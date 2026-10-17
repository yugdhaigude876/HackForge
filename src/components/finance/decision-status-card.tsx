import { Card, Badge } from "@/components/ui/primitives";
import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";

export type DecisionStatus = "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";

export interface DecisionStatusCardProps {
  status: DecisionStatus;
  mase?: number | null;
  confidence?: number | null;
  sample?: boolean;
  className?: string;
}

export function DecisionStatusCard({
  status,
  mase,
  confidence,
  sample,
  className,
}: DecisionStatusCardProps) {
  const isHealthy = status === "HEALTHY";
  const isUnderReserved = status === "UNDER_RESERVED";

  const Icon = isHealthy ? CheckCircle2 : isUnderReserved ? AlertOctagon : AlertTriangle;

  const glowClass = isHealthy
    ? "border-positive/40 shadow-xs"
    : isUnderReserved
    ? "border-negative/40 shadow-xs"
    : "border-warning/40 shadow-xs";

  return (
    <Card className={`p-4 transition-all ${glowClass} ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Decision Engine Status
        </p>
        {sample && <Badge tone="info">Sample</Badge>}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Icon
          className={`h-5 w-5 ${
            isHealthy
              ? "text-positive"
              : isUnderReserved
              ? "text-negative"
              : "text-warning"
          }`}
          aria-hidden
        />
        <p
          className={`text-xl font-bold tracking-tight ${
            isHealthy
              ? "text-positive"
              : isUnderReserved
              ? "text-negative"
              : "text-warning"
          }`}
          data-testid="decision-status-value"
        >
          {status}
        </p>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
        {typeof mase === "number" && (
          <span
            className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-foreground"
            data-testid="mase-chip"
          >
            MASE: {mase.toFixed(2)}
          </span>
        )}
        {typeof confidence === "number" && (
          <span
            className="inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-foreground"
            data-testid="confidence-chip"
          >
            {Math.round(confidence * 100)}% Conf.
          </span>
        )}
        {typeof mase !== "number" && typeof confidence !== "number" && (
          <span className="text-[11px] text-muted">Baseline evaluation</span>
        )}
      </div>
    </Card>
  );
}
