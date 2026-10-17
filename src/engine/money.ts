/**
 * Reserve Juggler - Strict Money Module
 *
 * Implements an immutable, high-precision currency value object using BigInt
 * for all internal minor unit (cents) storage. Eliminates floating-point rounding
 * errors in fintech forecasting, liquidity reserve management, and capital allocation.
 */

export type CurrencyCode = "USD" | "EUR" | "GBP" | string;

export type RoundingMode =
  | "half-even" // Banker's rounding (default for financial compliance)
  | "half-up"   // Round towards nearest neighbor; 0.5 rounds away from zero
  | "truncate"  // Round towards zero
  | "floor"     // Round towards negative infinity
  | "ceil";     // Round towards positive infinity

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Currency mismatch: cannot perform operation between ${a} and ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

export class NegativeMoneyError extends Error {
  constructor(message = "Money amount must be non-negative") {
    super(message);
    this.name = "NegativeMoneyError";
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export interface MoneyJSON {
  amountMinor: number | string;
  currency: CurrencyCode;
}

/**
 * Strict immutable Money value object.
 */
export class Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;

  private constructor(amountMinor: bigint, currency: CurrencyCode = "USD") {
    this.amountMinor = amountMinor;
    this.currency = currency.toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Factory Methods
  // ---------------------------------------------------------------------------

  /**
   * Create Money from minor units (e.g. cents).
   * Accepts bigint, safe integer number, or numeric string.
   */
  static fromMinor(amount: bigint | number | string, currency: CurrencyCode = "USD"): Money {
    if (typeof amount === "bigint") {
      return new Money(amount, currency);
    }

    if (typeof amount === "number") {
      if (!Number.isFinite(amount)) {
        throw new InvalidMoneyError(`Invalid minor amount: ${amount} (must be a finite integer)`);
      }
      if (!Number.isSafeInteger(amount)) {
        throw new InvalidMoneyError(
          `Amount ${amount} is outside safe integer range or is not an integer. Pass bigint or string.`
        );
      }
      return new Money(BigInt(amount), currency);
    }

    if (typeof amount === "string") {
      const trimmed = amount.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        throw new InvalidMoneyError(`Invalid integer minor unit string: "${amount}"`);
      }
      return new Money(BigInt(trimmed), currency);
    }

    throw new InvalidMoneyError(`Unsupported minor amount type: ${typeof amount}`);
  }

  /**
   * Create Money from a decimal representation (e.g., "12.34" or 12.34 dollars).
   * String parsing avoids floating-point inaccuracies.
   */
  static fromDecimal(
    decimal: number | string,
    currency: CurrencyCode = "USD",
    decimals = 2
  ): Money {
    if (decimals < 0 || !Number.isInteger(decimals)) {
      throw new InvalidMoneyError("Decimals must be a non-negative integer");
    }

    let str: string;
    if (typeof decimal === "number") {
      if (!Number.isFinite(decimal)) {
        throw new InvalidMoneyError(`Invalid decimal number: ${decimal}`);
      }
      // Fixed representation to prevent scientific notation for normal amounts
      str = decimal.toFixed(decimals);
    } else if (typeof decimal === "string") {
      str = decimal.trim();
    } else {
      throw new InvalidMoneyError(`Unsupported decimal type: ${typeof decimal}`);
    }

    const match = str.match(/^(-)?(\d+)(?:\.(\d+))?$/);
    if (!match) {
      throw new InvalidMoneyError(`Invalid decimal currency string: "${str}"`);
    }

    const [, sign = "", whole, frac = ""] = match;
    const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
    const minorStr = `${sign}${whole}${paddedFrac}`;
    return new Money(BigInt(minorStr), currency);
  }

  /**
   * Zero money in specified currency.
   */
  static zero(currency: CurrencyCode = "USD"): Money {
    return new Money(0n, currency);
  }

  /**
   * Parse from stored JSON (Firestore compatibility format).
   */
  static fromJSON(json: MoneyJSON): Money {
    if (!json || json.amountMinor === undefined) {
      throw new InvalidMoneyError("Missing amountMinor in Money JSON");
    }
    return Money.fromMinor(json.amountMinor, json.currency ?? "USD");
  }

  // ---------------------------------------------------------------------------
  // Core Arithmetic
  // ---------------------------------------------------------------------------

  /**
   * Add another Money value. Must have matching currency.
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  /**
   * Subtract another Money value. Must have matching currency.
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  /**
   * Negate this Money amount.
   */
  negate(): Money {
    return new Money(-this.amountMinor, this.currency);
  }

  /**
   * Absolute value of this Money.
   */
  abs(): Money {
    return this.amountMinor < 0n ? this.negate() : this;
  }

  /**
   * Multiply by a scalar with strict financial rounding.
   */
  multiply(factor: number | bigint, roundingMode: RoundingMode = "half-even"): Money {
    if (typeof factor === "bigint") {
      return new Money(this.amountMinor * factor, this.currency);
    }

    if (!Number.isFinite(factor)) {
      throw new InvalidMoneyError(`Multiplier must be finite: ${factor}`);
    }

    // Scale to high precision to avoid intermediate float errors
    // Use 1,000,000 as scaling factor (6 decimal places)
    const scale = 1_000_000n;
    const factorScaled = BigInt(Math.round(factor * 1_000_000));
    const numerator = this.amountMinor * factorScaled;

    const roundedMinor = divideWithRounding(numerator, scale, roundingMode);
    return new Money(roundedMinor, this.currency);
  }

  /**
   * Multiply by basis points (1 bps = 0.01% = 1 / 10,000).
   * Standard for yields, penalties, interest rates.
   */
  multiplyBps(bps: number | bigint, roundingMode: RoundingMode = "half-even"): Money {
    const bpsBigInt = typeof bps === "bigint" ? bps : BigInt(Math.round(bps));
    const numerator = this.amountMinor * bpsBigInt;
    const roundedMinor = divideWithRounding(numerator, 10_000n, roundingMode);
    return new Money(roundedMinor, this.currency);
  }

  /**
   * Divide by an integer or finite number with strict rounding.
   */
  divide(divisor: number | bigint, roundingMode: RoundingMode = "half-even"): Money {
    if (typeof divisor === "bigint") {
      if (divisor === 0n) {
        throw new InvalidMoneyError("Division by zero");
      }
      return new Money(divideWithRounding(this.amountMinor, divisor, roundingMode), this.currency);
    }

    if (!Number.isFinite(divisor) || divisor === 0) {
      throw new InvalidMoneyError(`Invalid divisor: ${divisor}`);
    }

    const scale = 1_000_000n;
    const divisorScaled = BigInt(Math.round(divisor * 1_000_000));
    const numerator = this.amountMinor * scale;
    const roundedMinor = divideWithRounding(numerator, divisorScaled, roundingMode);
    return new Money(roundedMinor, this.currency);
  }

  // ---------------------------------------------------------------------------
  // Allocation (Largest Remainder Method / Hare-Niemeyer)
  // ---------------------------------------------------------------------------

  /**
   * Proportional allocation according to ratios.
   * Guarantees that the sum of parts EXACTLY equals the original amount.
   * Zero cents lost or created.
   *
   * @param ratios Array of positive numbers or bigints representing proportions
   * @returns Array of Money instances summing exactly to this
   */
  allocate(ratios: readonly (number | bigint)[]): Money[] {
    if (ratios.length === 0) {
      throw new InvalidMoneyError("Cannot allocate across empty ratios");
    }

    // Convert ratios to non-negative BigInts
    const bigIntRatios: bigint[] = ratios.map((r, idx) => {
      if (typeof r === "bigint") {
        if (r < 0n) throw new InvalidMoneyError(`Ratio at index ${idx} cannot be negative`);
        return r;
      }
      if (typeof r === "number") {
        if (!Number.isFinite(r) || r < 0) {
          throw new InvalidMoneyError(`Ratio at index ${idx} must be non-negative and finite`);
        }
        // Scale by 1,000,000 to handle decimal ratios like [0.33, 0.67]
        return BigInt(Math.round(r * 1_000_000));
      }
      throw new InvalidMoneyError(`Invalid ratio type at index ${idx}`);
    });

    const totalRatio = bigIntRatios.reduce((acc, r) => acc + r, 0n);
    if (totalRatio === 0n) {
      throw new InvalidMoneyError("Sum of ratios must be greater than zero");
    }

    const totalAmount = this.amountMinor;
    const isNegative = totalAmount < 0n;
    const absTotal = isNegative ? -totalAmount : totalAmount;

    // Floor amounts and calculate remainders
    const shares: bigint[] = new Array(ratios.length);
    interface RemainderInfo {
      index: number;
      remainder: bigint;
    }
    const remainders: RemainderInfo[] = [];

    let allocatedSum = 0n;

    for (let i = 0; i < bigIntRatios.length; i++) {
      const ratio = bigIntRatios[i];
      const product = absTotal * ratio;
      const share = product / totalRatio;
      const remainder = product % totalRatio;

      shares[i] = share;
      allocatedSum += share;
      remainders.push({ index: i, remainder });
    }

    // Distribute remaining cents to highest remainders
    let leftover = absTotal - allocatedSum;
    remainders.sort((a, b) => {
      if (b.remainder > a.remainder) return 1;
      if (b.remainder < a.remainder) return -1;
      return a.index - b.index; // Stable tie-breaker
    });

    for (let i = 0; i < remainders.length && leftover > 0n; i++) {
      shares[remainders[i].index] += 1n;
      leftover -= 1n;
    }

    // Restore sign and construct Money objects
    return shares.map((s) => new Money(isNegative ? -s : s, this.currency));
  }

  // ---------------------------------------------------------------------------
  // Negative Constraints & Validation
  // ---------------------------------------------------------------------------

  /**
   * Check if amount is strictly negative (< 0).
   */
  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  /**
   * Check if amount is strictly positive (> 0).
   */
  isPositive(): boolean {
    return this.amountMinor > 0n;
  }

  /**
   * Check if amount is zero.
   */
  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  /**
   * Asserts that this amount is non-negative (>= 0).
   * Throws NegativeMoneyError if negative. Returns this if valid.
   */
  assertNonNegative(contextMessage?: string): Money {
    if (this.amountMinor < 0n) {
      const detail = contextMessage ? `: ${contextMessage}` : "";
      throw new NegativeMoneyError(
        `Negative money constraint violated: ${this.format()}${detail}`
      );
    }
    return this;
  }

  /**
   * Clamps amount so it is at least 0.
   */
  clampNonNegative(): Money {
    return this.amountMinor < 0n ? Money.zero(this.currency) : this;
  }

  /**
   * Clamp amount between min and max bounds.
   */
  clamp(min: Money, max: Money): Money {
    this.assertSameCurrency(min);
    this.assertSameCurrency(max);
    if (min.greaterThan(max)) {
      throw new InvalidMoneyError("Min bound cannot exceed max bound");
    }
    if (this.lessThan(min)) return min;
    if (this.greaterThan(max)) return max;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Comparisons
  // ---------------------------------------------------------------------------

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  static min(...moneys: Money[]): Money {
    if (moneys.length === 0) throw new InvalidMoneyError("Cannot find min of empty list");
    let lowest = moneys[0];
    for (let i = 1; i < moneys.length; i++) {
      if (moneys[i].lessThan(lowest)) lowest = moneys[i];
    }
    return lowest;
  }

  static max(...moneys: Money[]): Money {
    if (moneys.length === 0) throw new InvalidMoneyError("Cannot find max of empty list");
    let highest = moneys[0];
    for (let i = 1; i < moneys.length; i++) {
      if (moneys[i].greaterThan(highest)) highest = moneys[i];
    }
    return highest;
  }

  static sum(moneys: readonly Money[], defaultCurrency: CurrencyCode = "USD"): Money {
    if (moneys.length === 0) return Money.zero(defaultCurrency);
    const currency = moneys[0].currency;
    let total = 0n;
    for (const m of moneys) {
      if (m.currency !== currency) throw new CurrencyMismatchError(currency, m.currency);
      total += m.amountMinor;
    }
    return new Money(total, currency);
  }

  // ---------------------------------------------------------------------------
  // Conversion & Formatting
  // ---------------------------------------------------------------------------

  /**
   * Convert minor units to safe JS number. Throws if value exceeds safe integer range.
   */
  toMinorNumber(): number {
    const num = Number(this.amountMinor);
    if (!Number.isSafeInteger(num) || BigInt(num) !== this.amountMinor) {
      throw new InvalidMoneyError(
        `Amount ${this.amountMinor} exceeds JavaScript safe integer range`
      );
    }
    return num;
  }

  /**
   * Convert to decimal number (dollars). Note: use only for display/charts, not calculations!
   */
  toDecimal(): number {
    return Number(this.amountMinor) / 100;
  }

  /**
   * Exact decimal string representation with 2 decimal places (e.g. "123.45" or "-0.05").
   */
  toDecimalString(): string {
    const isNegative = this.amountMinor < 0n;
    const abs = isNegative ? -this.amountMinor : this.amountMinor;
    const whole = abs / 100n;
    const frac = abs % 100n;
    const sign = isNegative ? "-" : "";
    return `${sign}${whole}.${frac.toString().padStart(2, "0")}`;
  }

  /**
   * Standard currency formatted display (e.g. "$1,234.56").
   */
  format(options?: Intl.NumberFormatOptions): string {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options,
    });
    return formatter.format(this.toDecimal());
  }

  /**
   * Compact display (e.g. "$12.4M", "$500K", "$1.2B").
   */
  formatCompact(): string {
    const dollars = this.toDecimal();
    const abs = Math.abs(dollars);
    const sign = dollars < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  /**
   * Serialize for Firestore storage conforming to DATA_MODEL.md:
   * Stored as a number if < 2^53 (MAX_SAFE_INTEGER), otherwise decimal string.
   */
  toJSON(): MoneyJSON {
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
    const isSafe = this.amountMinor >= minSafe && this.amountMinor <= maxSafe;

    return {
      amountMinor: isSafe ? Number(this.amountMinor) : this.amountMinor.toString(),
      currency: this.currency,
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}

// -----------------------------------------------------------------------------
// Rounding Helper Function
// -----------------------------------------------------------------------------

function divideWithRounding(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator === 0n) {
    throw new InvalidMoneyError("Division by zero in rounding");
  }

  // Handle negative denominator
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n) {
    return quotient;
  }

  const isNegative = numerator < 0n;
  const absRemainder = isNegative ? -remainder : remainder;
  const doubleRemainder = absRemainder * 2n;

  switch (mode) {
    case "truncate":
      return quotient;

    case "floor":
      return isNegative ? quotient - 1n : quotient;

    case "ceil":
      return isNegative ? quotient : quotient + 1n;

    case "half-up":
      if (doubleRemainder >= denominator) {
        return isNegative ? quotient - 1n : quotient + 1n;
      }
      return quotient;

    case "half-even":
    default: {
      if (doubleRemainder > denominator) {
        return isNegative ? quotient - 1n : quotient + 1n;
      }
      if (doubleRemainder === denominator) {
        // Halfway case: round to nearest even quotient
        const isOdd = quotient % 2n !== 0n;
        if (isOdd) {
          return isNegative ? quotient - 1n : quotient + 1n;
        }
      }
      return quotient;
    }
  }
}

// -----------------------------------------------------------------------------
// Functional Conveniences & Backward Compatibility
// -----------------------------------------------------------------------------

export function money(amount: bigint | number | string, currency = "USD"): Money {
  return Money.fromMinor(amount, currency);
}

export function moneyFromDecimal(decimal: number | string, currency = "USD"): Money {
  return Money.fromDecimal(decimal, currency);
}

export function add(a: Money, b: Money): Money {
  return a.add(b);
}

export function subtract(a: Money, b: Money): Money {
  return a.subtract(b);
}

export function allocate(m: Money, ratios: readonly (number | bigint)[]): Money[] {
  return m.allocate(ratios);
}

export function assertNonNegative(m: Money, contextMessage?: string): Money {
  return m.assertNonNegative(contextMessage);
}
