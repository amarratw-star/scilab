"use client";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/misc";
import { BankInitials, startWebview } from "@/components/bank/bank-ui";

type Connector = { uuid: string; name: string; color: string | null; beta: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function BankPicker() {
  const [list, setList] = useState<Connector[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [going, setGoing] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/bank/connectors")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Liste indisponible");
        setList(d.connectors);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const shown = useMemo(() => (list ?? []).filter((c) => norm(c.name).includes(norm(q.trim()))).slice(0, 60), [list, q]);
  const go = async (uuid?: string) => {
    setGoing(uuid ?? "any");
    await startWebview({ flow: "connect", connectorUuid: uuid });
    setGoing(null);
  };
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher ma banque (ex. : Crédit Agricole, Boursorama…)" aria-label="Rechercher une banque" className="pl-9" />
      </div>
      {error && (
        <Callout tone="negative" className="mt-3" title="Liste des banques indisponible">
          {error} Tu peux quand même <button className="font-medium underline" onClick={() => go()}>ouvrir le parcours de connexion</button> et y chercher ta banque.
        </Callout>
      )}
      {!list && !error && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
      )}
      {list && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Banques disponibles">
          {shown.map((c) => (
            <li key={c.uuid}>
              <button disabled={!!going} onClick={() => go(c.uuid)} className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition hover:border-border-strong hover:bg-surface-2 disabled:opacity-60">
                <BankInitials name={c.name} color={c.color} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                {c.beta && <Badge>bêta</Badge>}
                {going === c.uuid && <span className="text-xs text-muted">Redirection…</span>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="col-span-full py-6 text-center text-sm text-muted">Aucune banque ne correspond à « {q} ».</li>}
        </ul>
      )}
    </div>
  );
}
