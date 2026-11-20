import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { runAsUser } from "@/server/services/context";
import { generateNotifications } from "@/server/services/notifications";
import { purgeOldDemoAccounts } from "@/server/services/user";
import { purgeExpiredSessions } from "@/server/auth/session";
import { lt, sql } from "drizzle-orm";

/** Tâche quotidienne : notifications (dont bilans), nettoyage des sessions, jetons et espaces de démo expirés. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  await purgeExpiredSessions();
  await purgeOldDemoAccounts();
  await getDb().delete(s.passwordResetTokens).where(lt(s.passwordResetTokens.expiresAt, new Date()));
  await getDb().delete(s.rateLimits).where(sql`${s.rateLimits.windowStart} < now() - interval '1 day'`);
  const users = await getDb().select().from(s.users);
  let created = 0;
  for (const u of users) {
    try {
      created += await runAsUser(u, (ctx) => generateNotifications(ctx));
    } catch (e) {
      console.error("[cron] notifications", u.id, e);
    }
  }
  return NextResponse.json({ ok: true, users: users.length, notifications: created });
}
