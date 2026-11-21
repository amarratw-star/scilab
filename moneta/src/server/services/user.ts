import "server-only";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { hashPassword, verifyPassword, dummyVerify } from "@/server/auth/password";
import { randomToken, sha256Hex } from "@/server/crypto";
import { runAsUser, audit, ServiceError, type Ctx } from "./context";
import { ensureDefaultCategories } from "./categories";
import { sendMail } from "@/server/mail";
import { revokeBankAccess } from "@/server/bank/service";

export async function findUserByEmail(email: string) {
  const [u] = await getDb().select().from(s.users).where(sql`lower(${s.users.email}) = ${email.toLowerCase()}`);
  return u ?? null;
}

export async function registerUser(input: { email: string; password: string; displayName: string; isDemo?: boolean }) {
  if (await findUserByEmail(input.email)) throw new ServiceError("Un compte existe déjà avec cette adresse e-mail.", { email: "Adresse déjà utilisée" });
  const passwordHash = await hashPassword(input.password);
  const [user] = await getDb()
    .insert(s.users)
    .values({ email: input.email.toLowerCase(), passwordHash, displayName: input.displayName, isDemo: input.isDemo ?? false })
    .returning();
  await runAsUser(user, async (ctx) => {
    await ensureDefaultCategories(ctx);
    await audit(ctx, "auth.register", "user", user.id);
  });
  return user;
}

export async function authenticate(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user) {
    await dummyVerify(password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    await runAsUser(user, (ctx) => audit(ctx, "auth.login_failed", "user", user.id));
    return null;
  }
  await runAsUser(user, (ctx) => audit(ctx, "auth.login", "user", user.id));
  return user;
}

export async function changePassword(userId: string, current: string, next: string) {
  const [user] = await getDb().select().from(s.users).where(eq(s.users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, current))) throw new ServiceError("Mot de passe actuel incorrect", { current: "Mot de passe incorrect" });
  await getDb().update(s.users).set({ passwordHash: await hashPassword(next), updatedAt: new Date() }).where(eq(s.users.id, userId));
  await runAsUser(user, (ctx) => audit(ctx, "auth.password_change", "user", userId));
}

/** Demande de réinitialisation : réponse identique que l'adresse existe ou non (pas d'énumération). */
export async function requestPasswordReset(email: string, appUrl: string) {
  const user = await findUserByEmail(email);
  if (!user || user.isDemo) return;
  const token = randomToken(32);
  await getDb().insert(s.passwordResetTokens).values({ tokenHash: sha256Hex(token), userId: user.id, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  const link = `${appUrl.replace(/\/$/, "")}/reinitialiser?token=${encodeURIComponent(token)}`;
  const sent = await sendMail({
    to: user.email,
    subject: "MONETA — réinitialisation de ton mot de passe",
    text: `Bonjour ${user.displayName},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore ce message.`,
  });
  if (!sent && process.env.NODE_ENV !== "production") {
    // En développement sans SMTP : le lien est affiché dans la console du serveur uniquement.
    console.info(`[MONETA] SMTP non configuré — lien de réinitialisation pour ${user.email} : ${link}`);
  } else if (!sent) {
    console.error("[MONETA] SMTP non configuré : impossible d'envoyer l'e-mail de réinitialisation.");
  }
  await runAsUser(user, (ctx) => audit(ctx, "auth.reset_requested", "user", user.id));
}

export async function resetPassword(token: string, password: string) {
  const hash = sha256Hex(token);
  const db = getDb();
  const [row] = await db
    .select()
    .from(s.passwordResetTokens)
    .where(and(eq(s.passwordResetTokens.tokenHash, hash), isNull(s.passwordResetTokens.usedAt), gt(s.passwordResetTokens.expiresAt, new Date())));
  if (!row) throw new ServiceError("Lien invalide ou expiré. Refais une demande de réinitialisation.");
  await db.transaction(async (t) => {
    await t.update(s.passwordResetTokens).set({ usedAt: new Date() }).where(eq(s.passwordResetTokens.tokenHash, hash));
    await t.update(s.users).set({ passwordHash: await hashPassword(password), updatedAt: new Date() }).where(eq(s.users.id, row.userId));
    await t.delete(s.sessions).where(eq(s.sessions.userId, row.userId)); // déconnecte toutes les sessions
  });
  const [user] = await db.select().from(s.users).where(eq(s.users.id, row.userId));
  await runAsUser(user, (ctx) => audit(ctx, "auth.password_reset", "user", user.id));
}

export async function updateProfile(ctx: Ctx, input: { displayName: string; currency: string; timezone: string; safetyCushion: number; monthlySavingsTarget: number }) {
  await ctx.tx
    .update(s.users)
    .set({
      displayName: input.displayName,
      currency: input.currency,
      timezone: input.timezone,
      settings: sql`settings || ${JSON.stringify({ safetyCushion: input.safetyCushion, monthlySavingsTarget: input.monthlySavingsTarget })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(s.users.id, ctx.userId));
  await audit(ctx, "user.update", "user", ctx.userId);
}

export async function updateSettingsJson(ctx: Ctx, patch: Partial<s.UserSettings>) {
  await ctx.tx
    .update(s.users)
    .set({ settings: sql`settings || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(eq(s.users.id, ctx.userId));
}

/** Suppression définitive du compte et de TOUTES les données (cascade). */
export async function deleteUserAccount(userId: string, password: string | null) {
  const [user] = await getDb().select().from(s.users).where(eq(s.users.id, userId));
  if (!user) return;
  if (!user.isDemo && !(password && (await verifyPassword(user.passwordHash, password)))) throw new ServiceError("Mot de passe incorrect", { password: "Mot de passe incorrect" });
  await runAsUser(user, (ctx) => revokeBankAccess(ctx)); // supprime aussi l'utilisateur chez l'agrégateur bancaire
  await getDb().delete(s.users).where(eq(s.users.id, userId));
}

/** Nettoyage des espaces de démonstration temporaires de plus de 48 h. */
export async function purgeOldDemoAccounts() {
  await getDb().delete(s.users).where(and(eq(s.users.isDemo, true), lt(s.users.createdAt, new Date(Date.now() - 48 * 3600 * 1000))));
}

/** Export complet des données personnelles (droit d'accès et de portabilité — RGPD art. 15 et 20). */
export async function exportAllData(ctx: Ctx) {
  const t = ctx.tx;
  const [user] = await t.select().from(s.users).where(eq(s.users.id, ctx.userId));
  const { passwordHash: _p, ...profile } = user;
  const [bankConnections, bankAccountLinks, merchantRules, reconciliations, syncRuns] = await Promise.all([
    t.select({ id: s.bankConnections.id, provider: s.bankConnections.provider, connectorName: s.bankConnections.connectorName, status: s.bankConnections.status, state: s.bankConnections.state, lastSyncAt: s.bankConnections.lastSyncAt, createdAt: s.bankConnections.createdAt }).from(s.bankConnections),
    t.select({ accountId: s.bankAccountLinks.accountId, connectionId: s.bankAccountLinks.connectionId, externalName: s.bankAccountLinks.externalName, ibanMasked: s.bankAccountLinks.ibanMasked, bankBalance: s.bankAccountLinks.bankBalance, balanceAt: s.bankAccountLinks.balanceAt, syncEnabled: s.bankAccountLinks.syncEnabled }).from(s.bankAccountLinks),
    t.select().from(s.merchantRules),
    t.select().from(s.txReconciliations),
    t.select().from(s.syncRuns),
  ]);
  const [accounts, categories, transactions, recurring, budgets, goals, contributions, wealthItems, wealthValuations, notifications, auditLog, documents] = await Promise.all([
    t.select().from(s.accounts),
    t.select().from(s.categories),
    t.select().from(s.transactions),
    t.select().from(s.recurringItems),
    t.select().from(s.budgets),
    t.select().from(s.goals),
    t.select().from(s.goalContributions),
    t.select().from(s.wealthItems),
    t.select().from(s.wealthValuations),
    t.select().from(s.notifications),
    t.select().from(s.auditLog),
    t.select().from(s.documents),
  ]);
  await audit(ctx, "data.export", "user", ctx.userId);
  return {
    format: "moneta-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    notice: "Montants exprimés en centimes (entiers). Documents encodés en base64.",
    profile,
    accounts,
    categories,
    transactions,
    recurring,
    budgets,
    goals,
    goalContributions: contributions,
    wealthItems,
    wealthValuations,
    notifications,
    auditLog,
    documents: documents.map((d) => ({ ...d, data: Buffer.from(d.data).toString("base64") })),
    bank: { notice: "Aucun jeton ni identifiant bancaire n'est exporté.", connections: bankConnections, accountLinks: bankAccountLinks, merchantRules, reconciliations, syncRuns },
  };
}
