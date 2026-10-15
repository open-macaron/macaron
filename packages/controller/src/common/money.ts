/** Integer micro-dollars: the only unit money is stored and compared in. */
export type UsdMicros = number;

export function toMicros(usd: number): UsdMicros {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`invalid USD amount: ${String(usd)}`);
  return Math.round(usd * 1_000_000);
}

export function toUsd(micros: UsdMicros): number {
  return micros / 1_000_000;
}

const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const subCent = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** `$1.84`; amounts under a cent keep four decimals (`$0.0040`) so router calls stay visible. */
export function formatUsd(micros: UsdMicros): string {
  const usd = toUsd(micros);
  return (usd !== 0 && usd < 0.01 ? subCent : cents).format(usd);
}
