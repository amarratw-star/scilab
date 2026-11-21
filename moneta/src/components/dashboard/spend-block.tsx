import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import type { AvailableResult } from "@/lib/finance/available";
import { formatMoney } from "@/lib/money";
import { formatDateFR } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/misc";

/** « Combien puis-je dépenser ? » : montant, budget quotidien et décomposition visuelle du disponible. */
export function SpendBlock({ av }: { av: AvailableResult }) {
  if (av.status !== "ok") return <Callout tone="neutral" icon={<Info />} title="Estimation indisponible">{av.reason}</Callout>;
  const parts = [
    { key: "fixed", label: "Charges fixes à payer", amount: av.pendingFixedCharges, color: "var(--chart-expense)" },
    { key: "planned", label: "Dépenses prévues", amount: av.plannedExpenses, color: "var(--chart-prudent)" },
    { key: "savings", label: "Épargne à préserver", amount: av.plannedSavingsTransfers + av.savingsToPreserve, color: "var(--chart-savings)" },
    { key: "cushion", label: "Montant de sécurité", amount: av.safetyCushion, color: "var(--warning)" },
    { key: "free", label: "Dépensable", amount: Math.max(0, av.spendableUntilMonthEnd), color: "var(--chart-income)" },
  ];
  const total = Math.max(1, parts.reduce((s, p) => s + p.amount, 0));
  const negative = av.spendableUntilMonthEnd < 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Badge tone="info">Estimation</Badge>
        <span className="text-xs text-subtle">jusqu&apos;à la fin du mois · {av.daysLeft} jour{av.daysLeft > 1 ? "s" : ""}</span>
      </div>
      <p className={`amount-hero mt-3 text-[38px] ${negative ? "text-negative" : ""}`}>{formatMoney(av.spendableUntilMonthEnd)}</p>
      <p className="mt-1 text-sm text-muted">
        soit <strong className="text-foreground">{formatMoney(av.recommendedDaily)} par jour</strong> pour tes dépenses variables
        {av.budgetRemaining !== null && av.recommendedDaily < av.dailyAllowance ? <span className="text-subtle"> (plafonné par tes budgets)</span> : null}
      </p>
      <div className="mt-5" aria-hidden>
        <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3">
          {parts.filter((p) => p.amount > 0).map((p) => <div key={p.key} style={{ width: `${(p.amount / total) * 100}%`, background: p.color }} className="h-full" />)}
        </div>
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3"><dt className="text-muted">Disponible aujourd&apos;hui</dt><dd className="tabular font-medium">{formatMoney(av.availableNow)}</dd></div>
        {parts.slice(0, 4).map((p) => (
          <div key={p.key} className="flex justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.label}</dt>
            <dd className="tabular">{p.amount ? formatMoney(-p.amount, undefined, { signed: true }) : formatMoney(0)}</dd>
          </div>
        ))}
      </dl>
      {av.nextIncome && <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Prochaine entrée attendue : <strong className="text-foreground">{formatMoney(av.nextIncome.amount)}</strong> le {formatDateFR(av.nextIncome.date)} — non comptée tant qu&apos;elle n&apos;est pas encaissée.</p>}
      <p className="mt-3 text-[11px] leading-relaxed text-subtle">Calcul : disponible − charges fixes à payer − dépenses prévues − épargne à préserver − sécurité. Les revenus attendus ne sont jamais comptés.</p>
      <Link href="/disponible" className="mt-auto flex items-center gap-1 pt-3 text-sm font-medium text-info hover:underline">Voir le détail du calcul <ArrowRight className="size-3.5" /></Link>
    </div>
  );
}
