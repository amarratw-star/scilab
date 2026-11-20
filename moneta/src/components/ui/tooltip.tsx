"use client";
import * as TP from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

export function InfoTip({ children, label = "Définition" }: { children: React.ReactNode; label?: string }) {
  return (
    <TP.Provider delayDuration={150}>
      <TP.Root>
        <TP.Trigger asChild>
          <button type="button" className="inline-flex text-subtle hover:text-foreground" aria-label={label}>
            <Info className="size-3.5" />
          </button>
        </TP.Trigger>
        <TP.Portal>
          <TP.Content sideOffset={6} className="z-50 max-w-72 rounded-xl border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl data-[state=delayed-open]:animate-fade-in">
            {children}
          </TP.Content>
        </TP.Portal>
      </TP.Root>
    </TP.Provider>
  );
}
