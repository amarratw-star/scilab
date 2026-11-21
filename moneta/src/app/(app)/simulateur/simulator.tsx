"use client";
import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/misc";
import { SingleSeriesBars } from "@/components/charts/charts";
import { incomeChangeImpact, PURCHASE_VERDICT, reductionSavings, savingsPlan, simulatePurchase } from "@/lib/finance/simulate";
import { SCENARIOS } from "@/lib/finance/forecast";
import type { AvailableResult } from "@/lib/finance/available";
import type { BudgetStatus } from "@/lib/finance/budgets";
import { formatMoney, formatPct, parseAmountToCents } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";

type Props = {
  available: AvailableResult;
  budgets: { id: string; name: string; categoryId: string | null; remaining: number; status: BudgetStatus }[];
  avgIncome: number;
  avgExpenses: number;
  categories: { id: string; name: string; monthly: number }[];
  hasHistory: boolean;
  scenarios: { reliability: string; start: number; milestones: { days: number; date: string; prudent: number; normal: number; optimistic: number }[]; assumptions: string[] };
};

function Row({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`tabular font-medium ${tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : ""}`}>{value}</span>
    </div>
  );
}

export function Simulator(p: Props) {
  const [tab, setTab] = useState<"achat" | "epargne" | "reduction" | "revenus" | "scenarios">("achat");
  return (
    <div>
      <Segmented value={tab} onChange={setTab} options={[{ value: "achat", label: "Achat" }, { value: "epargne", label: "Objectif d'épargne" }, { value: "reduction", label: "Réduire une dépense" }, { value: "revenus", label: "Revenus et charges" }, { value: "scenarios", label: "Scénarios" }]} />
      <div className="mt-5">
        {tab === "achat" && <Purchase {...p} />}
        {tab === "epargne" && <SavingsGoal avgSavings={p.avgIncome - p.avgExpenses} />}
        {tab === "reduction" && <Reduction categories={p.categories} />}
        {tab === "revenus" && <IncomeChange avgIncome={p.avgIncome} avgExpenses={p.avgExpenses} hasHistory={p.hasHistory} />}
        {tab === "scenarios" && <Scenarios s={p.scenarios} />}
      </div>
    </div>
  );
}

function Purchase({ available, budgets, avgIncome, avgExpenses }: Props) {
  const [price, setPrice] = useState("");
  const [budgetId, setBudgetId] = useState("");
  const cents = parseAmountToCents(price);
  const sim = useMemo(() => (cents && cents > 0 ? simulatePurchase({ price: cents, available, budget: budgets.find((b) => b.id === budgetId)?.status ?? null, averageMonthlySavings: avgIncome - avgExpenses }) : null), [cents, available, budgets, budgetId, avgIncome, avgExpenses]);
  const tone = sim ? PURCHASE_VERDICT[sim.verdict].tone : "neutral";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><div><CardTitle>Est-ce que je peux me le permettre ?</CardTitle><CardDescription>Impact d&apos;un achat sur ton solde, ton épargne et ton budget</CardDescription></div></CardHeader>
        <CardContent className="space-y-4">
          <Field label="Prix de l'achat (€)" htmlFor="price"><Input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="900" autoFocus /></Field>
          <Field label="Budget concerné (facultatif)" htmlFor="pb">
            <Select id="pb" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
              <option value="">Aucun</option>
              {budgets.map((b) => <option key={b.id} value={b.id}>{b.name} (reste {formatMoney(b.remaining)})</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Résultat</CardTitle>{sim && <Badge tone={tone === "positive" ? "positive" : tone === "negative" ? "negative" : tone === "warning" ? "warning" : "neutral"}>{PURCHASE_VERDICT[sim.verdict].label}</Badge>}</CardHeader>
        <CardContent>
          {!sim ? <p className="text-sm text-muted">Saisis un prix pour voir l&apos;impact.</p> : sim.verdict === "unknown" ? <Callout tone="neutral" icon={<Info />}>{sim.explanation[0]}</Callout> : (
            <>
              <div className="divide-y divide-border">
                <Row label="Solde disponible avant" value={formatMoney(sim.availableBefore)} />
                <Row label="Solde disponible après" value={formatMoney(sim.availableAfter)} tone={sim.availableAfter < 0 ? "neg" : undefined} />
                <Row label="Dépensable d'ici fin du mois après" value={formatMoney(sim.spendableAfter)} tone={(sim.spendableAfter ?? 0) < 0 ? "neg" : "pos"} />
                <Row label="Coussin de sécurité préservé" value={sim.cushionIntact ? "Oui" : "Non"} tone={sim.cushionIntact ? "pos" : "neg"} />
                {sim.budgetImpact && <Row label={`Budget « ${sim.budgetImpact.name} » après`} value={formatMoney(sim.budgetImpact.remainingAfter)} tone={sim.budgetImpact.remainingAfter < 0 ? "neg" : undefined} />}
                {sim.monthsOfSavings !== null && <Row label="Équivaut à" value={`${sim.monthsOfSavings.toFixed(1).replace(".", ",")} mois d'épargne moyenne`} />}
              </div>
              <ul className="mt-4 list-disc space-y-1 pl-4 text-xs text-muted">{sim.explanation.map((e) => <li key={e}>{e}</li>)}</ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SavingsGoal({ avgSavings }: { avgSavings: number }) {
  const [target, setTarget] = useState("3000");
  const [months, setMonths] = useState("12");
  const [current, setCurrent] = useState("0");
  const [rate, setRate] = useState("0");
  const plan = savingsPlan(parseAmountToCents(target) ?? 0, Number(months) || 0, parseAmountToCents(current) ?? 0, (Number(rate.replace(",", ".")) || 0) / 100);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Combien épargner chaque mois ?</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="Montant cible (€)" htmlFor="st"><Input id="st" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Durée (mois)" htmlFor="sm"><Input id="sm" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          <Field label="Déjà épargné (€)" htmlFor="sc"><Input id="sc" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="Rendement annuel (%)" htmlFor="sr" hint="Ex. taux d'un livret. 0 si aucun."><Input id="sr" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Plan</CardTitle></CardHeader>
        <CardContent>
          {!plan ? <p className="text-sm text-muted">Renseigne un montant et une durée.</p> : (
            <>
              <p className="tabular text-3xl font-semibold">{formatMoney(plan.monthly)} <span className="text-base font-normal text-muted">/ mois</span></p>
              <p className="mt-1 text-sm text-muted">pendant {plan.months} mois, soit {formatMoney(plan.totalContributed)} versés.</p>
              <p className={`mt-3 text-sm ${avgSavings >= plan.monthly ? "text-positive" : "text-warning"}`}>
                Ton épargne moyenne des 3 derniers mois : {formatMoney(avgSavings)} / mois — {avgSavings >= plan.monthly ? "l'objectif semble atteignable à ce rythme." : `il manquerait environ ${formatMoney(plan.monthly - avgSavings)} par mois.`}
              </p>
              <div className="mt-4"><SingleSeriesBars height={160} data={plan.schedule.filter((_, i, a) => a.length <= 24 || i % Math.ceil(a.length / 24) === 0).map((s) => ({ key: `M${s.month}`, value: s.balance }))} color="var(--chart-savings)" label="Épargne cumulée" /></div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Reduction({ categories }: { categories: Props["categories"] }) {
  const [cat, setCat] = useState(categories[0]?.id ?? "");
  const [amount, setAmount] = useState("30");
  const [months, setMonths] = useState("12");
  const red = parseAmountToCents(amount) ?? 0;
  const c = categories.find((x) => x.id === cat);
  const series = reductionSavings(red, Math.min(120, Number(months) || 12));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Et si je réduisais une dépense ?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Catégorie" htmlFor="rc">
            <Select id="rc" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Montant libre</option>
              {categories.map((x) => <option key={x.id} value={x.id}>{x.name} ({formatMoney(x.monthly)}/mois en moyenne)</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Réduction par mois (€)" htmlFor="ra"><Input id="ra" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Sur combien de mois" htmlFor="rm"><Input id="rm" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Économie cumulée</CardTitle></CardHeader>
        <CardContent>
          <p className="tabular text-3xl font-semibold text-positive">{formatMoney(series[series.length - 1]?.cumulative ?? 0)}</p>
          <p className="mt-1 text-sm text-muted">après {series.length} mois{c ? `, soit ${formatPct(c.monthly ? red / c.monthly : null, 0)} de ta dépense moyenne en ${c.name.toLowerCase()}` : ""}.</p>
          {c && red > c.monthly && <p className="mt-2 text-sm text-warning">Cette réduction dépasse ta dépense mensuelle moyenne dans cette catégorie ({formatMoney(c.monthly)}).</p>}
          <div className="mt-4"><SingleSeriesBars height={160} data={series.map((s) => ({ key: `M${s.month}`, value: s.cumulative }))} color="var(--chart-income)" label="Économie cumulée" /></div>
        </CardContent>
      </Card>
    </div>
  );
}

function IncomeChange({ avgIncome, avgExpenses, hasHistory }: { avgIncome: number; avgExpenses: number; hasHistory: boolean }) {
  const [delta, setDelta] = useState("100");
  const [charge, setCharge] = useState("0");
  const r = incomeChangeImpact({ monthlyIncome: avgIncome, monthlyExpenses: avgExpenses, incomeDelta: parseAmountToCents(delta) ?? 0, newFixedCharge: parseAmountToCents(charge) ?? 0 });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><div><CardTitle>Changement de revenus ou nouvelle charge</CardTitle><CardDescription>Base : moyennes des 3 derniers mois complets</CardDescription></div></CardHeader>
        <CardContent className="space-y-3">
          {!hasHistory && <Callout tone="neutral" icon={<Info />}>Pas encore assez d&apos;historique : les moyennes sont à zéro.</Callout>}
          <Field label="Variation de revenu mensuel (€, négatif possible)" htmlFor="id"><Input id="id" inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} /></Field>
          <Field label="Nouvelle charge fixe mensuelle (€)" htmlFor="ic"><Input id="ic" inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Impact</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          <Row label="Revenus moyens actuels" value={formatMoney(avgIncome)} />
          <Row label="Dépenses moyennes actuelles" value={formatMoney(avgExpenses)} />
          <Row label="Épargne mensuelle avant → après" value={`${formatMoney(r.savingsBefore)} → ${formatMoney(r.savingsAfter)}`} tone={r.savingsAfter >= r.savingsBefore ? "pos" : "neg"} />
          <Row label="Taux d'épargne avant → après" value={`${formatPct(r.rateBefore)} → ${formatPct(r.rateAfter)}`} />
          <Row label="Différence sur un an" value={formatMoney(r.annualDifference, undefined, { signed: true })} tone={r.annualDifference >= 0 ? "pos" : "neg"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Scenarios({ s }: { s: Props["scenarios"] }) {
  return (
    <Card>
      <CardHeader><div><CardTitle>Trois scénarios pour l&apos;ensemble de tes comptes</CardTitle><CardDescription>Point de départ : {formatMoney(s.start)} aujourd&apos;hui</CardDescription></div></CardHeader>
      <CardContent className="overflow-x-auto">
        {s.reliability === "insufficient" && <Callout tone="warning" className="mb-4" icon={<Info />}>Historique insuffisant : seules les échéances connues sont projetées, les résultats sont trop optimistes.</Callout>}
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="text-left text-xs text-subtle"><th className="pb-2 font-medium">Horizon</th><th className="pb-2 text-right font-medium">Prudent</th><th className="pb-2 text-right font-medium">Normal</th><th className="pb-2 text-right font-medium">Optimiste</th></tr></thead>
          <tbody className="divide-y divide-border">
            {s.milestones.map((m) => (
              <tr key={m.days}><td className="py-2">Dans {m.days} jours <span className="text-xs text-subtle">({formatDateFR(m.date)})</span></td><td className="tabular py-2 text-right">{formatMoney(m.prudent, undefined, { decimals: false })}</td><td className="tabular py-2 text-right font-medium">{formatMoney(m.normal, undefined, { decimals: false })}</td><td className="tabular py-2 text-right">{formatMoney(m.optimistic, undefined, { decimals: false })}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {Object.values(SCENARIOS).map((x) => <li key={x.label}><strong className="text-foreground">{x.label}</strong> — {x.description}</li>)}
          {s.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </CardContent>
    </Card>
  );
}
