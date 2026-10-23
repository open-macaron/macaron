import type { ShellUser } from "#lib/session.js";

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** Set by hooks.server.ts on every request; null without a session. */
      user: ShellUser | null;
    }
  }
}

export {};
