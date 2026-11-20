import "server-only";
import { eq, or, sql } from "drizzle-orm";
import type { z } from "zod";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import { computeBalances } from "@/lib/finance/ledger";
import { toLedgerAccount, toLedgerTx } from "./snapshot";
import type { accountSchema } from "@/lib/validation";

export async function createAccount(ctx: Ctx, input: z.infer<typeof accountSchema>) {
  const [{ max }] = await ctx.tx.select({ max: sql<number>`coalesce(max(sort_order), 0)::int` }).from(s.accounts);
  const [row] = await ctx.tx.insert(s.accounts).values({ ...input, userId: ctx.userId, sortOrder: max + 1 }).returning();
  await audit(ctx, "account.create", "account", row.id, { type: row.type });
  return row;
}

export async function updateAccount(ctx: Ctx, id: string, input: z.infer<typeof accountSchema>) {
  const [row] = await ctx.tx
    .update(s.accounts)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(s.accounts.id, id))
    .returning();
  if (!row) throw new ServiceError("Compte introuvable");
  await audit(ctx, "account.update", "account", id);
  return row;
}

export async function setAccountArchived(ctx: Ctx, id: string, archived: boolean) {
  const [row] = await ctx.tx
    .update(s.accounts)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(s.accounts.id, id))
    .returning();
  if (!row) throw new ServiceError("Compte introuvable");
  await audit(ctx, archived ? "account.archive" : "account.unarchive", "account", id);
  return row;
}

/** Supprime un compte ET toutes ses opérations (y compris les transferts qui le concernent). Irréversible. */
export async function deleteAccount(ctx: Ctx, id: string) {
  const [acc] = await ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, id));
  if (!acc) throw new ServiceError("Compte introuvable");
  const [{ n }] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(s.transactions)
    .where(or(eq(s.transactions.accountId, id), eq(s.transactions.toAccountId, id)));
  await ctx.tx.delete(s.accounts).where(eq(s.accounts.id, id));
  await audit(ctx, "account.delete", "account", id, { name: acc.name, deletedTransactions: n });
  return { deletedTransactions: n };
}

export async function accountBalance(ctx: Ctx, id: string) {
  const [acc] = await ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, id));
  if (!acc) throw new ServiceError("Compte introuvable");
  const txs = await ctx.tx
    .select()
    .from(s.transactions)
    .where(or(eq(s.transactions.accountId, id), eq(s.transactions.toAccountId, id)));
  return computeBalances([toLedgerAccount(acc)], txs.map(toLedgerTx)).get(id)!;
}

/**
 * Rapprochement : l'utilisateur indique le solde réel constaté. Si l'écart est non nul, une opération
 * de régularisation traçable est créée (jamais de modification silencieuse du solde initial).
 */
export async function reconcileAccount(ctx: Ctx, id: string, actualBalance: number, date: string, note?: string | null) {
  const computed = await accountBalance(ctx, id);
  const gap = actualBalance - computed;
  if (gap === 0) return { gap: 0, transactionId: null as string | null };
  const [row] = await ctx.tx
    .insert(s.transactions)
    .values({
      userId: ctx.userId,
      kind: "adjustment",
      status: "posted",
      amount: gap,
      accountId: id,
      date,
      description: "Régularisation de solde",
      notes: note ?? `Solde théorique ${computed / 100} → solde réel ${actualBalance / 100}`,
      source: "manual",
    })
    .returning({ id: s.transactions.id });
  await audit(ctx, "account.reconcile", "account", id, { computed, actualBalance, gap });
  return { gap, transactionId: row.id };
}
