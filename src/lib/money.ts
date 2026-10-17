/** Money is held as integer minor units (cents). Phase 3 replaces this with the full engine money module. */
export type Minor = number;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Format integer minor units (cents) as whole-dollar currency. Display only. */
export function formatMinor(minor: Minor): string {
  return usd.format(Math.trunc(minor / 100));
}

/** Compact display, e.g. $12.4M. Display only; never feed back into calculations. */
export function formatCompactMinor(minor: Minor): string {
  const dollars = minor / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
