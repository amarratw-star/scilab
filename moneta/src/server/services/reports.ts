/**
 * Rapports : données structurées + exports PDF, CSV et Excel.
 */
import "server-only";
import { addDays, addMonths, endOfMonth, endOfYear, formatDateFR, formatMonthLabel, startOfMonth, startOfYear, type ISODate } from "@/lib/dates";
import { currencySymbol, formatMoneyPlain, formatPct } from "@/lib/money";
import { expensesByCategory, incomeByCategory, monthlySeries, periodTotals, comparablePreviousPeriod, topExpenses } from "@/lib/finance/stats";
import { computeBalances, summarizeBalances } from "@/lib/finance/ledger";
import { goalProgress } from "@/lib/finance/goals";
import { categoryTrends, recommendations, unusualExpenses } from "@/lib/finance/insights";
import { evaluateBudget } from "@/lib/finance/budgets";
import type { Finance } from "./snapshot";

export type ReportKind = "monthly" | "annual" | "expenses" | "income" | "savings" | "categories" | "wealth";

export const REPORT_LABELS: Record<ReportKind, string> = {
  monthly: "Rapport mensuel",
  annual: "Rapport annuel",
  expenses: "Rapport des dépenses",
  income: "Rapport des revenus",
  savings: "Rapport d'épargne",
  categories: "Rapport par catégorie",
  wealth: "Rapport patrimonial",
};

export function reportPeriod(kind: ReportKind, ref: string, today: ISODate) {
  if (kind === "monthly" || kind === "categories" || kind === "expenses" || kind === "income") {
    const from = `${ref.slice(0, 7)}-01`;
    const end = endOfMonth(from);
    return { from, to: end > today ? today : end, label: formatMonthLabel(ref.slice(0, 7)) };
  }
  const y = ref.slice(0, 4);
  const from = startOfYear(`${y}-01-01`);
  const end = endOfYear(from);
  return { from, to: end > today ? today : end, label: `année ${y}` };
}

export function buildReport(fin: Finance, kind: ReportKind, ref: string, today: ISODate) {
  const { from, to, label } = reportPeriod(kind, ref, today);
  const totals = periodTotals(fin.txs, from, to, fin.cmap);
  const prevRange = kind === "annual" || kind === "savings" || kind === "wealth"
    ? { from: addMonths(from, -12), to: addMonths(to, -12) }
    : comparablePreviousPeriod(from, to === endOfMonth(from) ? to : to);
  const previous = periodTotals(fin.txs, prevRange.from, prevRange.to, fin.cmap);
  const byCategory = expensesByCategory(fin.txs, from, to, fin.cmap);
  const incomes = incomeByCategory(fin.txs, from, to, fin.cmap);
  const series = monthlySeries(fin.txs, kind === "monthly" ? startOfMonth(addMonths(from, -5)) : from, to);
  const startBalances = summarizeBalances(fin.accounts, computeBalances(fin.accounts, fin.txs, addDays(from, -1)));
  const endBalances = summarizeBalances(fin.accounts, computeBalances(fin.accounts, fin.txs, to));
  const goals = fin.goals.map((g) => ({ goal: g, progress: goalProgress(g, fin.contributions, to) }));
  const trends = categoryTrends(fin.txs, from, to, fin.cmap).slice(0, 5);
  const unusual = unusualExpenses(fin.txs, from, to, fin.cmap).slice(0, 5);
  const recos = recommendations({ txs: fin.txs, cats: fin.cmap, today: to, rules: fin.rules }).slice(0, 4);
  const budgets = fin.budgets.filter((b) => b.period === "monthly").map((b) => evaluateBudget(b, fin.txs, fin.cmap, to));
  const top = topExpenses(fin.txs, from, to, 10);
  const points: string[] = [];
  if (totals.savingsRate !== null && totals.savingsRate < 0) points.push(`Les dépenses ont dépassé les revenus de ${formatMoneyPlain(-totals.netSavings)}.`);
  for (const b of budgets) if (b.spent > b.effectiveAmount) points.push(`Budget « ${b.budget.name} » dépassé de ${formatMoneyPlain(b.spent - b.effectiveAmount)}.`);
  for (const u of unusual) points.push(`Dépense inhabituelle le ${formatDateFR(u.tx.date)} : ${u.reason}`);
  return { kind, title: `${REPORT_LABELS[kind]} — ${label}`, label, from, to, totals, previous, prevRange, byCategory, incomes, series, startBalances, endBalances, goals, trends, unusual, recos, budgets, top, points };
}

export type Report = ReturnType<typeof buildReport>;

/* ---------------- CSV ---------------- */

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Protection contre l'injection de formules dans les tableurs
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}

const KIND_LABEL: Record<string, string> = { expense: "Dépense", income: "Revenu", transfer: "Transfert", refund: "Remboursement", adjustment: "Régularisation" };
const STATUS_LABEL: Record<string, string> = { posted: "Effectuée", planned: "Prévue", cancelled: "Annulée" };

export function transactionsCsv(fin: Finance, from?: string, to?: string) {
  const accName = new Map(fin.accountRows.map((a) => [a.id, a.name]));
  const rows = fin.txRows
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .map((t) => [
      formatDateFR(t.date),
      KIND_LABEL[t.kind],
      STATUS_LABEL[t.status],
      ((t.kind === "expense" || (t.kind === "transfer") ? -t.amount : t.amount) / 100).toFixed(2).replace(".", ","),
      accName.get(t.accountId) ?? "",
      t.toAccountId ? accName.get(t.toAccountId) ?? "" : "",
      t.categoryId ? fin.cmap.get(t.categoryId)?.name ?? "" : "",
      t.description ?? "",
      t.merchant ?? "",
      t.paymentMethod ?? "",
      t.tags.join(", "),
      t.notes ?? "",
    ]);
  return toCsv(["Date", "Type", "Statut", "Montant (EUR)", "Compte", "Compte destination", "Catégorie", "Description", "Commerçant", "Moyen de paiement", "Tags", "Notes"], rows);
}

/* ---------------- Excel ---------------- */

export async function reportXlsx(fin: Finance, report: Report): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MONETA";
  const money = `#,##0.00 "${currencySymbol()}"`;
  const summary = wb.addWorksheet("Résumé");
  summary.columns = [{ header: "Indicateur", key: "k", width: 36 }, { header: "Valeur", key: "v", width: 18, style: { numFmt: money } }];
  summary.addRows([
    { k: "Période", v: `${formatDateFR(report.from)} → ${formatDateFR(report.to)}` },
    { k: "Revenus encaissés", v: report.totals.income / 100 },
    { k: "Dépenses brutes", v: report.totals.grossExpenses / 100 },
    { k: "Remboursements", v: report.totals.refunds / 100 },
    { k: "Dépenses nettes", v: report.totals.netExpenses / 100 },
    { k: "Épargne nette", v: report.totals.netSavings / 100 },
    { k: "Taux d'épargne", v: report.totals.savingsRate === null ? "—" : formatPct(report.totals.savingsRate) },
    { k: "Patrimoine financier en fin de période", v: report.endBalances.totalFinancial / 100 },
  ]);
  summary.getRow(1).font = { bold: true };
  const cats = wb.addWorksheet("Catégories");
  cats.columns = [{ header: "Catégorie", key: "n", width: 30 }, { header: "Montant", key: "a", width: 16, style: { numFmt: money } }, { header: "Part", key: "p", width: 10, style: { numFmt: "0.0%" } }, { header: "Opérations", key: "c", width: 12 }];
  report.byCategory.forEach((r) => cats.addRow({ n: r.name, a: r.amount / 100, p: r.share ?? 0, c: r.count }));
  cats.getRow(1).font = { bold: true };
  const months = wb.addWorksheet("Évolution mensuelle");
  months.columns = [{ header: "Mois", key: "m", width: 18 }, { header: "Revenus", key: "i", width: 16, style: { numFmt: money } }, { header: "Dépenses", key: "e", width: 16, style: { numFmt: money } }, { header: "Épargne", key: "s", width: 16, style: { numFmt: money } }];
  report.series.forEach((p) => months.addRow({ m: formatMonthLabel(p.month), i: p.income / 100, e: p.expenses / 100, s: p.savings / 100 }));
  months.getRow(1).font = { bold: true };
  const ops = wb.addWorksheet("Opérations");
  const accName = new Map(fin.accountRows.map((a) => [a.id, a.name]));
  ops.columns = [
    { header: "Date", key: "d", width: 12 },
    { header: "Type", key: "k", width: 14 },
    { header: "Statut", key: "s", width: 11 },
    { header: "Montant", key: "a", width: 14, style: { numFmt: money } },
    { header: "Compte", key: "acc", width: 24 },
    { header: "Catégorie", key: "c", width: 22 },
    { header: "Description", key: "desc", width: 36 },
  ];
  fin.txRows
    .filter((t) => t.date >= report.from && t.date <= report.to)
    .forEach((t) =>
      ops.addRow({ d: formatDateFR(t.date), k: KIND_LABEL[t.kind], s: STATUS_LABEL[t.status], a: (t.kind === "expense" || t.kind === "transfer" ? -t.amount : t.amount) / 100, acc: accName.get(t.accountId), c: t.categoryId ? fin.cmap.get(t.categoryId)?.name : "", desc: t.merchant || t.description || "" }),
    );
  ops.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------- PDF ---------------- */

export async function reportPdf(report: Report, userName: string, isDemo: boolean): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: report.title, Author: "MONETA" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const m = (c: number) => formatMoneyPlain(c);
  const W = doc.page.width - 96;
  const ink = "#0f172a";
  const muted = "#64748b";
  const green = "#059669";
  const red = "#dc2626";

  const heading = (t: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.8).fillColor(ink).font("Helvetica-Bold").fontSize(13).text(t);
    doc.moveTo(48, doc.y + 3).lineTo(48 + W, doc.y + 3).strokeColor("#e2e8f0").lineWidth(1).stroke();
    doc.moveDown(0.6).font("Helvetica").fontSize(10).fillColor(ink);
  };
  const row = (label: string, value: string, color = ink) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    doc.fillColor(muted).font("Helvetica").fontSize(10).text(label, 48, y, { width: W * 0.65 });
    doc.fillColor(color).font("Helvetica-Bold").text(value, 48 + W * 0.65, y, { width: W * 0.35, align: "right" });
    doc.font("Helvetica").moveDown(0.25);
  };

  doc.fillColor(ink).font("Helvetica-Bold").fontSize(22).text("MONETA");
  doc.font("Helvetica").fontSize(14).fillColor(ink).text(report.title);
  doc.fontSize(9).fillColor(muted).text(`Du ${formatDateFR(report.from)} au ${formatDateFR(report.to)} · préparé pour ${userName} · généré le ${formatDateFR(new Date().toISOString().slice(0, 10))}`);
  if (isDemo) doc.moveDown(0.4).fillColor(red).fontSize(9).text("DONNÉES DE DÉMONSTRATION FICTIVES — ce rapport ne reflète aucune situation réelle.");

  heading("1. Résumé financier");
  row("Revenus encaissés", m(report.totals.income), green);
  row("Dépenses nettes (après remboursements)", m(report.totals.netExpenses), red);
  row("Épargne nette (revenus − dépenses nettes)", m(report.totals.netSavings), report.totals.netSavings >= 0 ? green : red);
  row("Taux d'épargne", formatPct(report.totals.savingsRate));
  row("Dépenses fixes / variables", `${m(report.totals.fixedExpenses)} / ${m(report.totals.variableExpenses)}`);
  row("Dépense moyenne par jour", m(report.totals.dailyAverageExpense));

  heading("2. Revenus");
  if (!report.incomes.length) doc.fillColor(muted).text("Aucun revenu encaissé sur la période.");
  for (const r of report.incomes) row(r.name, m(r.amount));

  heading("3. Dépenses");
  row("Dépenses brutes", m(report.totals.grossExpenses));
  row("Remboursements", m(report.totals.refunds));
  row("Nombre de dépenses", String(report.totals.expenseCount));
  if (report.top.length) {
    doc.moveDown(0.3).fillColor(ink).font("Helvetica-Bold").text("Principales dépenses").font("Helvetica").moveDown(0.2);
    for (const t of report.top.slice(0, 6)) row(`${formatDateFR(t.date)} · ${t.merchant || t.description || "Dépense"}`, m(t.amount));
  }

  heading("4. Épargne");
  row("Épargne nette de la période", m(report.totals.netSavings), report.totals.netSavings >= 0 ? green : red);
  row("Épargne disponible (livrets) en fin de période", m(report.endBalances.savings));
  for (const g of report.goals) row(`Objectif « ${g.goal.name} »`, `${m(g.progress.saved)} / ${m(g.goal.targetAmount)} (${formatPct(g.progress.progress, 0)})`);

  heading("5. Répartition par catégorie");
  for (const c of report.byCategory.slice(0, 14)) {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    doc.fillColor(ink).fontSize(10).text(c.name, 48, y, { width: W * 0.4 });
    const barW = Math.max(2, (W * 0.35) * (c.share ?? 0));
    doc.rect(48 + W * 0.42, y + 2, barW, 8).fill(c.color || "#6366f1");
    doc.fillColor(ink).font("Helvetica-Bold").text(`${m(c.amount)} · ${formatPct(c.share, 0)}`, 48 + W * 0.78, y, { width: W * 0.22, align: "right" });
    doc.font("Helvetica").moveDown(0.3);
  }

  heading("6. Comparaison avec la période précédente");
  doc.fillColor(muted).fontSize(9).text(`Période de référence : ${formatDateFR(report.prevRange.from)} → ${formatDateFR(report.prevRange.to)} (période comparable)`).moveDown(0.3).fontSize(10);
  row("Revenus", `${m(report.totals.income)} (avant : ${m(report.previous.income)})`);
  row("Dépenses nettes", `${m(report.totals.netExpenses)} (avant : ${m(report.previous.netExpenses)})`);
  row("Épargne nette", `${m(report.totals.netSavings)} (avant : ${m(report.previous.netSavings)})`);

  heading("7. Évolution du patrimoine financier");
  row("Début de période", m(report.startBalances.totalFinancial));
  row("Fin de période", m(report.endBalances.totalFinancial));
  row("Variation", m(report.endBalances.totalFinancial - report.startBalances.totalFinancial), report.endBalances.totalFinancial >= report.startBalances.totalFinancial ? green : red);

  heading("8. Conseils et points d'attention");
  const items = [...report.points, ...report.recos.map((r) => `${r.title} — ${r.detail}`)];
  if (!items.length) doc.fillColor(muted).text("Aucun point d'attention particulier détecté sur cette période.");
  for (const p of items) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    doc.fillColor(ink).fontSize(10).text(`• ${p}`, { width: W }).moveDown(0.3);
  }
  doc.moveDown(1).fillColor(muted).fontSize(8).text("Les recommandations sont calculées à partir de tes données enregistrées et ne constituent pas un conseil financier personnalisé réglementé. Les projections ne sont jamais des garanties.", { width: W });
  doc.end();
  return done;
}
