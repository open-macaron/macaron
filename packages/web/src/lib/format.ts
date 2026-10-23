// Dates are rendered on the server and hydrated in the browser: a fixed locale and UTC keep both
// renders identical. The controller sends ISO strings.
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const usdFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 86_400_000;

/** "23 Oct 2026". */
export function formatDate(date: string | Date): string {
  return dateFormat.format(new Date(date));
}

/** "in 6 days", "yesterday", "3 days ago": whole days from now. */
export function formatRelativeDays(date: string | Date, now: Date = new Date()): string {
  return relativeFormat.format(Math.round((new Date(date).getTime() - now.getTime()) / DAY), "day");
}

/** "$1.84"; amounts under a cent show as "<$0.01" rather than "$0.00". */
export function formatUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? "<$0.01" : usdFormat.format(usd);
}
