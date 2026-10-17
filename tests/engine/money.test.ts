import { describe, it, expect } from "vitest";
import {
  Money,
  money,
  moneyFromDecimal,
  add,
  subtract,
  allocate,
  assertNonNegative,
  CurrencyMismatchError,
  NegativeMoneyError,
  InvalidMoneyError,
} from "@/engine/money";

describe("Money Module", () => {
  describe("Instantiation & Factory Methods", () => {
    it("creates money from safe integer numbers in minor units", () => {
      const m = Money.fromMinor(1234, "USD");
      expect(m.amountMinor).toBe(1234n);
      expect(m.currency).toBe("USD");
      expect(m.toMinorNumber()).toBe(1234);
    });

    it("creates money from BigInt minor units", () => {
      const big = 9_007_199_254_740_992n; // 2^53
      const m = Money.fromMinor(big, "USD");
      expect(m.amountMinor).toBe(big);
      expect(m.currency).toBe("USD");
    });

    it("creates money from integer string minor units", () => {
      const m = Money.fromMinor("50000000", "USD");
      expect(m.amountMinor).toBe(50000000n);
    });

    it("normalizes currency code to uppercase", () => {
      const m = Money.fromMinor(100, "eur");
      expect(m.currency).toBe("EUR");
    });

    it("creates zero money in currency", () => {
      const z = Money.zero("USD");
      expect(z.amountMinor).toBe(0n);
      expect(z.isZero()).toBe(true);
      expect(z.currency).toBe("USD");
    });

    it("rejects non-integer numbers for fromMinor", () => {
      expect(() => Money.fromMinor(12.34)).toThrow(InvalidMoneyError);
      expect(() => Money.fromMinor(NaN)).toThrow(InvalidMoneyError);
      expect(() => Money.fromMinor(Infinity)).toThrow(InvalidMoneyError);
    });

    it("rejects invalid string inputs for fromMinor", () => {
      expect(() => Money.fromMinor("12.34")).toThrow(InvalidMoneyError);
      expect(() => Money.fromMinor("abc")).toThrow(InvalidMoneyError);
      expect(() => Money.fromMinor("")).toThrow(InvalidMoneyError);
    });

    it("creates money from decimal strings without floating-point errors", () => {
      const m1 = Money.fromDecimal("12.34");
      expect(m1.amountMinor).toBe(1234n);
      expect(m1.toDecimalString()).toBe("12.34");

      const m2 = Money.fromDecimal("0.05");
      expect(m2.amountMinor).toBe(5n);

      const m3 = Money.fromDecimal("-45.99");
      expect(m3.amountMinor).toBe(-4599n);
      expect(m3.toDecimalString()).toBe("-45.99");

      const m4 = Money.fromDecimal("100");
      expect(m4.amountMinor).toBe(10000n);
    });

    it("handles classic floating-point addition via decimal parsing", () => {
      // In JS: 0.1 + 0.2 = 0.30000000000000004
      const m1 = Money.fromDecimal("0.10");
      const m2 = Money.fromDecimal("0.20");
      const sum = m1.add(m2);
      expect(sum.amountMinor).toBe(30n);
      expect(sum.toDecimalString()).toBe("0.30");
    });
  });

  describe("Addition", () => {
    it("adds two positive amounts", () => {
      const a = Money.fromMinor(1500, "USD");
      const b = Money.fromMinor(2500, "USD");
      const res = a.add(b);
      expect(res.amountMinor).toBe(4000n);
      expect(res.currency).toBe("USD");
    });

    it("satisfies the identity property with zero", () => {
      const a = Money.fromMinor(1234, "USD");
      const zero = Money.zero("USD");
      expect(a.add(zero).equals(a)).toBe(true);
      expect(zero.add(a).equals(a)).toBe(true);
    });

    it("satisfies commutativity and associativity", () => {
      const a = Money.fromMinor(100, "USD");
      const b = Money.fromMinor(200, "USD");
      const c = Money.fromMinor(300, "USD");

      expect(a.add(b).equals(b.add(a))).toBe(true);
      expect(a.add(b).add(c).equals(a.add(b.add(c)))).toBe(true);
    });

    it("correctly adds negative numbers", () => {
      const a = Money.fromMinor(500, "USD");
      const b = Money.fromMinor(-300, "USD");
      expect(a.add(b).amountMinor).toBe(200n);
    });

    it("handles large amounts exceeding Number.MAX_SAFE_INTEGER without precision loss", () => {
      const large1 = BigInt(Number.MAX_SAFE_INTEGER) + 100n;
      const large2 = 500n;
      const a = Money.fromMinor(large1, "USD");
      const b = Money.fromMinor(large2, "USD");
      const sum = a.add(b);
      expect(sum.amountMinor).toBe(large1 + 500n);
    });

    it("throws CurrencyMismatchError when adding different currencies", () => {
      const usd = Money.fromMinor(1000, "USD");
      const eur = Money.fromMinor(1000, "EUR");
      expect(() => usd.add(eur)).toThrow(CurrencyMismatchError);
    });
  });

  describe("Subtraction", () => {
    it("subtracts smaller positive amount from larger", () => {
      const a = Money.fromMinor(5000, "USD");
      const b = Money.fromMinor(2000, "USD");
      expect(a.subtract(b).amountMinor).toBe(3000n);
    });

    it("produces negative money when subtracting larger from smaller", () => {
      const a = Money.fromMinor(2000, "USD");
      const b = Money.fromMinor(5000, "USD");
      const res = a.subtract(b);
      expect(res.amountMinor).toBe(-3000n);
      expect(res.isNegative()).toBe(true);
    });

    it("satisfies self-subtraction giving zero", () => {
      const a = Money.fromMinor(9999, "USD");
      expect(a.subtract(a).equals(Money.zero("USD"))).toBe(true);
    });

    it("subtracts negative amounts (equivalent to adding)", () => {
      const a = Money.fromMinor(1000, "USD");
      const b = Money.fromMinor(-500, "USD");
      expect(a.subtract(b).amountMinor).toBe(1500n);
    });

    it("throws CurrencyMismatchError when subtracting different currencies", () => {
      const usd = Money.fromMinor(1000, "USD");
      const eur = Money.fromMinor(500, "EUR");
      expect(() => usd.subtract(eur)).toThrow(CurrencyMismatchError);
    });
  });

  describe("Multiplication and Basis Points", () => {
    it("multiplies by an integer factor", () => {
      const m = Money.fromMinor(250, "USD");
      expect(m.multiply(4n).amountMinor).toBe(1000n);
      expect(m.multiply(3).amountMinor).toBe(750n);
    });

    it("multiplies by decimal factor with Banker's rounding (half-even)", () => {
      // 25 cents * 1.5 = 37.5 cents -> 38 (even)
      const m1 = Money.fromMinor(25, "USD");
      expect(m1.multiply(1.5, "half-even").amountMinor).toBe(38n);

      // 35 cents * 1.5 = 52.5 cents -> 52 (even)
      const m2 = Money.fromMinor(35, "USD");
      expect(m2.multiply(1.5, "half-even").amountMinor).toBe(52n);
    });

    it("supports half-up rounding mode", () => {
      // 35 cents * 1.5 = 52.5 cents -> 53 (half-up rounds away from 0)
      const m = Money.fromMinor(35, "USD");
      expect(m.multiply(1.5, "half-up").amountMinor).toBe(53n);
    });

    it("multiplies by basis points (bps) accurately", () => {
      // $100,000 = 10,000,000 cents
      // 400 bps = 4.00% -> $4,000 = 400,000 cents
      const principal = Money.fromMinor(10_000_000, "USD");
      const yield400bps = principal.multiplyBps(400);
      expect(yield400bps.amountMinor).toBe(400_000n);
      expect(yield400bps.toDecimalString()).toBe("4000.00");
    });

    it("calculates penalties in basis points", () => {
      // $50,000 = 5,000,000 cents with 25 bps penalty = 0.25%
      // 5,000,000 * 25 / 10,000 = 12,500 cents ($125.00)
      const cash = Money.fromMinor(5_000_000, "USD");
      const penalty = cash.multiplyBps(25);
      expect(penalty.amountMinor).toBe(12500n);
      expect(penalty.toDecimalString()).toBe("125.00");
    });
  });

  describe("Division", () => {
    it("divides evenly", () => {
      const m = Money.fromMinor(1000, "USD");
      expect(m.divide(4).amountMinor).toBe(250n);
    });

    it("divides with rounding", () => {
      const m = Money.fromMinor(100, "USD"); // $1.00
      // 100 / 3 = 33.333... -> 33
      expect(m.divide(3, "half-even").amountMinor).toBe(33n);
    });

    it("throws on division by zero", () => {
      const m = Money.fromMinor(100, "USD");
      expect(() => m.divide(0)).toThrow(InvalidMoneyError);
      expect(() => m.divide(0n)).toThrow(InvalidMoneyError);
    });
  });

  describe("Proportional Allocation (Hare-Niemeyer Algorithm)", () => {
    it("allocates evenly with no remainder", () => {
      const m = Money.fromMinor(10000, "USD"); // $100.00
      const parts = m.allocate([1, 1]);
      expect(parts.length).toBe(2);
      expect(parts[0].amountMinor).toBe(5000n);
      expect(parts[1].amountMinor).toBe(5000n);
      expect(parts[0].add(parts[1]).equals(m)).toBe(true);
    });

    it("guarantees sum conservation for 3-way split with penny remainder", () => {
      // $100.00 (10,000 cents) across [1, 1, 1]
      // 10,000 / 3 = 3,333 cents with 1 cent remainder
      // Highest remainder gets the extra penny: [3334, 3333, 3333]
      const total = Money.fromMinor(10000, "USD");
      const parts = total.allocate([1, 1, 1]);

      expect(parts[0].amountMinor).toBe(3334n);
      expect(parts[1].amountMinor).toBe(3333n);
      expect(parts[2].amountMinor).toBe(3333n);

      // Invariant: sum of parts MUST equal total exactly
      const sum = Money.sum(parts);
      expect(sum.equals(total)).toBe(true);
      expect(sum.amountMinor).toBe(10000n);
    });

    it("allocates tiny amounts without losing pennies", () => {
      // 5 cents split across 3 equal parts -> [2, 2, 1]
      const small = Money.fromMinor(5, "USD");
      const parts = small.allocate([1, 1, 1]);
      expect(parts.map((p) => p.amountMinor)).toEqual([2n, 2n, 1n]);
      expect(Money.sum(parts).equals(small)).toBe(true);

      // 1 cent split across 3 parts -> [1, 0, 0]
      const oneCent = Money.fromMinor(1, "USD");
      const parts1 = oneCent.allocate([1, 1, 1]);
      expect(parts1.map((p) => p.amountMinor)).toEqual([1n, 0n, 0n]);
      expect(Money.sum(parts1).equals(oneCent)).toBe(true);
    });

    it("allocates according to unequal weights", () => {
      // $100.00 across 70% and 30%
      const m = Money.fromMinor(10000, "USD");
      const parts = m.allocate([70, 30]);
      expect(parts[0].amountMinor).toBe(7000n);
      expect(parts[1].amountMinor).toBe(3000n);
      expect(Money.sum(parts).equals(m)).toBe(true);
    });

    it("supports zero-weighted buckets in allocation", () => {
      // $100 across [1, 0, 1]
      const m = Money.fromMinor(10000, "USD");
      const parts = m.allocate([1, 0, 1]);
      expect(parts[0].amountMinor).toBe(5000n);
      expect(parts[1].amountMinor).toBe(0n);
      expect(parts[2].amountMinor).toBe(5000n);
      expect(Money.sum(parts).equals(m)).toBe(true);
    });

    it("allocates negative money while strictly preserving negative total", () => {
      const negativeTotal = Money.fromMinor(-10000, "USD");
      const parts = negativeTotal.allocate([1, 1, 1]);
      expect(parts[0].amountMinor).toBe(-3334n);
      expect(parts[1].amountMinor).toBe(-3333n);
      expect(parts[2].amountMinor).toBe(-3333n);
      expect(Money.sum(parts).equals(negativeTotal)).toBe(true);
    });

    it("throws InvalidMoneyError on invalid allocation inputs", () => {
      const m = Money.fromMinor(1000, "USD");
      expect(() => m.allocate([])).toThrow(InvalidMoneyError);
      expect(() => m.allocate([0, 0])).toThrow(InvalidMoneyError);
      expect(() => m.allocate([1, -1])).toThrow(InvalidMoneyError);
    });
  });

  describe("Negative Constraints & Invariants", () => {
    it("identifies negative, positive, and zero amounts", () => {
      const neg = Money.fromMinor(-100, "USD");
      const pos = Money.fromMinor(100, "USD");
      const zero = Money.zero("USD");

      expect(neg.isNegative()).toBe(true);
      expect(neg.isPositive()).toBe(false);
      expect(neg.isZero()).toBe(false);

      expect(pos.isNegative()).toBe(false);
      expect(pos.isPositive()).toBe(true);
      expect(pos.isZero()).toBe(false);

      expect(zero.isNegative()).toBe(false);
      expect(zero.isPositive()).toBe(false);
      expect(zero.isZero()).toBe(true);
    });

    it("assertNonNegative passes on non-negative amounts", () => {
      const pos = Money.fromMinor(100, "USD");
      const zero = Money.zero("USD");

      expect(() => pos.assertNonNegative()).not.toThrow();
      expect(pos.assertNonNegative()).toBe(pos);

      expect(() => zero.assertNonNegative()).not.toThrow();
      expect(zero.assertNonNegative()).toBe(zero);
    });

    it("assertNonNegative throws NegativeMoneyError on negative amounts", () => {
      const neg = Money.fromMinor(-100, "USD");
      expect(() => neg.assertNonNegative()).toThrow(NegativeMoneyError);
      expect(() => neg.assertNonNegative("Liquidity Reserve")).toThrow(
        /Liquidity Reserve/
      );
    });

    it("clampNonNegative clamps negative amount to zero and keeps positive", () => {
      const neg = Money.fromMinor(-5000, "USD");
      const pos = Money.fromMinor(5000, "USD");

      expect(neg.clampNonNegative().amountMinor).toBe(0n);
      expect(pos.clampNonNegative().amountMinor).toBe(5000n);
    });

    it("clamp enforces bounds between min and max", () => {
      const min = Money.fromMinor(1000, "USD");
      const max = Money.fromMinor(5000, "USD");

      const below = Money.fromMinor(500, "USD");
      const within = Money.fromMinor(3000, "USD");
      const above = Money.fromMinor(7000, "USD");

      expect(below.clamp(min, max).equals(min)).toBe(true);
      expect(within.clamp(min, max).equals(within)).toBe(true);
      expect(above.clamp(min, max).equals(max)).toBe(true);
    });

    it("clamp throws if min exceeds max", () => {
      const min = Money.fromMinor(5000, "USD");
      const max = Money.fromMinor(1000, "USD");
      const m = Money.fromMinor(2000, "USD");
      expect(() => m.clamp(min, max)).toThrow(InvalidMoneyError);
    });

    it("abs and negate work correctly", () => {
      const neg = Money.fromMinor(-2500, "USD");
      const pos = Money.fromMinor(2500, "USD");

      expect(neg.abs().amountMinor).toBe(2500n);
      expect(pos.abs().amountMinor).toBe(2500n);
      expect(neg.negate().amountMinor).toBe(2500n);
      expect(pos.negate().amountMinor).toBe(-2500n);
    });
  });

  describe("Comparisons", () => {
    const a = Money.fromMinor(1000, "USD");
    const b = Money.fromMinor(2000, "USD");
    const c = Money.fromMinor(1000, "USD");

    it("evaluates greaterThan and lessThan", () => {
      expect(b.greaterThan(a)).toBe(true);
      expect(a.lessThan(b)).toBe(true);
      expect(a.greaterThan(b)).toBe(false);
      expect(b.lessThan(a)).toBe(false);
    });

    it("evaluates equality and inequality", () => {
      expect(a.equals(c)).toBe(true);
      expect(a.equals(b)).toBe(false);
      expect(a.greaterThanOrEqual(c)).toBe(true);
      expect(a.lessThanOrEqual(c)).toBe(true);
    });

    it("computes min and max of a collection", () => {
      expect(Money.min(a, b, c).equals(a)).toBe(true);
      expect(Money.max(a, b, c).equals(b)).toBe(true);
    });

    it("throws on comparing different currencies", () => {
      const usd = Money.fromMinor(1000, "USD");
      const eur = Money.fromMinor(1000, "EUR");
      expect(() => usd.compare(eur)).toThrow(CurrencyMismatchError);
      expect(() => usd.greaterThan(eur)).toThrow(CurrencyMismatchError);
    });
  });

  describe("Conversions, Formatting & Serialization", () => {
    it("converts to safe JS number and throws on overflow", () => {
      const safe = Money.fromMinor(123456, "USD");
      expect(safe.toMinorNumber()).toBe(123456);

      const unsafe = Money.fromMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "USD");
      expect(() => unsafe.toMinorNumber()).toThrow(InvalidMoneyError);
    });

    it("converts to decimal dollar numbers and strings", () => {
      const m = Money.fromMinor(123456, "USD");
      expect(m.toDecimal()).toBe(1234.56);
      expect(m.toDecimalString()).toBe("1234.56");

      const neg = Money.fromMinor(-50, "USD");
      expect(neg.toDecimal()).toBe(-0.5);
      expect(neg.toDecimalString()).toBe("-0.50");
    });

    it("formats standard and compact currency strings", () => {
      const m = Money.fromMinor(1240000000, "USD"); // $12.4M
      expect(m.formatCompact()).toBe("$12.4M");

      const k = Money.fromMinor(50000000, "USD"); // $500K
      expect(k.formatCompact()).toBe("$500K");

      const b = Money.fromMinor(250000000000, "USD"); // $2.5B
      expect(b.formatCompact()).toBe("$2.50B");
    });

    it("serializes to and from JSON according to DATA_MODEL.md specification", () => {
      // Safe integers serialized as numbers
      const safe = Money.fromMinor(500000, "USD");
      const safeJSON = safe.toJSON();
      expect(safeJSON).toEqual({ amountMinor: 500000, currency: "USD" });

      const parsedSafe = Money.fromJSON(safeJSON);
      expect(parsedSafe.equals(safe)).toBe(true);

      // Large integers > 2^53 serialized as strings
      const largeBigInt = BigInt(Number.MAX_SAFE_INTEGER) + 1000n;
      const large = Money.fromMinor(largeBigInt, "USD");
      const largeJSON = large.toJSON();
      expect(typeof largeJSON.amountMinor).toBe("string");
      expect(largeJSON.amountMinor).toBe(largeBigInt.toString());

      const parsedLarge = Money.fromJSON(largeJSON);
      expect(parsedLarge.equals(large)).toBe(true);
    });
  });

  describe("Functional Conveniences", () => {
    it("exposes standalone functional helpers", () => {
      const m1 = money(1000, "USD");
      const m2 = moneyFromDecimal("20.00", "USD");
      const sum = add(m1, m2);
      expect(sum.amountMinor).toBe(3000n);

      const diff = subtract(sum, m1);
      expect(diff.amountMinor).toBe(2000n);

      const parts = allocate(diff, [1, 1]);
      expect(parts.length).toBe(2);
      expect(parts[0].amountMinor).toBe(1000n);

      expect(() => assertNonNegative(diff)).not.toThrow();
    });
  });
});
