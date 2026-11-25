/**
 * Pré-déploiement (Railway ou tout hébergeur) — exécuté avant chaque mise en service :
 *  1. crée ou met à jour le rôle d'exécution `moneta_app` (LOGIN, SANS BYPASSRLS) avec MONETA_APP_PASSWORD ;
 *  2. applique les migrations SQL avec le rôle propriétaire (MIGRATION_DATABASE_URL).
 * JavaScript pur (aucune dépendance de développement) : fonctionne dans l'image de production.
 * Usage : MIGRATION_DATABASE_URL=… MONETA_APP_PASSWORD=… node scripts/predeploy.mjs
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.MONETA_APP_PASSWORD;
if (!url) throw new Error("MIGRATION_DATABASE_URL est requis (rôle propriétaire de la base).");

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  if (appPassword) {
    if (appPassword.length < 24) throw new Error("MONETA_APP_PASSWORD doit contenir au moins 24 caractères.");
    const [exists] = await sql`select 1 from pg_roles where rolname = 'moneta_app'`;
    // CREATE/ALTER ROLE n'accepte pas de paramètre lié : littéral SQL échappé (valeur issue de la configuration)
    const pw = appPassword.replace(/'/g, "''");
    if (!exists) await sql.unsafe(`create role moneta_app login password '${pw}' nosuperuser nobypassrls`);
    else await sql.unsafe(`alter role moneta_app login password '${pw}' nosuperuser nobypassrls`);
    const [{ db }] = await sql`select current_database() as db`;
    await sql.unsafe(`grant connect on database "${db.replace(/"/g, '""')}" to moneta_app`);
    console.log("Rôle moneta_app prêt (sans BYPASSRLS).");
  }
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("Migrations appliquées.");
} finally {
  await sql.end({ timeout: 5 });
}
