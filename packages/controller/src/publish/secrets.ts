/**
 * Credential shapes that must never be published. Deterministic and cheap; GitHub's own secret
 * scanning on the public forks is the second line.
 */
const PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/ },
  { name: "OpenRouter key", pattern: /\bsk-or-(v1-)?[A-Za-z0-9]{32,}\b/ },
  { name: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/ },
  { name: "OpenAI key", pattern: /\bsk-(?!or-|ant-)(proj-)?[A-Za-z0-9_-]{40,}\b/ },
  { name: "AWS access key", pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: "private key", pattern: /-----BEGIN ((RSA|EC|DSA|OPENSSH|PGP) )?PRIVATE KEY( BLOCK)?-----/ },
];

/** Names of the credential kinds found in `text` (empty when clean). */
export function findSecrets(text: string): readonly string[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
