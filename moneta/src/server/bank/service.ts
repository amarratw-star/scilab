import "server-only";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "@/server/services/context";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { addDays } from "@/lib/dates";
import { merchantKey, ruleSuggestions } from "@/lib/bank/categorize";
import { normalizeLabel } from "@/lib/finance/labels";
import { duplicateScore, SUGGEST_SCORE } from "@/lib/bank/matching";
import { describeConnectionState } from "@/lib/bank/states";
import { formatPowensDateTime, PowensClient, PowensError, powensConfig, type PowensAccount, type PowensTransaction } from "./client";
import { ingestConnection, recordSyncError, type SyncStats } from "./ingest";

export function bankStatus(user: { isDemo: boolean; hasDemoData: boolean }) {
  const cfg = powensConfig();
  if (user.isDemo) return { available: false, reason: "demo" as const, message: "Les connexions bancaires sont désactivées dans un espace de démonstration : aucune vraie banque ne peut y être connectée." };
  if (user.hasDemoData) return { available: false, reason: "demo_data" as const, message: "Ton espace contient des données de démonstration fictives. Supprime-les (Paramètres → Mes données) avant de connecter une vraie banque, pour ne jamais mélanger fictif et réel." };
  if (!cfg) return { available: false, reason: "not_configured" as const, message: "La connexion bancaire n'est pas encore configurée sur ce serveur : identifiants Powens (POWENS_DOMAIN, POWENS_CLIENT_ID, POWENS_CLIENT_SECRET) et APP_ENCRYPTION_KEY requis." };
  return { available: true as const, reason: null, message: null, sandbox: /sandbox|test/i.test(cfg.domain) };
}

export function client() {
  const cfg = powensConfig();
  if (!cfg) throw new ServiceError("La connexion bancaire n'est pas configurée sur ce serveur.");
  return new PowensClient(cfg);
}

/** Un utilisateur Powens par utilisateur MONETA ; jeton permanent chiffré au repos. */
export async function ensureBankUser(ctx: Ctx, c: PowensClient): Promise<string> {
  const [existing] = await ctx.tx.select().from(s.bankUsers);
  if (existing) return decryptSecret(existing.accessTokenEnc);
  const created = await c.createUser();
  await ctx.tx.insert(s.bankUsers).values({ userId: ctx.userId, provider: "powens", externalUserId: String(created.id_user), accessTokenEnc: encryptSecret(created.auth_token) });
  await audit(ctx, "bank.user_created", "bank_user", ctx.userId);
  return created.auth_token;
}

export async function bankToken(ctx: Ctx): Promise<string | null> {
  const [u] = await ctx.tx.select().from(s.bankUsers);
  return u ? decryptSecret(u.accessTokenEnc) : null;
}

/** URL du parcours sécurisé Powens (connexion, reconnexion, gestion des comptes partagés). */
export async function webviewFor(ctx: Ctx, flow: "connect" | "reconnect" | "manage", opts: { state: string; redirectUri: string; connectorUuid?: string; connectionId?: string }) {
  const c = client();
  const token = await ensureBankUser(ctx, c);
  let externalConnection: string | undefined;
  if (opts.connectionId) {
    const [conn] = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.id, opts.connectionId));
    if (!conn?.externalConnectionId) throw new ServiceError("Connexion introuvable");
    externalConnection = conn.externalConnectionId;
  }
  const { code } = await c.temporaryCode(token);
  await audit(ctx, `bank.webview_${flow}`, "bank_connection", opts.connectionId);
  return c.webviewUrl(flow, { code, redirectUri: opts.redirectUri, state: opts.state, connectionId: externalConnection, connectorUuid: opts.connectorUuid });
}

/**
 * Synchronisation « pull » (retour de la webview, bouton Actualiser, tâche de secours si aucun webhook reçu).
 * Les erreurs réseau ou Powens n'effacent jamais les données déjà connues.
 */
export type PullResult = SyncStats & { connections: number; error?: string };

/** N'émet jamais d'exception pour une erreur Powens : l'erreur est journalisée (et committée) puis renvoyée dans `error`. */
export async function pullSync(ctx: Ctx, trigger: "manual" | "callback" | "scheduled", onlyExternalConnectionId?: string, c: PowensClient = client()): Promise<PullResult> {
  const token = await bankToken(ctx);
  if (!token) throw new ServiceError("Aucune banque connectée.");
  const total = { accounts: 0, created: 0, updated: 0, merged: 0, suggested: 0, transfers: 0, skipped: 0, connections: 0 };
  let conns;
  try {
    conns = onlyExternalConnectionId ? [await c.getConnection(token, onlyExternalConnectionId)] : (await c.listConnections(token)).connections ?? [];
  } catch (e) {
    await recordSyncError(ctx, null, trigger, e instanceof PowensError ? e.message : "Erreur inattendue");
    return { ...total, error: "Impossible de joindre l'agrégateur bancaire pour le moment. Tes dernières données restent affichées." };
  }
  const local = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.provider, "powens"));
  const oldest = local.filter((l) => conns.some((x) => String(x.id) === l.externalConnectionId)).map((l) => l.lastSyncAt).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
  const isFirst = conns.some((x) => !local.find((l) => l.externalConnectionId === String(x.id))?.lastSyncAt);
  let txs: PowensTransaction[] = [];
  try {
    txs = await c.listTransactions(token, isFirst || !oldest ? { minDate: addDays(ctx.today, -90) } : { lastUpdate: formatPowensDateTime(new Date(oldest.getTime() - 2 * 86400000)) });
  } catch (e) {
    for (const conn of conns) {
      const l = local.find((x) => x.externalConnectionId === String(conn.id));
      await recordSyncError(ctx, l?.id ?? null, trigger, e instanceof PowensError ? e.message : "Erreur inattendue");
    }
    return { ...total, error: "La récupération des opérations a échoué temporairement. Tes dernières données restent affichées ; réessaie plus tard." };
  }
  for (const conn of conns) {
    let accounts: PowensAccount[] = [];
    try {
      accounts = (await c.listAccounts(token, String(conn.id))).accounts ?? [];
    } catch (e) {
      const l = local.find((x) => x.externalConnectionId === String(conn.id));
      await recordSyncError(ctx, l?.id ?? null, trigger, e instanceof PowensError ? e.message : "Erreur inattendue");
      continue;
    }
    const st = await ingestConnection(ctx, conn, accounts, txs, trigger);
    total.connections++;
    for (const k of ["accounts", "created", "updated", "merged", "suggested", "transfers", "skipped"] as const) total[k] += st[k];
  }
  await notifyAfterSync(ctx, total);
  return total as PullResult;
}

export async function notifyAfterSync(ctx: Ctx, st: { created: number; suggested: number }) {
  const prefs = ctx.settings.bank ?? {};
  const rows: (typeof s.notifications.$inferInsert)[] = [];
  if (prefs.notifyImport !== false && st.created > 0)
    rows.push({ userId: ctx.userId, type: "bank_import", severity: "info", title: `${st.created} nouvelle(s) opération(s) bancaire(s)`, body: st.suggested ? `${st.suggested} doublon(s) possible(s) à vérifier.` : "Vérifie leur catégorie en quelques secondes.", link: "/transactions/a-verifier", dedupeKey: `bank-import:${Date.now()}` });
  if (prefs.notifyErrors !== false) {
    const conns = await ctx.tx.select().from(s.bankConnections).where(and(eq(s.bankConnections.provider, "powens"), ne(s.bankConnections.status, "revoked")));
    for (const c of conns) {
      const info = describeConnectionState(c.state);
      if (info.action === "reconnect" || info.action === "bank_site")
        rows.push({ userId: ctx.userId, type: "bank_error", severity: "warning", title: `${c.connectorName ?? "Banque"} : ${info.label.toLowerCase()}`, body: info.message, link: "/comptes#connexions", dedupeKey: `bank-state:${c.id}:${c.state}` });
    }
  }
  if (rows.length) await ctx.tx.insert(s.notifications).values(rows).onConflictDoNothing();
}

export async function refreshConnection(ctx: Ctx, connectionId: string) {
  const [conn] = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.id, connectionId));
  if (!conn?.externalConnectionId) throw new ServiceError("Connexion introuvable");
  // Limite : une actualisation MANUELLE toutes les 5 minutes (les synchronisations reçues par webhook ne comptent pas)
  const [recent] = await ctx.tx
    .select({ id: s.syncRuns.id })
    .from(s.syncRuns)
    .where(and(eq(s.syncRuns.connectionId, conn.id), eq(s.syncRuns.trigger, "manual"), gte(s.syncRuns.startedAt, new Date(Date.now() - 5 * 60_000))))
    .limit(1);
  if (recent) throw new ServiceError("Une actualisation a déjà été demandée il y a moins de 5 minutes.");
  const c = client();
  const token = await bankToken(ctx);
  if (!token) throw new ServiceError("Aucune banque connectée.");
  await ctx.tx.update(s.bankConnections).set({ syncing: true, lastAttemptAt: new Date() }).where(eq(s.bankConnections.id, connectionId));
  try {
    await c.requestSync(token, conn.externalConnectionId);
  } catch (e) {
    if (!(e instanceof PowensError) || e.status === null || e.status >= 500) {
      await recordSyncError(ctx, conn.id, "manual", e instanceof PowensError ? e.message : "Erreur inattendue");
      return { accounts: 0, created: 0, updated: 0, merged: 0, suggested: 0, transfers: 0, skipped: 0, connections: 0, error: "La banque n'a pas pu être interrogée. Tes dernières données restent affichées." } satisfies PullResult;
    }
  }
  return pullSync(ctx, "manual", conn.externalConnectionId, c);
}

/** Supprime une connexion chez Powens (suppression RGPD définitive côté agrégateur) puis localement. */
export async function deleteConnection(ctx: Ctx, connectionId: string, keepData: boolean) {
  const [conn] = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.id, connectionId));
  if (!conn) throw new ServiceError("Connexion introuvable");
  const token = await bankToken(ctx);
  if (token && conn.externalConnectionId && powensConfig()) {
    try {
      await client().deleteConnection(token, conn.externalConnectionId);
    } catch (e) {
      if (!(e instanceof PowensError && e.status === 404)) throw new ServiceError("La suppression chez l'agrégateur a échoué. Réessaie dans quelques minutes.");
    }
  }
  const links = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.connectionId, conn.id));
  if (!keepData && links.length) await ctx.tx.delete(s.accounts).where(inArray(s.accounts.id, links.map((l) => l.accountId)));
  else if (links.length) await ctx.tx.update(s.accounts).set({ description: "Ancien compte synchronisé (connexion supprimée) — désormais manuel" }).where(inArray(s.accounts.id, links.map((l) => l.accountId)));
  await ctx.tx.delete(s.bankConnections).where(eq(s.bankConnections.id, conn.id));
  await audit(ctx, "bank.connection_deleted", "bank_connection", conn.id, { keepData, accounts: links.length });
}

export async function setAccountSync(ctx: Ctx, accountId: string, enabled: boolean) {
  if (enabled) {
    const [l] = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.accountId, accountId));
    if (l?.duplicateOfAccountId) throw new ServiceError("Ce compte semble déjà synchronisé via une autre connexion. Confirme d'abord qu'il s'agit d'un autre compte.");
  }
  const [row] = await ctx.tx.update(s.bankAccountLinks).set({ syncEnabled: enabled }).where(eq(s.bankAccountLinks.accountId, accountId)).returning();
  if (!row) throw new ServiceError("Ce compte n'est pas synchronisé.");
  await audit(ctx, enabled ? "bank.account_sync_on" : "bank.account_sync_off", "account", accountId);
}

/**
 * L'utilisateur confirme qu'un compte signalé comme doublon probable est bien un AUTRE compte :
 * il est réactivé, réintégré aux totaux, et sera alimenté (avec ancrage du solde) à la prochaine synchronisation.
 */
export async function confirmDistinctAccount(ctx: Ctx, accountId: string) {
  const [row] = await ctx.tx
    .update(s.bankAccountLinks)
    .set({ duplicateOfAccountId: null, syncEnabled: true })
    .where(and(eq(s.bankAccountLinks.accountId, accountId), sql`${s.bankAccountLinks.duplicateOfAccountId} is not null`))
    .returning();
  if (!row) throw new ServiceError("Ce compte n'est pas signalé comme doublon.");
  await ctx.tx.update(s.accounts).set({ archivedAt: null, description: "Compte synchronisé automatiquement", updatedAt: new Date() }).where(eq(s.accounts.id, accountId));
  await audit(ctx, "bank.duplicate_account_confirmed_distinct", "account", accountId);
}

/** Rapproche un compte manuel d'un compte synchronisé qui représente le même compte réel. */
export async function mergeManualIntoBank(ctx: Ctx, manualAccountId: string, bankAccountId: string) {
  const [link] = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.accountId, bankAccountId));
  const [manualLink] = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.accountId, manualAccountId));
  const [manual] = await ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, manualAccountId));
  if (!link || !manual || manualLink) throw new ServiceError("Choisis un compte manuel et un compte synchronisé.");
  const moved = await ctx.tx.update(s.transactions).set({ accountId: bankAccountId, updatedAt: new Date() }).where(eq(s.transactions.accountId, manualAccountId)).returning();
  await ctx.tx.update(s.transactions).set({ toAccountId: bankAccountId }).where(eq(s.transactions.toAccountId, manualAccountId));
  await ctx.tx.update(s.recurringItems).set({ accountId: bankAccountId }).where(eq(s.recurringItems.accountId, manualAccountId));
  await ctx.tx.update(s.recurringItems).set({ toAccountId: bankAccountId }).where(eq(s.recurringItems.toAccountId, manualAccountId));
  await ctx.tx.update(s.goals).set({ accountId: bankAccountId }).where(eq(s.goals.accountId, manualAccountId));
  // Les opérations manuelles déplacées sont comparées aux opérations bancaires : propositions, jamais de suppression automatique
  const bankTx = await ctx.tx.select().from(s.transactions).where(and(eq(s.transactions.accountId, bankAccountId), sql`${s.transactions.externalId} is not null`, ne(s.transactions.status, "cancelled")));
  let suggestions = 0;
  for (const m of moved.filter((x) => !x.externalId && x.status !== "cancelled")) {
    const sm = { id: m.id, accountId: bankAccountId, date: m.date, amount: m.kind === "expense" ? -m.amount : m.amount, label: m.description ?? "", merchant: m.merchant };
    const best = bankTx.map((b) => ({ b, sc: duplicateScore(sm, { id: b.id, accountId: bankAccountId, date: b.date, amount: b.kind === "expense" ? -b.amount : b.amount, label: b.description ?? "", merchant: b.merchant }) })).sort((a, b) => b.sc - a.sc)[0];
    if (best && best.sc >= SUGGEST_SCORE) {
      await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "duplicate", status: "suggested", keptTxId: best.b.id, otherTxId: m.id, score: best.sc });
      suggestions++;
    }
  }
  await ctx.tx.delete(s.accounts).where(eq(s.accounts.id, manualAccountId));
  await audit(ctx, "bank.accounts_merged", "account", bankAccountId, { from: manualAccountId, moved: moved.length, suggestions });
  return { moved: moved.length, suggestions };
}

/** Décision sur un doublon proposé : fusion (l'opération manuelle est annulée, jamais supprimée) ou conservation des deux. */
export async function resolveDuplicate(ctx: Ctx, recoId: string, action: "merge" | "keep_both") {
  const [r] = await ctx.tx.select().from(s.txReconciliations).where(and(eq(s.txReconciliations.id, recoId), eq(s.txReconciliations.status, "suggested")));
  if (!r?.keptTxId || !r.otherTxId) throw new ServiceError("Proposition introuvable ou déjà traitée.");
  if (action === "merge") {
    const [bank] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, r.keptTxId));
    const [manual] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, r.otherTxId));
    if (!bank || !manual) throw new ServiceError("Opération introuvable.");
    await ctx.tx
      .update(s.transactions)
      .set({
        categoryId: manual.categoryId ?? bank.categoryId,
        categorySource: manual.categoryId ? "user" : bank.categorySource,
        categoryConfidence: manual.categoryId ? 100 : bank.categoryConfidence,
        notes: [bank.notes, manual.notes].filter(Boolean).join("\n") || null,
        merchant: bank.merchant ?? manual.merchant,
        tags: [...new Set([...bank.tags, ...manual.tags])],
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(s.transactions.id, bank.id));
    await ctx.tx.update(s.transactions).set({ status: "cancelled", notes: `Fusionnée avec l'opération bancaire du ${bank.date}. ${manual.notes ?? ""}`.trim(), updatedAt: new Date() }).where(eq(s.transactions.id, manual.id));
    await ctx.tx.update(s.documents).set({ transactionId: bank.id }).where(eq(s.documents.transactionId, manual.id));
    await ctx.tx.update(s.txReconciliations).set({ status: "merged", decidedAt: new Date(), snapshot: { manual: { id: manual.id, date: manual.date, amount: manual.amount, description: manual.description, status: manual.status } } }).where(eq(s.txReconciliations.id, r.id));
  } else {
    await ctx.tx.update(s.txReconciliations).set({ status: "kept_both", decidedAt: new Date() }).where(eq(s.txReconciliations.id, r.id));
  }
  await audit(ctx, `bank.duplicate_${action}`, "transaction", r.keptTxId, { other: r.otherTxId });
}

/** Annule une fusion automatique : l'opération manuelle retrouve son état et l'opération bancaire est recréée à part. */
export async function undoAutoMerge(ctx: Ctx, recoId: string) {
  const [r] = await ctx.tx.select().from(s.txReconciliations).where(and(eq(s.txReconciliations.id, recoId), eq(s.txReconciliations.status, "auto_merged")));
  if (!r?.keptTxId) throw new ServiceError("Fusion introuvable.");
  const [tx] = await ctx.tx.select().from(s.transactions).where(eq(s.transactions.id, r.keptTxId));
  const snap = r.snapshot as { manual?: { date: string; amount: number; description: string | null; merchant: string | null; status: "posted" | "planned" | "cancelled" }; bank?: { externalId: string; date: string; amount: number; label: string } };
  if (!tx || !snap.manual || !snap.bank) throw new ServiceError("Données de fusion incomplètes.");
  await ctx.tx.update(s.transactions).set({ externalId: null, bankStatus: null, bankLabel: null, bankCategory: null, valueDate: null, importedAt: null, date: snap.manual.date, amount: snap.manual.amount, status: snap.manual.status, updatedAt: new Date() }).where(eq(s.transactions.id, tx.id));
  const [bankRow] = await ctx.tx
    .insert(s.transactions)
    .values({ userId: ctx.userId, kind: snap.bank.amount < 0 ? "expense" : "income", status: "posted", amount: Math.abs(snap.bank.amount), accountId: tx.accountId, date: snap.bank.date, description: snap.bank.label, source: "bank", externalId: snap.bank.externalId, bankStatus: "booked", importedAt: new Date(), tags: [] })
    .returning({ id: s.transactions.id });
  await ctx.tx.update(s.txReconciliations).set({ status: "undone", decidedAt: new Date() }).where(eq(s.txReconciliations.id, r.id));
  await ctx.tx.insert(s.txReconciliations).values({ userId: ctx.userId, kind: "duplicate", status: "kept_both", keptTxId: bankRow.id, otherTxId: tx.id, decidedAt: new Date() });
  await audit(ctx, "bank.merge_undone", "transaction", tx.id);
}

export async function markVerified(ctx: Ctx, ids: string[] | "all") {
  const cond = ids === "all" ? and(isNull(s.transactions.verifiedAt), sql`${s.transactions.importedAt} is not null`) : and(inArray(s.transactions.id, ids), isNull(s.transactions.verifiedAt));
  const rows = await ctx.tx.update(s.transactions).set({ verifiedAt: new Date() }).where(cond).returning({ id: s.transactions.id });
  return rows.length;
}

export async function suggestedRules(ctx: Ctx) {
  const corrections = await ctx.tx
    .select({ merchant: s.transactions.merchant, description: s.transactions.description, bankLabel: s.transactions.bankLabel, categoryId: s.transactions.categoryId })
    .from(s.transactions)
    .where(and(eq(s.transactions.categorySource, "user"), sql`${s.transactions.importedAt} is not null`, sql`${s.transactions.categoryId} is not null`, gte(s.transactions.date, addDays(ctx.today, -365))));
  const rules = await ctx.tx.select({ pattern: s.merchantRules.pattern }).from(s.merchantRules);
  return ruleSuggestions(corrections.map((c) => ({ key: merchantKey(c.merchant, c.bankLabel || c.description), categoryId: c.categoryId! })), rules);
}

/** Crée une règle. Elle ne s'applique aux opérations passées QUE si l'utilisateur le demande explicitement. */
export async function createRule(ctx: Ctx, pattern: string, categoryId: string, applyToExisting: boolean) {
  // Même normalisation que le moteur de catégorisation (sans « CB », dates, numéros…)
  const p = normalizeLabel(pattern).slice(0, 60);
  if (p.length < 3) throw new ServiceError("Motif trop court ou trop générique.");
  await ctx.tx.insert(s.merchantRules).values({ userId: ctx.userId, pattern: p, categoryId }).onConflictDoUpdate({ target: [s.merchantRules.userId, s.merchantRules.pattern], set: { categoryId } });
  let applied = 0;
  if (applyToExisting) {
    const rows = await ctx.tx.select().from(s.transactions).where(and(sql`${s.transactions.importedAt} is not null`, sql`coalesce(${s.transactions.categorySource}, '') <> 'user'`));
    const ids = rows.filter((r) => merchantKey(r.merchant, r.bankLabel || r.description).includes(p) || normalizeLabel(`${r.merchant ?? ""} ${r.bankLabel || r.description || ""}`).includes(p)).map((r) => r.id);
    if (ids.length) applied = (await ctx.tx.update(s.transactions).set({ categoryId, categorySource: "rule", categoryConfidence: 95 }).where(inArray(s.transactions.id, ids)).returning({ id: s.transactions.id })).length;
  }
  await audit(ctx, "bank.rule_created", "merchant_rule", undefined, { applied });
  return { applied };
}

export async function deleteRule(ctx: Ctx, id: string) {
  await ctx.tx.delete(s.merchantRules).where(eq(s.merchantRules.id, id));
}

export async function connectionsOverview(ctx: Ctx) {
  const [conns, links, runs] = await Promise.all([
    ctx.tx.select().from(s.bankConnections).where(ne(s.bankConnections.status, "revoked")).orderBy(desc(s.bankConnections.createdAt)),
    ctx.tx.select().from(s.bankAccountLinks),
    ctx.tx.select().from(s.syncRuns).orderBy(desc(s.syncRuns.startedAt)).limit(30),
  ]);
  return { conns, links, runs };
}

export interface ConnectionView {
  id: string;
  name: string;
  color: string | null;
  info: ReturnType<typeof describeConnectionState>;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
  accounts: { accountId: string; name: string; ibanMasked: string | null; externalType: string | null; syncEnabled: boolean; disabledAtBank: boolean; bankBalance: number | null; balanceAt: string | null; currency: string | null; duplicateOf: string | null }[];
}

/** Vue sérialisable des connexions (aucun jeton, aucun identifiant externe exposé au navigateur). */
export async function connectionViews(ctx: Ctx): Promise<ConnectionView[]> {
  const { conns, links } = await connectionsOverview(ctx);
  const accs = await ctx.tx.select({ id: s.accounts.id, name: s.accounts.name }).from(s.accounts);
  const name = new Map(accs.map((a) => [a.id, a.name]));
  return conns.map((c) => ({
    id: c.id,
    name: c.connectorName ?? "Banque",
    color: c.connectorColor,
    info: describeConnectionState(c.state, { syncing: c.syncing && !!c.lastAttemptAt && Date.now() - c.lastAttemptAt.getTime() < 10 * 60_000, expired: !!c.expiresAt && c.expiresAt.getTime() < Date.now(), pending: !c.lastSyncAt && !c.externalConnectionId }),
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    nextSyncAt: c.nextSyncAt?.toISOString() ?? null,
    lastError: c.state ? null : c.lastError,
    accounts: links
      .filter((l) => l.connectionId === c.id)
      .map((l) => ({ accountId: l.accountId, name: name.get(l.accountId) ?? l.externalName ?? "Compte", ibanMasked: l.ibanMasked, externalType: l.externalType, syncEnabled: l.syncEnabled, disabledAtBank: l.disabledAtBank, bankBalance: l.bankBalance, balanceAt: l.balanceAt?.toISOString() ?? null, currency: l.currency, duplicateOf: l.duplicateOfAccountId ? (name.get(l.duplicateOfAccountId) ?? "un autre compte") : null })),
  }));
}

/** Nombre d'éléments en attente pour les bandeaux (tableau de bord, navigation). */
export async function reviewCounts(ctx: Ctx) {
  const [[u], [d], conns] = await Promise.all([
    ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.transactions).where(and(isNull(s.transactions.verifiedAt), sql`${s.transactions.importedAt} is not null`, ne(s.transactions.status, "cancelled"))),
    ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.txReconciliations).where(eq(s.txReconciliations.status, "suggested")),
    ctx.tx.select({ state: s.bankConnections.state, name: s.bankConnections.connectorName, expiresAt: s.bankConnections.expiresAt }).from(s.bankConnections).where(ne(s.bankConnections.status, "revoked")),
  ]);
  const needAction = conns.filter((c) => {
    const a = describeConnectionState(c.state, { expired: !!c.expiresAt && c.expiresAt.getTime() < Date.now() }).action;
    return a === "reconnect" || a === "bank_site";
  });
  const [da] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.bankAccountLinks).where(sql`${s.bankAccountLinks.duplicateOfAccountId} is not null`);
  return { unverified: u.n, duplicates: d.n, duplicateAccounts: da.n, connections: conns.length, needAction: needAction.map((c) => c.name ?? "Banque") };
}

export interface ReviewFilters { statut?: "non" | "oui" | "tous"; type?: "expense" | "income" | "transfer"; compte?: string; du?: string; au?: string; categorie?: string }
export interface ReviewTx {
  id: string; date: string; amount: number; kind: string; status: string; bankStatus: string | null; description: string | null; bankLabel: string | null; merchant: string | null;
  accountId: string; accountName: string; categoryId: string | null; categorySource: string | null; confidence: number | null; verified: boolean; notes: string | null; hasDocument: boolean;
  toAccountId: string | null; tags: string[]; paymentMethod: string | null; time: string | null; refundOfId: string | null;
}

/** Données de la page de revue : opérations importées, doublons proposés, fusions automatiques récentes, règles suggérées. */
export async function reviewData(ctx: Ctx, f: ReviewFilters) {
  const conds = [sql`${s.transactions.importedAt} is not null`, ne(s.transactions.status, "cancelled")];
  const statut = f.statut ?? "non";
  if (statut === "non") conds.push(isNull(s.transactions.verifiedAt));
  if (statut === "oui") conds.push(sql`${s.transactions.verifiedAt} is not null`);
  if (f.type) conds.push(eq(s.transactions.kind, f.type));
  if (f.compte && /^[0-9a-f-]{36}$/i.test(f.compte)) conds.push(eq(s.transactions.accountId, f.compte));
  if (f.categorie === "aucune") conds.push(isNull(s.transactions.categoryId));
  else if (f.categorie && /^[0-9a-f-]{36}$/i.test(f.categorie)) conds.push(eq(s.transactions.categoryId, f.categorie));
  if (f.du && /^\d{4}-\d{2}-\d{2}$/.test(f.du)) conds.push(gte(s.transactions.date, f.du));
  if (f.au && /^\d{4}-\d{2}-\d{2}$/.test(f.au)) conds.push(sql`${s.transactions.date} <= ${f.au}`);
  const [rows, accs, cats, recos, docs] = await Promise.all([
    ctx.tx.select().from(s.transactions).where(and(...conds)).orderBy(desc(s.transactions.date), desc(s.transactions.createdAt)).limit(300),
    ctx.tx.select({ id: s.accounts.id, name: s.accounts.name }).from(s.accounts),
    ctx.tx.select({ id: s.categories.id, name: s.categories.name, kind: s.categories.kind, color: s.categories.color, icon: s.categories.icon }).from(s.categories).where(isNull(s.categories.archivedAt)).orderBy(s.categories.sortOrder),
    ctx.tx.select().from(s.txReconciliations).where(and(eq(s.txReconciliations.kind, "duplicate"), sql`${s.txReconciliations.status} in ('suggested','auto_merged')`, gte(s.txReconciliations.createdAt, new Date(Date.now() - 60 * 86400000)))).orderBy(desc(s.txReconciliations.createdAt)).limit(100),
    ctx.tx.select({ transactionId: s.documents.transactionId }).from(s.documents).where(sql`${s.documents.transactionId} is not null`),
  ]);
  const accName = new Map(accs.map((a) => [a.id, a.name]));
  const withDoc = new Set(docs.map((d) => d.transactionId));
  const view = (r: typeof s.transactions.$inferSelect): ReviewTx => ({
    id: r.id, date: r.date, amount: r.amount, kind: r.kind, status: r.status, bankStatus: r.bankStatus, description: r.description, bankLabel: r.bankLabel, merchant: r.merchant,
    accountId: r.accountId, accountName: accName.get(r.accountId) ?? "Compte", categoryId: r.categoryId, categorySource: r.categorySource, confidence: r.categoryConfidence, verified: !!r.verifiedAt, notes: r.notes, hasDocument: withDoc.has(r.id),
    toAccountId: r.toAccountId, tags: r.tags, paymentMethod: r.paymentMethod, time: r.time, refundOfId: r.refundOfId,
  });
  const pairIds = [...new Set(recos.flatMap((r) => [r.keptTxId, r.otherTxId]).filter((x): x is string => !!x))];
  const pairRows = pairIds.length ? await ctx.tx.select().from(s.transactions).where(inArray(s.transactions.id, pairIds)) : [];
  const byId = new Map(pairRows.map((r) => [r.id, view(r)]));
  const duplicates = recos.filter((r) => r.status === "suggested" && r.keptTxId && r.otherTxId && byId.has(r.keptTxId) && byId.has(r.otherTxId)).map((r) => ({ id: r.id, score: r.score ?? 0, bank: byId.get(r.keptTxId!)!, manual: byId.get(r.otherTxId!)! }));
  const autoMerged = recos.filter((r) => r.status === "auto_merged" && r.keptTxId && byId.has(r.keptTxId)).map((r) => ({ id: r.id, tx: byId.get(r.keptTxId!)!, manual: (r.snapshot as { manual?: { description?: string | null; date?: string } }).manual ?? {} }));
  const rules = await ctx.tx.select().from(s.merchantRules).orderBy(desc(s.merchantRules.createdAt));
  return { txs: rows.map(view), accounts: accs, categories: cats, duplicates, autoMerged, suggestions: await suggestedRules(ctx), rules: rules.map((r) => ({ id: r.id, pattern: r.pattern, categoryId: r.categoryId })) };
}

/**
 * Révoque tout accès bancaire de l'utilisateur : suppression de l'utilisateur chez Powens (toutes ses connexions),
 * puis du jeton local. Utilisé par « Tout effacer » et la suppression du compte MONETA.
 */
export async function revokeBankAccess(ctx: Ctx) {
  const [u] = await ctx.tx.select().from(s.bankUsers);
  if (!u) return;
  const cfg = powensConfig();
  if (cfg) {
    try {
      await new PowensClient(cfg).deleteUser(decryptSecret(u.accessTokenEnc));
    } catch (e) {
      if (!(e instanceof PowensError && (e.status === 404 || e.status === 401))) throw new ServiceError("La révocation de l'accès bancaire chez l'agrégateur a échoué. Réessaie dans quelques minutes : rien n'a été supprimé.");
    }
  } else {
    console.warn("[bank] Powens non configuré : l'utilisateur agrégateur n'a pas pu être supprimé à distance", ctx.userId);
  }
  await ctx.tx.delete(s.bankUsers);
  await audit(ctx, "bank.access_revoked", "bank_user", ctx.userId);
}
