"use client";

import Link from "next/link";
import { formatCompactMinor } from "@/lib/money";
import { Badge } from "@/components/ui/primitives";
import { ScrollText, ExternalLink, RefreshCw } from "lucide-react";

export interface DecisionFeedItem {
  id: string;
  createdAt: string | Date;
  status: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  reserve: string;
  surplus: string;
  confidence: number;
  allocationsCount?: number;
  explanation?: string;
}

export interface DecisionAuditFeedProps {
  decisions: DecisionFeedItem[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  className?: string;
}

export function DecisionAuditFeed({
  decisions,
  loading = false,
  error = null,
  onRefresh,
  className,
}: DecisionAuditFeedProps) {
  return (
    <div className={`flex h-full flex-col ${className ?? ""}`}>
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted" />
          <span className="text-xs font-semibold text-foreground">
            Liquidity Decision Engine & Audit Log
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh log"
              className="rounded p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          )}
          <Link
            href="/audit"
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Full Trail
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      </div>

      <div className="flex-1 py-2">
        {loading ? (
          <div className="flex h-44 items-center justify-center text-xs text-muted">
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
            Loading decision audit log...
          </div>
        ) : error ? (
          <div className="flex h-44 flex-col items-center justify-center rounded-md border border-negative/20 bg-negative/5 p-4 text-center text-xs text-negative">
            <p className="font-medium">Failed to load audit records</p>
            <p className="mt-1 text-[11px] text-muted">{error}</p>
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center rounded-md border border-border/60 bg-surface-2/20 p-4 text-center text-xs text-muted">
            <p className="font-medium text-foreground">No decisions recorded yet</p>
            <p className="mt-1 max-w-xs text-[11px]">
              When the decision engine runs, persisted decisions and cryptographic
              audit hashes will appear here in chronological order.
            </p>
          </div>
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1 font-mono text-[11px]">
            {decisions.slice(0, 5).map((item) => {
              const date =
                typeof item.createdAt === "string"
                  ? new Date(item.createdAt)
                  : item.createdAt;
              const timeStr = !isNaN(date.getTime())
                ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                : "--:--:--";

              const statusTone =
                item.status === "HEALTHY"
                  ? "positive"
                  : item.status === "UNDER_RESERVED"
                  ? "negative"
                  : "warning";

              return (
                <div
                  key={item.id}
                  className="rounded border border-border/50 bg-surface-2/30 p-2 transition-colors hover:bg-surface-2/60"
                >
                  <div className="flex items-center justify-between gap-1 text-[10px]">
                    <span className="text-muted">{timeStr}</span>
                    <Badge tone={statusTone}>{item.status}</Badge>
                  </div>
                  <div className="mt-1 text-foreground">
                    <span>[DECISION] </span>
                    <span className="text-muted">Reserve: </span>
                    <span className="font-semibold text-warning">
                      {formatCompactMinor(BigInt(item.reserve || "0"))}
                    </span>
                    <span className="text-muted"> • Surplus: </span>
                    <span className="font-semibold text-positive">
                      {formatCompactMinor(BigInt(item.surplus || "0"))}
                    </span>
                  </div>
                  {item.explanation && (
                    <div className="mt-0.5 truncate text-[10px] text-muted">
                      {item.explanation}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-[9px] text-muted">
                    <span>Conf: {(item.confidence * 100).toFixed(1)}%</span>
                    <span className="truncate">id: {item.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
