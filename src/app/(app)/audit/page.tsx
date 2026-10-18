"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { apiFetch } from "@/lib/api-client";
import { Panel, DataTable, type Column, LoadingState, ErrorState, EmptyState } from "@/components/finance/panels";
import { Badge, Button } from "@/components/ui/primitives";
import { formatCompactMinor } from "@/lib/money";
import { ScrollText, RefreshCw, ShieldCheck } from "lucide-react";
import { FallbackBanner } from "@/components/ui/fallback-banner";
import { useDataSource } from "@/components/providers/data-source-provider";

interface DecisionRecord {
  id: string;
  createdAt: string | Date;
  status: "HEALTHY" | "UNDER_RESERVED" | "LOW_CONFIDENCE";
  reserve: string;
  surplus: string;
  confidence: number;
  explanation: string;
  allocations: Array<{ instrumentId: string; amount: string }>;
  source?: string;
}

const SEEDED_AUDIT_DECISIONS: DecisionRecord[] = [
  {
    id: "dec-audit-004",
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
    status: "HEALTHY",
    reserve: "1650000000",
    surplus: "3350000000",
    confidence: 0.99,
    explanation: "Basel III liquidity optimization executed: $16.5M reserve maintained in Tier 0 Cash Buffer. $33.5M surplus deployed across Tiers 1-3.",
    allocations: [
      { instrumentId: "tier1_repo", amount: "1850000000" },
      { instrumentId: "tier2_bonds", amount: "1000000000" },
      { instrumentId: "tier3_equities", amount: "500000000" },
    ],
  },
  {
    id: "dec-audit-003",
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
    status: "HEALTHY",
    reserve: "1650000000",
    surplus: "3350000000",
    confidence: 0.99,
    explanation: "17:00 UTC Repo sweep window executed: $18.5M swept into Tier 1 Overnight Repo @ 4.29% APY.",
    allocations: [
      { instrumentId: "tier1_repo", amount: "1850000000" },
      { instrumentId: "tier2_bonds", amount: "1000000000" },
      { instrumentId: "tier3_equities", amount: "500000000" },
    ],
  },
  {
    id: "dec-audit-002",
    createdAt: new Date(Date.now() - 36000_000).toISOString(),
    status: "HEALTHY",
    reserve: "1580000000",
    surplus: "3420000000",
    confidence: 0.99,
    explanation: "08:00 UTC Overnight Repo matured: principal returned to Tier 0 Cash with +$2,450.12 accrued yield.",
    allocations: [
      { instrumentId: "tier2_bonds", amount: "1000000000" },
      { instrumentId: "tier3_equities", amount: "500000000" },
    ],
  },
  {
    id: "dec-audit-001",
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
    status: "HEALTHY",
    reserve: "1600000000",
    surplus: "3400000000",
    confidence: 0.99,
    explanation: "Initial daily Basel III liquidity plan configured. Statistical VaR threshold satisfied.",
    allocations: [
      { instrumentId: "tier1_repo", amount: "1900000000" },
      { instrumentId: "tier2_bonds", amount: "1000000000" },
      { instrumentId: "tier3_equities", amount: "500000000" },
    ],
  },
];

const OFFLINE_FALLBACK_AUDIT_DECISIONS: DecisionRecord[] = SEEDED_AUDIT_DECISIONS.map((d) => ({
  ...d,
  source: "offline-fallback",
}));

export default function AuditTrailPage() {
  const { user, isMock } = useAuth();
  const { setSource } = useDataSource();
  const [decisions, setDecisions] = useState<DecisionRecord[]>(SEEDED_AUDIT_DECISIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [fallbackRequestId, setFallbackRequestId] = useState<string | null>(null);

  const isLive = Boolean(user && !isMock);

  useEffect(() => {
    if (isFallback) {
      setSource("offline-fallback");
    } else {
      setSource(null);
    }
  }, [isFallback, setSource]);

  const handleFetchResult = (res: { ok: boolean; status: number; data?: DecisionRecord[]; error?: { message?: string }; requestId?: string }) => {
    if (res.ok && res.data) {
      setDecisions(res.data);
      setError(null);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    if (res.status === 401 || res.status === 403) {
      const msg = res.status === 401
        ? "Authentication required. Please sign in with an authorised account to inspect live audit entries."
        : (res.error?.message ? (res.error.message.includes("Permission denied") ? res.error.message : `Permission denied: ${res.error.message}`) : "Permission denied. Viewer or analyst access required.");
      setError(msg);
      setDecisions([]);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    if (res.status === 429) {
      setError("Rate limit exceeded. Please wait before retrying.");
      setDecisions([]);
      setIsFallback(false);
      setFallbackRequestId(null);
      return;
    }

    // 5xx / Network / Timeout -> honest offline fallback
    console.warn(`[AuditTrailPage] Server error (HTTP ${res.status}), activating offline fallback`);
    setDecisions(OFFLINE_FALLBACK_AUDIT_DECISIONS);
    setError(null);
    setIsFallback(true);
    setFallbackRequestId(res.requestId || null);
  };

  const fetchAuditRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DecisionRecord[]>("/api/decisions?limit=50");
      handleFetchResult(res);
    } catch (err) {
      console.warn("[AuditTrailPage] Fetch exception, activating offline fallback:", err);
      setDecisions(OFFLINE_FALLBACK_AUDIT_DECISIONS);
      setError(null);
      setIsFallback(true);
      setFallbackRequestId(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    apiFetch<DecisionRecord[]>("/api/decisions?limit=50")
      .then((res) => {
        if (cancelled) return;
        handleFetchResult(res);
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("[AuditTrailPage] Network error on mount, activating offline fallback:", err);
          setDecisions(OFFLINE_FALLBACK_AUDIT_DECISIONS);
          setError(null);
          setIsFallback(true);
          setFallbackRequestId(null);
        }
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
          {isFallback && (
            <Badge tone="warning" data-testid="fallback-badge">
              Offline fallback
            </Badge>
          )}
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

      {isFallback && (
        <FallbackBanner
          onRetry={fetchAuditRecords}
          requestId={fallbackRequestId}
          isRetrying={loading}
        />
      )}

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
