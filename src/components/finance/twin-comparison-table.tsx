"use client";

import React from "react";
import { Badge } from "@/components/ui/primitives";
import { formatMinor } from "@/lib/money";

export interface SerializedPolicyMetricRecord {
  netYieldMinor: string;
  shortfallFrequency: number;
  expectedShortfallMinor: string;
  p95ShortfallMinor: string;
  penaltiesPaidMinor: string;
  emergencyBorrowingCostMinor: string;
  meanIdleCashMinor?: string;
  idleCashHoursMinor: string;
}

export interface MetricDeltaRecord {
  netYieldMinor: string;
  shortfallFrequency: number;
  expectedShortfallMinor: string;
  p95ShortfallMinor: string;
  penaltiesPaidMinor: string;
  emergencyBorrowingCostMinor: string;
}

export interface PolicyDeltasDTO {
  vsHoldAllCash?: MetricDeltaRecord;
  vsFixedBuffer?: MetricDeltaRecord;
}

export interface TwinComparisonTableProps {
  policies: string[];
  policyResults: Record<string, SerializedPolicyMetricRecord>;
  deltas?: Record<string, PolicyDeltasDTO>;
  winners?: {
    netYield: string;
    shortfallFrequency: string;
    expectedShortfall: string;
    p95Shortfall: string;
    penaltiesPaid: string;
    emergencyBorrowingCost: string;
  };
}

const POLICY_LABELS: Record<string, string> = {
  "reserve-juggler": "Reserve Juggler",
  "hold-all-cash": "Hold All Cash",
  "fixed-buffer": "Fixed Buffer",
};

export function TwinComparisonTable({
  policies,
  policyResults,
  deltas,
  winners,
}: TwinComparisonTableProps) {
  const formatDeltaMoney = (deltaMinorStr?: string, higherIsBetter = true) => {
    if (!deltaMinorStr) return null;
    const minor = BigInt(deltaMinorStr);
    if (minor === 0n) return <span className="text-muted tabular">±$0.00</span>;

    const isPositive = minor > 0n;
    const isGood = higherIsBetter ? isPositive : !isPositive;
    const sign = isPositive ? "+" : "";

    return (
      <span
        className={`tabular text-xs font-medium ${
          isGood ? "text-positive" : "text-negative"
        }`}
      >
        {sign}
        {formatMinor(minor)}
      </span>
    );
  };

  const formatDeltaPct = (deltaNum?: number, higherIsBetter = false) => {
    if (deltaNum === undefined) return null;
    if (Math.abs(deltaNum) < 0.0001) return <span className="text-muted tabular">±0.0%</span>;

    const isPositive = deltaNum > 0;
    const isGood = higherIsBetter ? isPositive : !isPositive;
    const sign = isPositive ? "+" : "";

    return (
      <span
        className={`tabular text-xs font-medium ${
          isGood ? "text-positive" : "text-negative"
        }`}
      >
        {sign}
        {(deltaNum * 100).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left text-xs" data-testid="twin-comparison-table">
        <thead className="border-b border-border bg-surface-2/60 text-muted">
          <tr>
            <th className="py-2.5 px-3 font-semibold">Metric</th>
            {policies.map((p) => (
              <th key={p} className="py-2.5 px-3 font-semibold">
                <div className="flex items-center gap-1.5">
                  <span>{POLICY_LABELS[p] ?? p}</span>
                  {p === "hold-all-cash" && (
                    <span className="text-[10px] text-muted font-normal">(baseline)</span>
                  )}
                </div>
              </th>
            ))}
            <th className="py-2.5 px-3 font-semibold">Best Policy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {/* Net Yield Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Net Yield</div>
              <div className="text-[10px] text-muted">Gross − Penalties − Borrowing</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              const pDelta = deltas?.[p]?.vsHoldAllCash;
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {res ? formatMinor(BigInt(res.netYieldMinor)) : "—"}
                  </div>
                  {p !== "hold-all-cash" && pDelta && (
                    <div className="text-[10px] text-muted">
                      Δ cash: {formatDeltaMoney(pDelta.netYieldMinor, true)}
                    </div>
                  )}
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone="positive">{POLICY_LABELS[winners.netYield] ?? winners.netYield}</Badge>
              )}
            </td>
          </tr>

          {/* Shortfall Frequency Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Shortfall Frequency</div>
              <div className="text-[10px] text-muted">Trials with Cash &lt; 0</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              const pDelta = deltas?.[p]?.vsHoldAllCash;
              const freqPct = res ? (res.shortfallFrequency * 100).toFixed(1) + "%" : "—";
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">{freqPct}</div>
                  {p !== "hold-all-cash" && pDelta && (
                    <div className="text-[10px] text-muted">
                      Δ cash: {formatDeltaPct(pDelta.shortfallFrequency, false)}
                    </div>
                  )}
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone={winners.shortfallFrequency === "hold-all-cash" ? "neutral" : "positive"}>
                  {POLICY_LABELS[winners.shortfallFrequency] ?? winners.shortfallFrequency}
                </Badge>
              )}
            </td>
          </tr>

          {/* Expected Shortfall Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Expected Shortfall</div>
              <div className="text-[10px] text-muted">Mean deficit across trials</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              const pDelta = deltas?.[p]?.vsHoldAllCash;
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {res ? formatMinor(BigInt(res.expectedShortfallMinor)) : "—"}
                  </div>
                  {p !== "hold-all-cash" && pDelta && (
                    <div className="text-[10px] text-muted">
                      Δ cash: {formatDeltaMoney(pDelta.expectedShortfallMinor, false)}
                    </div>
                  )}
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone="neutral">
                  {POLICY_LABELS[winners.expectedShortfall] ?? winners.expectedShortfall}
                </Badge>
              )}
            </td>
          </tr>

          {/* p95 Shortfall Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>P95 Shortfall</div>
              <div className="text-[10px] text-muted">95th percentile worst-case deficit</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              const pDelta = deltas?.[p]?.vsHoldAllCash;
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {res ? formatMinor(BigInt(res.p95ShortfallMinor)) : "—"}
                  </div>
                  {p !== "hold-all-cash" && pDelta && (
                    <div className="text-[10px] text-muted">
                      Δ cash: {formatDeltaMoney(pDelta.p95ShortfallMinor, false)}
                    </div>
                  )}
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone="neutral">
                  {POLICY_LABELS[winners.p95Shortfall] ?? winners.p95Shortfall}
                </Badge>
              )}
            </td>
          </tr>

          {/* Penalties Paid Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Penalties Paid</div>
              <div className="text-[10px] text-muted">Early liquidation fees</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {res ? formatMinor(BigInt(res.penaltiesPaidMinor)) : "—"}
                  </div>
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone="neutral">
                  {POLICY_LABELS[winners.penaltiesPaid] ?? winners.penaltiesPaid}
                </Badge>
              )}
            </td>
          </tr>

          {/* Emergency Borrowing Cost Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Borrowing Cost</div>
              <div className="text-[10px] text-muted">Emergency facility fees</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {res ? formatMinor(BigInt(res.emergencyBorrowingCostMinor)) : "—"}
                  </div>
                </td>
              );
            })}
            <td className="py-2.5 px-3">
              {winners && (
                <Badge tone="neutral">
                  {POLICY_LABELS[winners.emergencyBorrowingCost] ?? winners.emergencyBorrowingCost}
                </Badge>
              )}
            </td>
          </tr>

          {/* Mean Idle Liquid Cash Row */}
          <tr className="hover:bg-surface-2/30 transition-colors">
            <td className="py-2.5 px-3 font-medium text-foreground">
              <div>Mean Idle Cash</div>
              <div className="text-[10px] text-muted">Average liquid buffer balance</div>
            </td>
            {policies.map((p) => {
              const res = policyResults[p];
              const valMinor = res?.meanIdleCashMinor ?? res?.idleCashHoursMinor ?? "0";
              return (
                <td key={p} className="py-2.5 px-3">
                  <div className="tabular font-semibold text-foreground">
                    {formatMinor(BigInt(valMinor))}
                  </div>
                </td>
              );
            })}
            <td className="py-2.5 px-3 text-muted text-[11px]">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
