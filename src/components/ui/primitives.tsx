import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, Inbox } from "lucide-react";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[20px] border border-border bg-surface backdrop-blur-md shadow-sm transition-all duration-200",
        className
      )}
      {...props}
    />
  );
}

/** Translucent glass surface card with subtle specular gradient and hover lift */
export function GlassCard({
  className,
  children,
  hoverLift = true,
  ...props
}: React.ComponentProps<"div"> & { hoverLift?: boolean }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[22px] border border-border bg-surface/80 p-5 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-300",
        hoverLift && "hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
        className
      )}
      {...props}
    >
      <div className="specular-border pointer-events-none absolute inset-0 rounded-[22px]" />
      {children}
    </div>
  );
}

/** Hero glass card with an ambient radial backdrop glow pinned behind it */
export function HeroCard({
  className,
  glowColor = "rgba(59, 130, 246, 0.2)",
  children,
  ...props
}: React.ComponentProps<"div"> & { glowColor?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-[24px] border border-border-strong bg-surface-raised p-6 backdrop-blur-2xl shadow-xl", className)} {...props}>
      <div
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full blur-[80px]"
        style={{ background: glowColor }}
        aria-hidden="true"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/** StatCard with tabular numbers, trend pill, and sparkline slot */
export interface StatCardProps extends React.ComponentProps<"div"> {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  trend?: {
    direction: "up" | "down" | "neutral";
    label: string;
    positive?: boolean;
  };
  icon?: React.ReactNode;
  accentColor?: string;
  badge?: React.ReactNode;
  sparkline?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  subValue,
  trend,
  icon,
  accentColor,
  badge,
  sparkline,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between overflow-hidden rounded-[20px] border border-border bg-surface/80 p-4.5 backdrop-blur-md transition-all duration-200 hover:border-border-strong",
        className
      )}
      {...props}
    >
      {accentColor && (
        <div
          className="pointer-events-none absolute top-0 right-0 h-28 w-28 -mr-8 -mt-8 rounded-full opacity-15 blur-2xl"
          style={{ background: accentColor }}
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-muted">{label}</span>
        <div className="flex items-center gap-1.5">
          {badge}
          {icon && (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-2 text-foreground">
              {icon}
            </div>
          )}
        </div>
      </div>

      {/* Main Metric Value */}
      <div className="mt-3">
        <div className="text-2xl lg:text-3xl font-bold font-mono tracking-tight tabular text-foreground">
          {value}
        </div>
        {subValue && <div className="mt-1 text-xs text-muted font-medium">{subValue}</div>}
      </div>

      {/* Footer / Trend & Sparkline */}
      {(trend || sparkline) && (
        <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-2.5 text-xs">
          {trend && (
            <div className="flex items-center gap-1 font-mono text-[11px] font-semibold">
              {trend.direction === "up" ? (
                <span className={cn("inline-flex items-center gap-0.5", trend.positive !== false ? "text-positive" : "text-negative")}>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  {trend.label}
                </span>
              ) : trend.direction === "down" ? (
                <span className={cn("inline-flex items-center gap-0.5", trend.positive ? "text-positive" : "text-negative")}>
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  {trend.label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-muted">
                  <Minus className="h-3 w-3" />
                  {trend.label}
                </span>
              )}
            </div>
          )}
          {sparkline && <div className="ml-auto">{sparkline}</div>}
        </div>
      )}
    </div>
  );
}

/** Segmented Pill Tabs for Range Switching (1D, 1W, 1M, 6M, 1Y) */
export interface RangePillsProps {
  options?: Array<{ label: string; value: string | number }>;
  value: string | number;
  onChange: (val: string | number) => void;
  className?: string;
  size?: "sm" | "md";
}

const DEFAULT_RANGE_OPTIONS = [
  { label: "1D", value: 24 },
  { label: "1W", value: 168 },
  { label: "1M", value: 720 },
  { label: "6M", value: 4380 },
  { label: "1Y", value: 8760 },
];

export function RangePills({
  options = DEFAULT_RANGE_OPTIONS,
  value,
  onChange,
  className,
  size = "sm",
}: RangePillsProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Time horizon selector"
      className={cn("inline-flex items-center rounded-xl border border-border bg-surface-2 p-1 gap-1 backdrop-blur-sm", className)}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg font-mono font-semibold transition-all duration-200 focus-visible:outline-2 focus-visible:outline-primary",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs",
              isSelected
                ? "bg-primary text-white shadow-md shadow-primary/25"
                : "text-muted hover:bg-surface hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** SVG circular gauge for capacity and reserve coverage */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  strokeWidth = 6,
  strokeColor = "var(--primary)",
  trackColor = "var(--border)",
  className,
  children,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  strokeColor?: string;
  trackColor?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(0, value), max);
  const strokeDashoffset = circumference - (clamped / max) * circumference;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center pointer-events-none">{children}</div>}
    </div>
  );
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-2 text-muted",
        positive: "border-positive/30 bg-positive/10 text-positive",
        warning: "border-warning/30 bg-warning/10 text-warning",
        negative: "border-negative/30 bg-negative/10 text-negative",
        info: "border-primary/30 bg-primary/10 text-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary/90 shadow-sm shadow-primary/25",
        ghost: "text-muted hover:bg-surface-2 hover:text-foreground",
        outline: "border border-border text-foreground hover:bg-surface-2 hover:border-border-strong",
      },
      size: { sm: "h-8 px-3 text-xs rounded-lg", md: "h-9 px-4 rounded-xl", icon: "h-9 w-9 rounded-xl" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-xl bg-surface-2", className)} {...props} />;
}

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-xl border border-border bg-surface-2 px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("text-xs font-semibold tracking-wide text-foreground", className)}
      {...props}
    />
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Inbox className="h-8 w-8 text-muted" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted leading-relaxed">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <AlertTriangle className="h-8 w-8 text-negative" aria-hidden />
      <p className="max-w-sm text-sm font-medium text-foreground">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} size="sm" variant="primary">
          Retry
        </Button>
      )}
    </div>
  );
}
