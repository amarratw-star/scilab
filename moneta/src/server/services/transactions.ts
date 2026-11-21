import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import type { TransactionInput } from "@/lib/validation";

export interface TxFilters {
  q?: string;
  from?: string;
  to?: string;
  kind?: string[];
  status?: string[];
  accountId?: string;
  categoryId?: string;
  paymentMethod?: string;
  min?: number;
  max?: number;
  tag?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  limit?: number;
  offset?: number;
}

async function assertRefs(ctx: Ctx, input: { accountId: string; toAccountId?: string | null; categoryId?: string | null }) {
  const ids = [input.accountId, input.toAccountId].filter(Boolean) as string[];
  const found = await ctx.tx.select({ id: s.accounts.id }).from(s.accounts).where(inArray(s.accounts.id, ids));
  if (found.length !== new Set(ids).size) throw new ServiceError("Compte introuvable", { accountId: "Compte introuvable" });
  if (input.categoryId) {
    const [c] = await ctx.tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.id, input.categoryId));
    if (!c) throw new ServiceError("Catégorie introuvable", { categoryId: "Catégorie introuvable" });
  }
}

export async function createTransaction(ctx: Ctx, input: TransactionInput, source: "manual" | "csv" | "ocr" | "assistant" | "recurring" | "bank" | "demo" = "manual", extra: Partial<typeof s.transactions.$inferInsert> = {}) {
  await assertRefs(ctx, input);
  let categoryId = input.categoryId;
  if (input.kind === "refund" && input.refundOfId) {
    const [orig] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, input.refundOfId));
    if (!orig || orig.kind !== "expense") throw new ServiceError("L'opération remboursée doit être une dépense");
    categoryId ??= orig.categoryId;
  }
  const [row] = await ctx.tx
    .insert(s.transactions)
    .values({
      userId: ctx.userId,
      kind: input.kind,
      status: input.status,
      amount: input.amount,
      accountId: input.accountId,
      toAccountId: input.toAccountId,
      categoryId,
      date: input.date,
      time: input.time,
      description: input.description,
      merchant: input.merchant,
      paymentMethod: input.paymentMethod,
      tags: input.tags,
      isRecurring: input.isRecurring,
      notes: input.notes,
      refundOfId: input.kind === "refund" ? input.refundOfId : null,
      goalId: input.goalId,
      source,
      ...extra,
    })
    .returning();
  await audit(ctx, "transaction.create", "transaction", row.id, { kind: row.kind, amount: row.amount, source });
  return row;
}

export async function updateTransaction(ctx: Ctx, id: string, input: TransactionInput) {
  const [existing] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, id));
  if (!existing) throw new ServiceError("Opération introuvable");
  await assertRefs(ctx, input);
  const [row] = await ctx.tx
    .update(s.transactions)
    .set({
      kind: input.kind,
      status: input.status,
      amount: input.amount,
      accountId: input.accountId,
      toAccountId: input.toAccountId,
      categoryId: input.categoryId,
      date: input.date,
      time: input.time,
      description: input.description,
      merchant: input.merchant,
      paymentMethod: input.paymentMethod,
      tags: input.tags,
      isRecurring: input.isRecurring,
      notes: input.notes,
      refundOfId: input.kind === "refund" ? input.refundOfId : null,
      // Opération bancaire : une catégorie modifiée devient un choix de l'utilisateur (apprentissage, jamais écrasée)
      ...(existing.importedAt && input.categoryId !== existing.categoryId ? { categorySource: "user", categoryConfidence: 100, verifiedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(s.transactions.id, id))
    .returning();
  await audit(ctx, "transaction.update", "transaction", id, {
    before: { kind: existing.kind, amount: existing.amount, date: existing.date, status: existing.status },
    after: { kind: row.kind, amount: row.amount, date: row.date, status: row.status },
  });
  return row;
}

export async function deleteTransaction(ctx: Ctx, id: string) {
  const [bankRow] = await ctx.tx.select({ externalId: s.transactions.externalId, notes: s.transactions.notes }).from(s.transactions).where(eq(s.transactions.id, id));
  if (bankRow?.externalId) {
    // Opération synchronisée : masquée (annulée) plutôt qu'effacée, sinon elle serait réimportée à la synchronisation suivante
    const [row] = await ctx.tx.update(s.transactions).set({ status: "cancelled", notes: `Masquée par l'utilisateur. ${bankRow.notes ?? ""}`.trim(), updatedAt: new Date() }).where(eq(s.transactions.id, id)).returning();
    await audit(ctx, "transaction.hide_bank", "transaction", id, { kind: row.kind, amount: row.amount, date: row.date });
    return row;
  }
  const [existing] = await ctx.tx.delete(s.transactions).where(eq(s.transactions.id, id)).returning();
  if (!existing) throw new ServiceError("Opération introuvable");
  await audit(ctx, "transaction.delete", "transaction", id, { kind: existing.kind, amount: existing.amount, date: existing.date });
  return existing;
}

export async function duplicateTransaction(ctx: Ctx, id: string, date: string) {
  const [t] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, id));
  if (!t) throw new ServiceError("Opération introuvable");
  const { id: _id, createdAt: _c, updatedAt: _u, importHash: _h, occurrenceDate: _o, recurringId: _r, ...rest } = t;
  const [row] = await ctx.tx.insert(s.transactions).values({ ...rest, date, source: "manual" }).returning();
  await audit(ctx, "transaction.duplicate", "transaction", row.id, { from: id });
  return row;
}

/** Confirme une opération prévue (elle devient effective) à la date indiquée. */
export async function confirmPlanned(ctx: Ctx, id: string, date: string) {
  const [row] = await ctx.tx
    .update(s.transactions)
    .set({ status: "posted", date, updatedAt: new Date() })
    .where(and(eq(s.transactions.id, id), eq(s.transactions.status, "planned")))
    .returning();
  if (!row) throw new ServiceError("Opération prévue introuvable");
  await audit(ctx, "transaction.confirm", "transaction", id);
  return row;
}

function buildWhere(f: TxFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(s.transactions.date, f.from));
  if (f.to) conds.push(lte(s.transactions.date, f.to));
  if (f.kind?.length) conds.push(inArray(s.transactions.kind, f.kind as (typeof s.txKindEnum.enumValues)[number][]));
  if (f.status?.length) conds.push(inArray(s.transactions.status, f.status as (typeof s.txStatusEnum.enumValues)[number][]));
  if (f.accountId) conds.push(or(eq(s.transactions.accountId, f.accountId), eq(s.transactions.toAccountId, f.accountId))!);
  if (f.categoryId === "none") conds.push(sql`${s.transactions.categoryId} is null and ${s.transactions.kind} in ('expense','income','refund')`);
  else if (f.categoryId)
    conds.push(
      or(
        eq(s.transactions.categoryId, f.categoryId),
        sql`${s.transactions.categoryId} in (select id from categories where parent_id = ${f.categoryId})`,
      )!,
    );
  if (f.paymentMethod) conds.push(eq(s.transactions.paymentMethod, f.paymentMethod as (typeof s.paymentMethodEnum.enumValues)[number]));
  if (f.min !== undefined) conds.push(sql`abs(${s.transactions.amount}) >= ${f.min}`);
  if (f.max !== undefined) conds.push(sql`abs(${s.transactions.amount}) <= ${f.max}`);
  if (f.tag) conds.push(sql`${f.tag} = any(${s.transactions.tags})`);
  if (f.q?.trim()) {
    const q = f.q.trim().slice(0, 100);
    const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    conds.push(
      or(
        ilike(s.transactions.description, like),
        ilike(s.transactions.merchant, like),
        ilike(s.transactions.notes, like),
        sql`word_similarity(${q.toLowerCase()}, lower(coalesce(${s.transactions.description}, '') || ' ' || coalesce(${s.transactions.merchant}, ''))) > 0.45`,
        sql`${s.transactions.categoryId} in (select id from categories where name ilike ${like})`,
      )!,
    );
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listTransactions(ctx: Ctx, f: TxFilters) {
  const where = buildWhere(f);
  const order =
    f.sort === "amount_desc"
      ? [desc(sql`abs(${s.transactions.amount})`), desc(s.transactions.date)]
      : f.sort === "amount_asc"
        ? [asc(sql`abs(${s.transactions.amount})`), desc(s.transactions.date)]
        : f.sort === "date_asc"
          ? [asc(s.transactions.date), asc(s.transactions.createdAt)]
          : [desc(s.transactions.date), desc(s.transactions.time), desc(s.transactions.createdAt)];
  const limit = Math.min(500, f.limit ?? 50);
  const rows = await ctx.tx
    .select({
      t: s.transactions,
      docCount: sql<number>`(select count(*)::int from documents d where d.transaction_id = ${s.transactions.id})`,
    })
    .from(s.transactions)
    .where(where)
    .orderBy(...order)
    .limit(limit)
    .offset(f.offset ?? 0);
  const [agg] = await ctx.tx
    .select({
      count: sql<number>`count(*)::int`,
      income: sql<number>`coalesce(sum(case when kind = 'income' and status = 'posted' then amount end), 0)::bigint`,
      expenses: sql<number>`coalesce(sum(case when kind = 'expense' and status = 'posted' then amount when kind = 'refund' and status = 'posted' then -amount end), 0)::bigint`,
    })
    .from(s.transactions)
    .where(where);
  return {
    rows: rows.map((r) => ({ ...r.t, docCount: r.docCount })),
    total: agg.count,
    income: Number(agg.income),
    expenses: Number(agg.expenses),
  };
}

export async function getTransaction(ctx: Ctx, id: string) {
  const [t] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, id));
  return t ?? null;
}

/** Liste des tags existants (pour l'autocomplétion). */
export async function listTags(ctx: Ctx) {
  const rows = await ctx.tx.execute<{ tag: string }>(sql`select distinct unnest(tags) as tag from transactions order by 1 limit 200`);
  return (rows as unknown as { tag: string }[]).map((r) => r.tag);
}

/** Commerçants récents (autocomplétion). */
export async function listMerchants(ctx: Ctx) {
  const rows = await ctx.tx.execute<{ merchant: string }>(
    sql`select merchant from transactions where merchant is not null group by merchant order by max(date) desc limit 100`,
  );
  return (rows as unknown as { merchant: string }[]).map((r) => r.merchant);
}
