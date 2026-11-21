import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Info, Lightbulb } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { healthHistory, healthScore, HEALTH_LEVEL_LABEL } from "@/lib/finance/health";
import { formatMonthLabel } from "@/lib/dates";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Callout, PageHeader } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { HealthRing } from "@/components/dashboard/health-ring";

export const metadata: Metadata = { title: "Santé financière" };

export default async function HealthPage() {
  const user = await requireUser();
  const { fin, today } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today }));
  const input = { today, accounts: fin.accounts, txs: fin.txs, cats: fin.cmap, rules: fin.rules, budgets: fin.budgets };
  const h = healthScore(input);
  const history = healthHistory(input, 4);
  const recos = h.criteria.filter((c) => c.score !== null && c.recommendation).sort((a, b) => (a.score! * a.weight) - (b.score! * b.weight)).slice(0, 3);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Santé financière" description="Une note indicative sur 100, calculée à partir de ratios objectifs. Ce n'est pas un diagnostic financier officiel." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardContent className="flex flex-col items-center pt-6 text-center">
            <HealthRing score={h.score} size={156} />
            {h.status === "ok" ? (
              <>
                <p className="mt-4 text-xl font-semibold">{HEALTH_LEVEL_LABEL[h.level!]}</p>
                <p className="mt-1 text-xs text-muted">{h.evaluatedWeight} % des critères évalués · {h.historyDays} jours d&apos;historique</p>
              </>
            ) : (
              <>
                <p className="mt-4 text-lg font-semibold">Données insuffisantes</p>
                <ul className="mt-2 space-y-1 text-sm text-muted">{h.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <p className="mt-3 text-xs text-subtle">Continue à enregistrer tes opérations : la note apparaîtra automatiquement.</p>
              </>
            )}
            <div className="mt-6 w-full border-t border-border pt-4 text-left">
              <p className="mb-2 text-xs font-medium text-muted">Évolution (fin de mois)</p>
              <ul className="space-y-1.5 text-sm">
                {history.map((m) => (
                  <li key={m.month} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 capitalize text-muted">{formatMonthLabel(m.month, true)}</span>
                    <div className="flex-1"><Progress value={m.score === null ? 0 : m.score / 100} tone="info" label={`Note ${m.month}`} /></div>
                    <span className="w-8 text-right tabular">{m.score ?? "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          {recos.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 text-warning" /> Recommandations prioritaires</CardTitle></CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-2 pl-5 text-sm">{recos.map((r) => <li key={r.key}><span className="font-medium">{r.label} :</span> <span className="text-muted">{r.recommendation}</span></li>)}</ol>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><div><CardTitle>Détail des critères</CardTitle><CardDescription>Chaque critère est noté sur 100 puis pondéré. Un critère non évaluable est exclu.</CardDescription></div></CardHeader>
            <CardContent className="divide-y divide-border">
              {h.criteria.map((c) => (
                <div key={c.key} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {c.score === null ? <Info className="size-4 text-subtle" /> : c.score >= 70 ? <CheckCircle2 className="size-4 text-positive" /> : c.score < 50 ? <CircleAlert className="size-4 text-negative" /> : <Info className="size-4 text-info" />}
                      {c.label} <span className="text-xs font-normal text-subtle">· poids {c.weight} %</span>
                    </p>
                    {c.score === null ? <Badge>Non évaluable</Badge> : <span className="text-sm font-semibold tabular">{c.score}/100</span>}
                  </div>
                  {c.score !== null && <Progress value={c.score / 100} tone={c.score >= 70 ? "positive" : c.score >= 50 ? "info" : "auto"} className="mt-2" label={c.label} />}
                  <p className="mt-1.5 text-xs text-muted">{c.detail}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Callout tone="neutral" icon={<Info />} title="Comment la note est calculée">
            Capacité d&apos;épargne (25 %), marge de sécurité (25 %), respect des budgets (15 %), évolution des dépenses (15 %), poids des charges fixes (10 %) et régularité de la gestion (10 %).
            Tous les critères sont des ratios : un revenu modeste n&apos;est pas pénalisé et un revenu élevé ne garantit pas une bonne note.
            <Link href="/analyses" className="ml-1 text-info underline">Voir mes analyses</Link>
          </Callout>
        </div>
      </div>
    </div>
  );
}
