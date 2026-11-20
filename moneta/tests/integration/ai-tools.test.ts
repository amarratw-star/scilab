/** Outils du conseiller IA : exécutés sur des données de démonstration, sans appel à l'API (déterministes). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

process.env.DATABASE_URL ??= "postgres://moneta_app:moneta_app_dev@localhost:5432/moneta_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_test";

const { closeDb } = await import("@/server/db");
const { runAsUser } = await import("@/server/services/context");
const { registerUser } = await import("@/server/services/user");
const { seedDemoData } = await import("@/server/services/demo");
const { loadFinance } = await import("@/server/services/snapshot");
const { AI_TOOLS, runTool } = await import("@/server/ai/tools");

type User = Awaited<ReturnType<typeof registerUser>>;
let user: User;
const TODAY = "2026-03-20";

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin`delete from users where email = 'ai-tools@test.local'`;
  await admin.end();
  user = await registerUser({ email: "ai-tools@test.local", password: "motdepasse123", displayName: "IA", isDemo: true });
  await runAsUser(user, (ctx) => seedDemoData(ctx), TODAY);
});
afterAll(() => closeDb());

const INPUTS: Record<string, Record<string, unknown>> = {
  get_period_stats: { preset: "last_month" },
  compare_periods: { preset: "this_month" },
  monthly_history: { months: 6 },
  search_transactions: { query: "démo", limit: 5 },
  simulate_purchase: { price_euros: 900 },
  savings_plan: { target_euros: 3000, months: 12 },
  forecast: { days: 30 },
  propose_transaction: { kind: "expense", amount_euros: 12.5, description: "Test proposition", category: "Restaurants" },
};

describe("outils du conseiller IA", () => {
  it("chaque outil déclaré s'exécute et renvoie un résultat sérialisable", async () => {
    const fin = await runAsUser(user, (ctx) => loadFinance(ctx), TODAY);
    for (const tool of AI_TOOLS) {
      const out = await runTool(tool.name, INPUTS[tool.name] ?? {}, fin, TODAY, {}, []);
      expect(() => JSON.stringify(out), tool.name).not.toThrow();
      expect(JSON.stringify(out), tool.name).not.toContain('"error"');
    }
  });
  it("propose_transaction n'enregistre rien en base", async () => {
    const before = (await runAsUser(user, (ctx) => loadFinance(ctx), TODAY)).txs.length;
    const fin = await runAsUser(user, (ctx) => loadFinance(ctx), TODAY);
    const proposals: unknown[] = [];
    await runTool("propose_transaction", INPUTS.propose_transaction, fin, TODAY, {}, proposals as never);
    expect(proposals).toHaveLength(1);
    const after = (await runAsUser(user, (ctx) => loadFinance(ctx), TODAY)).txs.length;
    expect(after).toBe(before);
  });
  it("une catégorie inconnue est signalée au lieu d'être inventée", async () => {
    const fin = await runAsUser(user, (ctx) => loadFinance(ctx), TODAY);
    const out = (await runTool("get_period_stats", { preset: "this_month", category: "Licornes" }, fin, TODAY, {}, [])) as { error?: string };
    expect(out.error).toMatch(/introuvable/);
  });
  it("le simulateur d'achat chiffre l'impact sans inventer de revenus", async () => {
    const fin = await runAsUser(user, (ctx) => loadFinance(ctx), TODAY);
    const out = (await runTool("simulate_purchase", { price_euros: 1200 }, fin, TODAY, { safetyCushion: 50000 }, [])) as { verdict: string; explications: string[] };
    expect(out.verdict).toBeTruthy();
    expect(out.explications.join(" ")).toMatch(/Solde disponible actuel/);
  });
});
