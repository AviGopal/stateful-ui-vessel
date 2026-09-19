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
export type AskType = "text" | "choice" | "number";
export type Visibility = "public" | "operator_only";
export interface Ask {
    id: string;
    prompt: string;
    type: AskType;
    choices?: string[];
}
export interface Panel {
    id: string;
    title: string;
    body: string;
    kind: string;
    importance: string;
    asks?: Ask[];
    visibility: Visibility;
    createdAt: number;
    updatedAt: number;
}
export interface Feedback {
    panelId: string;
    askId?: string;
    value: unknown;
    kind: "answer" | "reaction" | "dismiss";
    visibility: Visibility;
    receivedAt: number;
}
export interface Observation {
    type: "click" | "dwell" | "scroll" | "focus";
    panelId?: string;
    askId?: string;
    durationMs?: number;
    position?: {
        x: number;
        y: number;
    };
    visibility: Visibility;
    observedAt: number;
}
export interface InteractorEvent {
    id: string;
    type: "click" | "dismiss" | "expand" | "collapse" | "focus" | "fetch";
    target?: string;
    panelId?: string;
    body?: Record<string, unknown>;
    visibility: Visibility;
    occurredAt: number;
}
export interface InteractorAssertion {
    id: string;
    kind: string;
    body: string;
    visibility: Visibility;
    assertedAt: number;
}
export interface InteractorAttachment {
    id: string;
    pointer: Record<string, unknown>;
    note?: string;
    visibility: Visibility;
    attachedAt: number;
}
type Listener = (event: {
    event: string;
    data: unknown;
}) => void;
export declare function subscribe(fn: Listener): () => void;
export declare function upsertPanel(p: Omit<Panel, "createdAt" | "updatedAt" | "visibility"> & {
    createdAt?: number;
    visibility?: Visibility;
}): Panel;
export declare function listPanels(): Panel[];
export declare function recordFeedback(f: Omit<Feedback, "receivedAt" | "visibility"> & {
    visibility?: Visibility;
}): Feedback;
export declare function recentFeedback(limit?: number): Feedback[];
export declare function recordObservation(o: Omit<Observation, "observedAt" | "visibility"> & {
    visibility?: Visibility;
}): Observation;
export declare function recentObservations(limit?: number): Observation[];
export declare function recordEvent(e: Omit<InteractorEvent, "id" | "occurredAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorEvent;
export declare function recentEvents(limit?: number): InteractorEvent[];
export declare function recordAssertion(a: Omit<InteractorAssertion, "id" | "assertedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorAssertion;
export declare function recentAsserts(limit?: number): InteractorAssertion[];
export declare function recordAttachment(a: Omit<InteractorAttachment, "id" | "attachedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorAttachment;
export declare function recentAttachments(limit?: number): InteractorAttachment[];
/** Inputs for the substrate's state-signature integration (slice 4). */
export interface SignatureInputs {
    recent_interactor_events_count: number;
    unanswered_asks_age_ms_p95: number;
    operator_assertion_pending_count: number;
    panels_open_count: number;
}
export declare function signatureInputs(): SignatureInputs;
export {};
//# sourceMappingURL=store.d.ts.map