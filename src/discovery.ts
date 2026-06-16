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

const HEARTBEAT_INTERVAL_MS = 60_000;

export interface DiscoveryConfig {
  discoveryEndpoint: string;
  apiKey: string;
  vesselId: string;
  vesselName: string;
  endpoint: string;
  shapes: string[];
  resolveEndpoint?: string;
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function buildPayload(cfg: DiscoveryConfig) {
  return {
    vesselId: cfg.vesselId,
    vesselName: cfg.vesselName,
    version: "0.1.0",
    endpoint: cfg.endpoint,
    shapes: cfg.shapes,
    resolve_endpoint: cfg.resolveEndpoint ?? "/resolve",
    resolve_request_format: "pointer",
    auth_scheme: "ApiKey",
    resolve_timeout_ms: 10_000,
    auth_token_source: "caller_identity" as const,
    auth_delegation_mode: "forward" as const,
  };
}

async function doRegister(cfg: DiscoveryConfig): Promise<void> {
  const res = await fetch(`${cfg.discoveryEndpoint}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `ApiKey ${cfg.apiKey}`,
    },
    body: JSON.stringify(buildPayload(cfg)),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`discovery register ${res.status}: ${text}`);
  }
}

async function doHeartbeat(cfg: DiscoveryConfig): Promise<void> {
  const res = await fetch(`${cfg.discoveryEndpoint}/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `ApiKey ${cfg.apiKey}`,
    },
    body: JSON.stringify({ vesselId: cfg.vesselId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`discovery heartbeat ${res.status}: ${text}`);
  }
}

export function startDiscoveryRegistration(cfg: DiscoveryConfig): void {
  doRegister(cfg)
    .then(() => {
      console.log(`[discovery] registered as ${cfg.vesselId}`);
      heartbeatTimer = setInterval(() => {
        doHeartbeat(cfg).catch((err) => {
          console.warn(`[discovery] heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
          doRegister(cfg).catch((e) => {
            console.warn(`[discovery] re-register failed: ${e instanceof Error ? e.message : String(e)}`);
          });
        });
      }, HEARTBEAT_INTERVAL_MS);
    })
    .catch((err) => {
      console.warn(`[discovery] registration failed (vessel still functional): ${err instanceof Error ? err.message : String(err)}`);
    });
}

export function stopDiscoveryRegistration(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
