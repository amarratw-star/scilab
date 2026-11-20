import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90 shadow-sm",
        secondary: "bg-surface-2 text-foreground hover:bg-surface-3 border border-border",
        outline: "border border-border bg-surface hover:bg-surface-2 text-foreground",
        ghost: "hover:bg-surface-2 text-foreground",
        destructive: "bg-negative text-white hover:opacity-90",
        positive: "bg-positive text-white dark:text-black hover:opacity-90",
        link: "text-info underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props}>
        {children}
      </Comp>
    );
  }
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
Button.displayName = "Button";
