"use client";
import * as React from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = "end", ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6} className={cn("z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-xl data-[state=open]:animate-fade-in", className)} {...props} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        destructive && "text-negative [&_svg]:text-negative",
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 py-1.5 text-xs text-subtle", className)} {...props} />;
}
