#!/usr/bin/env node
// A stand-in for Claude Code in the review phase tests, run in a directory holding fake-claude.json:
// triage (`--tools ""`) says the rules in `notApplicable` don't apply; a check session passes every
// rule in its prompt but those in `dropped` (its first session only, unless `alwaysDropped`).
// Each session's phase, rule ids and diff files go to calls.log.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const options = z
  .strictObject({ notApplicable: z.array(z.string()).default([]), dropped: z.array(z.string()).default([]), alwaysDropped: z.boolean().default(false) })
  .parse(JSON.parse(readFileSync("fake-claude.json", "utf8")));
const args = process.argv.slice(2);
const triage = args[args.indexOf("--tools") + 1] === "";
const prompt = readFileSync(0, "utf8");
const ids = [...prompt.matchAll(/^### `([^`]+)`/gm)].map((match) => match[1] ?? "");
const files = [...prompt.matchAll(/^### (src\/\S+)$/gm)].map((match) => match[1] ?? "");
appendFileSync("calls.log", `${triage ? "triage" : "check"} ${ids.join(",")}${files.length > 0 ? ` diff:${files.join(",")}` : ""}\n`);

let answer: object;
if (triage) {
  answer = { rules: ids.map((ruleId) => ({ ruleId, applies: !options.notApplicable.includes(ruleId), reason: "r" })) };
} else {
  const dropped = !existsSync("checked") || options.alwaysDropped ? options.dropped : [];
  appendFileSync("checked", "");
  answer = { verdicts: ids.filter((id) => !dropped.includes(id)).map((ruleId) => ({ ruleId, verdict: "pass", evidence: [], explanation: "" })) };
}
process.stdout.write(JSON.stringify({ structured_output: answer, num_turns: 1, total_cost_usd: 0.01 }));
