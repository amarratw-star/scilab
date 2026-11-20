/**
 * Applique les migrations SQL (dossier ./drizzle) avec le rôle propriétaire.
 * Usage : MIGRATION_DATABASE_URL=... npm run db:migrate
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL (ou DATABASE_URL) doit être défini.");
  const client = postgres(url, { max: 1, onnotice: (n) => console.log("NOTICE:", n.message) });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrations appliquées.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
