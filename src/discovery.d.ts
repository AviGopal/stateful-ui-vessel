/**
 * Discovery registration for stateful-ui-vessel.
 *
 * Advertises:
 *   - uiPanel_write       (substrate posts a panel)
 *   - uiQuestion_write    (substrate posts a panel with asks[])
 *   - uiFeedback          (read: operator feedback)
 *   - interactorObservation (read: behavioral observations)
 *
 * Same DiscoveryRegistrationLoop pattern as development-vessel.
 */
export interface DiscoveryConfig {
    discoveryEndpoint: string;
    apiKey: string;
    vesselId: string;
    vesselName: string;
    endpoint: string;
    shapes: string[];
    resolveEndpoint?: string;
}
export declare function startDiscoveryRegistration(cfg: DiscoveryConfig): void;
export declare function stopDiscoveryRegistration(): void;
//# sourceMappingURL=discovery.d.ts.map