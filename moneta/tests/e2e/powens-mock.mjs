/**
 * SERVEUR POWENS SIMULÉ — tests e2e uniquement. Données 100 % fictives, aucune banque réelle.
 * Reproduit le format documenté des réponses de l'API Powens 2.0 pour les endpoints utilisés par MONETA.
 * L'application ne l'utilise que si POWENS_API_BASE_OVERRIDE pointe vers la boucle locale.
 */
import http from "node:http";

const PORT = Number(process.env.POWENS_MOCK_PORT ?? 3199);
const TOKEN = "jeton-fictif-e2e";
const today = new Date().toISOString().slice(0, 10);
const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const connector = { id: 59, uuid: "00000000-0000-4000-8000-000000000059", name: "Banque Fictive E2E", color: "0b7a5a", hidden: false, beta: false, capabilities: ["bank"] };
const connection = { id: 8801, id_user: 4242, id_connector: 59, state: null, error: null, last_update: `${today} 06:00:00`, next_try: null, active: true, connector };
const accounts = [
  { id: 901, id_connection: 8801, name: "Compte courant fictif", original_name: "CPT COURANT", iban: "FR7600000000000000000000042", balance: 1840.25, coming: -12.9, currency: { id: "EUR" }, type: "checking", disabled: null, last_update: `${today} 06:00:00` },
  { id: 902, id_connection: 8801, name: "Livret fictif", iban: null, balance: 5000, currency: { id: "EUR" }, type: "savings", disabled: null },
];
const tx = (id, acc, date, value, wording, extra = {}) => ({ id, id_account: acc, date, value, wording, original_wording: wording, simplified_wording: wording, type: "card", coming: false, deleted: null, categories: [], ...extra });
const transactions = [
  tx(1, 901, d(12), 2100, "VIR SALAIRE SOCIETE FICTIVE", { type: "transfer" }),
  tx(2, 901, d(9), -54.3, "CB SUPERMARCHE FICTIF", { categories: [{ code: "supermarket" }] }),
  tx(3, 901, d(7), -300, "VIR VERS LIVRET FICTIF", { type: "transfer" }),
  tx(4, 902, d(7), 300, "VIR DEPUIS COMPTE COURANT", { type: "transfer" }),
  tx(5, 901, d(4), -23.5, "CB RESTAURANT FICTIF", { categories: [{ code: "restaurant" }] }),
  tx(6, 901, d(2), -9.99, "PRLV ABONNEMENT FICTIF", { type: "order" }),
  tx(7, 901, d(1), -12.9, "CB PAIEMENT EN ATTENTE", { coming: true }),
  tx(8, 901, d(3), -17.4, "CB XKQZ 77812"),
];

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    const authed = req.headers.authorization === `Bearer ${TOKEN}`;
    if (req.method === "POST" && p === "/2.0/auth/init") return send(res, 200, { auth_token: TOKEN, type: "permanent", id_user: 4242, expires_in: null });
    if (req.method === "GET" && p === "/2.0/connectors") return send(res, 200, { connectors: [connector, { ...connector, id: 60, uuid: "00000000-0000-4000-8000-000000000060", name: "Autre Banque Fictive", color: "7a2a0b" }, { ...connector, id: 61, uuid: "00000000-0000-4000-8000-000000000061", name: "Connecteur caché", hidden: true }] });
    if (!authed) return send(res, 401, { code: "invalidToken" });
    if (req.method === "GET" && p === "/2.0/auth/token/code") return send(res, 200, { code: "code-temporaire-fictif", type: "singleAccess", access: "standard", expires_in: 1800 });
    if (req.method === "GET" && p === "/2.0/users/me/connections") return send(res, 200, { connections: [connection], total: 1 });
    if (p === "/2.0/users/me/connections/8801") {
      if (req.method === "DELETE") return send(res, 204);
      return send(res, 200, connection);
    }
    if (req.method === "GET" && p === "/2.0/users/me/connections/8801/accounts") return send(res, 200, { accounts, total: accounts.length });
    if (req.method === "GET" && p === "/2.0/users/me/transactions") {
      if (!url.searchParams.get("limit")) return send(res, 400, { code: "missingParameter" });
      return send(res, 200, { transactions, first_date: d(12), last_date: today, _links: { next: null } });
    }
    if (req.method === "DELETE" && p === "/2.0/users/me") return send(res, 204);
    send(res, 404, { code: "notFound" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Powens simulé sur ${PORT}`));
