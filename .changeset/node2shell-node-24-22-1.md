---
"@open-macaron/controller": patch
"@open-macaron/web": patch
---

Run on Node.js 24.22.1 with libbrotli 1.2.1, which fix CVE-2026-111497 (Node2Shell, remote code execution in the Brotli decoder). The images now build on Red Hat's hardened Hummingbird Node.js images: UBI's have no fix yet.
