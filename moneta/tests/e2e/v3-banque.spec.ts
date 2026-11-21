/**
 * MONETA V3 — connexion bancaire de bout en bout contre un serveur Powens SIMULÉ (tests/e2e/powens-mock.mjs).
 * La webview Powens réelle (webview.powens.com) est interceptée : le test vérifie l'URL construite puis simule
 * le retour documenté (?connection_id=…&state=…). Aucune banque réelle, aucun identifiant bancaire.
 */
import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now();
const u = { email: `banque-${stamp}@e2e.test`, password: "MotDePasse2026", name: "Camille" };

test.describe.configure({ mode: "serial" });

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource.*(401|404)/.test(m.text()) && errors.push(`console: ${m.text()}`));
  return errors;
}

test("V3 : connecter une banque, importer, vérifier", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Prénom").fill(u.name);
  await page.getByLabel("Adresse e-mail").fill(u.email);
  await page.getByLabel("Mot de passe").fill(u.password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("**/bienvenue");

  // Accueil : option « Connecter ma banque »
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Connecter ma banque" }).click();
  await page.waitForURL("**/connecter-banque");
  // Section Connexions bancaires (vide)
  await page.goto("/comptes");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Connexions bancaires" })).toBeVisible();
  await expect(page.getByText("Aucune banque connectée")).toBeVisible();
  await page.getByRole("link", { name: "Connecter ma banque" }).click();
  await page.waitForURL("**/connecter-banque");
  await expect(page.getByText("Tu t'authentifies chez ta banque")).toBeVisible();

  // Recherche d'une banque (les connecteurs cachés ne sont pas proposés)
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Rechercher une banque").fill("fictive");
  const list = page.getByRole("list", { name: "Banques disponibles" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(page.getByText("Connecteur caché")).toHaveCount(0);

  // Webview Powens interceptée : contrôle de l'URL puis retour simulé conforme à la documentation
  let webviewUrl: URL | null = null;
  await page.route("https://webview.powens.com/**", async (route) => {
    webviewUrl = new URL(route.request().url());
    const back = new URL(webviewUrl.searchParams.get("redirect_uri")!);
    back.searchParams.set("connection_id", "8801");
    back.searchParams.set("state", webviewUrl.searchParams.get("state")!);
    await route.fulfill({ status: 302, headers: { location: back.toString() } });
  });
  await list.getByRole("button", { name: /Banque Fictive E2E/ }).click();
  await page.waitForURL(/\/comptes\?banque=ok/, { timeout: 30_000 });
  expect(webviewUrl).not.toBeNull();
  const w = webviewUrl!;
  expect(w.pathname).toBe("/fr/connect");
  expect(w.searchParams.get("domain")).toBe("e2e-fictif.biapi.pro");
  expect(w.searchParams.get("client_id")).toBe("client-fictif-e2e");
  expect(w.searchParams.get("code")).toBe("code-temporaire-fictif");
  expect(w.searchParams.get("connector_uuids")).toBe("00000000-0000-4000-8000-000000000059");
  expect(w.searchParams.get("state")!.length).toBeGreaterThanOrEqual(32);
  expect(w.toString()).not.toContain("jeton-fictif-e2e"); // le jeton permanent ne quitte jamais le serveur

  // Comptes importés
  await expect(page.getByText("Banque connectée")).toBeVisible();
  const card = page.getByRole("article", { name: "Connexion Banque Fictive E2E" });
  await expect(card.getByText("Connectée", { exact: true })).toBeVisible();
  await expect(card.getByText("FR76 •••• •••• 0042")).toBeVisible();
  await expect(card.getByRole("link", { name: "Compte courant fictif" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Livret fictif" })).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain("jeton-fictif-e2e");
  expect(html).not.toContain("FR7600000000000000000000042");

  // Le solde calculé correspond au solde bancaire (aucun écart signalé)
  await page.waitForLoadState("networkidle");
  await card.getByRole("link", { name: "Compte courant fictif" }).click();
  await expect(page.getByText(/Synchronisé avec Banque Fictive E2E/)).toBeVisible();
  await expect(page.getByText(/Écart de/)).toHaveCount(0);

  // Tableau de bord : bandeau des nouvelles opérations
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const banner = page.getByRole("navigation", { name: "Synchronisation bancaire" });
  await expect(banner.getByText(/nouvelles opérations bancaires à vérifier/)).toBeVisible();
  await banner.getByRole("link", { name: /à vérifier/ }).click();
  await page.waitForURL("**/transactions/a-verifier");

  // Revue : badges, virement interne, catégorie incertaine, validation
  await expect(page.getByRole("heading", { name: "Opérations à vérifier" })).toBeVisible();
  await expect(page.getByText("En attente").first()).toBeVisible();
  await expect(page.getByText("Virement interne").first()).toBeVisible();
  const unknown = page.getByLabel("Catégorie de CB XKQZ 77812");
  await expect(unknown).toHaveValue("");
  await unknown.selectOption({ label: "Loisirs" });
  await expect(page.getByText("Catégorie enregistrée")).toBeVisible();
  await page.getByRole("button", { name: "Marquer CB SUPERMARCHE FICTIF comme vérifiée" }).click();
  await expect(page.getByText(/vérifiée/).first()).toBeVisible();

  // Filtres
  await page.getByRole("radio", { name: "Vérifiées", exact: true }).click();
  await page.waitForURL(/statut=oui/);
  await expect(page.getByText("CB XKQZ 77812")).toBeVisible();

  // Paramètres : préférences et historique de synchronisation
  await page.goto("/parametres#banque");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Historique des synchronisations")).toBeVisible();
  await expect(page.getByText("Après connexion").first()).toBeVisible();

  expect(errors).toEqual([]);
});

test("V3 : un retour de webview falsifié est ignoré", async ({ page }) => {
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Adresse e-mail").fill(u.email);
  await page.locator("#password").fill(u.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/connexion"));
  await page.goto("/api/bank/callback?connection_id=8801&state=etat-forge-par-un-tiers");
  await page.waitForURL(/banque=etat/);
  await expect(page.getByText("Retour de connexion non reconnu")).toBeVisible();
  // Refus de l'utilisateur dans la webview : message clair
  const res = await page.request.post("/api/bank/connect", { data: { flow: "connect" } });
  expect(res.ok()).toBe(true);
  const set = res.headers()["set-cookie"] ?? "";
  expect(set).toMatch(/moneta_bank_state=.*HttpOnly/i);
  const webhook = await page.request.post("/api/webhooks/powens?event=CONNECTION_SYNCED", { data: { id_webhook_data: 1, user: { id: 4242 } } });
  expect(webhook.status()).toBe(401); // sans jeton ni signature valide
});

test("V3 : espace de démonstration sans connexion bancaire réelle", async ({ page }) => {
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Explorer la démo/ }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 60_000 });
  await page.goto("/comptes");
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Connexion bancaire indisponible")).toBeVisible();
  await expect(page.getByText(/espace de démonstration/).first()).toBeVisible();
  const res = await page.request.post("/api/bank/connect", { data: { flow: "connect" } });
  expect(res.status()).toBe(400);
  await page.goto("/confidentialite-bancaire");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Confidentialité bancaire" })).toBeVisible();
});
