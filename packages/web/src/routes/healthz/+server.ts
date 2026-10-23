import type { RequestHandler } from "./$types";

/** Liveness for the cluster: the process answers, nothing else is checked. */
export const GET = (() => new Response("ok", { headers: { "cache-control": "no-store" } })) satisfies RequestHandler;
