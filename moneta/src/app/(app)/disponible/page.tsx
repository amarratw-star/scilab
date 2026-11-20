import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Info } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { computeOverview } from "@/server/services/overview";
import { scheduledItems } from "@/lib/finance/recurring";
import { endOfMonth, formatDateFR, startOfMonth } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, PageHeader, Stat } from "@/components/ui/misc";
import { Money } from "@/components/ui/money";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Combien puis-je dépenser ?" };

export default async function AvailablePage() {
  const user = await requireUser();
  const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
  const ov = computeOverview(fin, today, settings);
  const av = ov.available;
  const items = scheduledItems(fin.rules, fin.txs, startOfMonth(today), endOfMonth(today)).filter((i) => !i.realized);
  return (
    <div>
      <PageHeader title="Combien puis-je dépenser ?" description="Ton argent réellement disponible, une fois tes engagements du mois mis de côté." />
      {av.status !== "ok" ? (
        <Callout tone="neutral" icon={<Info />} title="Estimation indisponible">{av.reason} <Link href="/comptes?nouveau=1" className="text-info underline">Ajouter un compte</Link></Callout>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Disponible aujourd'hui" accent="info" value={<Money cents={av.availableNow} />} hint="Comptes courants, secondaires et espèces" />
            <Stat label="Dépensable jusqu'à la fin du mois" value={<Money cents={av.spendableUntilMonthEnd} tone={av.spendableUntilMonthEnd < 0 ? "negative" : "none"} />} hint={`${av.daysLeft} jour(s) restant(s)`} />
            <Stat label="Budget quotidien recommandé" accent="positive" value={<Money cents={av.recommendedDaily} />} hint={av.budgetRemaining !== null ? `Budgets restants : ${formatMoney(av.budgetRemaining)}` : "Aucun budget mensuel défini"} />
            <Stat label="Montant de sécurité" accent="warning" value={<Money cents={av.safetyCushion} />} hint={<Link href="/parametres" className="hover:text-foreground">Modifier dans les paramètres →</Link>} />
          </div>
          {av.warnings.map((w) => <Callout key={w} tone="warning" className="mt-4" title={w} />)}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><div><CardTitle>Le calcul, étape par étape</CardTitle><CardDescription>Aucun revenu attendu n&apos;est compté comme de l&apos;argent disponible</CardDescription></div></CardHeader>
              <CardContent>
                <dl className="divide-y divide-border">
                  {av.lines.map((l) => (
                    <div key={l.label} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="text-sm">{l.label}{l.hint && <span className="block text-xs text-subtle">{l.hint}</span>}</dt>
                      <dd className={`tabular text-sm font-medium ${l.amount < 0 ? "text-negative" : ""}`}>{formatMoney(l.amount, "EUR", { signed: l.amount < 0 })}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-4 py-3 text-base font-semibold">
                    <dt>= Dépensable jusqu&apos;au {formatDateFR(endOfMonth(today))}</dt>
                    <dd className={`tabular ${av.spendableUntilMonthEnd < 0 ? "text-negative" : ""}`}>{formatMoney(av.spendableUntilMonthEnd)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-2.5 text-sm">
                    <dt>÷ {av.daysLeft} jour(s) restant(s){av.budgetRemaining !== null ? ", plafonné par tes budgets" : ""}</dt>
                    <dd className="tabular font-medium">{formatMoney(av.recommendedDaily)} / jour</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-subtle">Épargne déjà mise de côté ce mois-ci : {formatMoney(Math.max(0, av.savedThisMonth))} (objectif mensuel : {formatMoney(settings.monthlySavingsTarget ?? 0)}).</p>
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> Engagements restants ce mois-ci</CardTitle></CardHeader>
                <CardContent>
                  {items.length === 0 && fin.txs.filter((t) => t.status === "planned").length === 0 ? <p className="text-sm text-muted">Aucun engagement restant.</p> : (
                    <ul className="divide-y divide-border text-sm">
                      {items.map((i) => (
                        <li key={i.ruleId + i.date} className="flex items-center justify-between gap-3 py-2">
                          <span>{i.name} <span className="text-xs text-subtle">· {formatDateFR(i.date)}</span></span>
                          <span className="flex items-center gap-2">{i.date < today && <Badge tone="warning">À confirmer</Badge>}<span className={`tabular ${i.kind === "income" ? "text-positive" : ""}`}>{formatMoney(i.kind === "income" ? i.amount : -i.amount, "EUR", { signed: true })}</span></span>
                        </li>
                      ))}
                      {fin.txRows.filter((t) => t.status === "planned" && t.date <= endOfMonth(today)).map((t) => (
                        <li key={t.id} className="flex justify-between gap-3 py-2"><span>{t.description ?? "Opération prévue"} <span className="text-xs text-subtle">· {formatDateFR(t.date)}</span></span><span className="tabular">{formatMoney(t.kind === "expense" ? -t.amount : t.amount, "EUR", { signed: true })}</span></li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Revenus attendus</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  {av.nextIncome ? (
                    <p>Prochaine entrée d&apos;argent estimée : <strong>{formatMoney(av.nextIncome.amount)}</strong> le <strong>{formatDateFR(av.nextIncome.date)}</strong> ({av.nextIncome.label}). Total attendu d&apos;ici la fin du mois : {formatMoney(av.expectedIncome)}.</p>
                  ) : (
                    <p className="text-muted">Aucun revenu prévu d&apos;ici la fin du mois. Ajoute ton salaire comme revenu récurrent dans <Link href="/abonnements" className="text-info underline">Abonnements et charges</Link> pour connaître la date de ta prochaine entrée d&apos;argent.</p>
                  )}
                  <p className="mt-2 text-xs text-subtle">Ces montants ne sont pas ajoutés à ton disponible tant qu&apos;ils ne sont pas réellement encaissés.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
