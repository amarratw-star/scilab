import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://moneta_app:moneta_app_dev@localhost:5432/moneta_e2e";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, locale: "fr-FR", timezoneId: "Europe/Paris", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
    { name: "mobile-small", use: { ...devices["iPhone SE"], defaultBrowserType: "chromium" }, testMatch: /mobile/ },
  ],
  webServer: [
    // Serveur Powens SIMULÉ (données fictives) : permet de parcourir le flux de connexion sans banque réelle
    { command: "node tests/e2e/powens-mock.mjs", port: 3199, reuseExistingServer: false, timeout: 30_000, env: { POWENS_MOCK_PORT: "3199" } },
    {
      command: `npx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: DB,
        APP_URL: `http://localhost:${PORT}`,
        RATE_LIMIT_MULTIPLIER: "100",
        ALLOW_DEMO_ACCOUNTS: "true",
        ANTHROPIC_API_KEY: "",
        NODE_ENV: "production",
        POWENS_DOMAIN: "e2e-fictif",
        POWENS_CLIENT_ID: "client-fictif-e2e",
        POWENS_CLIENT_SECRET: "secret-fictif-e2e",
        POWENS_API_BASE_OVERRIDE: "http://127.0.0.1:3199",
        APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? "cle-de-chiffrement-e2e-uniquement-0123456789abcdef",
      },
    },
  ],
});
