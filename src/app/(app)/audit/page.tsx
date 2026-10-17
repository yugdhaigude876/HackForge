"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { Panel, DataTable, type Column, LoadingState, ErrorState, EmptyState } from "@/components/finance/panels";
import { Badge, Button } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import { ScrollText, RefreshCw, ShieldCheck } from "lucide-react";

interface DecisionRecord {
  id: string;
  createdAt: string | Date;
  status: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  reserve: string;
  surplus: string;
  confidence: number;
  explanation: string;
  allocations: Array<{ instrumentId: string; amount: string }>;
}

export default function AuditTrailPage() {
  const { user, isMock } = useAuth();
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive = Boolean(user && !isMock);

  const fetchAuditRecords = async () => {
    if (!isLive) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DecisionRecord[]>("/api/decisions?limit=50");
      if (res.ok) {
        setDecisions(res.data);
      } else {
        setError(res.error.message || "Failed to load audit records");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch audit records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLive) {
      return;
    }

    let cancelled = false;
    apiFetch<DecisionRecord[]>("/api/decisions?limit=50")
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setDecisions(res.data);
          setError(null);
        } else {
          setError(res.error.message || "Failed to load audit records");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to fetch audit records");
      });

    return () => {
      cancelled = true;
    };
  }, [isLive]);

  const columns: Column<DecisionRecord>[] = [
    {
      key: "timestamp",
      header: "Timestamp",
      render: (r) => {
        const d = new Date(r.createdAt);
        return isNaN(d.getTime()) ? "—" : d.toLocaleString();
      },
    },
    {
      key: "id",
      header: "Document ID",
      render: (r) => <span className="font-mono text-xs text-muted">{r.id}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => {
        const tone =
          r.status === "HEALTHY" ? "positive" : r.status === "UNDER_RESERVED" ? "negative" : "warning";
        return <Badge tone={tone}>{r.status}</Badge>;
      },
    },
    {
      key: "reserve",
      header: "Required Reserve",
      align: "right",
      render: (r) => formatCompactMinor(BigInt(r.reserve || "0")),
    },
    {
      key: "surplus",
      header: "Surplus",
      align: "right",
      render: (r) => formatCompactMinor(BigInt(r.surplus || "0")),
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "right",
      render: (r) => `${Math.round(r.confidence * 100)}%`,
    },
    {
      key: "allocations",
      header: "Allocations",
      align: "right",
      render: (r) => `${r.allocations?.length ?? 0} instruments`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-muted" />
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Audit Trail & Persisted Decisions
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isMock && <Badge tone="info">Demo Auth — Inactive</Badge>}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAuditRecords}
            disabled={loading}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {isMock && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Append-Only Cryptographic Audit Log
          </div>
          <p className="mt-1 text-xs text-muted">
            You are currently signed in with demo auth. Audit records are cryptographically
            hashed with SHA-256 and persisted per-organisation in production. Sign in with a
            real account to record and inspect immutable audit entries.
          </p>
        </div>
      )}

      <Panel
        title="Persisted Liquidity Decisions"
        description="Immutable, cryptographically verifiable runs recorded by the decision engine (GET /api/decisions)"
      >
        {loading ? (
          <LoadingState rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchAuditRecords} />
        ) : decisions.length === 0 ? (
          <EmptyState
            title="No decision records found"
            message={
              isMock
                ? "Connect a live Firebase project to evaluate and persist decision records."
                : "No decisions have been evaluated for this organisation yet."
            }
          />
        ) : (
          <DataTable columns={columns} rows={decisions} />
        )}
      </Panel>
    </div>
  );
}
