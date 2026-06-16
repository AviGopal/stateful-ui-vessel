/**
 * stateful-ui-vessel — the substrate's "face." v0.2.
 *
 * Three-region pool/execution/decisions UI, shape→renderer + pointer→fetcher
 * registries, and real interactor* impulses. Interactor inputs are written
 * locally and also passed through dev-vessel's discovery contract so any
 * downstream consumer (gap consumer, future activity-api shape) can subscribe.
 *
 * Port 8270.
 */

import { Hono } from "hono";
import {
  upsertPanel,
  listPanels,
  recordFeedback,
  recentFeedback,
  recordObservation,
  recentObservations,
  recordEvent,
  recentEvents,
  recordAssertion,
  recentAsserts,
  recordAttachment,
  recentAttachments,
  signatureInputs,
  subscribe,
  type Ask,
  type Visibility,
} from "./store.js";
import { startDiscoveryRegistration } from "./discovery.js";

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? "8270", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const VESSEL_ID = process.env.STATEFUL_UI_VESSEL_ID ?? process.env.VESSEL_ID ?? "stateful-ui-vessel";
const DISCOVERY_ENDPOINT = process.env.DISCOVERY_VESSEL_ENDPOINT ?? "http://127.0.0.1:8100";
const DEV_VESSEL_ENDPOINT = process.env.DEV_VESSEL_ENDPOINT ?? "http://127.0.0.1:8090";
const ACTIVITY_API_ENDPOINT = process.env.ACTIVITY_API_ENDPOINT ?? "http://127.0.0.1:8080";
const API_KEY = process.env.METABOB_API_KEY ?? "";

const SHAPES = [
  "uiPanel_write",
  "uiQuestion_write",
  "uiFeedback",
  "interactorObservation",
  "interactorEvent",
  "interactorAssertion",
  "interactorAttachment",
];

// ─── Upstream emission ──────────────────────────────────────────────────────
async function emitToDevVessel(pointer: Record<string, unknown>): Promise<void> {
  if (!API_KEY) return;
  try {
    await fetch(`${DEV_VESSEL_ENDPOINT}/v2/impulses/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `ApiKey ${API_KEY}`,
      },
      body: JSON.stringify({ impulse: { pointer } }),
    });
  } catch (err) {
    console.warn(
      `[emit] failed (${pointer.type}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function asVisibility(v: unknown, fallback: Visibility): Visibility {
  return v === "public" || v === "operator_only" ? v : fallback;
}

// ─── HTTP ───────────────────────────────────────────────────────────────────
const app = new Hono();

app.get("/health", (c) =>
  c.json({ status: "ok", vessel: VESSEL_ID, port: PORT, panels: listPanels().length }),
);

app.get("/shapes", (c) => c.json({ shapes: SHAPES }));

app.get("/api/state", (c) =>
  c.json({
    panels: listPanels(),
    feedback: recentFeedback(20),
    observations: recentObservations(20),
    events: recentEvents(50),
    asserts: recentAsserts(30),
    attachments: recentAttachments(30),
  }),
);

app.get("/api/signature-inputs", (c) => c.json(signatureInputs()));

// ─── Substrate writes (resolver path) ───────────────────────────────────────
app.post("/api/panels", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    id?: string; title?: string; body?: string; kind?: string;
    importance?: string; asks?: Ask[]; visibility?: Visibility;
  };
  if (!body || !body.id || !body.title) {
    return c.json({ error: "id and title required" }, 400);
  }
  const panel = upsertPanel({
    id: body.id,
    title: body.title,
    body: body.body ?? "",
    kind: body.kind ?? "info",
    importance: body.importance ?? "medium",
    asks: body.asks,
    visibility: asVisibility(body.visibility, "public"),
  });
  return c.json({ ok: true, panel });
});

// ─── Operator writes (interactor* impulses) ─────────────────────────────────

/** uiFeedback — response to an ask, or a dismiss. */
app.post("/api/feedback", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    panel_id?: string; ask_id?: string; value?: unknown;
    kind?: "answer" | "reaction" | "dismiss"; visibility?: Visibility;
  };
  if (!body || !body.panel_id) {
    return c.json({ error: "panel_id required" }, 400);
  }
  const entry = recordFeedback({
    panelId: body.panel_id,
    askId: body.ask_id,
    value: body.value,
    kind: body.kind ?? "answer",
    visibility: asVisibility(body.visibility, "public"),
  });
  void emitToDevVessel({
    type: "uiFeedback_write",
    id: `uf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    panel_id: entry.panelId,
    ask_id: entry.askId,
    value: entry.value,
    kind: entry.kind,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true, feedback: entry });
});

/** interactorObservation — low-level behavioural telemetry. */
app.post("/api/observations", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    type?: "click" | "dwell" | "scroll" | "focus";
    panel_id?: string; ask_id?: string; duration_ms?: number;
    position?: { x: number; y: number }; visibility?: Visibility;
  };
  if (!body || !body.type) {
    return c.json({ error: "type required" }, 400);
  }
  const entry = recordObservation({
    type: body.type,
    panelId: body.panel_id,
    askId: body.ask_id,
    durationMs: body.duration_ms,
    position: body.position,
    visibility: asVisibility(body.visibility, "operator_only"),
  });
  void emitToDevVessel({
    type: "interactorObservation",
    obs_type: entry.type,
    panel_id: entry.panelId,
    ask_id: entry.askId,
    duration_ms: entry.durationMs,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true });
});

/** interactorEvent — higher-level event with target + body (e.g. fetched a pointer). */
app.post("/api/events", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    type?: "click" | "dismiss" | "expand" | "collapse" | "focus" | "fetch";
    target?: string; panel_id?: string; body?: Record<string, unknown>;
    visibility?: Visibility;
  };
  if (!body || !body.type) {
    return c.json({ error: "type required" }, 400);
  }
  const entry = recordEvent({
    type: body.type,
    target: body.target,
    panelId: body.panel_id,
    body: body.body,
    visibility: asVisibility(body.visibility, "public"),
  });
  void emitToDevVessel({
    type: "interactorEvent_write",
    id: entry.id,
    event_type: entry.type,
    target: entry.target,
    panel_id: entry.panelId,
    body: entry.body,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true, event: entry });
});

/** interactorAssertion — operator-typed substrate-bound fact. */
app.post("/api/assertions", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    kind?: string; body?: string; visibility?: Visibility;
  };
  if (!body || typeof body.body !== "string" || body.body.trim() === "") {
    return c.json({ error: "body required" }, 400);
  }
  const entry = recordAssertion({
    kind: body.kind ?? "context",
    body: body.body,
    visibility: asVisibility(body.visibility, "operator_only"),
  });
  void emitToDevVessel({
    type: "interactorAssertion_write",
    id: entry.id,
    kind: entry.kind,
    body: entry.body,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true, assertion: entry });
});

/** interactorDismiss — explicit dismiss for arbitrary impulse (not just panel). */
app.post("/api/dismiss", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    target?: string; reason?: string; visibility?: Visibility;
  };
  if (!body || !body.target) {
    return c.json({ error: "target required" }, 400);
  }
  const entry = recordEvent({
    type: "dismiss",
    target: body.target,
    body: body.reason ? { reason: body.reason } : undefined,
    visibility: asVisibility(body.visibility, "public"),
  });
  void emitToDevVessel({
    type: "interactorDismiss_write",
    id: entry.id,
    target: entry.target,
    reason: body.reason,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true, event: entry });
});

/** interactorAttachment — operator-supplied pointer reference. */
app.post("/api/attachments", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    pointer?: Record<string, unknown>; note?: string; visibility?: Visibility;
  };
  if (!body || !body.pointer || typeof body.pointer !== "object") {
    return c.json({ error: "pointer required" }, 400);
  }
  const entry = recordAttachment({
    pointer: body.pointer,
    note: body.note,
    visibility: asVisibility(body.visibility, "operator_only"),
  });
  void emitToDevVessel({
    type: "interactorAttachment_write",
    id: entry.id,
    pointer: entry.pointer,
    note: entry.note,
    visibility: entry.visibility,
    source: VESSEL_ID,
  });
  return c.json({ ok: true, attachment: entry });
});

// ─── SSE stream ─────────────────────────────────────────────────────────────
app.get("/api/stream", (c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: { event: string; data: unknown }): void => {
        const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
        try { controller.enqueue(encoder.encode(payload)); } catch { /* closed */ }
      };
      send({ event: "hello", data: { vesselId: VESSEL_ID, ts: Date.now() } });
      const unsubscribe = subscribe(send);
      const keepalive = setInterval(() => send({ event: "ping", data: Date.now() }), 25_000);
      const onClose = (): void => {
        clearInterval(keepalive);
        unsubscribe();
        try { controller.close(); } catch { /* ignore */ }
      };
      c.req.raw.signal.addEventListener("abort", onClose);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// ─── Discovery contract (substrate dispatches) ──────────────────────────────
app.post("/resolve", async (c) => {
  const body = await c.req.json().catch(() => null) as null | {
    impulse?: { pointer?: Record<string, unknown> };
  };
  const pointer = body?.impulse?.pointer;
  if (!pointer || typeof pointer.type !== "string") {
    return c.json({ resolved: false, error: "missing impulse.pointer.type" }, 400);
  }
  const t = pointer.type;
  if (t === "uiPanel_write" || t === "uiQuestion_write") {
    const id = String(pointer.id ?? `panel-${Date.now()}`);
    const title = String(pointer.title ?? "Untitled");
    const panelBody = String(pointer.body ?? "");
    const kind = String(pointer.kind ?? (t === "uiQuestion_write" ? "question" : "info"));
    const importance = String(pointer.importance ?? "medium");
    const asks = Array.isArray(pointer.asks) ? (pointer.asks as Ask[]) : undefined;
    const visibility = asVisibility(pointer.visibility, "public");
    const panel = upsertPanel({ id, title, body: panelBody, kind, importance, asks, visibility });
    return c.json({ resolved: true, shape: t, body: panel });
  }
  return c.json({ resolved: false, error: `unsupported pointer.type: ${t}` }, 400);
});

// ─── Proxy endpoints (client → dev-vessel resolver chain) ───────────────────
const ALLOW_PROXY_HOSTS = [
  "127.0.0.1",
  "localhost",
  // substrate-internal vessel hosts (loopback inside container)
  "0.0.0.0",
];

function isAllowedProxyUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return ALLOW_PROXY_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function isAllowedPath(path: string): boolean {
  // Only allow paths under /workspace or /vessels (substrate-internal).
  return path.startsWith("/workspace/") || path.startsWith("/vessels/") ||
         path === "/workspace" || path === "/vessels";
}

app.get("/api/proxy/fs_read", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ ok: false, error: "path required" }, 400);
  if (!isAllowedPath(path)) {
    return c.json({ ok: false, error: "path outside /workspace or /vessels" }, 403);
  }
  if (!API_KEY) return c.json({ ok: false, error: "no API_KEY configured" }, 500);
  try {
    const res = await fetch(`${DEV_VESSEL_ENDPOINT}/v2/impulses/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${API_KEY}` },
      body: JSON.stringify({ impulse: { pointer: { type: "fs_read", path } } }),
    });
    const j = await res.json().catch(() => null);
    return c.json({ ok: res.ok, body: j });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/api/proxy/http_fetch", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ ok: false, error: "url required" }, 400);
  if (!isAllowedProxyUrl(url)) {
    return c.json({ ok: false, error: "url host not in allowlist" }, 403);
  }
  if (!API_KEY) return c.json({ ok: false, error: "no API_KEY configured" }, 500);
  try {
    const res = await fetch(`${DEV_VESSEL_ENDPOINT}/v2/impulses/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${API_KEY}` },
      body: JSON.stringify({ impulse: { pointer: { type: "http_fetch", url } } }),
    });
    const j = await res.json().catch(() => null);
    return c.json({ ok: res.ok, body: j });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

app.get("/api/proxy/sse", async (c) => {
  const url = c.req.query("url");
  if (!url || !isAllowedProxyUrl(url)) {
    return c.json({ ok: false, error: "url required + must be allowlisted" }, 403);
  }
  // Pipe upstream SSE through to client.
  try {
    const upstream = await fetch(url, { headers: { Accept: "text/event-stream" } });
    if (!upstream.body) return c.json({ ok: false, error: "upstream has no body" }, 502);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// Execution view: lightweight passthrough to activity-api for recent traces.
app.get("/api/recent-traces", async (c) => {
  if (!API_KEY) return c.json({ executions: [] });
  try {
    const res = await fetch(
      `${ACTIVITY_API_ENDPOINT}/v2/activities/execution-traces?limit=10`,
      { headers: { Authorization: `ApiKey ${API_KEY}` } },
    );
    const j = await res.json().catch(() => ({ executions: [] }));
    return c.json(j);
  } catch {
    return c.json({ executions: [] });
  }
});

// ─── Frontend ──────────────────────────────────────────────────────────────
import { HTML } from "./html.js";
app.get("/", (c) => c.html(HTML));

// ─── Start ──────────────────────────────────────────────────────────────────
const endpointPublic = `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}`;

startDiscoveryRegistration({
  discoveryEndpoint: DISCOVERY_ENDPOINT,
  apiKey: API_KEY,
  vesselId: VESSEL_ID,
  vesselName: "Stateful UI Vessel",
  endpoint: endpointPublic,
  shapes: SHAPES,
  resolveEndpoint: "/resolve",
});

console.log(
  `[stateful-ui-vessel] starting on ${HOST}:${PORT} | discovery=${DISCOVERY_ENDPOINT} | dev-vessel=${DEV_VESSEL_ENDPOINT}`,
);

export default {
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
};
