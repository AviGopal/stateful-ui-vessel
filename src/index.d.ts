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
declare const _default: {
    port: number;
    hostname: string;
    fetch: (request: Request, env?: unknown, executionCtx?: import("hono").ExecutionContext) => Response | Promise<Response>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map