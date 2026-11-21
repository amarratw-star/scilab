/**
 * Parcours essentiels de bout en bout (navigateur réel, serveur de production, base PostgreSQL réelle).
 */
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ADMIN = process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_e2e";
const stamp = Date.now();
const alice = { email: `alice-${stamp}@e2e.test`, password: "MotDePasse2026", name: "Alice" };
const bob = { email: `bob-${stamp}@e2e.test`, password: "AutreSecret2026", name: "Bob" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = postgres(ADMIN, { max: 1, onnotice: () => {} });
  await sql`truncate users, rate_limits cascade`;
  await sql.end();
});

async function register(page: Page, u: typeof alice) {
  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Prénom").fill(u.name);
  await page.getByLabel("Adresse e-mail").fill(u.email);
  await page.getByLabel("Mot de passe").fill(u.password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("**/bienvenue");
}

async function login(page: Page, u: typeof alice) {
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Adresse e-mail").fill(u.email);
  await page.locator("#password").fill(u.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));
  await page.waitForLoadState("networkidle");
}

async function quickAdd(page: Page, opts: { kind?: "Dépense" | "Revenu" | "Transfert"; amount: string; category?: string; description: string; account?: string; to?: string }) {
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Ajouter une opération/ }).first().click();
  const dialog = page.getByRole("dialog");
  if (opts.kind && opts.kind !== "Dépense") await dialog.getByRole("radio", { name: opts.kind }).click();
  await dialog.getByLabel("Montant", { exact: true }).fill(opts.amount);
  if (opts.category) await dialog.getByLabel("Catégorie").selectOption({ label: opts.category });
  if (opts.account) await dialog.locator("#account").selectOption({ label: opts.account });
  if (opts.to) await dialog.locator("#toAccount").selectOption({ label: opts.to });
  await dialog.getByLabel(/Description|Source/).fill(opts.description);
  await expect(dialog.getByLabel("Montant", { exact: true })).toHaveValue(opts.amount);
  await dialog.getByRole("button", { name: /^Enregistrer$/ }).click();
  await expect(dialog).toBeHidden();
}

test("pages privées protégées", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/connexion\?suite=%2Ftransactions/);
  const res = await page.request.get("/api/search?q=test");
  expect(res.status()).toBe(401);
});

test("inscription, premier compte et tableau de bord", async ({ page }) => {
  await register(page, alice);
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByLabel("Nom du compte").fill("Compte courant");
  await page.getByLabel("Solde initial").fill("1 500,00");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByRole("heading", { name: /Bonjour Alice/ })).toBeVisible();
  await expect(page.getByText("1 500,00 €").first()).toBeVisible();
});

test("ajout d'une dépense et d'un revenu : soldes et statistiques mis à jour", async ({ page }) => {
  await login(page, alice);
  await quickAdd(page, { amount: "42,50", category: "Restaurants", description: "Dîner test" });
  await quickAdd(page, { kind: "Revenu", amount: "2000", category: "Salaire", description: "Salaire test" });
  await page.goto("/comptes");
  await expect(page.getByText("3 457,50 €").first()).toBeVisible(); // 1500 − 42,50 + 2000
  await page.goto("/transactions");
  await expect(page.getByText("Dîner test")).toBeVisible();
  await expect(page.getByText("-42,50 €")).toBeVisible();
});

test("modification puis suppression d'une opération", async ({ page }) => {
  await login(page, alice);
  await page.goto("/transactions");
  await page.getByRole("button", { name: /Modifier Dîner test/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Montant", { exact: true }).fill("50");
  await dialog.getByRole("button", { name: "Enregistrer les modifications" }).click();
  await expect(page.getByText("-50,00 €")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.locator("div.group").filter({ hasText: "Dîner test" }).getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Supprimer" }).click();
  await expect(page.getByText("Dîner test")).toBeHidden();
  await page.goto("/comptes");
  await expect(page.getByText("3 500,00 €").first()).toBeVisible();
});

test("transfert entre comptes : ni dépense ni revenu", async ({ page }) => {
  await login(page, alice);
  await page.goto("/comptes");
  await page.getByRole("button", { name: "Nouveau compte" }).click();
  await page.getByLabel("Nom du compte").fill("Livret A");
  await page.getByLabel("Type").selectOption("savings");
  await page.getByLabel("Solde initial").fill("0");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await page.waitForURL(/\/comptes\/[0-9a-f-]{36}/);
  await quickAdd(page, { kind: "Transfert", amount: "300", account: "Compte courant", to: "Livret A", description: "Épargne du mois" });
  await page.goto("/comptes");
  await expect(page.getByText("3 200,00 €").first()).toBeVisible();
  await expect(page.getByText("300,00 €").first()).toBeVisible();
  await page.goto("/analyses");
  // Dépenses du mois : aucune (la dépense a été supprimée, le transfert n'en est pas une)
  await expect(page.locator("text=Total des dépenses").locator("..").locator("..")).toContainText("0,00 €");
});

test("budget mis à jour automatiquement", async ({ page }) => {
  await login(page, alice);
  await quickAdd(page, { amount: "80", category: "Restaurants", description: "Restaurant budget" });
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Nouveau budget" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Catégorie").selectOption({ label: "Restaurants" });
  await dialog.getByLabel("Montant", { exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Créer le budget" }).click();
  await expect(page.getByText("80,00 €").first()).toBeVisible();
  await expect(page.getByText(/80 % · À surveiller/)).toBeVisible();
});

test("objectif d'épargne et versement", async ({ page }) => {
  await login(page, alice);
  await page.goto("/epargne?nouveau=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de l'objectif").fill("Voyage");
  await dialog.getByLabel("Montant cible").fill("1000");
  await dialog.getByRole("button", { name: "Créer l'objectif" }).click();
  await expect(page.getByText("Voyage")).toBeVisible();
  await page.getByRole("button", { name: "Déposer" }).first().click();
  await page.getByRole("dialog").getByLabel("Montant", { exact: true }).fill("250");
  await page.getByRole("dialog").getByRole("button", { name: "Déposer" }).click();
  await expect(page.getByText("25 % · reste 750,00 €")).toBeVisible();
});

test("échéance récurrente : confirmation du paiement", async ({ page }) => {
  await login(page, alice);
  await page.goto("/abonnements");
  await page.getByRole("button", { name: "Nouvelle échéance" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nom").fill("Musique");
  await d.getByLabel("Montant", { exact: true }).fill("10,99");
  await d.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByText("Échéances à traiter")).toBeVisible();
  await page.getByRole("button", { name: "Payé" }).first().click();
  await expect(page.getByText("Échéance confirmée")).toBeVisible();
  await page.goto("/transactions");
  await expect(page.getByText("-10,99 €")).toBeVisible();
});

test("import CSV avec détection des doublons", async ({ page }) => {
  await login(page, alice);
  const file = path.join(os.tmpdir(), `releve-${stamp}.csv`);
  fs.writeFileSync(file, "Date;Libellé;Débit;Crédit\n02/11/2026;CB CARREFOUR MARKET;45,20;\n03/11/2026;VIR REMBOURSEMENT AMI;;20,00\n", "utf8");
  for (const round of [1, 2]) {
    await page.goto("/import");
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await page.getByRole("button", { name: "Prévisualiser l'import" }).click();
    if (round === 1) {
      await expect(page.getByText("Nouvelle").first()).toBeVisible();
      await page.getByRole("button", { name: "Importer", exact: true }).click();
      await expect(page.getByText("2 opération(s) importée(s)").first()).toBeVisible();
    } else {
      await expect(page.getByText("Déjà importée").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Importer", exact: true })).toBeDisabled();
    }
  }
});

test("exports CSV, PDF, Excel et RGPD", async ({ page }) => {
  await login(page, alice);
  for (const url of ["/api/export/transactions", "/api/export/report?type=monthly&format=pdf", "/api/export/report?type=annual&format=xlsx", "/api/export/data"]) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(200);
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    if (url.includes("pdf")) expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    if (url.includes("data")) expect(body.toString()).not.toContain("argon2");
  }
});

test("conseiller IA sans clé : message de configuration clair", async ({ page }) => {
  await login(page, alice);
  await page.goto("/conseiller");
  await expect(page.getByText("Le conseiller IA nécessite une configuration")).toBeVisible();
});

test("recherche globale", async ({ page }) => {
  await login(page, alice);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Rechercher une dépense/).fill("carrefour");
  await expect(page.getByRole("option", { name: /CB CARREFOUR MARKET/ })).toBeVisible();
});

test("isolation : un autre utilisateur ne voit rien des données d'Alice", async ({ page, browser }) => {
  await login(page, alice);
  await page.goto("/comptes");
  await page.getByRole("link", { name: /Compte courant/ }).first().click();
  await page.waitForURL(/\/comptes\/[0-9a-f-]{36}/);
  const aliceAccountUrl = page.url();
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await register(p2, bob);
  await p2.getByRole("button", { name: /Passer pour l'instant/ }).click();
  await p2.waitForURL((u) => u.pathname === "/");
  await p2.goto(aliceAccountUrl.replace(/^https?:\/\/[^/]+/, ""));
  await expect(p2.getByText("404")).toBeVisible();
  await p2.goto("/transactions");
  await expect(p2.getByText("Aucune opération ne correspond")).toBeVisible();
  const search = await p2.request.get("/api/search?q=carrefour");
  expect((await search.json()).hits).toHaveLength(0);
  await ctx.close();
});

test("déconnexion", async ({ page }) => {
  await login(page, alice);
  await page.getByRole("button", { name: /Alice/ }).first().click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await page.waitForURL("**/connexion");
  await page.goto("/");
  await expect(page).toHaveURL(/connexion/);
});

test("démo isolée puis espace vidé", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByRole("button", { name: /Explorer la démo/ }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
  await expect(page.getByText("Données de démonstration fictives")).toBeVisible();
  await page.goto("/parametres#donnees");
  await expect(async () => {
    await page.getByRole("button", { name: "Supprimer les données fictives" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Tout supprimer" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page.getByText("Ajoute ton premier compte pour commencer")).toBeVisible();
});
