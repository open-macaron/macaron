const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** "1.2M", "48.2K", "950": tokens as people read them. */
export function formatTokens(tokens: number): string {
  return COMPACT.format(tokens);
}
