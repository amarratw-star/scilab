import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { runAsUser, audit } from "@/server/services/context";
import { listTransactions } from "@/server/services/transactions";
import { loadFinance } from "@/server/services/snapshot";
import { transactionsCsv } from "@/server/services/reports";
import { parseTxFilters } from "@/app/(app)/transactions/filters";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non authentifié", { status: 401 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const csv = await runAsUser(user, async (ctx) => {
    const f = parseTxFilters(sp, ctx.today);
    const ids = new Set<string>();
    for (let offset = 0; offset < 1_000_000; offset += 500) {
      const page = await listTransactions(ctx, { ...f, limit: 500, offset });
      page.rows.forEach((r) => ids.add(r.id));
      if (page.rows.length < 500) break;
    }
    const fin = await loadFinance(ctx);
    await audit(ctx, "export.transactions_csv", "transaction", undefined, { count: ids.size });
    return transactionsCsv({ ...fin, txRows: fin.txRows.filter((t) => ids.has(t.id)) });
  });
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="moneta-operations.csv"`, "Cache-Control": "no-store" },
  });
}
