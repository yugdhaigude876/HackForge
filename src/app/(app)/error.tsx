"use client";

import { ErrorState, Panel } from "@/components/finance/panels";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Panel title="Something went wrong">
      <ErrorState message="This view failed to load. No data was changed." onRetry={reset} />
    </Panel>
  );
}
