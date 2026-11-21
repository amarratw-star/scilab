"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useRefData } from "@/components/app/app-shell";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { QUICK_PERIODS } from "./filters";
import { cn } from "@/lib/utils";

export function FilterBar({ accounts, tags }: { accounts: { id: string; name: string }[]; tags: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { categories } = useRefData();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [advanced, setAdvanced] = useState(Boolean(sp.get("type") || sp.get("compte") || sp.get("categorie") || sp.get("moyen") || sp.get("min") || sp.get("max") || sp.get("tag") || sp.get("statut")));
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    next.delete("page");
    next.delete("id");
    router.replace(`/transactions?${next.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set({ q: q || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const periode = sp.get("periode") ?? "tout";
  const activeCount = ["type", "compte", "categorie", "moyen", "min", "max", "tag", "statut"].filter((k) => sp.get(k)).length;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (libellé, commerçant, catégorie, notes)…" className="pl-9" aria-label="Rechercher" />
        </div>
        <Button variant={advanced ? "secondary" : "outline"} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          <SlidersHorizontal /> <span className="hidden sm:inline">Filtres</span>
          {activeCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{activeCount}</span>}
        </Button>
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {QUICK_PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => set({ periode: p.value === "tout" ? null : p.value })}
            className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-xs transition", periode === p.value ? "border-foreground bg-foreground text-background" : "border-border bg-surface text-muted hover:text-foreground")}
          >
            {p.label}
          </button>
        ))}
      </div>
      {periode === "perso" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" className="w-auto" defaultValue={sp.get("du") ?? ""} onChange={(e) => set({ du: e.target.value || null })} aria-label="Du" />
          <span className="text-muted">→</span>
          <Input type="date" className="w-auto" defaultValue={sp.get("au") ?? ""} onChange={(e) => set({ au: e.target.value || null })} aria-label="Au" />
        </div>
      )}
      {advanced && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-surface p-3 sm:grid-cols-3 lg:grid-cols-5 animate-fade-in">
          <Select aria-label="Type" value={sp.get("type") ?? ""} onChange={(e) => set({ type: e.target.value || null })}>
            <option value="">Tous les types</option>
            <option value="expense">Dépenses</option>
            <option value="income">Revenus</option>
            <option value="transfer">Transferts</option>
            <option value="refund">Remboursements</option>
            <option value="adjustment">Régularisations</option>
            <option value="expense,refund">Dépenses + remboursements</option>
          </Select>
          <Select aria-label="Catégorie" value={sp.get("categorie") ?? ""} onChange={(e) => set({ categorie: e.target.value || null })}>
            <option value="">Toutes catégories</option>
            <option value="none">Non catégorisées</option>
            {categories.filter((c) => !c.parentId).map((c) => (
              <option key={c.id} value={c.id}>{c.kind === "income" ? "↓ " : ""}{c.name}</option>
            ))}
          </Select>
          <Select aria-label="Compte" value={sp.get("compte") ?? ""} onChange={(e) => set({ compte: e.target.value || null })}>
            <option value="">Tous les comptes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          <Select aria-label="Moyen de paiement" value={sp.get("moyen") ?? ""} onChange={(e) => set({ moyen: e.target.value || null })}>
            <option value="">Tous moyens</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
          <Select aria-label="Statut" value={sp.get("statut") ?? ""} onChange={(e) => set({ statut: e.target.value || null })}>
            <option value="">Tous statuts</option>
            <option value="posted">Effectuées</option>
            <option value="planned">Prévues</option>
            <option value="cancelled">Annulées</option>
          </Select>
          <Input inputMode="decimal" placeholder="Montant min" defaultValue={sp.get("min") ?? ""} onBlur={(e) => set({ min: e.target.value || null })} aria-label="Montant minimum" />
          <Input inputMode="decimal" placeholder="Montant max" defaultValue={sp.get("max") ?? ""} onBlur={(e) => set({ max: e.target.value || null })} aria-label="Montant maximum" />
          {tags.length > 0 && (
            <Select aria-label="Tag" value={sp.get("tag") ?? ""} onChange={(e) => set({ tag: e.target.value || null })}>
              <option value="">Tous les tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </Select>
          )}
          <Select aria-label="Tri" value={sp.get("tri") ?? "date_desc"} onChange={(e) => set({ tri: e.target.value === "date_desc" ? null : e.target.value })}>
            <option value="date_desc">Plus récentes</option>
            <option value="date_asc">Plus anciennes</option>
            <option value="amount_desc">Montant décroissant</option>
            <option value="amount_asc">Montant croissant</option>
          </Select>
          {activeCount > 0 && (
            <Button variant="ghost" onClick={() => router.replace("/transactions")}>
              <X /> Réinitialiser
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
