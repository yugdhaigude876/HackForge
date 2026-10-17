import { Card, Badge, Skeleton } from "@/components/ui/primitives";

export type KpiStatus = "ok" | "watch" | "breach" | "neutral";

const statusTone = { ok: "positive", watch: "warning", breach: "negative", neutral: "neutral" } as const;
const statusLabel = { ok: "Covered", watch: "Watch", breach: "Breach", neutral: "—" } as const;

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  status?: KpiStatus;
  /** Marks values that come from placeholder data rather than the engine. */
  sample?: boolean;
}

export function KpiCard({ label, value, hint, status = "neutral", sample }: KpiCardProps) {
  return (
    <Card className="fade-in p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {status !== "neutral" && <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {sample && <Badge tone="info">Sample</Badge>}
        {hint && <span>{hint}</span>}
      </div>
    </Card>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-4" aria-busy="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-32" />
      <Skeleton className="mt-2 h-3 w-20" />
    </Card>
  );
}
