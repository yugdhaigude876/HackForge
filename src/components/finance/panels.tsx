import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Badge, Button, Card, Skeleton } from "@/components/ui/primitives";

export function Panel({
  title,
  description,
  sample,
  children,
}: {
  title: string;
  description?: string;
  sample?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="fade-in">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {sample && <Badge tone="info">Sample data</Badge>}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-negative" aria-hidden />
      <p className="max-w-sm text-sm">{message}</p>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

export function DataTable<T extends { id: string }>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  if (rows.length === 0) return <EmptyState title="No rows" message="Nothing to display yet." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.align === "right" ? "tabular text-right" : ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
