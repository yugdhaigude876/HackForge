import { EmptyState, Panel } from "@/components/finance/panels";

export function PlannedPage({ title, phase, summary }: { title: string; phase: number; summary: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{title}</h1>
      <Panel title={title}>
        <EmptyState title={`Planned for Phase ${phase}`} message={`${summary} This view is not implemented yet; see docs/IMPLEMENTATION_PLAN.md.`} />
      </Panel>
    </div>
  );
}
