/**
 * Ingestion des données Powens dans MONETA. Les opérations deviennent des lignes `transactions` ordinaires :
 * TOUT le moteur financier V2 (soldes, budgets, prévisions, santé…) les prend en compte sans code spécifique.
 *
 * Correspondance des états :
 *   comptabilisée (booked)  → status "posted"
 *   à venir (coming)        → status "planned" (déduite une seule fois du disponible, jamais des statistiques)
 *   supprimée par la banque → status "cancelled" (sans effet, conservée pour la traçabilité)
 *
 * Idempotence : index unique (user_id, external_id) ; une opération déjà connue est mise à jour, jamais dupliquée.
 * Concurrence : verrou consultatif PostgreSQL par utilisateur pendant toute l'ingestion.
 */
import "server-only";
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import type { Ctx } from "@/server/services/context";
import { audit } from "@/server/services/context";
import { addDays, type ISODate } from "@/lib/dates";
import { computeBalances } from "@/lib/finance/ledger";
import { categorize, merchantKey, type CategorizeContext } from "@/lib/bank/categorize";
import { decideDuplicate, findSupersededPending, findTransferPair, type MatchTx } from "@/lib/bank/matching";
import { maskIban } from "@/lib/bank/states";
import { toLedgerAccount, toLedgerTx } from "@/server/services/snapshot";
import { toCents, type PowensAccount, type PowensConnection, type PowensTransaction } from "./client";

export interface SyncStats {
  accounts: number;
  created: number;
  updated: number;
  merged: number;
  suggested: number;
  transfers: number;
  skipped: number;
}

const ACCOUNT_TYPE_MAP: Record<string, (typeof s.accountTypeEnum.enumValues)[number]> = {
  checking: "checking",
  card: "checking",
  joint: "checking",
  savings: "savings",
  deposit: "savings",
  ldds: "savings",
  pel: "savings",
  cel: "savings",
  csl: "savings",
  cat: "savings",
  market: "investment",
  pea: "investment",
  crowdlending: "investment",
  lifeinsurance: "placement",
  capitalisation: "placement",
  pee: "placement",
  perco: "placement",
  per: "placement",
  perp: "placement",
  madelin: "placement",
  rsp: "placement",
};

const TRANSFER_HINT = /\b(vir|virement|virt|transfert|transfer)\b/i;
const MANUAL_SOURCES = ["manual", "ocr", "assistant", "csv", "recurring"] as const;

export async function lockUser(ctx: Ctx) {
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"moneta-bank:" + ctx.userId}))`);
}

export async function loadCategorizeContext(ctx: Ctx): Promise<CategorizeContext> {
  const [cats, rules, hist] = await Promise.all([
    ctx.tx.select({ id: s.categories.id, name: s.categories.name, kind: s.categories.kind }).from(s.categories).where(isNull(s.categories.archivedAt)),
    ctx.tx.select({ pattern: s.merchantRules.pattern, categoryId: s.merchantRules.categoryId }).from(s.merchantRules),
    ctx.tx
      .select({ merchant: s.transactions.merchant, description: s.transactions.description, bankLabel: s.transactions.bankLabel, categoryId: s.transactions.categoryId })
      .from(s.transactions)
      .where(and(sql`${s.transactions.categoryId} is not null`, gte(s.transactions.date, addDays(ctx.today, -365)), ne(s.transactions.status, "cancelled"), or(isNull(s.transactions.categorySource), inArray(s.transactions.categorySource, ["user", "rule"]))!)),
  ]);
  const history = new Map<string, Map<string, number>>();
  for (const h of hist) {
    const k = merchantKey(h.merchant, h.bankLabel || h.description);
    if (!k || !h.categoryId) continue;
    const m = history.get(k) ?? new Map<string, number>();
    m.set(h.categoryId, (m.get(h.categoryId) ?? 0) + 1);
    history.set(k, m);
  }
  return { categories: cats, rules, history };
}

function statusFor(t: PowensTransaction): { status: "posted" | "planned" | "cancelled"; bankStatus: "booked" | "coming" | "deleted" } {
  if (t.deleted) return { status: "cancelled", bankStatus: "deleted" };
  if (t.coming) return { status: "planned", bankStatus: "coming" };
  return { status: "posted", bankStatus: "booked" };
}

function labelOf(t: PowensTransaction) {
  return (t.simplified_wording || t.wording || t.original_wording || "Opération bancaire").trim().slice(0, 200);
}

/** Met à jour (ou crée) la connexion locale à partir de l'objet Connection Powens. */
export async function upsertConnection(ctx: Ctx, conn: PowensConnection) {
  const ext = String(conn.id);
  const state = conn.state ?? conn.error ?? null;
  const values = {
    connectorUuid: conn.connector?.uuid ?? conn.connector_uuid ?? null,
    connectorName: conn.connector?.name ?? null,
    connectorColor: conn.connector?.color ? `#${String(conn.connector.color).replace(/^#/, "")}` : null,
    state,
    errorMessage: conn.error_message ?? null,
    nextSyncAt: conn.next_try ? new Date(conn.next_try) : null,
    expiresAt: conn.expire ? new Date(conn.expire) : null,
    status: state ? "error" : "active",
    syncing: false,
    updatedAt: new Date(),
    ...(!state && conn.last_update ? { lastSyncAt: new Date(conn.last_update) } : {}),
  };
  const [existing] = await ctx.tx.select().from(s.bankConnections).where(and(eq(s.bankConnections.provider, "powens"), eq(s.bankConnections.externalConnectionId, ext)));
  if (existing) {
    // Ne jamais effacer un nom de banque connu par une valeur absente
    const patch = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== null || ["state", "errorMessage", "nextSyncAt"].includes(k)));
    const [row] = await ctx.tx.update(s.bankConnections).set(patch).where(eq(s.bankConnections.id, existing.id)).returning();
    return row;
  }
  const [row] = await ctx.tx.insert(s.bankConnections).values({ userId: ctx.userId, provider: "powens", externalConnectionId: ext, ...values }).returning();
  return row;
}

/**
 * Ingestion complète d'une connexion : comptes puis opérations.
 * `transactions` : opérations récupérées (webhook ou API), toutes connexions confondues — filtrées par compte.
 */
export async function ingestConnection(ctx: Ctx, conn: PowensConnection, accounts: PowensAccount[], transactions: PowensTransaction[], trigger: "webhook" | "manual" | "callback" | "scheduled"): Promise<SyncStats> {
  await lockUser(ctx);
  const stats: SyncStats = { accounts: 0, created: 0, updated: 0, merged: 0, suggested: 0, transfers: 0, skipped: 0 };
  const connection = await upsertConnection(ctx, conn);
  const links = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.connectionId, connection.id));
  const linkByExt = new Map(links.map((l) => [l.externalAccountId, l]));
  const newAccounts = new Set<string>();

  for (const acc of accounts) {
    const ext = String(acc.id);
    const disabled = Boolean(acc.disabled);
    const balance = toCents(acc.balance);
    const coming = toCents(acc.coming);
    const balanceAt = acc.last_update ? new Date(acc.last_update) : new Date();
    let link = linkByExt.get(ext);
    if (!link) {
      if (disabled || acc.deleted) continue; // compte non partagé : rien n'est importé
      const [created] = await ctx.tx
        .insert(s.accounts)
        .values({
          userId: ctx.userId,
          name: (acc.name || acc.original_name || "Compte bancaire").slice(0, 80),
          institution: connection.connectorName ?? "Banque connectée",
          type: ACCOUNT_TYPE_MAP[acc.type ?? ""] ?? "other",
          currency: acc.currency?.id ?? ctx.currency,
          initialBalance: 0,
          openedOn: ctx.today,
          color: connection.connectorColor ?? "#2a78d6",
          icon: "landmark",
          description: "Compte synchronisé automatiquement",
        })
        .returning();
      [link] = await ctx.tx
        .insert(s.bankAccountLinks)
        .values({ userId: ctx.userId, connectionId: connection.id, externalAccountId: ext, accountId: created.id, externalName: acc.original_name ?? acc.name ?? null, externalType: acc.type ?? null, ibanMasked: maskIban(acc.iban), currency: acc.currency?.id ?? null, bankBalance: balance, bankComing: coming, balanceAt: balance !== null ? balanceAt : null, lastSeenAt: new Date() })
        .returning();
      linkByExt.set(ext, link);
      newAccounts.add(link.accountId);
    } else {
      await ctx.tx
        .update(s.bankAccountLinks)
        .set({
          externalName: acc.original_name ?? acc.name ?? link.externalName,
          externalType: acc.type ?? link.externalType,
          ibanMasked: maskIban(acc.iban) ?? link.ibanMasked,
          disabledAtBank: disabled,
          lastSeenAt: new Date(),
          // Un solde absent (erreur, donnée manquante) ne remplace JAMAIS le dernier solde connu
          ...(balance !== null ? { bankBalance: balance, balanceAt } : {}),
          ...(coming !== null ? { bankComing: coming } : {}),
        })
        .where(and(eq(s.bankAccountLinks.connectionId, connection.id), eq(s.bankAccountLinks.externalAccountId, ext)));
    }
    stats.accounts++;
  }

  // ---- Opérations ----
  const accountByExt = new Map([...linkByExt.values()].filter((l) => l.syncEnabled && !accounts.find((a) => String(a.id) === l.externalAccountId)?.disabled).map((l) => [l.externalAccountId, l.accountId]));
  // Donnée incomplète (date ou montant absent/invalide) : ignorée plutôt qu'inventée
  const valid = (t: PowensTransaction) => typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date.slice(0, 10)) && !!toCents(t.value);
  const incoming = transactions
    .filter((t) => accountByExt.has(String(t.id_account)) && valid(t))
    .map((t) => ({ ...t, date: t.date.slice(0, 10), vdate: t.vdate && /^\d{4}-\d{2}-\d{2}/.test(t.vdate) ? t.vdate.slice(0, 10) : null }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  stats.skipped += transactions.length - incoming.length;
  if (!incoming.length && !newAccounts.size) {
    await finishRun(ctx, connection.id, trigger, stats, connection.state ? "partial" : "success");
    return stats;
  }
  const extIds = incoming.map((t) => String(t.id));
  const existing = extIds.length ? await ctx.tx.select().from(s.transactions).where(inArray(s.transactions.externalId, extIds)) : [];
  const byExt = new Map(existing.map((e) => [e.externalId!, e]));
  const catCtx = await loadCategorizeContext(ctx);
  const accountIds = [...new Set(accountByExt.values())];
  // Carte à débit différé : les achats figurent sur le compte carte ; le prélèvement mensuel (summary_card) sur le
  // compte courant n'est donc qu'un transfert courant → carte (sinon les dépenses seraient comptées deux fois).
  const cardLinks = [...linkByExt.values()].filter((l) => l.externalType === "card" && l.syncEnabled);
  const cardTargetFor = (t: PowensTransaction): string | null => {
    if (t.type !== "summary_card" || !cardLinks.length) return null;
    const children = cardLinks.filter((l) => String(accounts.find((a) => String(a.id) === l.externalAccountId)?.id_parent ?? "") === String(t.id_account));
    const target = children.length === 1 ? children[0] : cardLinks.length === 1 ? cardLinks[0] : null;
    return target && target.externalAccountId !== String(t.id_account) ? target.accountId : null;
  };
  const minDate = incoming.length ? addDays(incoming[0].date, -7) : ctx.today;
  const manualPool = await ctx.tx
    .select()
    .from(s.transactions)
    .where(and(inArray(s.transactions.accountId, accountIds), isNull(s.transactions.externalId), inArray(s.transactions.source, [...MANUAL_SOURCES]), ne(s.transactions.status, "cancelled"), gte(s.transactions.date, minDate), inArray(s.transactions.kind, ["expense", "income", "refund"])));
  const usedManual = new Set<string>();
  const pendingPool = await ctx.tx.select().from(s.transactions).where(and(inArray(s.transactions.accountId, accountIds), eq(s.transactions.bankStatus, "coming"), eq(s.transactions.status, "planned")));
  const newBank: MatchTx[] = incoming.filter((t) => !byExt.has(String(t.id))).map((t) => ({ id: String(t.id), accountId: accountByExt.get(String(t.id_account))!, date: t.date, amount: toCents(t.value) ?? 0, label: labelOf(t) }));

  const cardReclass = new Map<string, number>();
  for (const t of incoming) {
    const ext = String(t.id);
    const accountId = accountByExt.get(String(t.id_account))!;
    const amount = toCents(t.value);
    if (amount === null || amount === 0 || !t.date) {
      stats.skipped++; // donnée incomplète : ignorée plutôt qu'inventée
      continue;
    }
    const { status, bankStatus } = statusFor(t);
    const label = labelOf(t);
    const bankCats = (t.categories ?? []).flatMap((c) => [c.code, c.parent_code]).filter((x): x is string => Boolean(x));
    const prev = byExt.get(ext);
    if (prev) {
      // Mise à jour d'une opération connue (comptabilisation, modification ou suppression par la banque)
      const keepCancelled = prev.status === "cancelled" && bankStatus !== "deleted" && prev.bankStatus === bankStatus; // ex. partie créditrice d'un virement interne
      const patch: Partial<typeof s.transactions.$inferInsert> = {};
      if (!keepCancelled && prev.status !== status) patch.status = status;
      if (prev.bankStatus !== bankStatus) patch.bankStatus = bankStatus;
      if (prev.kind !== "transfer" && Math.abs(amount) !== prev.amount) patch.amount = Math.abs(amount);
      const card = amount < 0 ? cardTargetFor(t) : null;
      if (card && prev.kind === "expense") {
        Object.assign(patch, { kind: "transfer" as const, toAccountId: card, categoryId: null, categorySource: null, categoryConfidence: null });
        // Le solde initial de la carte a été ancré sur le solde bancaire avec l'ancienne classification :
        // on compense pour que ce reclassement ne crée pas d'argent fictif sur le compte carte.
        if (prev.status === "posted") cardReclass.set(card, (cardReclass.get(card) ?? 0) + prev.amount);
      }
      if (prev.date !== t.date) patch.date = t.date;
      if ((t.vdate ?? null) !== prev.valueDate) patch.valueDate = t.vdate ?? null;
      if ((t.original_wording ?? null) !== prev.bankLabel) patch.bankLabel = t.original_wording ?? null;
      if (Object.keys(patch).length) {
        await ctx.tx.update(s.transactions).set({ ...patch, updatedAt: new Date() }).where(eq(s.transactions.id, prev.id));
        stats.updated++;
      }
      continue;
    }
    const me: MatchTx = { id: ext, accountId, date: t.date, amount, label };
    // 1. Une opération « à venir » remplacée par sa version comptabilisée sous un autre identifiant
    if (bankStatus === "booked") {
      const p = findSupersededPending(me, pendingPool.filter((x) => x.status === "planned").map((x) => ({ id: x.id, accountId: x.accountId, date: x.date, amount: x.kind === "expense" ? -x.amount : x.amount, label: x.description ?? "" })));
      if (p) {
        await ctx.tx.update(s.transactions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.transactions.id, p.id));
        const pp = pendingPool.find((x) => x.id === p.id);
        if (pp) pp.status = "cancelled";
        await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "pending_superseded", status: "applied", otherTxId: p.id, snapshot: { externalBooked: ext } });
      }
    }
    // 2. Doublon d'une opération saisie à la main
    const candidates: MatchTx[] = manualPool.filter((m) => !usedManual.has(m.id)).map((m) => ({ id: m.id, accountId: m.accountId, date: m.date, amount: m.kind === "expense" ? -m.amount : m.amount, label: m.description ?? "", merchant: m.merchant }));
    const sameDayBank = newBank.filter((o) => o.id !== ext && o.accountId === accountId && o.amount === amount && o.date === t.date);
    const dup = decideDuplicate(me, candidates, sameDayBank);
    if (dup.decision === "auto" && dup.candidate) {
      const manual = manualPool.find((m) => m.id === dup.candidate!.id)!;
      usedManual.add(manual.id);
      await ctx.tx
        .update(s.transactions)
        .set({ externalId: ext, bankStatus, status, bankLabel: t.original_wording ?? label, bankCategory: bankCats[0] ?? null, valueDate: t.vdate ?? null, date: t.date, amount: Math.abs(amount), importedAt: new Date(), updatedAt: new Date() })
        .where(eq(s.transactions.id, manual.id));
      await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "duplicate", status: "auto_merged", keptTxId: manual.id, score: dup.score, snapshot: { manual: { date: manual.date, amount: manual.amount, description: manual.description, merchant: manual.merchant, status: manual.status }, bank: { externalId: ext, date: t.date, amount, label } } });
      stats.merged++;
      continue;
    }
    // 3. Nouvelle opération bancaire
    const isIncome = amount > 0;
    const guess = ctx.settings.bank?.autoCategorize === false ? { categoryId: null, source: null, confidence: null } : categorize({ label, merchant: t.counterparty?.label ?? null, bankCategories: bankCats, isIncome }, catCtx);
    const cardTarget = amount < 0 ? cardTargetFor(t) : null;
    const kind: "expense" | "income" | "refund" | "transfer" = cardTarget ? "transfer" : amount < 0 ? "expense" : t.type === "payback" ? "refund" : "income";
    const [row] = await ctx.tx
      .insert(s.transactions)
      .values({
        userId: ctx.userId,
        kind,
        status,
        amount: Math.abs(amount),
        accountId,
        toAccountId: cardTarget,
        categoryId: cardTarget ? null : guess.categoryId,
        date: t.date,
        valueDate: t.vdate ?? null,
        description: label,
        merchant: t.counterparty?.label ?? null,
        paymentMethod: t.type === "card" || t.type === "deferred_card" ? "card" : t.type === "transfer" ? "transfer" : t.type === "order" ? "direct_debit" : t.type === "withdrawal" ? "cash" : null,
        source: "bank",
        externalId: ext,
        bankStatus,
        bankLabel: t.original_wording ?? null,
        bankCategory: bankCats[0] ?? null,
        categorySource: cardTarget ? null : guess.source,
        categoryConfidence: cardTarget ? null : guess.confidence,
        importedAt: new Date(),
        tags: [],
      })
      .onConflictDoNothing()
      .returning({ id: s.transactions.id });
    if (!row) continue; // déjà inséré par une synchronisation concurrente
    stats.created++;
    if (dup.decision === "suggest" && dup.candidate) {
      await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "duplicate", status: "suggested", keptTxId: row.id, otherTxId: dup.candidate.id, score: dup.score, snapshot: {} });
      stats.suggested++;
    }
  }

  for (const [cardId, amt] of cardReclass) {
    await ctx.tx.update(s.accounts).set({ initialBalance: sql`${s.accounts.initialBalance} - ${amt}` }).where(eq(s.accounts.id, cardId));
    await audit(ctx, "bank.card_reclassified", "account", cardId, { amount: amt });
  }
  stats.transfers = await pairInternalTransfers(ctx, accountIds, minDate);
  await setInitialBalances(ctx, newAccounts);
  await finishRun(ctx, connection.id, trigger, stats, connection.state ? "partial" : "success");
  return stats;
}

/**
 * Virements internes : un débit bancaire et un crédit du même montant sur un autre compte de l'utilisateur,
 * à ≤ 3 jours, avec un libellé de virement → une seule opération « transfert » (ni dépense ni revenu).
 */
export async function pairInternalTransfers(ctx: Ctx, accountIds: string[], since: ISODate): Promise<number> {
  const rows = await ctx.tx
    .select()
    .from(s.transactions)
    .where(and(gte(s.transactions.date, since), eq(s.transactions.status, "posted"), inArray(s.transactions.kind, ["expense", "income"]), sql`${s.transactions.externalId} is not null`));
  const debits = rows.filter((r) => r.kind === "expense" && accountIds.includes(r.accountId));
  const credits = rows.filter((r) => r.kind === "income");
  const used = new Set<string>();
  let n = 0;
  for (const d of debits) {
    const dHint = TRANSFER_HINT.test(`${d.description ?? ""} ${d.bankLabel ?? ""}`);
    const pool = credits.filter((c) => !used.has(c.id) && (dHint || TRANSFER_HINT.test(`${c.description ?? ""} ${c.bankLabel ?? ""}`)));
    const pair = findTransferPair({ id: d.id, accountId: d.accountId, date: d.date, amount: -d.amount, label: "" }, pool.map((c) => ({ id: c.id, accountId: c.accountId, date: c.date, amount: c.amount, label: "" })));
    if (!pair) continue;
    used.add(pair.id);
    await ctx.tx.update(s.transactions).set({ kind: "transfer", toAccountId: pair.accountId, categoryId: null, categorySource: null, updatedAt: new Date() }).where(eq(s.transactions.id, d.id));
    await ctx.tx.update(s.transactions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(s.transactions.id, pair.id));
    await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "internal_transfer", status: "applied", keptTxId: d.id, otherTxId: pair.id, snapshot: { amount: d.amount, date: d.date } });
    n++;
  }
  return n;
}

/** Solde initial des comptes nouvellement importés : solde bancaire − effet des opérations importées. */
async function setInitialBalances(ctx: Ctx, accountIds: Set<string>) {
  for (const id of accountIds) {
    const [acc] = await ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, id));
    const [link] = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.accountId, id));
    if (!acc || !link) continue;
    const txs = await ctx.tx.select().from(s.transactions).where(or(eq(s.transactions.accountId, id), eq(s.transactions.toAccountId, id)));
    const first = txs.reduce<string | null>((m, t) => (!m || t.date < m ? t.date : m), null);
    const effect = computeBalances([{ ...toLedgerAccount(acc), initialBalance: 0 }], txs.map(toLedgerTx), ctx.today).get(id) ?? 0;
    await ctx.tx
      .update(s.accounts)
      .set({ initialBalance: link.bankBalance !== null ? link.bankBalance - effect : 0, openedOn: first && first < acc.openedOn ? first : acc.openedOn, updatedAt: new Date() })
      .where(eq(s.accounts.id, id));
  }
}

async function finishRun(ctx: Ctx, connectionId: string, trigger: string, st: SyncStats, status: "success" | "partial" | "error", message?: string) {
  await ctx.tx.insert(s.syncRuns).values({ userId: ctx.userId, connectionId, trigger, status, accounts: st.accounts, created: st.created, updated: st.updated, merged: st.merged, message: message ?? (st.suggested ? `${st.suggested} doublon(s) possible(s) à vérifier` : null), finishedAt: new Date() });
  // Une synchronisation réussie (même partielle) met à jour la date affichée « Dernière synchronisation »
  await ctx.tx.update(s.bankConnections).set({ syncing: false, lastAttemptAt: new Date(), ...(status === "success" ? { lastSyncAt: new Date(), lastError: null } : {}) }).where(eq(s.bankConnections.id, connectionId));
  await audit(ctx, "bank.sync", "bank_connection", connectionId, { trigger, ...st });
}

export async function recordSyncError(ctx: Ctx, connectionId: string | null, trigger: string, message: string) {
  await ctx.tx.insert(s.syncRuns).values({ userId: ctx.userId, connectionId, trigger, status: "error", message: message.slice(0, 300), finishedAt: new Date() });
  if (connectionId) await ctx.tx.update(s.bankConnections).set({ syncing: false, lastAttemptAt: new Date(), lastError: message.slice(0, 300) }).where(eq(s.bankConnections.id, connectionId));
}

