/**
 * In-memory store for the substrate's face.
 *
 * v0.2: extended from panel-only to a full pool model:
 *   - panels       (substrate-authored UI artifacts)
 *   - feedback     (operator answers/dismisses on asks)
 *   - observations (behavioural telemetry — click/dwell/focus/scroll)
 *   - events       (interactorEvent — clicks/dismisses, structured for upstream learning)
 *   - asserts      (interactorAssertion — operator-typed substrate-bound facts)
 *   - attachments  (interactorAttachment — operator-supplied references)
 *
 * Every record carries `visibility: "public" | "operator_only"`. Public records
 * may flow into the substrate's LLM context; operator_only records stay in the
 * pool but downstream filters (goal-host context-builder) must redact them.
 *
 * No persistence yet — substrate restart clears all stores. Durable backing
 * is a v0.3 follow-up.
 */
const panels = new Map();
const feedback = [];
const observations = [];
const events = [];
const asserts = [];
const attachments = [];
const MAX_HISTORY = 500;
// ── Durable backing (2026-08-28) ─────────────────────────────────────────────
// Panels and feedback are the escalation channel: gap-to-feature posts a
// "Gap needs a human decision" panel whenever hopeless() excludes a gap. Holding
// those only in memory meant a vessel restart destroyed every unanswered
// question with no record it was ever asked — measured, 194 panels to 0 across
// one restart. hopeless() escalates exactly the gaps that need a SLOW human
// decision, which are exactly the ones that would not survive to be answered.
// Only panels + feedback are persisted; observations/events/asserts/attachments
// are telemetry and stay in memory.
const STORE_PATH = process.env["UI_STORE_PATH"] ?? "/workspace/state/ui-panel-store.json";
let lastPersistAt = 0;
let persistTimer = null;
function writeNow() {
    lastPersistAt = Date.now();
    try {
        const snapshot = JSON.stringify({ panels: Array.from(panels.values()), feedback });
        void Bun.write(STORE_PATH, snapshot).catch(() => { });
    }
    catch { /* a store write must never break a resolve */ }
}
// Coalesce bursts: write at most once per 2s, but never DROP the last write.
function persist() {
    const since = Date.now() - lastPersistAt;
    if (since >= 2000) {
        writeNow();
        return;
    }
    if (persistTimer)
        return;
    persistTimer = setTimeout(() => { persistTimer = null; writeNow(); }, 2000 - since);
}
function hydrate() {
    try {
        const raw = require("node:fs").readFileSync(STORE_PATH, "utf8");
        const saved = JSON.parse(raw);
        for (const pn of saved.panels ?? [])
            if (pn && typeof pn.id === "string")
                panels.set(pn.id, pn);
        for (const f of saved.feedback ?? [])
            if (f && typeof f.panelId === "string")
                feedback.push(f);
        while (feedback.length > MAX_HISTORY)
            feedback.shift();
    }
    catch { /* absent or corrupt — start empty, exactly as before */ }
}
hydrate();
const listeners = new Set();
export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
function emit(event, data) {
    for (const l of listeners) {
        try {
            l({ event, data });
        }
        catch { /* ignore */ }
    }
}
function rid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function norm(v, fallback) {
    return v === "public" || v === "operator_only" ? v : fallback;
}
export function upsertPanel(p) {
    const now = Date.now();
    const existing = panels.get(p.id);
    const stored = {
        ...p,
        visibility: norm(p.visibility, "public"),
        createdAt: existing?.createdAt ?? p.createdAt ?? now,
        updatedAt: now,
    };
    panels.set(p.id, stored);
    persist();
    emit(existing ? "panel_updated" : "panel_added", stored);
    return stored;
}
export function listPanels() {
    return Array.from(panels.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function recordFeedback(f) {
    const entry = {
        ...f,
        visibility: norm(f.visibility, "public"),
        receivedAt: Date.now(),
    };
    feedback.push(entry);
    if (feedback.length > MAX_HISTORY)
        feedback.shift();
    persist();
    emit("feedback_received", entry);
    return entry;
}
export function recentFeedback(limit = 50) {
    return feedback.slice(-limit).reverse();
}
export function recordObservation(o) {
    const entry = {
        ...o,
        visibility: norm(o.visibility, "operator_only"),
        observedAt: Date.now(),
    };
    observations.push(entry);
    if (observations.length > MAX_HISTORY)
        observations.shift();
    return entry;
}
export function recentObservations(limit = 50) {
    return observations.slice(-limit).reverse();
}
export function recordEvent(e) {
    const entry = {
        ...e,
        id: e.id ?? rid("evt"),
        visibility: norm(e.visibility, "public"),
        occurredAt: Date.now(),
    };
    events.push(entry);
    if (events.length > MAX_HISTORY)
        events.shift();
    emit("event_recorded", entry);
    return entry;
}
export function recentEvents(limit = 50) {
    return events.slice(-limit).reverse();
}
export function recordAssertion(a) {
    const entry = {
        ...a,
        id: a.id ?? rid("asn"),
        visibility: norm(a.visibility, "operator_only"),
        assertedAt: Date.now(),
    };
    asserts.push(entry);
    if (asserts.length > MAX_HISTORY)
        asserts.shift();
    emit("assertion_recorded", entry);
    return entry;
}
export function recentAsserts(limit = 50) {
    return asserts.slice(-limit).reverse();
}
export function recordAttachment(a) {
    const entry = {
        ...a,
        id: a.id ?? rid("att"),
        visibility: norm(a.visibility, "operator_only"),
        attachedAt: Date.now(),
    };
    attachments.push(entry);
    if (attachments.length > MAX_HISTORY)
        attachments.shift();
    emit("attachment_recorded", entry);
    return entry;
}
export function recentAttachments(limit = 50) {
    return attachments.slice(-limit).reverse();
}
export function signatureInputs() {
    const now = Date.now();
    const recentWindow = now - 300_000;
    const recentEventsCount = events.reduce((n, e) => (e.occurredAt >= recentWindow ? n + 1 : n), 0);
    // Asks are unanswered when no feedback with kind:"answer" has been recorded
    // for their panel within the recent window. Use panel age as proxy for
    // ask age since asks share a panel timestamp.
    const answeredPanels = new Set();
    for (const f of feedback) {
        if (f.kind === "answer")
            answeredPanels.add(f.panelId);
    }
    const dismissedPanels = new Set();
    for (const f of feedback) {
        if (f.kind === "dismiss")
            dismissedPanels.add(f.panelId);
    }
    const ages = [];
    let panelsOpen = 0;
    for (const p of panels.values()) {
        const isOpen = !dismissedPanels.has(p.id) && !answeredPanels.has(p.id);
        if (isOpen)
            panelsOpen += 1;
        if ((p.asks?.length ?? 0) > 0 && !answeredPanels.has(p.id)) {
            ages.push(now - p.createdAt);
        }
    }
    ages.sort((a, b) => a - b);
    const p95 = ages.length === 0
        ? 0
        : ages[Math.min(ages.length - 1, Math.floor(ages.length * 0.95))] ?? 0;
    // Assertions are "pending" until the substrate produces a trace whose
    // metadata references them. Until that wiring lands, treat every recent
    // operator_only assertion as pending.
    const pendingAsserts = asserts.reduce((n, a) => a.visibility === "operator_only" && a.assertedAt >= recentWindow ? n + 1 : n, 0);
    return {
        recent_interactor_events_count: recentEventsCount,
        unanswered_asks_age_ms_p95: p95,
        operator_assertion_pending_count: pendingAsserts,
        panels_open_count: panelsOpen,
    };
}
//# sourceMappingURL=store.js.map