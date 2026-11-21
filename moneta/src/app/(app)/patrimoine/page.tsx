import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import * as s from "@/server/db/schema";
import { computeBalances, summarizeBalances } from "@/lib/finance/ledger";
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, latestValuation, netWorth, netWorthHistory, type WealthItemInput } from "@/lib/finance/wealth";
import { addMonths, formatDateFR, startOfMonth } from "@/lib/dates";
import { formatMoney, formatPct } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { NetWorthChart } from "@/components/charts/charts";
import { WealthItemActions, NewWealthItem } from "./wealth-ui";

export const metadata: Metadata = { title: "Mon patrimoine" };

export default async function WealthPage() {
  const user = await requireUser();
  const { fin, today, items, vals } = await runAsUser(user, async (ctx) => ({
    fin: await loadFinance(ctx),
    today: ctx.today,
    items: await ctx.tx.select().from(s.wealthItems).orderBy(asc(s.wealthItems.createdAt)),
    vals: await ctx.tx.select().from(s.wealthValuations).orderBy(asc(s.wealthValuations.date)),
  }));
  const wi: WealthItemInput[] = items.map((i) => ({ id: i.id, kind: i.kind, name: i.name, category: i.category, archived: Boolean(i.archivedAt), valuations: vals.filter((v) => v.itemId === i.id).map((v) => ({ date: v.date, value: v.value, method: v.method })) }));
  const nw = netWorth(fin.summary.totalFinancial, wi, today);
  const history = netWorthHistory(startOfMonth(addMonths(today, -11)), today, wi, (d) => summarizeBalances(fin.accounts, computeBalances(fin.accounts, fin.txs, d)).totalFinancial);
  const prev = history.length > 1 ? history[history.length - 2].net : null;
  const assets = wi.filter((i) => i.kind === "asset");
  const liabilities = wi.filter((i) => i.kind === "liability");
  const List = ({ list, kind }: { list: WealthItemInput[]; kind: "asset" | "liability" }) => (
    <div className="divide-y divide-border">
      {list.length === 0 && <p className="py-4 text-sm text-muted">{kind === "asset" ? "Aucun bien déclaré (immobilier, véhicule, placements hors comptes…)." : "Aucun crédit ni dette déclaré."}</p>}
      {list.map((i) => {
        const v = latestValuation(i, today);
        return (
          <div key={i.id} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{i.name}</p>
              <p className="text-xs text-subtle">{(kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES)[i.category] ?? i.category}{v ? ` · mis à jour le ${formatDateFR(v.date)}` : ""}</p>
            </div>
            {v && <Badge tone={v.method === "estimated" ? "warning" : "neutral"}>{v.method === "estimated" ? "Estimation" : "Valeur saisie"}</Badge>}
            <span className={`tabular w-28 text-right text-sm font-semibold ${kind === "liability" ? "text-negative" : ""}`}>{v ? formatMoney(kind === "liability" ? -v.value : v.value) : "—"}</span>
            <WealthItemActions item={{ id: i.id, name: i.name, kind }} history={i.valuations.map((x) => ({ ...x }))} today={today} />
          </div>
        );
      })}
    </div>
  );
  return (
    <div>
      <PageHeader title="Mon patrimoine" description="Patrimoine net = total des actifs − total des passifs." actions={<NewWealthItem today={today} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Patrimoine net" value={<Money cents={nw.net} tone={nw.net < 0 ? "negative" : "none"} />} hint={prev !== null ? `${formatMoney(nw.net - prev, undefined, { signed: true })} vs fin du mois dernier` : undefined} />
        <Stat label="Patrimoine brut" accent="positive" value={<Money cents={nw.gross} />} hint="Comptes + autres actifs" />
        <Stat label="Comptes (financier)" accent="info" value={<Money cents={nw.accountsTotal} />} />
        <Stat label="Passifs" accent="negative" value={<Money cents={nw.liabilitiesTotal} />} hint="Capital restant dû déclaré" />
      </div>
      {nw.estimatedShare > 0 && <Callout tone="warning" className="mt-4" title={`${formatPct(nw.estimatedShare, 0)} de tes actifs (hors comptes) reposent sur des estimations`}>Ce sont des valeurs indicatives que tu as saisies, pas des valorisations officielles. Mets-les à jour régulièrement.</Callout>}
      <Card className="mt-6">
        <CardHeader><div><CardTitle>Évolution du patrimoine net</CardTitle><CardDescription>Fin de chaque mois : soldes recalculés + dernières valorisations connues à cette date</CardDescription></div></CardHeader>
        <CardContent><NetWorthChart data={history} /></CardContent>
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Actifs</CardTitle><span className="tabular text-sm font-semibold">{formatMoney(nw.accountsTotal + nw.assetsTotal)}</span></CardHeader>
          <CardContent>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-subtle">Comptes</p>
            <div className="mb-4 divide-y divide-border">
              {fin.summary.byAccount.filter((a) => !a.archived).map((a) => (
                <div key={a.id} className="flex justify-between gap-3 py-2 text-sm"><span>{a.name} <span className="text-xs text-subtle">· {ACCOUNT_TYPE_LABELS[a.type]}</span></span><span className="tabular font-medium">{formatMoney(a.balance)}</span></div>
              ))}
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-subtle">Autres actifs</p>
            <List list={assets} kind="asset" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Passifs</CardTitle><span className="tabular text-sm font-semibold text-negative">{formatMoney(-nw.liabilitiesTotal)}</span></CardHeader>
          <CardContent><List list={liabilities} kind="liability" /></CardContent>
        </Card>
      </div>
    </div>
  );
}
