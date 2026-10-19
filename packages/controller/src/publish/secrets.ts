import { lintSource } from "@secretlint/core";
import { creator as pattern } from "@secretlint/secretlint-rule-pattern";
import { creator as recommended } from "@secretlint/secretlint-rule-preset-recommend";

const RULE_PREFIX = "@secretlint/secretlint-rule-";
/** The pattern rule masks which pattern matched, so all of ours report as one kind. */
const PATTERN_KIND = "LLM key";

/** secretlint's recommended preset (GitHub, OpenAI, Anthropic, AWS, private keys…) plus what it lacks. */
const RULES = [
  { id: "@secretlint/secretlint-rule-preset-recommend", rule: recommended },
  {
    id: "@secretlint/secretlint-rule-pattern",
    rule: pattern,
    options: {
      patterns: [
        { name: "OpenRouter API key", patterns: ["/sk-or-v1-[0-9a-f]{64}/"] },
        { name: "Bifrost virtual key", patterns: ["/sk-bf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"] },
      ],
    },
  },
];

/**
 * Names of the credential kinds secretlint finds in `content` (empty when clean).
 * `path` lets path-aware rules (e.g. `.npmrc`, `.env`) apply; secrets are masked in messages.
 */
export async function findSecrets(content: string, path = "content.txt"): Promise<readonly string[]> {
  const result = await lintSource({
    source: { content, filePath: path, contentType: "text" },
    options: { config: { rules: RULES }, maskSecrets: true, noPhysicFilePath: true },
  });
  const kinds = result.messages.map((message) => (message.ruleId === `${RULE_PREFIX}pattern` ? PATTERN_KIND : message.ruleId.replace(RULE_PREFIX, "")));
  return [...new Set(kinds)];
}
