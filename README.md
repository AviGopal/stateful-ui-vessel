# stateful-ui-vessel

The substrate's "face." Holds an in-memory pool of panels + interactor*
impulses (events, asserts, attachments, feedback, observations) and serves
them through a three-region UI (POOL | EXECUTION | DECISIONS).

Port `8270` (host-mapped at `18270`). Discovery-registered.

## Architecture (v0.2)

Substrate authors panels via `uiPanel_write` / `uiQuestion_write` impulses
dispatched through dev-vessel. Operator interactions in the browser POST
to vessel endpoints which (a) record durably in the in-memory pool and
(b) emit `*_write` impulses back through dev-vessel for substrate
consumption.

```
substrate → uiPanel_write   → dev-vessel → stateful-ui-vessel pool → browser
browser   → /api/feedback   → stateful-ui pool → uiFeedback_write → dev-vessel
browser   → /api/events     → stateful-ui pool → interactorEvent_write
browser   → /api/assertions → stateful-ui pool → interactorAssertion_write
browser   → /api/dismiss    → stateful-ui pool → interactorDismiss_write
browser   → /api/attachments → stateful-ui pool → interactorAttachment_write
```

## Shapes

Advertised (read + write):

- `uiPanel_write`, `uiQuestion_write` — substrate-side panel authoring
- `uiFeedback` — operator answers / dismisses on asks
- `interactorObservation` — raw behavioural telemetry (click/dwell/focus)
- `interactorEvent` — structured event with type + target
- `interactorAssertion` — operator-typed substrate-bound facts
- `interactorAttachment` — operator-supplied pointer references

## Visibility contract

Every record carries `visibility: "public" | "operator_only"`. Defaults:

| Impulse | Default visibility |
|---|---|
| Panel | `public` |
| Feedback (answer/dismiss) | `public` |
| Observation | `operator_only` |
| Event | `public` (overridable) |
| Assertion | `operator_only` |
| Attachment | `operator_only` |

The bottom interactor bar in the UI exposes a toggle so the operator can
override per-message.

**Downstream filter (NOT YET IMPLEMENTED — v0.3 follow-up):**
`getImpulsesForLLMContext` in goal-host-vessel should filter
`visibility !== 'public'` before serialising into LLM prompts. Until that
filter ships, operator_only assertions still tag the impulse but are not
mechanically redacted from prompts. Operators should treat operator_only
as a request-for-redaction, not a guarantee.

## Endpoints

```
GET  /                      HTML UI (React via esm.sh)
GET  /health
GET  /shapes
GET  /api/state             pool snapshot
GET  /api/stream            SSE — panel_added, feedback_received, …
GET  /api/signature-inputs  4 fields for substrate state-signature
GET  /api/recent-traces     activity-api proxy
GET  /api/proxy/fs_read
GET  /api/proxy/http_fetch
GET  /api/proxy/sse
POST /api/panels            substrate-only authoring path (alternative to /resolve)
POST /api/feedback
POST /api/observations
POST /api/events
POST /api/assertions
POST /api/dismiss
POST /api/attachments
POST /resolve               discovery contract — uiPanel_write / uiQuestion_write
```

## State-signature integration

`GET /api/signature-inputs` returns four counters consumed by
`compute_state_signature` in dev-vessel. Operator presence (recent events,
unanswered asks, pending assertions, open panels) becomes part of the
substrate's deterministic signature — so the substrate distinguishes
"operator silent" from "operator active" states when learning template
performance.

## Open follow-ups (v0.3+)

1. **Visibility filter in goal-host context-builder** — make
   `operator_only` mechanically respected by the LLM context.
2. **Dwell time instrumentation** — `IntersectionObserver` driving
   `POST /api/observations` with type=dwell + duration_ms.
3. **Durable pool** — pin panels to a small SurrealDB table or flat-file
   journal so substrate restarts don't lose conversation state.
4. **Substrate-side renderer registration** — `uiRenderer_register` shape
   so substrate activities can ship new renderers without editing this
   vessel's source.
5. **Activity-api-backed durability** — `interactorEvent` etc become
   first-class activity-api shapes with their own SurrealDB tables,
   enabling cross-substrate aggregation.
