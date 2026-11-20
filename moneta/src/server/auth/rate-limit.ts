import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";

/**
 * Limitation de débit à fenêtre fixe stockée en base (fonctionne sur plusieurs instances serverless).
 * Retourne true si la requête est autorisée.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await getDb().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count
  `);
  const count = Number((rows as unknown as { count: number }[])[0]?.count ?? 0);
  // RATE_LIMIT_MULTIPLIER permet d'assouplir les limites en test de bout en bout (1 en production).
  const multiplier = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER ?? 1) || 1);
  return count <= limit * multiplier;
}

export async function resetRateLimit(key: string) {
  await getDb().execute(sql`delete from rate_limits where key = ${key}`);
}
