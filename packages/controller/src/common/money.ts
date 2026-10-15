/** Integer micro-dollars: the only unit money is stored and compared in. */
export type UsdMicros = number;

export function toMicros(usd: number): UsdMicros {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`invalid USD amount: ${String(usd)}`);
  return Math.round(usd * 1_000_000);
}

export function toUsd(micros: UsdMicros): number {
  return micros / 1_000_000;
}

/** `$1.84`, `$0.004` — enough precision for router calls, no trailing noise. */
export function formatUsd(micros: UsdMicros): string {
  const usd = toUsd(micros);
  const digits = usd !== 0 && usd < 0.01 ? 4 : 2;
  return `$${usd.toFixed(digits)}`;
}
