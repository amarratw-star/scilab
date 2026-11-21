import { expect, test } from "@playwright/test";

test("mobile : navigation inférieure, ajout rapide et absence de défilement horizontal", async ({ page }) => {
  await page.goto("/connexion");
  await page.getByRole("button", { name: /Explorer la démo/ }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
  const nav = page.getByRole("navigation", { name: "Navigation mobile" });
  await expect(nav).toBeVisible();
  for (const path of ["/", "/transactions", "/comptes", "/budgets", "/epargne", "/abonnements", "/calendrier", "/disponible", "/analyses", "/sante", "/conseiller", "/simulateur", "/previsions", "/patrimoine", "/documents", "/rapports", "/import", "/scanner", "/notifications", "/parametres"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `défilement horizontal sur ${path}`).toBeLessThanOrEqual(1);
  }
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Ajout rapide" }).click();
  await expect(page.getByRole("dialog", { name: "Nouvelle opération" })).toBeVisible();
  await page.getByRole("dialog").getByLabel("Montant", { exact: true }).fill("4,20");
  await page.getByRole("dialog").getByLabel("Description").fill("Café mobile");
  await expect(page.getByRole("dialog").getByLabel("Montant", { exact: true })).toHaveValue("4,20");
  await page.getByRole("dialog").getByRole("button", { name: /^Enregistrer$/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.goto("/transactions");
  await expect(page.getByText("Café mobile")).toBeVisible();
  await nav.getByRole("button", { name: "Plus" }).click();
  await expect(page.getByRole("link", { name: "Mon patrimoine" })).toBeVisible();
});
