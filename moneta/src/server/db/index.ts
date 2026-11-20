import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Connexion PostgreSQL avec le rôle d'exécution `moneta_app` (sans BYPASSRLS).
 * Toute lecture/écriture de données financières passe par `withUser`, qui ouvre une transaction
 * et positionne `app.user_id` : les politiques RLS filtrent alors automatiquement les lignes.
 */
type DB = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __monetaSql?: postgres.Sql; __monetaDb?: DB };

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas défini. Copiez .env.example vers .env.");
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    prepare: process.env.DATABASE_DISABLE_PREPARE === "true" ? false : true,
    onnotice: () => {},
  });
  return { client, db: drizzle(client, { schema }) };
}

export function getDb(): DB {
  if (!globalForDb.__monetaDb) {
    const { client, db } = create();
    globalForDb.__monetaSql = client;
    globalForDb.__monetaDb = db;
  }
  return globalForDb.__monetaDb!;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exécute `fn` dans une transaction où seules les données de `userId` sont visibles. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("Identifiant utilisateur invalide");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  await globalForDb.__monetaSql?.end({ timeout: 5 });
  globalForDb.__monetaSql = undefined;
  globalForDb.__monetaDb = undefined;
}

export { schema };
