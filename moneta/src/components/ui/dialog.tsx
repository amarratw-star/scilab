"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** Fenêtre modale : centrée sur ordinateur, en feuille glissante depuis le bas sur mobile. */
export function DialogContent({ className, children, title, description, wide, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-border bg-surface shadow-2xl data-[state=open]:animate-slide-up",
          "inset-x-0 bottom-0 rounded-t-3xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-surface-3 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-5">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground" aria-label="Fermer">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
