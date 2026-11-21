/**
 * Réception des webhooks Powens. Vérifications (doc officielle « Webhooks ») :
 *  - Signature HMAC si POWENS_WEBHOOK_SECRET est défini :
 *      BI-Signature = BASE64(HMAC_SHA256("POST" + "." + <chemin> + "." + <BI-Signature-Date> + "." + <corps brut>, secret))
 *    avec une date à ±10 min (anti-rejeu) ;
 *  - jeton utilisateur dans `Authorization: Bearer …`, comparé au jeton chiffré de l'utilisateur concerné.
 *  Au moins l'un des deux est exigé ; si un secret HMAC est configuré, la signature est obligatoire.
 *  - Déduplication par `id_webhook_data` (table webhook_events) ; reprise limitée à 5 tentatives.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto";
import { runAsUser } from "@/server/services/context";
import { ingestConnection } from "./ingest";
import { notifyAfterSync } from "./service";
import type { PowensAccount, PowensConnection, PowensTransaction } from "./client";

export const HANDLED_EVENTS = ["CONNECTION_SYNCED", "CONNECTION_DELETED", "ACCOUNT_DISABLED", "ACCOUNT_ENABLED", "USER_DELETED"] as const;
const MAX_ATTEMPTS = 5;

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function computeSignature(secret: string, method: string, endpoint: string, date: string, payload: string) {
  return createHmac("sha256", secret).update(`${method.toUpperCase()}.${endpoint}.${date}.${payload}`).digest("base64");
}

export function verifyHmac(headers: Headers, path: string, pathWithQuery: string, payload: string, secret: string, now = Date.now()): boolean {
  const sig = headers.get("bi-signature");
  const date = headers.get("bi-signature-date");
  if (!sig || !date) return false;
  const t = Date.parse(date.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(date) ? date : `${date}Z`);
  if (!Number.isFinite(t) || Math.abs(now - t) > 10 * 60_000) return false;
  return [path, pathWithQuery].some((ep) => safeEqual(computeSignature(secret, "POST", ep, date, payload), sig));
}

export function decodeBody(raw: Buffer, encoding: string | null): string {
  if ((encoding ?? "").toLowerCase().includes("gzip") || (raw[0] === 0x1f && raw[1] === 0x8b)) return gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8");
  return raw.toString("utf8");
}

function externalUserId(event: string, body: Record<string, unknown>): string | null {
  const user = body.user as { id?: number } | undefined;
  const conn = (body.connection ?? (event.startsWith("CONNECTION") ? body : undefined)) as { id_user?: number } | undefined;
  const acc = event.startsWith("ACCOUNT") ? (body as { id_user?: number }) : undefined;
  const id = user?.id ?? conn?.id_user ?? acc?.id_user ?? (event === "USER_DELETED" ? (body as { id?: number }).id : undefined);
  return id === undefined || id === null ? null : String(id);
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

export async function handlePowensWebhook(input: { event: string | null; headers: Headers; rawBody: Buffer; path: string; pathWithQuery: string }): Promise<WebhookResult> {
  let text: string;
  let body: Record<string, unknown>;
  try {
    text = decodeBody(input.rawBody, input.headers.get("content-encoding"));
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    return { status: 400, body: { error: "Corps invalide" } };
  }
  // Chaque webhook est enregistré par événement dans la console Powens (URL avec ?event=…) ; à défaut, déduction prudente
  const event = (input.event ?? (body.connection && (body.connection as { accounts?: unknown }).accounts ? "CONNECTION_SYNCED" : "")).toUpperCase();
  const webhookId = body.id_webhook_data;
  if (!event || (typeof webhookId !== "number" && typeof webhookId !== "string")) return { status: 400, body: { error: "Événement ou id_webhook_data manquant" } };

  // Authenticité
  const secret = process.env.POWENS_WEBHOOK_SECRET;
  if (secret && !verifyHmac(input.headers, input.path, input.pathWithQuery, text, secret)) return { status: 401, body: { error: "Signature invalide" } };
  const extUser = externalUserId(event, body);
  let userId: string | null = null;
  if (extUser) {
    const rows = (await getDb().execute(sql`select user_id, access_token_enc from bank_user_lookup('powens', ${extUser})`)) as unknown as { user_id: string; access_token_enc: string }[];
    const found = rows[0];
    const bearer = (input.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (found) {
      const tokenOk = bearer ? safeEqual(bearer, decryptSecret(found.access_token_enc)) : false;
      if (!secret && !tokenOk) return { status: 401, body: { error: "Jeton invalide" } };
      if (bearer && !tokenOk) return { status: 401, body: { error: "Jeton invalide" } };
      userId = found.user_id;
    } else if (!secret) return { status: 401, body: { error: "Utilisateur inconnu" } };
  } else if (!secret) return { status: 401, body: { error: "Authentification impossible" } };

  // Idempotence
  const id = `powens:${webhookId}`;
  const db = getDb();
  await db.insert(s.webhookEvents).values({ id, event, userId }).onConflictDoNothing();
  const [rec] = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.id, id));
  if (rec.status === "processed" || rec.status === "ignored") return { status: 200, body: { ok: true, duplicate: true } };
  if (rec.attempts >= MAX_ATTEMPTS) return { status: 200, body: { ok: false, abandoned: true } };
  const claimed = await db.update(s.webhookEvents).set({ attempts: rec.attempts + 1 }).where(and(eq(s.webhookEvents.id, id), eq(s.webhookEvents.attempts, rec.attempts))).returning();
  if (!claimed.length) return { status: 200, body: { ok: true, concurrent: true } };

  if (!userId || !(HANDLED_EVENTS as readonly string[]).includes(event)) {
    await db.update(s.webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(s.webhookEvents.id, id));
    return { status: 200, body: { ok: true, ignored: true } };
  }
  const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!user || user.isDemo) {
    await db.update(s.webhookEvents).set({ status: "ignored", processedAt: new Date() }).where(eq(s.webhookEvents.id, id));
    return { status: 200, body: { ok: true, ignored: true } };
  }
  try {
    await runAsUser(user, async (ctx) => {
      if (event === "CONNECTION_SYNCED") {
        const conn = body.connection as PowensConnection | undefined;
        if (!conn || typeof conn.id !== "number") throw new Error("Charge CONNECTION_SYNCED incomplète");
        const accounts = (conn.accounts ?? []) as PowensAccount[];
        const txs = accounts.flatMap((a) => (a.transactions ?? []).map((t) => ({ ...t, id_account: t.id_account ?? a.id }))) as PowensTransaction[];
        const st = await ingestConnection(ctx, conn, accounts, txs, "webhook");
        await notifyAfterSync(ctx, st);
      } else if (event === "CONNECTION_DELETED") {
        const extId = String((body.connection as { id?: number } | undefined)?.id ?? body.id ?? "");
        await ctx.tx.update(s.bankConnections).set({ status: "revoked", state: null, updatedAt: new Date() }).where(eq(s.bankConnections.externalConnectionId, extId));
      } else if (event === "ACCOUNT_DISABLED" || event === "ACCOUNT_ENABLED") {
        const extAcc = String((body as { id?: number }).id ?? "");
        await ctx.tx.update(s.bankAccountLinks).set({ disabledAtBank: event === "ACCOUNT_DISABLED" }).where(eq(s.bankAccountLinks.externalAccountId, extAcc));
      } else if (event === "USER_DELETED") {
        await ctx.tx.delete(s.bankUsers);
        await ctx.tx.update(s.bankConnections).set({ status: "revoked" });
      }
    });
    await db.update(s.webhookEvents).set({ status: "processed", processedAt: new Date(), error: null }).where(eq(s.webhookEvents.id, id));
    return { status: 200, body: { ok: true } };
  } catch (e) {
    await db.update(s.webhookEvents).set({ status: "error", error: (e as Error).message.slice(0, 300) }).where(eq(s.webhookEvents.id, id));
    // 5xx → Powens retentera (flusher) ; au-delà de 5 tentatives, l'événement est abandonné et journalisé
    return { status: 500, body: { error: "Traitement impossible, nouvelle tentative attendue" } };
  }
}
