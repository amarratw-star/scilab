import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db";
import { sessions, users } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/crypto";
import { setRequestCurrency } from "@/server/currency";

export const SESSION_COOKIE = "moneta_session";
const SESSION_DAYS = 30;
const RENEW_AFTER_DAYS = 1;

export type SessionUser = typeof users.$inferSelect;

export async function clientInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** Crée une session : seul le hachage SHA-256 du jeton est stocké ; le jeton brut va dans un cookie httpOnly. */
export async function createSession(userId: string) {
  const token = randomToken(32);
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await getDb().insert(sessions).values({ id: sha256Hex(token), userId, expiresAt, ip, userAgent });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Utilisateur courant (mis en cache pour la durée de la requête). */
export const getCurrentSession = cache(async (): Promise<{ user: SessionUser; sessionId: string } | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const id = sha256Hex(token);
  const db = getDb();
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Renouvellement glissant et suivi d'activité (au plus une fois par jour)
  if (Date.now() - row.session.lastSeenAt.getTime() > RENEW_AFTER_DAYS * 86400000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) })
      .where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id };
});

export async function getCurrentUser() {
  return (await getCurrentSession())?.user ?? null;
}

/** À appeler dans toute page, action ou route privée. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  setRequestCurrency(user.currency);
  return user;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, sha256Hex(token)));
  jar.delete(SESSION_COOKIE);
}

export async function listSessions(userId: string) {
  return getDb().select().from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
}

export async function revokeSession(userId: string, sessionId: string) {
  await getDb().delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)));
}

export async function revokeOtherSessions(userId: string, keepSessionId: string) {
  await getDb().delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.id} <> ${keepSessionId}`));
}

export async function purgeExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
