import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export interface FallbackBannerProps {
  onRetry?: () => void;
  requestId?: string | null;
  isRetrying?: boolean;
}

export function FallbackBanner({ onRetry, requestId, isRetrying }: FallbackBannerProps) {
  return (
    <div
      role="status"
      data-testid="fallback-banner"
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
    >
      <div className="flex items-start sm:items-center gap-2.5">
        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden />
        <div>
          <span className="font-semibold text-amber-300">
            Live data unavailable. Showing locally generated sample data. Nothing here is saved.
          </span>
          {requestId && (
            <span
              className="block sm:inline sm:ml-2 font-mono text-[11px] text-amber-400/90"
              data-testid="request-id"
            >
              (Request ID: {requestId})
            </span>
          )}
        </div>
      </div>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={isRetrying}
          className="border-amber-500/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-xs shrink-0"
          data-testid="fallback-retry-btn"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`} />
          Retry
        </Button>
      )}
    </div>
  );
}
