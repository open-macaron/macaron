import { OpenRouterCore } from "@openrouter/sdk/core.js";
import { apiKeysCreate } from "@openrouter/sdk/funcs/apiKeysCreate.js";
import { apiKeysGet } from "@openrouter/sdk/funcs/apiKeysGet.js";
import { apiKeysUpdate } from "@openrouter/sdk/funcs/apiKeysUpdate.js";
import { apiKeysDelete } from "@openrouter/sdk/funcs/apiKeysDelete.js";
import { workspacesList } from "@openrouter/sdk/funcs/workspacesList.js";
const core = new OpenRouterCore({ apiKey: process.env.OPENROUTER_PROVISIONING_KEY });
const workspaceId = (await workspacesList(core, {})).value.result.data.find((w) => w.slug === "macaron").id;
const keys = {};
for (const label of ["frozen", "active"]) {
  const r = await apiKeysCreate(core, { requestBody: { name: `macaron-run-lag-${label}-${Date.now()}`, limit: 0.01, workspaceId, expiresAt: new Date(Date.now() + 30 * 60_000) } });
  keys[label] = { key: r.value.key, hash: r.value.data.hash };
}
const t0 = Date.now();
for (const [label, k] of Object.entries(keys)) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${k.key}`, "content-type": "application/json" }, body: JSON.stringify({ model: "anthropic/claude-haiku-5.5", max_tokens: 5, messages: [{ role: "user", content: "Say ok." }] }) });
  const body = await res.json();
  console.log(`${label}: call ${res.status} cost=${body.usage?.cost}`);
}
await apiKeysUpdate(core, { hash: keys.frozen.hash, requestBody: { disabled: true } });
const seen = {};
while (Date.now() - t0 < 10 * 60_000 && Object.keys(seen).length < 2) {
  for (const [label, k] of Object.entries(keys)) {
    if (seen[label]) continue;
    const g = await apiKeysGet(core, { hash: k.hash });
    if (g.ok && g.value.data.usage > 0) { seen[label] = true; console.log(`${label}: usage ${g.value.data.usage} after ${Math.round((Date.now() - t0) / 1000)}s`); }
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
for (const [label, k] of Object.entries(keys)) { if (!seen[label]) console.log(`${label}: still 0 after ${Math.round((Date.now() - t0) / 1000)}s`); await apiKeysDelete(core, { hash: k.hash }); }
console.log("done");
