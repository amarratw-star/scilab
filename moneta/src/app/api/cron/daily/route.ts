import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { runAsUser } from "@/server/services/context";
import { generateNotifications } from "@/server/services/notifications";
import { purgeOldDemoAccounts } from "@/server/services/user";
import { purgeExpiredSessions } from "@/server/auth/session";
import { lt, sql } from "drizzle-orm";
import { withCurrency } from "@/server/currency";
import { powensConfig } from "@/server/bank/client";
import { pullSync } from "@/server/bank/service";

/** Tâche quotidienne : notifications (dont bilans), nettoyage, synchronisation bancaire de secours. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  await purgeExpiredSessions();
  await purgeOldDemoAccounts();
  await getDb().delete(s.passwordResetTokens).where(lt(s.passwordResetTokens.expiresAt, new Date()));
  await getDb().delete(s.webhookEvents).where(sql`${s.webhookEvents.receivedAt} < now() - interval '90 days'`);
  await getDb().delete(s.rateLimits).where(sql`${s.rateLimits.windowStart} < now() - interval '1 day'`);
  const users = await getDb().select().from(s.users);
  let created = 0;
  for (const u of users) {
    try {
      created += await withCurrency(u.currency, () => runAsUser(u, (ctx) => generateNotifications(ctx)));
    } catch (e) {
      console.error("[cron] notifications", u.id, e);
    }
  }
  // Synchronisation bancaire de secours : uniquement si aucune mise à jour (webhook) depuis plus de 26 h
  let bankSynced = 0;
  if (powensConfig()) {
    const stale = await getDb().execute(sql`select user_id from bank_stale_users()`) as unknown as { user_id: string }[];
    for (const row of stale) {
      const u = users.find((x) => x.id === row.user_id);
      if (!u || u.isDemo || u.settings.bank?.autoSync === false) continue;
      try {
        await withCurrency(u.currency, () => runAsUser(u, (ctx) => pullSync(ctx, "scheduled")));
        bankSynced++;
      } catch (e) {
        console.error("[cron] bank", u.id, (e as Error).message);
      }
    }
  }
  return NextResponse.json({ ok: true, users: users.length, notifications: created, bankSynced });
}
