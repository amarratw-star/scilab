"use client";
import * as React from "react";
import * as AD from "@radix-ui/react-alert-dialog";
import { Button } from "./button";

/** Boîte de confirmation pour les actions destructrices. */
export function ConfirmDialog({ trigger, title, description, confirmLabel = "Confirmer", destructive = true, onConfirm, children }: { trigger: React.ReactNode; title: string; description: React.ReactNode; confirmLabel?: string; destructive?: boolean; onConfirm: () => Promise<void> | void; children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  return (
    <AD.Root open={open} onOpenChange={setOpen}>
      <AD.Trigger asChild>{trigger}</AD.Trigger>
      <AD.Portal>
        <AD.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
        <AD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-surface p-6 shadow-2xl data-[state=open]:animate-slide-up">
          <AD.Title className="text-lg font-semibold">{title}</AD.Title>
          <AD.Description asChild>
            <div className="mt-2 text-sm text-muted">{description}</div>
          </AD.Description>
          {children}
          <div className="mt-6 flex justify-end gap-2">
            <AD.Cancel asChild>
              <Button variant="ghost">Annuler</Button>
            </AD.Cancel>
            <Button
              variant={destructive ? "destructive" : "default"}
              loading={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AD.Content>
      </AD.Portal>
    </AD.Root>
  );
}
