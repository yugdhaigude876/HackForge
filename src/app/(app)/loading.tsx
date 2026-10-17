import { KpiCardSkeleton } from "@/components/finance/kpi-card";
import { LoadingState, Panel } from "@/components/finance/panels";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
      <Panel title="Loading">
        <LoadingState />
      </Panel>
    </div>
  );
}
