/**
 * Connecteur d'agrégation bancaire DSP2 — Powens (ex-Budget Insight).
 *
 * ⚠️ Nécessite un contrat avec Powens et les variables POWENS_DOMAIN, POWENS_CLIENT_ID,
 * POWENS_CLIENT_SECRET et APP_ENCRYPTION_KEY. Sans elles, aucune connexion n'est proposée
 * et l'interface l'indique clairement. Ce module n'a PAS pu être testé contre l'API réelle
 * faute d'identifiants : il suit la documentation publique de l'API Powens v2.0.
 *
 * Sécurité : MONETA ne demande ni ne stocke JAMAIS les identifiants bancaires. L'utilisateur
 * s'authentifie auprès de sa banque dans la webview Powens (consentement DSP2) ; seul un jeton
 * d'accès Powens est conservé, chiffré en AES-256-GCM.
 */
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { features } from "@/server/env";
import { audit, ServiceError, type Ctx } from "@/server/services/context";
import { addDays } from "@/lib/dates";

export interface BankProvider {
  id: string;
  name: string;
  isConfigured(): boolean;
}

function base() {
  return `https://${process.env.POWENS_DOMAIN}.biapi.pro/2.0`;
}

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ServiceError(`Erreur Powens (${res.status})`);
  return (await res.json()) as T;
}

export const powens: BankProvider = {
  id: "powens",
  name: "Powens (agrégateur agréé DSP2)",
  isConfigured: () => features.bank(),
};

/** Étape 1 : crée l'utilisateur Powens (jeton permanent chiffré) et retourne l'URL de la webview de consentement. */
export async function startConnection(ctx: Ctx, appUrl: string): Promise<string> {
  if (!powens.isConfigured()) throw new ServiceError("La connexion bancaire n'est pas configurée sur ce serveur.");
  const init = await api<{ auth_token: string; id_user: number }>("/auth/init", {
    method: "POST",
    body: JSON.stringify({ client_id: process.env.POWENS_CLIENT_ID, client_secret: process.env.POWENS_CLIENT_SECRET }),
  });
  const [conn] = await ctx.tx
    .insert(s.bankConnections)
    .values({ userId: ctx.userId, provider: "powens", externalUserId: String(init.id_user), accessTokenEnc: encryptSecret(init.auth_token), status: "pending" })
    .returning();
  const { code } = await api<{ code: string }>("/auth/token/code", { token: init.auth_token });
  await audit(ctx, "bank.connect_start", "bank_connection", conn.id);
  const params = new URLSearchParams({
    domain: `${process.env.POWENS_DOMAIN}.biapi.pro`,
    client_id: process.env.POWENS_CLIENT_ID!,
    redirect_uri: `${appUrl.replace(/\/$/, "")}/api/bank/callback`,
    code,
    state: conn.id,
  });
  return `https://webview.powens.com/connect?${params.toString()}`;
}

type PowensAccount = { id: number; name: string; balance: number | null; type: string; currency?: { id: string }; disabled?: boolean };
type PowensTx = { id: number; id_account: number; date: string; value: number; original_wording?: string; wording?: string; simplified_wording?: string; coming: boolean; deleted?: string | null };

const TYPE_MAP: Record<string, (typeof s.accountTypeEnum.enumValues)[number]> = {
  checking: "checking",
  card: "checking",
  savings: "savings",
  deposit: "savings",
  market: "investment",
  pea: "investment",
  lifeinsurance: "placement",
  pee: "placement",
  perco: "placement",
  per: "placement",
};

/** Étape 2 : synchronise comptes et opérations (déduplication par identifiant Powens). */
export async function syncConnection(ctx: Ctx, connectionId: string) {
  const [conn] = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.id, connectionId));
  if (!conn || !conn.accessTokenEnc) throw new ServiceError("Connexion bancaire introuvable");
  const token = decryptSecret(conn.accessTokenEnc);
  try {
    const { accounts } = await api<{ accounts: PowensAccount[] }>("/users/me/accounts", { token });
    const links = await ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.connectionId, conn.id));
    const linkMap = new Map(links.map((l) => [l.externalAccountId, l.accountId]));
    const minDate = conn.lastSyncAt ? addDays(conn.lastSyncAt.toISOString().slice(0, 10), -10) : addDays(ctx.today, -90);
    const { transactions } = await api<{ transactions: PowensTx[] }>(`/users/me/transactions?min_date=${minDate}&limit=1000`, { token });
    let imported = 0;
    for (const acc of accounts.filter((a) => !a.disabled)) {
      const ext = String(acc.id);
      const txs = transactions.filter((t) => t.id_account === acc.id && !t.coming && !t.deleted);
      let localId = linkMap.get(ext);
      if (!localId) {
        // Solde initial calculé pour que le solde MONETA corresponde au solde bancaire réel.
        const sum = txs.reduce((sum, t) => sum + Math.round(t.value * 100), 0);
        const balance = Math.round((acc.balance ?? 0) * 100);
        const [created] = await ctx.tx
          .insert(s.accounts)
          .values({ userId: ctx.userId, name: acc.name, institution: "Synchronisé via Powens", type: TYPE_MAP[acc.type] ?? "other", currency: acc.currency?.id ?? "EUR", initialBalance: balance - sum, openedOn: minDate })
          .returning();
        await ctx.tx.insert(s.bankAccountLinks).values({ userId: ctx.userId, connectionId: conn.id, externalAccountId: ext, accountId: created.id });
        localId = created.id;
      }
      const hashes = txs.map((t) => `powens:${t.id}`);
      const existing = hashes.length
        ? new Set((await ctx.tx.select({ h: s.transactions.importHash }).from(s.transactions).where(and(eq(s.transactions.accountId, localId), inArray(s.transactions.importHash, hashes)))).map((r) => r.h))
        : new Set();
      const values = txs
        .filter((t) => !existing.has(`powens:${t.id}`) && t.value !== 0)
        .map((t) => ({
          userId: ctx.userId,
          kind: (t.value < 0 ? "expense" : "income") as "expense" | "income",
          status: "posted" as const,
          amount: Math.abs(Math.round(t.value * 100)),
          accountId: localId!,
          date: t.date.slice(0, 10),
          description: t.simplified_wording || t.wording || t.original_wording || "Opération bancaire",
          source: "bank" as const,
          importHash: `powens:${t.id}`,
        }));
      if (values.length) await ctx.tx.insert(s.transactions).values(values);
      imported += values.length;
    }
    await ctx.tx.update(s.bankConnections).set({ status: "active", lastSyncAt: new Date(), lastError: null }).where(eq(s.bankConnections.id, conn.id));
    await audit(ctx, "bank.sync", "bank_connection", conn.id, { imported });
    return { imported, accounts: accounts.length };
  } catch (e) {
    await ctx.tx.update(s.bankConnections).set({ status: "error", lastError: (e as Error).message.slice(0, 300) }).where(eq(s.bankConnections.id, conn.id));
    throw e;
  }
}

export async function revokeConnection(ctx: Ctx, connectionId: string) {
  const [conn] = await ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.id, connectionId));
  if (!conn) throw new ServiceError("Connexion introuvable");
  if (conn.accessTokenEnc && powens.isConfigured()) {
    try {
      await api("/users/me", { method: "DELETE", token: decryptSecret(conn.accessTokenEnc) });
    } catch {
      // la révocation locale prime
    }
  }
  await ctx.tx.update(s.bankConnections).set({ status: "revoked", accessTokenEnc: null }).where(eq(s.bankConnections.id, conn.id));
  await audit(ctx, "bank.revoke", "bank_connection", conn.id);
}
