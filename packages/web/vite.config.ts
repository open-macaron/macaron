import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  // Workspace packages (@open-macaron/contracts) resolve to their TypeScript sources: bundled, no build.
  resolve: { conditions: ["@open-macaron/source", ...defaultClientConditions] },
  ssr: { resolve: { conditions: ["@open-macaron/source", ...defaultServerConditions] } },
  // `pnpm dev` only: sign-in is the controller's (the edge routes /api/auth to it in production).
  server: { proxy: { "/api/auth": loadEnv(mode, import.meta.dirname, "")["CONTROLLER_URL"] ?? "http://127.0.0.1:8080" } },
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Runes everywhere in our code; libraries keep their own mode.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
        // Required by remote functions (`await` in components).
        experimental: { async: true },
      },
      // Remote functions (*.remote.ts) for every read and write: experimental in SvelteKit 3.
      experimental: { remoteFunctions: true },
      adapter: adapter(),
      // The app owns its CSP: no third-party origin, no framing. Hashes cover SvelteKit's inline bootstrap.
      csp: {
        mode: "auto",
        directives: {
          "default-src": ["self"],
          // The hash is mode-watcher's head script, which sets the theme before first paint (no flash).
          // It changes only with mode-watcher: a CSP error in the console after a bump gives the new one.
          // The second is Svelte's `this.__e=event`, which replays an <img>'s load/error events at hydration:
          // 'unsafe-hashes' allows only inline handlers whose text has a listed hash, nothing else.
          "script-src": [
            "self",
            "sha256-Cr3r+iKjDTUxJaxM3r/Iq0ow6clOB9AqoT6j0wMFMIM=",
            // The same script as the dev server serves it, unminified.
            "sha256-94WxU203ItVdYeuHa4UBPQzWANAxvaHV/BgTnRrE/14=",
            "unsafe-hashes",
            "sha256-7dQwUgLau1NFCCGjfn9FsYptB6ZtWxJin6VohGIu20I=",
          ],
          "style-src": ["self", "unsafe-inline"],
          "img-src": ["self", "data:", "https://avatars.githubusercontent.com"],
          "font-src": ["self"],
          "connect-src": ["self"],
          "form-action": ["self", "https://github.com"],
          "frame-ancestors": ["none"],
          "base-uri": ["none"],
          "object-src": ["none"],
        },
      },
    }),
  ],
}));
