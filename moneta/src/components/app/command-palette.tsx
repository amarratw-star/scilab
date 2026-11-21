"use client";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, FileText, Folder, Loader2, Plus, Repeat, Search, Tag, Target, Wallet } from "lucide-react";
import { ALL_NAV } from "./nav";
import { formatMoney } from "@/lib/money";
import type { QuickAddPreset } from "@/components/forms/quick-add";

type Hit = { type: string; id: string; title: string; subtitle: string; href: string; amount?: number; kind?: string };
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { transaction: ArrowLeftRight, account: Wallet, subscription: Repeat, category: Tag, document: Folder, goal: Target };
const TYPE_LABEL: Record<string, string> = { transaction: "Opérations", account: "Comptes", subscription: "Abonnements et échéances", category: "Catégories", document: "Documents", goal: "Objectifs" };

export function CommandPalette({ open, onOpenChange, onQuickAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onQuickAdd: (p?: QuickAddPreset) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d) => setHits(d.hits ?? []))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const groups = Object.entries(
    hits.reduce<Record<string, Hit[]>>((acc, h) => {
      (acc[h.type] ??= []).push(h);
      return acc;
    }, {}),
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-[10dvh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-slide-up" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Recherche globale</Dialog.Title>
          <Command shouldFilter={false} label="Recherche globale">
            <div className="flex items-center gap-2 border-b border-border px-4">
              {loading ? <Loader2 className="size-4 animate-spin text-subtle" /> : <Search className="size-4 text-subtle" />}
              <Command.Input value={q} onValueChange={setQ} placeholder="Rechercher une dépense, un compte, un abonnement…" className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" />
            </div>
            <Command.List className="max-h-[60dvh] overflow-y-auto p-2">
              {q.trim().length >= 2 && !loading && hits.length === 0 && <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Aucun résultat pour « {q} ».</Command.Empty>}
              {groups.map(([type, list]) => (
                <Command.Group key={type} heading={TYPE_LABEL[type] ?? type} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                  {list.map((h) => {
                    const Icon = TYPE_ICON[h.type] ?? FileText;
                    return (
                      <Command.Item key={h.type + h.id} value={h.type + h.id} onSelect={() => go(h.href)} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-surface-2">
                        <Icon className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{h.title}</span>
                          <span className="block truncate text-xs text-subtle">{h.subtitle}</span>
                        </span>
                        {h.amount !== undefined && (
                          <span className={`tabular text-sm ${h.kind === "expense" ? "text-negative" : h.kind === "income" || h.kind === "refund" ? "text-positive" : ""}`}>
                            {formatMoney(h.kind === "expense" ? -h.amount : h.amount, undefined, { signed: h.kind === "expense" || h.kind === "income" })}
                          </span>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
              {q.trim().length < 2 && (
                <>
                  <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                    {(
                      [
                        ["Ajouter une dépense", { kind: "expense" }],
                        ["Ajouter un revenu", { kind: "income" }],
                        ["Effectuer un transfert", { kind: "transfer" }],
                      ] as [string, QuickAddPreset][]
                    ).map(([label, p]) => (
                      <Command.Item key={label} onSelect={() => { onOpenChange(false); onQuickAdd(p); }} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-surface-2">
                        <Plus className="size-4 text-muted" /> {label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                  <Command.Group heading="Aller à" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
                    {ALL_NAV.map((n) => (
                      <Command.Item key={n.href} onSelect={() => go(n.href)} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm data-[selected=true]:bg-surface-2">
                        <n.icon className="size-4 text-muted" /> {n.label}
                      </Command.Item>
                    ))}
                  </Command.Group>
                </>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
