import { BootstrapResponse } from "@open-macaron/contracts";
import pRetry, { AbortError } from "p-retry";
import { zBootstrapResponse } from "./generated/controller/zod.gen.ts";
import type { BootstrapData } from "./generated/controller/types.gen.ts";

/** 425: the controller hasn't recorded this run's dispatch yet. Worth retrying for a short while. */
const TOO_EARLY = 425;

/**
 * POST /v1/bootstrap. The wire format is validated with the schemas generated from the
 * controller's OpenAPI document, then parsed into the domain types shared through contracts.
 */
export async function bootstrap(controllerUrl: string, body: BootstrapData["body"], oidcToken: string): Promise<BootstrapResponse> {
  return pRetry(
    async () => {
      const response = await fetch(new URL("/v1/bootstrap", controllerUrl), {
        method: "POST",
        headers: { authorization: `Bearer ${oidcToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === TOO_EARLY || response.status >= 500) throw new Error(`controller answered ${String(response.status)}`);
      if (!response.ok) throw new AbortError(`bootstrap refused: HTTP ${String(response.status)} ${await response.text()}`);
      const wire = zBootstrapResponse.parse(await response.json());
      return BootstrapResponse.parse(wire);
    },
    { retries: 8, minTimeout: 1_000, maxTimeout: 10_000, maxRetryTime: 90_000 },
  );
}
