import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-muted border border-border",
      positive: "bg-positive-soft text-positive",
      negative: "bg-negative-soft text-negative",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
      solid: "bg-primary text-primary-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
