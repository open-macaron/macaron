// Dates are rendered on the server and hydrated in the browser: a fixed locale and UTC keep both
// renders identical. The controller sends ISO strings.
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const tokensFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 86_400_000;

/** "23 Oct 2026". */
export function formatDate(date: string | Date): string {
  return dateFormat.format(new Date(date));
}

/** "23 Oct 2026, 14:05 UTC". */
export function formatDateTime(date: string | Date): string {
  return dateTimeFormat.format(new Date(date));
}

/** "in 6 days", "yesterday", "3 days ago": whole days from now. */
export function formatRelativeDays(date: string | Date, now: Date = new Date()): string {
  return relativeFormat.format(Math.round((new Date(date).getTime() - now.getTime()) / DAY), "day");
}

/** "$1.84"; amounts under a cent show as "<$0.01" rather than "$0.00". */
export function formatUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : usdFormat.format(usd);
}

/** "1.25M": a run's tokens, in millions; counts that would round to "0.00M" show as "<0.01M". */
export function formatMillions(tokens: number): string {
  return tokens > 0 && tokens < 5_000 ? "<0.01M" : `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** "1.2M", "48.2K", "950": tokens as people read them, as the bot's footer writes them. */
export function formatTokens(tokens: number): string {
  return tokensFormat.format(tokens);
}
