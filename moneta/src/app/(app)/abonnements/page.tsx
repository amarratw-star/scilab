import type { Metadata } from "next";
import { Repeat, Search, Sparkles } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { annualEquivalent, FREQUENCY_LABELS, monthlyEquivalent, nextOccurrence, scheduledItems, subscriptionTotals } from "@/lib/finance/recurring";
import { detectRecurringPayments, reviewSubscriptions } from "@/lib/finance/insights";
import { addDays, formatDateFR, startOfMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";
import { IconBadge } from "@/components/ui/icon";
import { RecurringDialog, RecurringMenu, OccurrenceActions, ReviewedButton } from "./recurring-ui";

export const metadata: Metadata = { title: "Abonnements et charges fixes" };

export default async function SubscriptionsPage() {
  const user = await requireUser();
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const subs = subscriptionTotals(fin.rules);
  const fixed = subscriptionTotals(fin.rules, false);
  const incomes = fin.rules.filter((r) => r.kind === "income" && r.status === "active").reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency), 0);
  const pending = scheduledItems(fin.rules, fin.txs, startOfMonth(today), addDays(today, 30)).filter((i) => !i.realized);
  const candidates = detectRecurringPayments(fin.txs, fin.rules, today);
  const findings = reviewSubscriptions(fin.rules, new Map(fin.ruleRows.map((r) => [r.id, r.lastReviewedAt])), candidates, fin.cmap, today);
  const accounts = Object.fromEntries(fin.accountRows.map((a) => [a.id, a.name]));
  const groups: [string, typeof fin.ruleRows][] = [
    ["Abonnements", fin.ruleRows.filter((r) => r.isSubscription && r.kind === "expense")],
    ["Charges fixes", fin.ruleRows.filter((r) => !r.isSubscription && r.kind === "expense")],
    ["Revenus récurrents", fin.ruleRows.filter((r) => r.kind === "income")],
    ["Virements programmés", fin.ruleRows.filter((r) => r.kind === "transfer")],
  ];
  return (
    <div>
      <PageHeader title="Abonnements et charges fixes" description="Tout ce qui revient chaque semaine, mois ou année. MONETA ne résilie jamais rien à ta place." actions={<RecurringDialog />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Abonnements / mois" accent="negative" value={<Money cents={subs.monthly} />} hint={`${subs.activeCount} actif(s)`} />
        <Stat label="Abonnements / an" value={<Money cents={subs.annual} />} />
        <Stat label="Toutes charges fixes / mois" value={<Money cents={fixed.monthly} />} hint={`soit ${formatMoney(fixed.annual)} par an`} />
        <Stat label="Revenus récurrents / mois" accent="positive" value={<Money cents={incomes} />} />
      </div>

      {pending.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <div>
              <CardTitle>Échéances à traiter</CardTitle>
              <CardDescription>Ce mois-ci et les 30 prochains jours. Confirme quand le paiement a réellement eu lieu.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {pending.map((it) => (
                <li key={it.ruleId + it.date} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.name}</span>
                    <span className="text-xs text-subtle">{formatDateFR(it.date)} · {accounts[it.accountId]}</span>
                  </span>
                  {it.date < today ? <Badge tone="warning">À confirmer</Badge> : it.date === today ? <Badge tone="info">Aujourd&apos;hui</Badge> : <Badge>Prévu</Badge>}
                  <span className={`tabular w-24 text-right text-sm font-semibold ${it.kind === "income" ? "text-positive" : ""}`}>{formatMoney(it.kind === "income" ? it.amount : -it.amount, undefined, { signed: true })}</span>
                  {it.date <= today ? <OccurrenceActions ruleId={it.ruleId} date={it.date} amount={it.amount} /> : <span className="w-[148px]" />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {findings.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold"><Sparkles className="size-4 text-warning" /> Économies potentielles à vérifier</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {findings.map((f, i) => (
              <Callout key={i} tone={f.type === "untracked" ? "info" : "warning"} icon={f.type === "untracked" ? <Search /> : <Repeat />} title={f.title}>
                <p>{f.detail}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="positive">jusqu&apos;à {formatMoney(f.potentialMonthlySaving * 12)} / an</Badge>
                  {f.type === "review" && <ReviewedButton ruleId={f.ruleIds[0]} />}
                  {f.type === "untracked" && <RecurringDialog compact preset={{ name: candidates.find((c) => f.title.endsWith(c.label))?.label ?? "", amount: candidates.find((c) => f.title.endsWith(c.label))?.averageAmount }} />}
                </div>
              </Callout>
            ))}
          </div>
        </section>
      )}

      {fin.ruleRows.length === 0 ? (
        <EmptyState className="mt-6" icon={<Repeat />} title="Aucune échéance récurrente" description="Ajoute ton loyer, tes abonnements (streaming, téléphone, salle de sport…) et ton salaire : ils alimenteront le calendrier, le reste à vivre et les prévisions." />
      ) : (
        groups.filter(([, list]) => list.length).map(([label, list]) => (
          <section key={label} className="mt-8">
            <h2 className="mb-3 text-[15px] font-semibold">{label}</h2>
            <div className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
              {list.map((r) => {
                const cat = r.categoryId ? fin.cmap.get(r.categoryId) : undefined;
                const next = r.status === "active" ? nextOccurrence(fin.rules.find((x) => x.id === r.id)!, today) : null;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <IconBadge icon={cat?.icon ?? "repeat"} color={cat?.color ?? "#7c3aed"} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        {r.name}
                        {r.status === "paused" && <Badge tone="warning">Suspendu</Badge>}
                        {r.status === "ended" && <Badge>Terminé</Badge>}
                      </p>
                      <p className="truncate text-xs text-subtle">
                        {FREQUENCY_LABELS[r.frequency]} · {accounts[r.accountId]}
                        {next ? ` · prochaine le ${formatDateFR(next)}` : ""}
                        {r.endDate ? ` · fin le ${formatDateFR(r.endDate)}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`tabular text-sm font-semibold ${r.kind === "income" ? "text-positive" : ""}`}>{formatMoney(r.amount)}</p>
                      <p className="tabular text-[11px] text-subtle">{formatMoney(monthlyEquivalent(r.amount, r.frequency))}/mois · {formatMoney(annualEquivalent(r.amount, r.frequency), undefined, { decimals: false })}/an</p>
                    </div>
                    <RecurringMenu rule={{ id: r.id, name: r.name, kind: r.kind as "expense" | "income" | "transfer", amount: r.amount, frequency: r.frequency, startDate: r.startDate, endDate: r.endDate, accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, isSubscription: r.isSubscription, merchant: r.merchant, paymentMethod: r.paymentMethod, status: r.status, notes: r.notes }} />
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
