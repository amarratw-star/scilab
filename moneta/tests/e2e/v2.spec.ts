/** MONETA V2 : tableau de bord, devise, santé financière, trésorerie, simulateur, thèmes, console. */
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/transactions", "/comptes", "/budgets", "/epargne", "/abonnements", "/calendrier", "/disponible", "/analyses", "/sante", "/conseiller", "/simulateur", "/previsions", "/patrimoine", "/documents", "/rapports", "/import", "/scanner", "/notifications", "/parametres"];

test("V2 : parcours complet sur un espace de démonstration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await page.goto("/connexion");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /Explorer la démo/ }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
  await page.waitForLoadState("networkidle");

  // Tableau de bord : 4 indicateurs principaux + bloc dépensable + santé
  const kpis = page.getByRole("region", { name: "Indicateurs principaux" });
  for (const label of ["Argent disponible", "Dépenses du mois", "Revenus du mois", "Épargne du mois"]) await expect(kpis.getByText(label)).toBeVisible();
  await expect(page.getByText("Combien puis-je dépenser ?").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir le détail du calcul" })).toBeVisible();
  await expect(page.getByText("Santé financière").first()).toBeVisible();
  // Clic sur une catégorie → opérations filtrées
  await page.getByRole("button", { name: /Logement : .*voir les opérations/ }).click();
  await page.waitForURL(/\/transactions\?categorie=/);
  await expect(page.getByText(/opération\(s\)/)).toBeVisible();

  // Santé financière
  await page.goto("/sante");
  await expect(page.getByRole("heading", { name: "Santé financière" })).toBeVisible();
  await expect(page.getByText("Détail des critères")).toBeVisible();

  // Trésorerie : changement d'horizon
  await page.goto("/calendrier?horizon=7");
  await expect(page.getByText("Chronologie des mouvements")).toBeVisible();
  await expect(page.getByRole("link", { name: "7 jours" })).toHaveClass(/bg-foreground/);

  // Simulateur : un achat met à jour l'impact sans toucher aux données
  await page.goto("/simulateur");
  await page.waitForLoadState("networkidle");
  const before = await page.getByText("Solde disponible après").locator("..").locator("p").nth(1).textContent();
  await page.getByLabel("Achat ponctuel").fill("500");
  await expect(page.getByText("Solde disponible après").locator("..").locator("p").nth(1)).not.toHaveText(before ?? "");
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Indicateurs principaux" }).getByText(before?.trim() ?? "___").first()).toBeVisible();

  // Devise : appliquée partout, persistante après rechargement, sans conversion
  await page.goto("/parametres#profil");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Devise d'affichage").selectOption("USD");
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByText("Paramètres enregistrés")).toBeVisible();
  await page.goto("/");
  await page.reload();
  const amount = await kpis.locator(".amount-hero").first().textContent();
  expect(amount).toContain("$");
  expect(amount).not.toContain("€");
  await page.goto("/transactions");
  await expect(page.locator("text=/\\$/").first()).toBeVisible();
  await page.goto("/parametres#profil");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Devise d'affichage").selectOption("EUR");
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByText("Paramètres enregistrés")).toBeVisible();

  // Toutes les pages : chargement sans erreur, en clair puis en sombre
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const p of PAGES) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBeLessThan(400);
      await expect(page.locator("main h1").first()).toBeVisible();
    }
  }
  const relevant = errors.filter((e) => !/favicon|Download the React DevTools|\[Fast Refresh\]/i.test(e));
  expect(relevant, relevant.join("\n")).toEqual([]);
});
