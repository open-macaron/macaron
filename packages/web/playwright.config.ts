import { defineConfig, devices } from "@playwright/test";
import { PORTS as ports } from "./e2e/ports.ts";

/**
 * End-to-end tests of the production build (`pnpm build` first), in Chromium, behind a stand-in
 * for the edge and against a fake controller (e2e/): the topology of production, without GitHub.
 */

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${String(ports.edge)}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "node e2e/fake-controller.ts", port: ports.controller, reuseExistingServer: false },
    {
      command: "node build/index.js",
      port: ports.web,
      reuseExistingServer: false,
      // As in production (deploy/openshift/web.yaml): the edge says which protocol the client used.
      env: { PORT: String(ports.web), HOST: "127.0.0.1", CONTROLLER_URL: `http://127.0.0.1:${String(ports.controller)}`, PROTOCOL_HEADER: "x-forwarded-proto" },
    },
    { command: "node e2e/edge.ts", port: ports.edge, reuseExistingServer: false },
  ],
});
