import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { runAsUser } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { scheduledItems } from "@/lib/finance/recurring";
import { addDays, addMonths, endOfMonth, endOfWeek, formatDateLong, formatMonthLabel, isValidISODate, monthKey, startOfMonth, startOfWeek, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Treasury } from "./treasury";

export const metadata: Metadata = { title: "Calendrier" };

type Ev = { id: string; date: ISODate; label: string; amount: number | null; type: "income" | "expense" | "transfer" | "savings" | "goal"; status: "done" | "planned"; sub?: string };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const { fin, today, settings } = await runAsUser(user, async (ctx) => ({ fin: await loadFinance(ctx), today: ctx.today, settings: ctx.settings }));
  const month = sp.mois && /^\d{4}-\d{2}$/.test(sp.mois) ? `${sp.mois}-01` : startOfMonth(today);
  const selected = sp.jour && isValidISODate(sp.jour) ? sp.jour : month === startOfMonth(today) ? today : month;
  const gridStart = startOfWeek(month);
  const gridEnd = endOfWeek(endOfMonth(month));
  const liquid = new Set(fin.accounts.filter((a) => ["checking", "secondary", "cash"].includes(a.type)).map((a) => a.id));
  const events: Ev[] = [];
  for (const t of fin.txs) {
    if (t.date < gridStart || t.date > gridEnd || t.status === "cancelled") continue;
    const type: Ev["type"] = t.kind === "income" || t.kind === "refund" ? "income" : t.kind === "transfer" ? (liquid.has(t.accountId) && t.toAccountId && !liquid.has(t.toAccountId) ? "savings" : "transfer") : "expense";
    if (t.kind === "adjustment") continue;
    events.push({ id: t.id, date: t.date, label: t.merchant || t.description || (fin.cmap.get(t.categoryId ?? "")?.name ?? "Opération"), amount: t.kind === "expense" ? -t.amount : t.amount, type, status: t.status === "planned" ? "planned" : "done", sub: t.categoryId ? fin.cmap.get(t.categoryId)?.name : undefined });
  }
  for (const it of scheduledItems(fin.rules, fin.txs, gridStart, gridEnd)) {
    if (it.realized) continue;
    const type: Ev["type"] = it.kind === "income" ? "income" : it.kind === "transfer" ? "savings" : "expense";
    events.push({ id: it.ruleId + it.date, date: it.date, label: it.name, amount: it.kind === "expense" ? -it.amount : it.amount, type, status: "planned", sub: it.isSubscription ? "Abonnement" : it.kind === "income" ? "Revenu prévu" : it.kind === "transfer" ? "Versement d'épargne programmé" : "Prélèvement" });
  }
  for (const c of fin.contribRows) if (c.date >= gridStart && c.date <= gridEnd && !c.transactionId) events.push({ id: c.id, date: c.date, label: `Objectif « ${fin.goalRows.find((g) => g.id === c.goalId)?.name} »`, amount: c.amount, type: "savings", status: "done", sub: "Affectation à un objectif" });
  for (const g of fin.goalRows) if (g.deadline && g.deadline >= gridStart && g.deadline <= gridEnd) events.push({ id: "goal" + g.id, date: g.deadline, label: `Échéance : ${g.name}`, amount: g.targetAmount, type: "goal", status: "planned", sub: "Date limite d'objectif" });

  const byDate = new Map<string, Ev[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const days: ISODate[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const selectedEvents = (byDate.get(selected) ?? []).sort((a, b) => (a.status === b.status ? 0 : a.status === "done" ? -1 : 1));
  const prev = monthKey(addMonths(month, -1));
  const next = monthKey(addMonths(month, 1));
  const dotColor: Record<Ev["type"], string> = { income: "bg-positive", expense: "bg-negative", transfer: "bg-info", savings: "bg-[var(--chart-savings)]", goal: "bg-warning" };

  return (
    <div>
      <PageHeader title="Calendrier et trésorerie" description="Quand ton argent entre et sort : chronologie, solde prévisionnel et calendrier mensuel." />
      <Treasury fin={fin} today={today} horizonParam={sp.horizon} cushion={settings.safetyCushion ?? 0} month={monthKey(month)} />
      <h2 className="mb-3 text-[15px] font-semibold">Calendrier mensuel</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="items-center">
            <CardTitle className="text-lg capitalize">{formatMonthLabel(monthKey(month))}</CardTitle>
            <div className="flex items-center gap-1">
              <Button asChild size="icon-sm" variant="outline"><Link href={`/calendrier?mois=${prev}${sp.horizon ? `&horizon=${sp.horizon}` : ""}`} aria-label="Mois précédent"><ChevronLeft /></Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/calendrier">Aujourd&apos;hui</Link></Button>
              <Button asChild size="icon-sm" variant="outline"><Link href={`/calendrier?mois=${next}${sp.horizon ? `&horizon=${sp.horizon}` : ""}`} aria-label="Mois suivant"><ChevronRight /></Link></Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-subtle">
              {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((d) => {
                const evs = byDate.get(d) ?? [];
                const inMonth = monthKey(d) === monthKey(month);
                const net = evs.filter((e) => e.type === "income" || e.type === "expense").reduce((s, e) => s + (e.amount ?? 0), 0);
                return (
                  <Link
                    key={d}
                    href={`/calendrier?mois=${monthKey(month)}&jour=${d}`}
                    scroll={false}
                    aria-label={`${formatDateLong(d)} : ${evs.length} élément(s)`}
                    className={cn(
                      "flex min-h-16 flex-col rounded-xl border p-1.5 text-left transition sm:min-h-24",
                      inMonth ? "border-border bg-surface hover:border-border-strong" : "border-transparent bg-surface-2/40 text-subtle",
                      d === selected && "ring-2 ring-foreground",
                    )}
                  >
                    <span className={cn("text-xs font-medium", d === today && "flex size-5 items-center justify-center rounded-full bg-foreground text-background")}>{Number(d.slice(8))}</span>
                    <span className="mt-auto flex flex-wrap gap-0.5">
                      {evs.slice(0, 6).map((e) => (
                        <span key={e.id} className={cn("size-1.5 rounded-full", e.status === "done" ? dotColor[e.type] : "border border-current bg-transparent", e.status === "planned" && { income: "text-positive", expense: "text-negative", transfer: "text-info", savings: "text-[var(--chart-savings)]", goal: "text-warning" }[e.type])} />
                      ))}
                    </span>
                    {net !== 0 && <span className={cn("tabular mt-0.5 hidden truncate text-[10px] sm:block", net > 0 ? "text-positive" : "text-muted")}>{formatMoney(net, undefined, { signed: true, decimals: false })}</span>}
                  </Link>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {[["bg-positive", "Revenus"], ["bg-negative", "Dépenses"], ["bg-[var(--chart-savings)]", "Épargne"], ["bg-info", "Transferts"], ["bg-warning", "Objectifs"]].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className={`size-2 rounded-full ${c}`} />{l}</span>)}
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-full border border-muted" />Prévu</span>
            </div>
          </CardContent>
        </Card>
        <Card className="h-fit lg:sticky lg:top-24">
          <CardHeader><CardTitle className="capitalize">{formatDateLong(selected)}</CardTitle></CardHeader>
          <CardContent>
            {selectedEvents.length === 0 ? <p className="py-6 text-center text-sm text-muted">Rien ce jour-là.</p> : (
              <ul className="divide-y divide-border">
                {selectedEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{e.label}</span>
                      <span className="text-xs text-subtle">{e.sub}</span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      {e.amount !== null && <span className={cn("tabular text-sm font-semibold", e.type === "income" && "text-positive")}>{e.type === "goal" ? formatMoney(e.amount) : formatMoney(e.amount, undefined, { signed: true })}</span>}
                      <Badge tone={e.status === "done" ? "positive" : "info"}>{e.status === "done" ? "Effectué" : "Prévu"}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
