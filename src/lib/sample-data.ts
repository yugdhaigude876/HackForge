/**
 * SAMPLE DATA ONLY. Deterministic, hand-shaped placeholder values used to lay out the
 * Phase 1 dashboard. Nothing here is a forecast or a result from the engine.
 */
import type { Minor } from "./money";

export const SAMPLE_LABEL = "Sample data — not a forecast";

export interface NetFlowPoint {
  hour: string;
  inflow: Minor;
  outflow: Minor;
  net: Minor;
}

/** Small seeded PRNG (mulberry32) so the sample is identical on server and client. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNetFlow(): NetFlowPoint[] {
  const rand = mulberry32(2026);
  const points: NetFlowPoint[] = [];
  for (let h = 0; h < 48; h++) {
    const hourOfDay = h % 24;
    const daytime = Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2) * 0.5 + 0.5;
    const inflow = Math.round((14_000_000 + daytime * 12_000_000 + rand() * 2_000_000) * 100);
    const outflow = Math.round((13_000_000 + daytime * 12_500_000 + rand() * 2_500_000) * 100);
    points.push({ hour: `${String(hourOfDay).padStart(2, "0")}:00`, inflow, outflow, net: inflow - outflow });
  }
  return points;
}

export const sampleNetFlow: NetFlowPoint[] = buildNetFlow();

export const sampleBalances = {
  totalCash: 62_400_000_00,
  requiredReserve: 21_000_000_00,
  deployedSurplus: 28_500_000_00,
  /** Placeholder, not computed by any model. */
  expectedNetYieldPerDay: 31_200_00,
};

export interface SampleInstrument {
  id: string;
  name: string;
  annualRateBps: number;
  settlementLagHours: number;
  penaltyBps: number;
  deployed: Minor;
  capacity: Minor;
}

export const sampleInstruments: SampleInstrument[] = [
  { id: "tier1_repo", name: "Tier 1: Overnight Repo", annualRateBps: 429, settlementLagHours: 0, penaltyBps: 50, deployed: 18_500_000_00, capacity: 25_000_000_00 },
  { id: "tier2_bonds", name: "Tier 2: 2Y Sovereign Bonds", annualRateBps: 480, settlementLagHours: 0, penaltyBps: 200, deployed: 10_000_000_00, capacity: 15_000_000_00 },
  { id: "tier3_equities", name: "Tier 3: Growth Equities", annualRateBps: 1000, settlementLagHours: 0, penaltyBps: 1500, deployed: 5_000_000_00, capacity: 10_000_000_00 },
];
