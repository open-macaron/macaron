import type { IncomingMessage, ServerResponse } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";

/** A Node request handler: better-auth's `toNodeHandler(auth)`. */
export type NodeHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

/** Where better-auth answers: the edge routes this prefix here (deploy/openshift/edge/nginx.conf). */
export const AUTH_PATH_PREFIX = "/api/auth/";

/**
 * Sends /api/auth/* to better-auth, which reads its own request bodies. Call before the app is
 * initialised (listen): Nest registers its body parsers then, after this. Matched by hand rather
 * than mounted on a path, which would strip the prefix better-auth routes on.
 */
export function mountAuth(app: NestExpressApplication, handler: NodeHandler): void {
  app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.startsWith(AUTH_PATH_PREFIX) === true) void handler(request, response);
    else next();
  });
}
