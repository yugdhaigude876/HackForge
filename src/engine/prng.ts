/**
 * Reserve Juggler - Seeded Pseudo-Random Number Generator (PRNG)
 *
 * Implements a 32-bit Mulberry32 PRNG paired with a 32-bit string hashing algorithm.
 * Guarantees 100% deterministic sequence reproduction across platforms for any given seed.
 */

/**
 * 32-bit MurmurHash3-inspired string hash to convert string seeds to 32-bit unsigned integers.
 */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    // 32-bit FNV prime multiplication
    h = Math.imul(h, 0x01000193);
  }
  // Avalanching finalizer
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class SeededPRNG {
  private state: number;
  readonly seedString: string;

  constructor(seed: string | number) {
    if (typeof seed === "number") {
      this.seedString = seed.toString();
      this.state = seed >>> 0;
    } else {
      this.seedString = seed;
      this.state = hashSeed(seed);
    }

    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /**
   * Returns next pseudo-random float in [0, 1) using Mulberry32.
   */
  next(): number {
    let z = (this.state += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns pseudo-random integer in [min, max] inclusive.
   */
  nextInt(min: number, max: number): number {
    if (min > max) {
      throw new Error(`min (${min}) cannot exceed max (${max})`);
    }
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Returns pseudo-random float in [min, max).
   */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a standard normal variable using Box-Muller transform.
   */
  nextGaussian(mean = 0, stdDev = 1): number {
    let u1 = this.next();
    let u2 = this.next();
    // Prevent log(0)
    while (u1 === 0) u1 = this.next();
    while (u2 === 0) u2 = this.next();

    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /**
   * Choose an item from an array with optional relative weights.
   */
  choice<T>(items: readonly T[], weights?: readonly number[]): T {
    if (items.length === 0) {
      throw new Error("Cannot choose from empty array");
    }
    if (!weights) {
      const idx = Math.floor(this.next() * items.length);
      return items[idx];
    }
    if (weights.length !== items.length) {
      throw new Error("Weights length must match items length");
    }

    const totalWeight = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
    if (totalWeight <= 0) {
      throw new Error("Total weight must be positive");
    }

    let r = this.next() * totalWeight;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) {
        return items[i];
      }
    }
    return items[items.length - 1];
  }

  /**
   * Deterministic UUID v4-like string generator.
   */
  nextUUID(): string {
    const hex = () => Math.floor(this.next() * 16).toString(16);
    return (
      Array.from({ length: 8 }, hex).join("") +
      "-" +
      Array.from({ length: 4 }, hex).join("") +
      "-4" +
      Array.from({ length: 3 }, hex).join("") +
      "-a" +
      Array.from({ length: 3 }, hex).join("") +
      "-" +
      Array.from({ length: 12 }, hex).join("")
    );
  }
}

/**
 * Convenience factory to create a SeededPRNG instance.
 */
export function createPRNG(seed: string | number): SeededPRNG {
  return new SeededPRNG(seed);
}
