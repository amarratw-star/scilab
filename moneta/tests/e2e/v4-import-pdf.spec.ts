/** Import d'un relevé PDF FICTIF au format Banque Populaire : lecture, choix du compte, contrôle des soldes, import. */
import { expect, test } from "@playwright/test";
import { makeStatementPdf } from "../fixtures/make-statement-pdf";

test("import d'un relevé PDF", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `pdf-${Date.now()}@e2e.test`;
  await page.goto("/inscription");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Prénom").fill("Paul");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("MotDePasse2026");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("**/bienvenue");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Commencer" }).click();
  await page.getByLabel("Nom du compte").fill("Compte Banque Populaire");
  await page.getByLabel("Solde initial").fill("1 250,00");
  await page.getByRole("button", { name: /Créer le compte|Enregistrer/ }).click();
  await page.waitForURL((u) => u.pathname === "/");

  await page.goto("/import");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles({ name: "releve-fictif.pdf", mimeType: "application/pdf", buffer: await makeStatementPdf() });
  await expect(page.getByText("2. Relevé PDF")).toBeVisible();
  await expect(page.getByText(/Ce relevé contient plusieurs comptes/)).toBeVisible();
  await expect(page.getByText(/Lecture complète vérifiée/)).toBeVisible();
  await expect(page.getByText("6 opération(s) reconnue(s).", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Prévisualiser l'import" }).click();
  await expect(page.getByText("3. Aperçu et catégories")).toBeVisible();
  await expect(page.getByText("VIR SEPA RECU EMPLOYEUR FICTIF SALAIRE DECEMBRE")).toBeVisible();
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await expect(page.getByText("6 opération(s) importée(s)").first()).toBeVisible();

  // Le solde du compte correspond au nouveau solde du relevé (1 250,00 − 1 251,80 + 2 100,00)
  await page.goto("/comptes");
  await expect(page.getByText("2 098,20 €").first()).toBeVisible();
  expect(errors).toEqual([]);
});
