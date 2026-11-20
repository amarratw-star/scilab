import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, audit } from "@/server/services/context";
import { loadFinance } from "@/server/services/snapshot";
import { buildReport, reportPdf, reportXlsx, toCsv, REPORT_LABELS, type ReportKind } from "@/server/services/reports";
import { formatDateFR } from "@/lib/dates";

export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non authentifié", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const kind = (Object.keys(REPORT_LABELS).find((k) => k === sp.get("type")) ?? "monthly") as ReportKind;
  const format = ["pdf", "csv", "xlsx"].includes(sp.get("format") ?? "") ? sp.get("format")! : "pdf";
  const result = await runAsUser(user, async (ctx) => {
    const ref = /^\d{4}(-\d{2})?$/.test(sp.get("ref") ?? "") ? sp.get("ref")! : ctx.today.slice(0, 7);
    const fin = await loadFinance(ctx);
    const report = buildReport(fin, kind, ref.length === 4 ? `${ref}-01` : ref, ctx.today);
    await audit(ctx, "export.report", "report", kind, { format, ref });
    return { fin, report, ref };
  });
  const base = `moneta-${kind}-${result.ref}`;
  if (format === "pdf") {
    const buf = await reportPdf(result.report, user.displayName, user.isDemo || user.hasDemoData);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "no-store" } });
  }
  if (format === "xlsx") {
    const buf = await reportXlsx(result.fin, result.report);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "no-store" } });
  }
  const r = result.report;
  const rows: unknown[][] = [
    ["Rapport", r.title],
    ["Période", `${formatDateFR(r.from)} → ${formatDateFR(r.to)}`],
    ["Revenus encaissés (EUR)", (r.totals.income / 100).toFixed(2).replace(".", ",")],
    ["Dépenses nettes (EUR)", (r.totals.netExpenses / 100).toFixed(2).replace(".", ",")],
    ["Épargne nette (EUR)", (r.totals.netSavings / 100).toFixed(2).replace(".", ",")],
    ["Taux d'épargne", r.totals.savingsRate === null ? "" : `${(r.totals.savingsRate * 100).toFixed(1).replace(".", ",")} %`],
    [],
    ["Catégorie", "Montant (EUR)", "Part", "Opérations"],
    ...r.byCategory.map((c) => [c.name, (c.amount / 100).toFixed(2).replace(".", ","), c.share === null ? "" : `${(c.share * 100).toFixed(1).replace(".", ",")} %`, c.count]),
    [],
    ["Mois", "Revenus (EUR)", "Dépenses (EUR)", "Épargne (EUR)"],
    ...r.series.map((m) => [m.month, (m.income / 100).toFixed(2).replace(".", ","), (m.expenses / 100).toFixed(2).replace(".", ","), (m.savings / 100).toFixed(2).replace(".", ",")]),
  ];
  return new NextResponse(toCsv(["MONETA", ""], rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" } });
}
