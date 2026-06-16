/**
 * Embedded HTML/React frontend for stateful-ui-vessel. v0.2.
 *
 * Three-region layout (POOL | EXECUTION | DECISIONS) + bottom interactor bar.
 * React via esm.sh, no build step, plain CSS. Shape→renderer + pointer→fetcher
 * registries live client-side; pointer resolution flows through vessel proxy
 * endpoints which delegate to dev-vessel's resolver chain.
 */

export const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Substrate face</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { color-scheme: dark; --bg:#0d1117; --fg:#e6edf3; --muted:#7d8590;
          --card:#161b22; --border:#21262d; --accent:#238636; --warn:#7f1d1d;
          --info:#1e3a8a; --code:#0a0f15; }
  * { box-sizing: border-box; }
  body { margin:0; font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;
         background:var(--bg); color:var(--fg); display:flex; flex-direction:column;
         height:100vh; overflow:hidden; }
  header { padding:8px 16px; border-bottom:1px solid var(--border);
           background:var(--card); display:flex; align-items:baseline; gap:12px; }
  header h1 { margin:0; font-size:14px; font-weight:600; }
  header .meta { color:var(--muted); font-size:11px; }
  main { flex:1; display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1px;
         background:var(--border); overflow:hidden; }
  .col { background:var(--bg); display:flex; flex-direction:column; overflow:hidden; }
  .col-head { padding:8px 12px; font-size:11px; font-weight:600; letter-spacing:1px;
              color:var(--muted); border-bottom:1px solid var(--border);
              background:var(--card); text-transform:uppercase; }
  .col-body { flex:1; overflow:auto; padding:8px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:6px;
          padding:10px 12px; margin-bottom:8px; }
  .card-head { display:flex; justify-content:space-between; align-items:baseline;
               gap:8px; }
  .card-title { font-weight:600; font-size:13px; }
  .card-body { color:#c9d1d9; margin-top:6px; }
  .card-body pre { background:var(--code); padding:8px; border-radius:4px;
                   overflow:auto; max-height:300px; }
  .badge { display:inline-block; padding:1px 6px; border-radius:999px; font-size:10px;
           background:#1f2937; color:#9ca3af; margin-left:4px; }
  .badge.high { background:var(--warn); color:#fecaca; }
  .badge.medium { background:#78350f; color:#fed7aa; }
  .badge.low { background:var(--info); color:#bfdbfe; }
  .badge.op { background:#3b0764; color:#e9d5ff; }
  .ask { display:flex; gap:8px; align-items:center; margin-top:6px; }
  .ask label { flex:0 0 auto; color:#9ca3af; font-size:12px; }
  .ask input, .ask select, .ask textarea { flex:1; background:var(--bg);
           color:var(--fg); border:1px solid #30363d; border-radius:4px;
           padding:4px 8px; font:inherit; }
  button { background:var(--accent); color:#fff; border:0; border-radius:4px;
           padding:5px 10px; cursor:pointer; font:inherit; }
  button.secondary { background:#30363d; }
  button.danger { background:var(--warn); }
  button:disabled { opacity:0.5; cursor:not-allowed; }
  .empty { color:var(--muted); padding:24px; text-align:center; font-style:italic; }
  .row-actions { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
  footer { border-top:1px solid var(--border); background:var(--card); padding:10px 16px;
           display:flex; gap:8px; align-items:center; }
  footer textarea { flex:1; background:var(--bg); color:var(--fg);
           border:1px solid #30363d; border-radius:4px; padding:6px 8px;
           font:inherit; resize:vertical; min-height:34px; max-height:100px; }
  footer select { background:var(--bg); color:var(--fg);
           border:1px solid #30363d; border-radius:4px; padding:6px; font:inherit; }
  .small { font-size:11px; color:var(--muted); }
  .json-tree { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
               font-size:12px; }
  .json-key { color:#7ee787; }
  .json-str { color:#a5d6ff; }
  .json-num { color:#79c0ff; }
  .json-bool { color:#ff7b72; }
  .gap-card { border-left:3px solid #fbbf24; padding-left:8px; }
  .decision-card { border-left:3px solid #60a5fa; padding-left:8px; }
  details > summary { cursor:pointer; user-select:none; }
  .event-line { font-size:11px; color:var(--muted); padding:2px 0;
                font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
</style>
</head>
<body>
<header>
  <h1>substrate face</h1>
  <span class="meta" id="meta">connecting…</span>
</header>
<main id="root"></main>
<footer>
  <textarea id="assertion" placeholder="tell the substrate something…" rows="1"></textarea>
  <select id="vis">
    <option value="operator_only">operator_only</option>
    <option value="public">public</option>
  </select>
  <button id="send">send</button>
</footer>

<script type="module">
import React, { useState, useEffect, useMemo, useCallback } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { marked } from "https://esm.sh/marked@12.0.2";

const h = React.createElement;

// ─── Renderer registry (shape → React component) ──────────────────────────
function MarkdownView({ content }) {
  const html = useMemo(() => marked.parse(String(content ?? ""), { breaks: true }), [content]);
  return h("div", { className: "card-body markdown", dangerouslySetInnerHTML: { __html: html } });
}

function JsonTreeView({ content, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  if (content === null || content === undefined) return h("span", { className: "json-str" }, "null");
  if (typeof content === "string") return h("span", { className: "json-str" }, JSON.stringify(content));
  if (typeof content === "number") return h("span", { className: "json-num" }, String(content));
  if (typeof content === "boolean") return h("span", { className: "json-bool" }, String(content));
  if (Array.isArray(content)) {
    return h("div", { className: "json-tree" },
      h("span", { onClick: () => setOpen(!open), style: { cursor: "pointer" } },
        open ? "▾ [" : "▸ [", !open && content.length + "]"),
      open && content.map((v, i) =>
        h("div", { key: i, style: { paddingLeft: 12 } },
          h(JsonTreeView, { content: v, depth: depth + 1 }))),
      open && "]"
    );
  }
  if (typeof content === "object") {
    const keys = Object.keys(content);
    return h("div", { className: "json-tree" },
      h("span", { onClick: () => setOpen(!open), style: { cursor: "pointer" } },
        open ? "▾ {" : "▸ {", !open && keys.length + " keys}"),
      open && keys.map(k =>
        h("div", { key: k, style: { paddingLeft: 12 } },
          h("span", { className: "json-key" }, k), ": ",
          h(JsonTreeView, { content: content[k], depth: depth + 1 }))),
      open && "}"
    );
  }
  return h("span", null, String(content));
}

function CodeView({ content, lang }) {
  return h("pre", null, h("code", { className: lang ? "lang-" + lang : "" }, String(content ?? "")));
}

function TraceTreeView({ content }) {
  const t = content || {};
  return h("details", { open: false },
    h("summary", null, h("strong", null, t.template_id || t.id || "trace"),
      " · ", h("span", { className: "small" }, (t.status || "?") + " · " + (t.duration_ms || 0) + "ms")),
    h("div", { style: { paddingLeft: 12, paddingTop: 6 } },
      (t.tasks || []).map((task, i) =>
        h("div", { key: i, className: "event-line" },
          "[" + (task.status || "?") + "] " + (task.id || task.resolver_id || "task " + i))))
  );
}

function FailureModeBadge({ content }) {
  const fm = content || {};
  return h("div", { className: "card-body" },
    h("span", { className: "badge high" }, fm.type || "failure"),
    " ", h("span", { className: "small" }, fm.reason || ""));
}

function GapCardView({ content }) {
  const g = content || {};
  return h("div", { className: "gap-card card-body" },
    h("div", null, h("strong", null, g.category || "gap")),
    h("div", { className: "small" }, g.description || JSON.stringify(g).slice(0, 200)));
}

function StreamView({ url }) {
  const [chunks, setChunks] = useState([]);
  useEffect(() => {
    if (!url) return;
    const es = new EventSource("/api/proxy/sse?url=" + encodeURIComponent(url));
    es.onmessage = (e) => setChunks(prev => [...prev, e.data].slice(-100));
    return () => es.close();
  }, [url]);
  return h("pre", { className: "card-body" }, chunks.join(""));
}

const renderers = {
  markdown: MarkdownView,
  json: JsonTreeView,
  code: CodeView,
  trace: TraceTreeView,
  failureMode: FailureModeBadge,
  substrateGap: GapCardView,
  streamingText: StreamView,
  default: JsonTreeView,
};

// ─── Fetcher registry (pointer.type → resolver) ───────────────────────────
const fetchers = {
  memo: (p) => Promise.resolve(p.content ?? p.body ?? ""),
  file: async (p) => {
    const r = await fetch("/api/proxy/fs_read?path=" + encodeURIComponent(p.path || ""));
    const j = await r.json();
    return j?.body?.body ?? j?.body ?? "";
  },
  http_fetch: async (p) => {
    const r = await fetch("/api/proxy/http_fetch?url=" + encodeURIComponent(p.url || ""));
    const j = await r.json();
    return j?.body?.body ?? j?.body ?? "";
  },
  sse_url: (p) => p.url, // StreamView handles the EventSource
};

async function resolvePointer(p) {
  if (!p || typeof p !== "object") return null;
  const fn = fetchers[p.type] || fetchers.memo;
  try {
    return await fn(p);
  } catch (err) {
    return { error: String(err) };
  }
}

// ─── Pool column ──────────────────────────────────────────────────────────
function PanelCard({ panel, onAnswer, onDismiss, onObserve }) {
  const Renderer = renderers[panel.kind] || renderers.default;
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    onObserve("focus", panel.id);
  }, [panel.id]);

  const submit = useCallback(() => {
    for (const ask of panel.asks || []) {
      const v = answers[ask.id];
      if (v !== undefined) onAnswer(panel.id, ask.id, v);
    }
    setAnswers({});
  }, [panel, answers]);

  return h("div", { className: "card", "data-panel-id": panel.id },
    h("div", { className: "card-head" },
      h("div", { className: "card-title" }, panel.title),
      h("div", null,
        h("span", { className: "badge " + panel.importance }, panel.importance),
        h("span", { className: "badge" }, panel.kind),
        panel.visibility === "operator_only" && h("span", { className: "badge op" }, "op"))),
    panel.body && h(MarkdownView, { content: panel.body }),
    (panel.asks || []).map(ask =>
      h("div", { key: ask.id, className: "ask" },
        h("label", null, ask.prompt),
        ask.type === "choice" && ask.choices
          ? h("select", {
              value: answers[ask.id] ?? "",
              onChange: e => setAnswers(a => ({ ...a, [ask.id]: e.target.value })),
            }, h("option", { value: "" }, "—"), ask.choices.map(c => h("option", { key: c }, c)))
          : h("input", {
              type: ask.type === "number" ? "number" : "text",
              value: answers[ask.id] ?? "",
              onChange: e => setAnswers(a => ({ ...a, [ask.id]: e.target.value })),
            }))),
    h("div", { className: "row-actions" },
      (panel.asks || []).length > 0 && h("button", { onClick: submit }, "submit"),
      h("button", { className: "secondary", onClick: () => onDismiss(panel.id) }, "dismiss")));
}

function PoolColumn({ state, onAnswer, onDismiss, onObserve }) {
  if (!state.panels.length) {
    return h("div", { className: "empty" }, "no panels — the substrate hasn't spoken.");
  }
  return h(React.Fragment, null,
    state.panels.map(p => h(PanelCard, {
      key: p.id, panel: p, onAnswer, onDismiss, onObserve,
    })));
}

// ─── Execution column ─────────────────────────────────────────────────────
function ExecutionColumn() {
  const [traces, setTraces] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/recent-traces");
        const j = await r.json();
        if (!cancelled) setTraces(j.executions || j.traces || []);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);
  if (err) return h("div", { className: "empty" }, "trace fetch failed: " + err);
  if (!traces.length) return h("div", { className: "empty" }, "no recent traces");
  return h(React.Fragment, null,
    traces.slice(0, 10).map((t, i) =>
      h("div", { key: t.id || i, className: "card" },
        h(TraceTreeView, { content: t }))));
}

// ─── Decisions column ─────────────────────────────────────────────────────
function DecisionsColumn({ state }) {
  // Show recent events + asserts + attachments as the "audit log" of
  // substrate-visible operator actions.
  const items = [
    ...state.events.map(e => ({ kind: "event", ts: e.occurredAt, item: e })),
    ...state.asserts.map(a => ({ kind: "assert", ts: a.assertedAt, item: a })),
    ...state.attachments.map(a => ({ kind: "attach", ts: a.attachedAt, item: a })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 30);
  if (!items.length) {
    return h("div", { className: "empty" }, "no decisions yet — interact to populate");
  }
  return h(React.Fragment, null, items.map((x, i) => {
    if (x.kind === "assert") {
      return h("div", { key: i, className: "card decision-card" },
        h("div", null, h("strong", null, x.item.kind),
          h("span", { className: "badge " + (x.item.visibility === "operator_only" ? "op" : "low") },
            x.item.visibility)),
        h("div", { className: "card-body" }, x.item.body));
    }
    if (x.kind === "attach") {
      return h("div", { key: i, className: "card decision-card" },
        h("div", null, h("strong", null, "attachment"),
          x.item.note && h("span", { className: "small" }, " " + x.item.note)),
        h(JsonTreeView, { content: x.item.pointer }));
    }
    return h("div", { key: i, className: "event-line" },
      "[" + x.item.type + "] " + (x.item.target || x.item.panelId || "—"));
  }));
}

// ─── App ──────────────────────────────────────────────────────────────────
function App() {
  const [state, setState] = useState({
    panels: [], feedback: [], observations: [],
    events: [], asserts: [], attachments: [],
  });
  const [metaText, setMetaText] = useState("connecting…");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/state");
      setState(await r.json());
    } catch (e) {
      setMetaText("disconnected");
    }
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/stream");
    es.addEventListener("hello", () => setMetaText("live"));
    const refresh = () => load();
    ["panel_added","panel_updated","feedback_received",
     "event_recorded","assertion_recorded","attachment_recorded"].forEach(ev =>
      es.addEventListener(ev, refresh));
    es.onerror = () => setMetaText("reconnecting…");
    return () => es.close();
  }, [load]);

  useEffect(() => {
    document.getElementById("meta").textContent = metaText;
  }, [metaText]);

  const post = async (path, body) => {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  };

  const onAnswer = (panel_id, ask_id, value) => {
    void post("/api/feedback", { panel_id, ask_id, value, kind: "answer", visibility: "public" });
    void post("/api/events", { type: "click", target: "answer:" + panel_id + ":" + ask_id, panel_id });
  };
  const onDismiss = (panel_id) => {
    void post("/api/feedback", { panel_id, kind: "dismiss", visibility: "public" });
    void post("/api/events", { type: "dismiss", target: "panel:" + panel_id, panel_id });
  };
  const onObserve = (type, panel_id) => {
    void fetch("/api/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, panel_id }),
    });
  };

  // Bottom bar: assertion box
  useEffect(() => {
    const ta = document.getElementById("assertion");
    const send = document.getElementById("send");
    const vis = document.getElementById("vis");
    const onSend = async () => {
      const body = ta.value.trim();
      if (!body) return;
      await post("/api/assertions", { kind: "context", body, visibility: vis.value });
      ta.value = "";
    };
    send.addEventListener("click", onSend);
    const onKey = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSend(); };
    ta.addEventListener("keydown", onKey);
    return () => { send.removeEventListener("click", onSend); ta.removeEventListener("keydown", onKey); };
  }, [load]);

  return h(React.Fragment, null,
    h("section", { className: "col" },
      h("div", { className: "col-head" }, "POOL"),
      h("div", { className: "col-body" }, h(PoolColumn, { state, onAnswer, onDismiss, onObserve }))),
    h("section", { className: "col" },
      h("div", { className: "col-head" }, "EXECUTION"),
      h("div", { className: "col-body" }, h(ExecutionColumn, null))),
    h("section", { className: "col" },
      h("div", { className: "col-head" }, "DECISIONS"),
      h("div", { className: "col-body" }, h(DecisionsColumn, { state }))));
}

createRoot(document.getElementById("root")).render(h(App, null));
</script>
</body>
</html>`;

