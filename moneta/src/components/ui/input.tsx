import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-xl border border-border bg-surface px-3 text-[15px] sm:text-sm placeholder:text-subtle transition-colors focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 aria-[invalid=true]:border-negative",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-20 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[15px] sm:text-sm placeholder:text-subtle focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/** Sélecteur natif stylé : fiable, accessible et parfaitement adapté au mobile. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full appearance-none rounded-xl border border-border bg-surface pl-3 pr-9 text-[15px] sm:text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-50 aria-[invalid=true]:border-negative",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <svg aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
  </div>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-foreground", className)} {...props} />;
}

export function Field({ label, htmlFor, error, hint, children, className }: { label: React.ReactNode; htmlFor?: string; error?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-negative" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
