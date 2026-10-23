/**
 * The production edge, as far as the web app is concerned (deploy/openshift/edge/nginx.conf):
 * /api/auth/* goes to the controller, everything else to the web app, with the protocol the
 * router saw. For the end-to-end tests only.
 */
import { createServer, request as forward } from "node:http";
import { PORTS } from "./ports.ts";

createServer((request, response) => {
  const toController = request.url?.startsWith("/api/auth/") === true;
  const upstream = forward(
    {
      host: "127.0.0.1",
      port: toController ? PORTS.controller : PORTS.web,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, "x-forwarded-proto": "http", ...(toController ? { "x-through-edge": "1" } : {}) },
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
}).listen(PORTS.edge, "127.0.0.1", () => {
  console.info(`edge on ${String(PORTS.edge)}`);
});
