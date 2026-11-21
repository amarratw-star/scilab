import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { Landmark } from "lucide-react";
import * as s from "@/server/db/schema";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { accountNames, toTxView } from "@/server/services/views";
import { balanceHistory } from "@/lib/finance/ledger";
import { periodTotals } from "@/lib/finance/stats";
import { addDays, addMonths, formatDateFR } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ACCOUNT_TYPE_LABELS } from "@/lib/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { BalanceChart } from "@/components/charts/charts";
import { TxList } from "@/components/app/tx-list";
import { AccountActions } from "./account-actions";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requireUser();
  const { fin, today, link } = await runAsUser(user, async (ctx) => ({
    fin: await loadFinance(ctx),
    today: ctx.today,
    link: (await ctx.tx.select().from(s.bankAccountLinks).leftJoin(s.bankConnections, eq(s.bankConnections.id, s.bankAccountLinks.connectionId)).where(eq(s.bankAccountLinks.accountId, id)))[0] ?? null,
  }));
  const acc = fin.accountRows.find((a) => a.id === id);
  if (!acc) notFound();
  const balance = fin.balances.get(id) ?? acc.initialBalance;
  const scope = new Set([id]);
  const from = addDays(addMonths(today, -6), 1) > acc.openedOn ? addDays(addMonths(today, -6), 1) : acc.openedOn;
  const history = balanceHistory(fin.accounts, fin.txs, from, today, scope).map((p) => ({ date: p.date, total: p.balance, available: p.balance }));
  const own = fin.txs.filter((t) => t.accountId === id || t.toAccountId === id);
  const month = periodTotals(own.filter((t) => t.accountId === id), `${today.slice(0, 7)}-01`, today, fin.cmap);
  const rows = fin.txRows.filter((t) => t.accountId === id || t.toAccountId === id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1)).slice(0, 200).map(toTxView);
  const planned = own.filter((t) => t.status === "planned").length;
  return (
    <div>
      <PageHeader
        title={acc.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {ACCOUNT_TYPE_LABELS[acc.type]} {acc.institution ? `· ${acc.institution}` : ""} · ouvert le {formatDateFR(acc.openedOn)}
            {acc.archivedAt && <Badge>Archivé</Badge>}
          </span>
        }
        actions={
          <AccountActions
            account={{ id: acc.id, name: acc.name, institution: acc.institution, type: acc.type, initialBalance: acc.initialBalance, openedOn: acc.openedOn, description: acc.description, color: acc.color, icon: acc.icon, currency: acc.currency, archived: Boolean(acc.archivedAt) }}
            balance={balance}
            today={today}
            txCount={own.length}
          />
        }
      />
      {link && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-medium"><Landmark className="size-4" /> Synchronisé avec {link.bank_connections?.connectorName ?? "ta banque"}</span>
          {link.bank_account_links.ibanMasked && <span className="text-xs text-subtle">{link.bank_account_links.ibanMasked}</span>}
          {!link.bank_account_links.syncEnabled && <Badge tone="warning">Synchronisation suspendue</Badge>}
          <span className="ml-auto text-xs text-muted">
            {link.bank_account_links.bankBalance !== null ? <>Solde communiqué par la banque : <strong className="tabular">{formatMoney(link.bank_account_links.bankBalance)}</strong>{link.bank_account_links.balanceAt ? ` (${formatDateFR(link.bank_account_links.balanceAt.toISOString().slice(0, 10))})` : ""}</> : "Solde non communiqué par la banque"}
          </span>
          {link.bank_account_links.bankBalance !== null && Math.abs(link.bank_account_links.bankBalance - balance) >= 1 && (
            <p className="basis-full text-xs text-warning">
              Écart de {formatMoney(balance - link.bank_account_links.bankBalance, undefined, { signed: true })} avec le solde calculé (opérations antérieures non importées, opérations manuelles en double ou en attente…). Vérifie les <Link href="/transactions/a-verifier" className="underline">doublons possibles</Link> ou utilise « Rapprocher ».
            </p>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde actuel" value={<Money cents={balance} tone={balance < 0 ? "negative" : "none"} />} hint="Solde initial + opérations effectuées" />
        <Stat label="Solde initial" value={<Money cents={acc.initialBalance} />} hint={`au ${formatDateFR(acc.openedOn)}`} />
        <Stat label="Entrées du mois" accent="positive" value={<Money cents={month.income + month.refunds} />} />
        <Stat label="Sorties du mois" accent="negative" value={<Money cents={month.grossExpenses} />} hint={planned ? `${planned} opération(s) prévue(s) non comptée(s)` : undefined} />
      </div>
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Historique du solde</CardTitle>
            <CardDescription>Six derniers mois, recalculé à partir des opérations</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <BalanceChart data={history} />
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <div>
            <CardTitle>Opérations</CardTitle>
            <CardDescription>{own.length} opération(s) · solde après toutes les opérations : {formatMoney(balance)}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <TxList rows={rows} accountNames={accountNames(fin)} perspectiveAccountId={id} />
        </CardContent>
      </Card>
    </div>
  );
}
