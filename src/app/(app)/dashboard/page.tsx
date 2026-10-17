import { KpiCard } from "@/components/finance/kpi-card";
import { NetFlowChart } from "@/components/finance/net-flow-chart";
import { DataTable, Panel, type Column } from "@/components/finance/panels";
import { Badge } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import { sampleBalances, sampleInstruments, sampleNetFlow, type SampleInstrument } from "@/lib/sample-data";

const columns: Column<SampleInstrument>[] = [
  { key: "name", header: "Instrument", render: (r) => r.name },
  { key: "rate", header: "Rate", align: "right", render: (r) => `${(r.annualRateBps / 100).toFixed(2)}%` },
  { key: "lag", header: "Settles", align: "right", render: (r) => (r.settlementLagHours === 0 ? "Instant" : `${r.settlementLagHours}h`) },
  { key: "pen", header: "Early exit", align: "right", render: (r) => (r.penaltyBps === 0 ? "None" : `${(r.penaltyBps / 100).toFixed(2)}%`) },
  { key: "dep", header: "Deployed", align: "right", render: (r) => formatCompactMinor(r.deployed) },
  { key: "util", header: "Utilisation", align: "right", render: (r) => `${Math.round((r.deployed / r.capacity) * 100)}%` },
];

export default function DashboardPage() {
  const b = sampleBalances;
  const liquid = b.totalCash - b.deployedSurplus;
  const coverage = liquid / b.requiredReserve;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Liquidity dashboard</h1>
        <Badge tone="info">Sample data — no forecast or optimisation has run</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total cash" value={formatCompactMinor(b.totalCash)} hint="Across all accounts" sample />
        <KpiCard label="Immediately available" value={formatCompactMinor(liquid)} hint={`${coverage.toFixed(2)}× placeholder reserve`} status={coverage >= 1 ? "ok" : "breach"} sample />
        <KpiCard label="Placeholder reserve" value={formatCompactMinor(b.requiredReserve)} hint="Not computed by the engine" sample />
        <KpiCard label="Deployed in yield" value={formatCompactMinor(b.deployedSurplus)} hint="Illustrative positions" sample />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="Hourly net cash flow" description="Inflows minus outflows, 48 hours (synthetic)" sample>
            <NetFlowChart data={sampleNetFlow} />
          </Panel>
        </div>
        <Panel title="Reserve status" description="How the sample dashboard will report coverage" sample>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Coverage ratio</dt><dd className="tabular">{coverage.toFixed(2)}×</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Headroom</dt><dd className="tabular">{formatCompactMinor(liquid - b.requiredReserve)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Confidence level</dt><dd className="text-muted">Set in Phase 5</dd></div>
          </dl>
          <p className="mt-4 text-xs text-muted">A probabilistic reserve is not a guarantee that every payout is funded.</p>
        </Panel>
      </div>

      <Panel title="Yield instruments" description="Terms are illustrative placeholders" sample>
        <DataTable columns={columns} rows={sampleInstruments} />
      </Panel>
    </div>
  );
}
