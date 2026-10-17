import { Card, Badge, Skeleton } from "@/components/ui/primitives";

export type KpiStatus = "ok" | "watch" | "breach" | "neutral";

const statusTone = { ok: "positive", watch: "warning", breach: "negative", neutral: "neutral" } as const;
const statusLabel = { ok: "Covered", watch: "Watch", breach: "Breach", neutral: "—" } as const;

export interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  status?: KpiStatus;
  accent?: "default" | "amber" | "teal" | "blue";
  subline?: React.ReactNode;
  /** Marks values that come from placeholder data rather than the engine. */
  sample?: boolean;
}

export function KpiCard({
  label,
  value,
  hint,
  status = "neutral",
  accent = "default",
  subline,
  sample,
}: KpiCardProps) {
  const accentClass =
    accent === "amber"
      ? "border-warning/30 hover:border-warning/50 dark:shadow-[0_0_15px_-3px_rgba(245,158,11,0.08)]"
      : accent === "teal"
      ? "border-positive/30 hover:border-positive/50 dark:shadow-[0_0_15px_-3px_rgba(16,185,129,0.08)]"
      : accent === "blue"
      ? "border-primary/30 hover:border-primary/50 dark:shadow-[0_0_15px_-3px_rgba(59,130,246,0.08)]"
      : "";

  return (
    <Card className={`p-4 transition-all ${accentClass}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {status !== "neutral" && <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {subline && <div className="mt-1 text-[11px] font-mono text-muted">{subline}</div>}
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
