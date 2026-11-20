import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border-strong px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 rounded-2xl bg-surface-2 p-3 text-muted [&_svg]:size-6">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tip, className, accent }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tip?: React.ReactNode; className?: string; accent?: "positive" | "negative" | "warning" | "info" }) {
  return (
    <div className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5", className)}>
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        {accent ? <span className={cn("size-1.5 rounded-full", { positive: "bg-positive", negative: "bg-negative", warning: "bg-warning", info: "bg-info" }[accent])} aria-hidden /> : null}
        {label}
        {tip}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">{value}</div>
      {hint ? <div className="mt-1 text-xs text-subtle">{hint}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between first:mt-0">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

export function Callout({ tone = "info", title, children, className, icon }: { tone?: "info" | "warning" | "negative" | "positive" | "neutral"; title?: React.ReactNode; children?: React.ReactNode; className?: string; icon?: React.ReactNode }) {
  const tones = {
    info: "bg-info-soft border-info/20 text-foreground",
    warning: "bg-warning-soft border-warning/25",
    negative: "bg-negative-soft border-negative/25",
    positive: "bg-positive-soft border-positive/25",
    neutral: "bg-surface-2 border-border",
  };
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm", tones[tone], className)} role={tone === "negative" ? "alert" : undefined}>
      {icon ? <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div> : null}
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn("text-muted", title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}
