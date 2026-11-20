import type { Metadata } from "next";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { getTransaction, listTransactions, listTags } from "@/server/services/transactions";
import * as s from "@/server/db/schema";
import { toTxView } from "@/server/services/views";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { TxList } from "@/components/app/tx-list";
import { FilterBar } from "./filter-bar";
import { parseTxFilters } from "./filters";
import { AddButton } from "./add-button";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const data = await runAsUser(user, async (ctx) => {
    const f = parseTxFilters(sp, ctx.today);
    const single = sp.id && /^[0-9a-f-]{36}$/i.test(sp.id) ? await getTransaction(ctx, sp.id) : null;
    const list = single ? { rows: [{ ...single, docCount: 0 }], total: 1, income: 0, expenses: 0 } : await listTransactions(ctx, f);
    const accounts = await ctx.tx.select({ id: s.accounts.id, name: s.accounts.name, archivedAt: s.accounts.archivedAt }).from(s.accounts);
    const tags = await listTags(ctx);
    return { f, list, accounts, tags, single: Boolean(single) };
  });
  const { f, list, accounts, tags } = data;
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const pages = Math.max(1, Math.ceil(list.total / 50));
  const qs = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v !== undefined) as [string, string][]);
    for (const [k, v] of Object.entries(patch)) p.set(k, String(v));
    return `/transactions?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v !== undefined && k !== "page") as [string, string][]).toString();
  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Toutes tes dépenses, revenus, transferts et remboursements."
        actions={
          <>
            <Button asChild variant="outline"><a href={`/api/export/transactions?${exportQs}`}><Download /> Exporter</a></Button>
            <Button asChild variant="outline"><Link href="/import"><Upload /> Importer</Link></Button>
            <AddButton />
          </>
        }
      />
      <FilterBar accounts={accounts.map((a) => ({ id: a.id, name: a.name }))} tags={tags} />
      {data.single && (
        <p className="mb-3 text-sm text-muted">
          Résultat de recherche. <Link href="/transactions" className="text-info hover:underline">Voir toutes les opérations</Link>
        </p>
      )}
      <div className="mb-3 mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
        <span><strong className="text-foreground">{list.total}</strong> opération(s)</span>
        {!data.single && (
          <>
            <span>Revenus : <Money cents={list.income} tone="positive" /></span>
            <span>Dépenses nettes : <Money cents={list.expenses} className="text-foreground" /></span>
            <span className="text-xs">(opérations effectuées uniquement)</span>
          </>
        )}
      </div>
      <Card>
        <CardContent className="pt-2">
          <TxList rows={list.rows.map(toTxView)} accountNames={names} groupByDate={f.sort === "date_desc" || f.sort === "date_asc"} emptyText="Aucune opération ne correspond à ces filtres." />
        </CardContent>
      </Card>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="Pagination">
          {f.page > 1 && <Button asChild variant="outline" size="sm"><Link href={qs({ page: f.page - 1 })}>← Précédent</Link></Button>}
          <span className="text-sm text-muted">Page {f.page} / {pages}</span>
          {f.page < pages && <Button asChild variant="outline" size="sm"><Link href={qs({ page: f.page + 1 })}>Suivant →</Link></Button>}
        </nav>
      )}
    </div>
  );
}
