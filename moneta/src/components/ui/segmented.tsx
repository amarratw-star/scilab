"use client";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({ value, onChange, options, className, size = "default" }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; size?: "default" | "sm" }) {
  return (
    <div role="radiogroup" className={cn("inline-flex min-w-0 max-w-full overflow-x-auto scrollbar-none rounded-xl border border-border bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "whitespace-nowrap rounded-[10px] font-medium transition-all",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
