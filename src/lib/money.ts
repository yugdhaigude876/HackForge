/**
 * Compatibility re-export and helper utilities for UI components.
 * The core financial engine resides in @/engine/money.
 */

export * from "@/engine/money";
import { Money } from "@/engine/money";

export type Minor = number;

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Format integer minor units (cents) as whole-dollar currency. Display only.
 */
export function formatMinor(minor: Minor): string {
  const num = typeof minor === "bigint" ? Number(minor) : minor;
  return usdWhole.format(Math.trunc(num / 100));
}

/**
 * Compact display, e.g. $12.4M. Display only; never feed back into calculations.
 */
export function formatCompactMinor(minor: Minor | bigint | string | Money): string {
  if (minor instanceof Money) {
    return minor.formatCompact();
  }
  const num = typeof minor === "string" ? Number(minor) : typeof minor === "bigint" ? Number(minor) : minor;
  const dollars = num / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
