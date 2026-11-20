import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import { importFingerprint } from "@/lib/csv-import";
import { isoDate } from "@/lib/validation";

export const importRowSchema = z.object({
  date: isoDate,
  label: z.string().trim().min(1).max(200),
  amount: z.number().int().refine((v) => v !== 0, "Montant nul"),
  categoryId: z.string().uuid().nullable(),
  include: z.boolean(),
});

export const importPayloadSchema = z.object({
  accountId: z.string().uuid(),
  rows: z.array(importRowSchema).min(1).max(5000),
});

/** Calcule les empreintes et repère les doublons (déjà importés ou en double dans le fichier). */
export async function checkDuplicates(ctx: Ctx, accountId: string, rows: { date: string; label: string; amount: number }[]) {
  const hashes = await Promise.all(rows.map((r) => importFingerprint(accountId, r.date, r.amount, r.label)));
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const found = await ctx.tx.select({ h: s.transactions.importHash }).from(s.transactions).where(and(eq(s.transactions.accountId, accountId), inArray(s.transactions.importHash, chunk)));
    found.forEach((f) => f.h && existing.add(f.h));
  }
  // Doublons « souples » : même compte, même date, même montant, saisis manuellement
  const dates = [...new Set(rows.map((r) => r.date))];
  const manual = dates.length
    ? await ctx.tx
        .select({ date: s.transactions.date, amount: s.transactions.amount, kind: s.transactions.kind })
        .from(s.transactions)
        .where(and(eq(s.transactions.accountId, accountId), inArray(s.transactions.date, dates)))
    : [];
  const softKeys = new Set(manual.map((m) => `${m.date}|${m.kind === "expense" ? -m.amount : m.amount}`));
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const h = hashes[i];
    const status = existing.has(h) ? "imported" : seen.has(h) ? "in_file" : softKeys.has(`${r.date}|${r.amount}`) ? "possible" : "new";
    seen.add(h);
    return { hash: h, status: status as "imported" | "in_file" | "possible" | "new" };
  });
}

export async function importRows(ctx: Ctx, payload: z.infer<typeof importPayloadSchema>) {
  const [acc] = await ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, payload.accountId));
  if (!acc) throw new ServiceError("Compte introuvable");
  const catIds = [...new Set(payload.rows.map((r) => r.categoryId).filter(Boolean))] as string[];
  if (catIds.length) {
    const found = await ctx.tx.select({ id: s.categories.id }).from(s.categories).where(inArray(s.categories.id, catIds));
    if (found.length !== catIds.length) throw new ServiceError("Catégorie introuvable");
  }
  const selected = payload.rows.filter((r) => r.include);
  const dup = await checkDuplicates(ctx, acc.id, selected);
  let imported = 0;
  let skipped = 0;
  const values: (typeof s.transactions.$inferInsert)[] = [];
  selected.forEach((r, i) => {
    if (dup[i].status === "imported" || dup[i].status === "in_file") {
      skipped++;
      return;
    }
    values.push({
      userId: ctx.userId,
      kind: r.amount < 0 ? "expense" : "income",
      status: "posted",
      amount: Math.abs(r.amount),
      accountId: acc.id,
      categoryId: r.categoryId,
      date: r.date,
      description: r.label,
      source: "csv",
      importHash: dup[i].hash,
    });
    imported++;
  });
  for (let i = 0; i < values.length; i += 500) await ctx.tx.insert(s.transactions).values(values.slice(i, i + 500));
  await audit(ctx, "import.csv", "account", acc.id, { imported, skipped });
  return { imported, skipped };
}
