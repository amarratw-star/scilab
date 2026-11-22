/**
 * Synchronisation bancaire V3 — tests d'intégration sur une vraie base PostgreSQL (RLS active)
 * avec des réponses Powens SIMULÉES (fixtures conformes au format documenté). Aucun appel réseau réel.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL ??= "postgres://moneta_app:moneta_app_dev@localhost:5432/moneta_test";
process.env.APP_ENCRYPTION_KEY ??= "cle-de-chiffrement-de-test-uniquement-0123456789";
delete process.env.POWENS_DOMAIN; // aucune vraie configuration Powens dans les tests
delete process.env.POWENS_WEBHOOK_SECRET;
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_test";

const { closeDb } = await import("@/server/db");
const s = await import("@/server/db/schema");
const { eq, ne } = await import("drizzle-orm");
const { runAsUser } = await import("@/server/services/context");
const { registerUser } = await import("@/server/services/user");
const { createTransaction, deleteTransaction } = await import("@/server/services/transactions");
const { loadFinance } = await import("@/server/services/snapshot");
const { transactionSchema } = await import("@/lib/validation");
const { encryptSecret } = await import("@/server/crypto");
const { ingestConnection } = await import("@/server/bank/ingest");
const bank = await import("@/server/bank/service");
const { PowensClient } = await import("@/server/bank/client");
const { handlePowensWebhook, computeSignature } = await import("@/server/bank/webhook");
type PowensTransaction = import("@/server/bank/client").PowensTransaction;
type PowensAccount = import("@/server/bank/client").PowensAccount;
type User = Awaited<ReturnType<typeof registerUser>>;

const TODAY = "2026-03-20";
const TOKEN = "jeton-utilisateur-fictif-de-test";
let user: User;
let other: User;
const as = <T,>(u: User, fn: Parameters<typeof runAsUser<T>>[1]) => runAsUser(u, fn, TODAY);

const conn = { id: 7001, id_user: 9001, state: null, last_update: "2026-03-20 08:00:00", connector: { id: 40, uuid: "6c1b8d2e-0000-4000-8000-000000000040", name: "Banque Test", color: "1a73e8" } };
const A1: PowensAccount = { id: 501, id_connection: 7001, name: "Compte courant", iban: "FR7630006000011234567890189", balance: 1500, coming: -30, currency: { id: "EUR" }, type: "checking", last_update: "2026-03-20 08:00:00" };
const A2: PowensAccount = { id: 502, id_connection: 7001, name: "Livret A", iban: null, balance: "3200.00", currency: { id: "EUR" }, type: "savings" };
const A3: PowensAccount = { id: 503, id_connection: 7001, name: "Compte joint non partagé", balance: 999, type: "checking", disabled: "2026-01-01 00:00:00" };
const T = (id: number, id_account: number, date: string, value: number, wording: string, extra: Partial<PowensTransaction> = {}): PowensTransaction => ({ id, id_account, date, value, wording, original_wording: wording, type: "card", coming: false, ...extra });
const base: PowensTransaction[] = [
  T(1, 501, "2026-03-02", 2500, "VIR SALAIRE ACME", { type: "transfer" }),
  T(2, 501, "2026-03-05", -42.5, "CB MONOPRIX PARIS", { categories: [{ code: "supermarket" }] }),
  T(3, 501, "2026-03-10", -200, "VIR VERS LIVRET A", { type: "transfer" }),
  T(4, 502, "2026-03-10", 200, "VIR DEPUIS COMPTE COURANT", { type: "transfer" }),
  T(5, 501, "2026-03-18", -30, "CB SNCF", { coming: true }),
  T(6, 501, "2026-03-03", -15, "CB ANNULEE", { deleted: "2026-03-04 10:00:00" }),
  T(7, 503, "2026-03-04", -80, "CB COMPTE NON PARTAGE"),
  T(8, 501, "2026-03-12", -9.99, "PRLV NETFLIX", { type: "order" }),
];

const txOf = (u: User) => as(u, (ctx) => ctx.tx.select().from(s.transactions));
const accountId = async (ext: string) => (await as(user, (ctx) => ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.externalAccountId, ext))))[0].accountId;
const manual = (u: User, input: Record<string, unknown>) => as(u, (ctx) => createTransaction(ctx, transactionSchema.parse(input)));

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin`delete from users where email in ('banque@test.local', 'banque-autre@test.local')`;
  await admin`delete from webhook_events where id like 'powens:test-%'`;
  await admin.end();
  user = await registerUser({ email: "banque@test.local", password: "motdepasse123", displayName: "Banque" });
  other = await registerUser({ email: "banque-autre@test.local", password: "motdepasse123", displayName: "Autre" });
  await as(user, (ctx) => ctx.tx.insert(s.bankUsers).values({ userId: user.id, provider: "powens", externalUserId: "9001", accessTokenEnc: encryptSecret(TOKEN) }));
});
afterAll(() => closeDb());

describe("première synchronisation", () => {
  it("importe les comptes partagés uniquement, avec IBAN masqué et solde bancaire", async () => {
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A1, A2, A3], base, "callback"));
    expect(st.accounts).toBe(2);
    const links = await as(user, (ctx) => ctx.tx.select().from(s.bankAccountLinks));
    expect(links.map((l) => l.externalAccountId).sort()).toEqual(["501", "502"]);
    const l1 = links.find((l) => l.externalAccountId === "501")!;
    expect(l1.ibanMasked).toBe("FR76 •••• •••• 0189");
    expect(l1.bankBalance).toBe(150000);
    const accs = await as(user, (ctx) => ctx.tx.select().from(s.accounts));
    expect(accs.map((a) => a.institution)).toEqual(["Banque Test", "Banque Test"]);
    expect(accs.find((a) => a.id === links.find((l) => l.externalAccountId === "502")!.accountId)!.type).toBe("savings");
  });

  it("aucun IBAN complet n'est stocké en base", async () => {
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    const rows = await admin`select count(*)::int as n from bank_account_links where iban_masked like '%000011234567890%'`;
    await admin.end();
    expect(rows[0].n).toBe(0);
  });

  it("statuts : en attente → prévue, supprimée → annulée, compte non partagé ignoré", async () => {
    const txs = await txOf(user);
    const byExt = new Map(txs.map((t) => [t.externalId, t]));
    expect(byExt.get("5")!.status).toBe("planned");
    expect(byExt.get("5")!.bankStatus).toBe("coming");
    expect(byExt.get("6")?.status ?? "cancelled").toBe("cancelled");
    expect(byExt.has("7")).toBe(false);
    expect(byExt.get("2")!.status).toBe("posted");
    expect(byExt.get("2")!.verifiedAt).toBeNull();
  });

  it("apparie le virement interne : un transfert, jamais un revenu ni une dépense", async () => {
    const txs = await txOf(user);
    const debit = txs.find((t) => t.externalId === "3")!;
    const credit = txs.find((t) => t.externalId === "4")!;
    expect(debit.kind).toBe("transfer");
    expect(debit.toAccountId).toBe(await accountId("502"));
    expect(credit.status).toBe("cancelled");
  });

  it("le solde calculé par le moteur V2 correspond au solde communiqué par la banque", async () => {
    const fin = await as(user, (ctx) => loadFinance(ctx));
    expect(fin.balances.get(await accountId("501"))).toBe(150000);
    expect(fin.balances.get(await accountId("502"))).toBe(320000);
  });

  it("l'opération en attente est comptée une seule fois dans les dépenses prévues", async () => {
    const fin = await as(user, (ctx) => loadFinance(ctx));
    const planned = fin.txs.filter((t) => t.status === "planned" && t.amount === 3000);
    expect(planned).toHaveLength(1);
  });

  it("catégorise à partir de la catégorie bancaire, avec niveau de confiance", async () => {
    const t = (await txOf(user)).find((x) => x.externalId === "2")!;
    expect(t.categorySource).toBe("bank");
    expect(t.categoryConfidence).toBe(70);
  });
});

describe("synchronisations répétées et concurrentes", () => {
  it("rejouer exactement la même synchronisation ne crée ni ne modifie rien (idempotence)", async () => {
    const before = (await txOf(user)).length;
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A1, A2, A3], base, "webhook"));
    expect(st.created).toBe(0);
    expect(st.updated).toBe(0);
    expect((await txOf(user)).length).toBe(before);
  });

  it("deux synchronisations simultanées n'importent qu'une fois la même opération", async () => {
    const extra = [T(12, 501, "2026-03-19", -7.2, "CB PHARMACIE CENTRALE")];
    const res = await Promise.all([as(user, (ctx) => ingestConnection(ctx, conn, [A1], extra, "webhook")), as(user, (ctx) => ingestConnection(ctx, conn, [A1], extra, "manual"))]);
    expect(res.map((r) => r.created).sort()).toEqual([0, 1]);
    expect((await txOf(user)).filter((t) => t.externalId === "12")).toHaveLength(1);
  });

  it("un solde absent ne remplace jamais le dernier solde connu", async () => {
    await as(user, (ctx) => ingestConnection(ctx, conn, [{ ...A1, balance: null }], [], "webhook"));
    const l1 = (await as(user, (ctx) => ctx.tx.select().from(s.bankAccountLinks).where(eq(s.bankAccountLinks.externalAccountId, "501"))))[0];
    expect(l1.bankBalance).toBe(150000);
  });

  it("une réponse incomplète (montant ou date manquant) est ignorée, pas inventée", async () => {
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [{ id: 13, id_account: 501, date: "", value: null }], "webhook"));
    expect(st.skipped).toBe(1);
    expect((await txOf(user)).some((t) => t.externalId === "13")).toBe(false);
  });
});

describe("cycle de vie des opérations bancaires", () => {
  it("en attente → comptabilisée avec le même identifiant : mise à jour, sans doublon", async () => {
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(5, 501, "2026-03-19", -30, "CB SNCF", { coming: false })], "webhook"));
    const rows = (await txOf(user)).filter((t) => t.externalId === "5");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("posted");
    expect(rows[0].bankStatus).toBe("booked");
  });

  it("en attente → comptabilisée avec un nouvel identifiant : l'attente est annulée (traçée), jamais comptée deux fois", async () => {
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(20, 501, "2026-03-15", -18, "CB FNAC", { coming: true })], "webhook"));
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(21, 501, "2026-03-17", -18, "CB FNAC PARIS")], "webhook"));
    const txs = await txOf(user);
    expect(txs.find((t) => t.externalId === "20")!.status).toBe("cancelled");
    expect(txs.find((t) => t.externalId === "21")!.status).toBe("posted");
    const reco = await as(user, (ctx) => ctx.tx.select().from(s.txReconciliations).where(eq(s.txReconciliations.kind, "pending_superseded")));
    expect(reco.length).toBeGreaterThanOrEqual(1);
  });

  it("modifiée puis supprimée par la banque", async () => {
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(8, 501, "2026-03-12", -10.99, "PRLV NETFLIX", { type: "order" })], "webhook"));
    expect((await txOf(user)).find((t) => t.externalId === "8")!.amount).toBe(1099);
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(8, 501, "2026-03-12", -10.99, "PRLV NETFLIX", { deleted: "2026-03-13 00:00:00" })], "webhook"));
    const t = (await txOf(user)).find((x) => x.externalId === "8")!;
    expect(t.status).toBe("cancelled");
    expect(t.bankStatus).toBe("deleted");
  });

  it("remboursement bancaire (payback) → remboursement, pas un revenu", async () => {
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(22, 501, "2026-03-19", 42.5, "REMBOURSEMENT MONOPRIX", { type: "payback" })], "webhook"));
    expect((await txOf(user)).find((t) => t.externalId === "22")!.kind).toBe("refund");
  });

  it("supprimer une opération bancaire la masque (elle ne revient pas à la synchronisation suivante)", async () => {
    const t = (await txOf(user)).find((x) => x.externalId === "22")!;
    await as(user, (ctx) => deleteTransaction(ctx, t.id));
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(22, 501, "2026-03-19", 42.5, "REMBOURSEMENT MONOPRIX", { type: "payback" })], "webhook"));
    const rows = (await txOf(user)).filter((x) => x.externalId === "22");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("cancelled");
  });
});

describe("doublons entre saisies manuelles et opérations bancaires", () => {
  it("fusion automatique d'un doublon non ambigu, puis annulation possible", async () => {
    const acc = await accountId("501");
    const m = await manual(user, { kind: "expense", amount: "12.34", accountId: acc, date: "2026-03-19", description: "Boulangerie Paul" });
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(30, 501, "2026-03-19", -12.34, "CB BOULANGERIE PAUL")], "webhook"));
    expect(st.merged).toBe(1);
    expect(st.created).toBe(0);
    let rows = (await txOf(user)).filter((t) => t.amount === 1234 && t.status !== "cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(m.id);
    expect(rows[0].externalId).toBe("30");
    // Réversible et tracé
    const [reco] = await as(user, (ctx) => ctx.tx.select().from(s.txReconciliations).where(eq(s.txReconciliations.status, "auto_merged")));
    await as(user, (ctx) => bank.undoAutoMerge(ctx, reco.id));
    rows = (await txOf(user)).filter((t) => t.amount === 1234 && t.status !== "cancelled");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === m.id)!.externalId).toBeNull();
    // La resynchronisation ne recrée pas de troisième ligne
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(30, 501, "2026-03-19", -12.34, "CB BOULANGERIE PAUL")], "webhook"));
    expect((await txOf(user)).filter((t) => t.amount === 1234 && t.status !== "cancelled")).toHaveLength(2);
  });

  it("montants identiques légitimes : proposition seulement, l'utilisateur décide", async () => {
    const acc = await accountId("501");
    await manual(user, { kind: "expense", amount: "5", accountId: acc, date: "2026-03-19", description: "Café" });
    await manual(user, { kind: "expense", amount: "5", accountId: acc, date: "2026-03-19", description: "Café" });
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(31, 501, "2026-03-19", -5, "CB CAFE DU COIN")], "webhook"));
    expect(st.merged).toBe(0);
    expect(st.suggested).toBe(1);
    const fives = () => txOf(user).then((r) => r.filter((t) => t.amount === 500 && t.status !== "cancelled"));
    expect(await fives()).toHaveLength(3); // rien supprimé silencieusement
    const [sug] = await as(user, (ctx) => ctx.tx.select().from(s.txReconciliations).where(eq(s.txReconciliations.status, "suggested")));
    await as(user, (ctx) => bank.resolveDuplicate(ctx, sug.id, "merge"));
    const after = await fives();
    expect(after).toHaveLength(2);
    expect(after.some((t) => t.externalId === "31")).toBe(true);
    const cancelled = (await txOf(user)).find((t) => t.id === sug.otherTxId)!;
    expect(cancelled.status).toBe("cancelled"); // conservée, consultable
    await expect(as(user, (ctx) => bank.resolveDuplicate(ctx, sug.id, "merge"))).rejects.toThrow(/déjà traitée/);
  });
});

describe("apprentissage de la catégorisation", () => {
  it("après deux corrections, le commerçant est reconnu et une règle est proposée", async () => {
    const loisirs = (await as(user, (ctx) => ctx.tx.select().from(s.categories).where(eq(s.categories.name, "Loisirs"))))[0].id;
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(40, 501, "2026-03-11", -23, "CB LIBRAIRIE GIBERT"), T(41, 501, "2026-03-14", -31, "CB LIBRAIRIE GIBERT")], "webhook"));
    for (const ext of ["40", "41"]) {
      const t = (await txOf(user)).find((x) => x.externalId === ext)!;
      await as(user, (ctx) => ctx.tx.update(s.transactions).set({ categoryId: loisirs, categorySource: "user", categoryConfidence: 100 }).where(eq(s.transactions.id, t.id)));
    }
    await as(user, (ctx) => ingestConnection(ctx, conn, [A1], [T(42, 501, "2026-03-19", -12, "CB LIBRAIRIE GIBERT")], "webhook"));
    const t42 = (await txOf(user)).find((x) => x.externalId === "42")!;
    expect(t42.categoryId).toBe(loisirs);
    expect(t42.categorySource).toBe("history");
    const sugg = await as(user, (ctx) => bank.suggestedRules(ctx));
    expect(sugg.some((x) => x.categoryId === loisirs && x.count >= 2)).toBe(true);
  });

  it("une règle ne modifie pas les opérations passées sans demande explicite", async () => {
    const shopping = (await as(user, (ctx) => ctx.tx.select().from(s.categories).where(eq(s.categories.name, "Shopping"))))[0].id;
    const before = (await txOf(user)).find((x) => x.externalId === "2")!.categoryId;
    const r = await as(user, (ctx) => bank.createRule(ctx, "cb monoprix", shopping, false));
    expect(r.applied).toBe(0);
    expect((await txOf(user)).find((x) => x.externalId === "2")!.categoryId).toBe(before);
    const r2 = await as(user, (ctx) => bank.createRule(ctx, "cb monoprix", shopping, true));
    expect(r2.applied).toBeGreaterThan(0);
  });

  it("préférence « catégorisation automatique » désactivée → aucune catégorie devinée", async () => {
    const st = await runAsUser({ ...user, settings: { bank: { autoCategorize: false } } }, (ctx) => ingestConnection(ctx, conn, [A1], [T(43, 501, "2026-03-19", -60, "CB MONOPRIX PARIS", { categories: [{ code: "supermarket" }] })], "webhook"), TODAY);
    expect(st.created).toBe(1);
    expect((await txOf(user)).find((x) => x.externalId === "43")!.categoryId).toBeNull();
  });
});

describe("revue des opérations", () => {
  it("liste les opérations non vérifiées, puis les marque vérifiées", async () => {
    const data = await as(user, (ctx) => bank.reviewData(ctx, { statut: "non" }));
    expect(data.txs.length).toBeGreaterThan(0);
    expect(data.txs.every((t) => !t.verified)).toBe(true);
    const n = await as(user, (ctx) => bank.markVerified(ctx, [data.txs[0].id]));
    expect(n).toBe(1);
    const counts = await as(user, (ctx) => bank.reviewCounts(ctx));
    expect(counts.unverified).toBe(data.txs.length - 1);
  });
});

describe("isolation entre utilisateurs", () => {
  it("un autre utilisateur ne voit aucune donnée bancaire", async () => {
    const [c, l, u, t, r] = await as(other, async (ctx) => [
      await ctx.tx.select().from(s.bankConnections),
      await ctx.tx.select().from(s.bankAccountLinks),
      await ctx.tx.select().from(s.bankUsers),
      await ctx.tx.select().from(s.transactions),
      await ctx.tx.select().from(s.txReconciliations),
    ]);
    expect([c.length, l.length, u.length, t.length, r.length]).toEqual([0, 0, 0, 0, 0]);
  });
  it("un autre utilisateur ne peut pas résoudre un doublon qui ne lui appartient pas", async () => {
    const [any] = await as(user, (ctx) => ctx.tx.select().from(s.txReconciliations));
    await expect(as(other, (ctx) => bank.resolveDuplicate(ctx, any.id, "merge"))).rejects.toThrow();
  });
});

describe("webhooks", () => {
  const body = (id: string, txs: PowensTransaction[]) => JSON.stringify({ id_webhook_data: `test-${id}`, user: { id: 9001 }, connection: { ...conn, accounts: [{ ...A1, transactions: txs }] } });
  const call = (raw: string, headers: Record<string, string>, event = "CONNECTION_SYNCED") =>
    handlePowensWebhook({ event, headers: new Headers(headers), rawBody: Buffer.from(raw), path: "/api/webhooks/powens", pathWithQuery: `/api/webhooks/powens?event=${event}` });

  it("authentifié par le jeton utilisateur : importe les nouvelles opérations", async () => {
    const r = await call(body("1", [T(50, 501, "2026-03-20", -4, "CB BOULANGERIE")]), { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(200);
    expect((await txOf(user)).some((t) => t.externalId === "50")).toBe(true);
  });
  it("un événement reçu deux fois n'est traité qu'une fois", async () => {
    const r = await call(body("1", [T(51, 501, "2026-03-20", -4, "CB X")]), { authorization: `Bearer ${TOKEN}` });
    expect(r.body.duplicate).toBe(true);
    expect((await txOf(user)).some((t) => t.externalId === "51")).toBe(false);
  });
  it("refuse un jeton invalide, absent ou un utilisateur inconnu", async () => {
    expect((await call(body("2", []), { authorization: "Bearer faux" })).status).toBe(401);
    expect((await call(body("3", []), {})).status).toBe(401);
    expect((await call(JSON.stringify({ id_webhook_data: "test-4", user: { id: 424242 }, connection: conn }), { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
  });
  it("refuse un corps invalide ou sans identifiant d'événement", async () => {
    expect((await call("pas du json", {})).status).toBe(400);
    expect((await call(JSON.stringify({ user: { id: 9001 } }), { authorization: `Bearer ${TOKEN}` })).status).toBe(400);
  });
  it("avec une clé HMAC configurée, la signature devient obligatoire", async () => {
    process.env.POWENS_WEBHOOK_SECRET = "cle-hmac-test";
    try {
      const raw = body("5", [T(52, 501, "2026-03-20", -6, "CB Y")]);
      expect((await call(raw, { authorization: `Bearer ${TOKEN}` })).status).toBe(401);
      const date = new Date().toISOString();
      const sig = computeSignature("cle-hmac-test", "POST", "/api/webhooks/powens", date, raw);
      expect((await call(raw, { authorization: `Bearer ${TOKEN}`, "bi-signature": sig, "bi-signature-date": date })).status).toBe(200);
      const forged = createHmac("sha256", "mauvaise-cle").update(`POST./api/webhooks/powens.${date}.${raw}`).digest("base64");
      expect((await call(body("6", []), { "bi-signature": forged, "bi-signature-date": date })).status).toBe(401);
    } finally {
      delete process.env.POWENS_WEBHOOK_SECRET;
    }
  });
  it("une charge incomplète est journalisée en erreur (Powens réessaiera), sans rien casser", async () => {
    const r = await call(JSON.stringify({ id_webhook_data: "test-7", user: { id: 9001 }, connection: { id: "pas-un-nombre" } }), { authorization: `Bearer ${TOKEN}` });
    expect(r.status).toBe(500);
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    const [ev] = await admin`select status, attempts from webhook_events where id = 'powens:test-7'`;
    await admin.end();
    expect(ev).toMatchObject({ status: "error", attempts: 1 });
  });
  it("événement non géré : accusé de réception sans traitement", async () => {
    const r = await call(JSON.stringify({ id_webhook_data: "test-8", user: { id: 9001 } }), { authorization: `Bearer ${TOKEN}` }, "TRANSACTION_ATTACHMENTS_FOUND");
    expect(r.body.ignored).toBe(true);
  });
});

describe("synchronisation « pull » face aux erreurs de Powens", () => {
  const cfg = { domain: "test", clientId: "id-test", clientSecret: "secret-test", apiBaseOverride: "http://127.0.0.1:9" };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

  it("erreur temporaire (500) : erreur signalée et journalisée, dernières données conservées", async () => {
    const before = await as(user, (ctx) => loadFinance(ctx));
    let calls = 0;
    const c = new PowensClient(cfg, (async () => { calls++; return json({ code: "internalError" }, 503); }) as typeof fetch);
    const r = await as(user, (ctx) => bank.pullSync(ctx, "manual", undefined, c));
    expect(r.error).toMatch(/dernières données/);
    expect(calls).toBe(3); // nouvelles tentatives avec attente progressive
    const after = await as(user, (ctx) => loadFinance(ctx));
    expect(after.balances).toEqual(before.balances);
    const runs = await as(user, (ctx) => ctx.tx.select().from(s.syncRuns).where(eq(s.syncRuns.status, "error")));
    expect(runs.length).toBeGreaterThan(0);
  });

  it("coupure réseau pendant la récupération des opérations : aucune donnée perdue", async () => {
    const before = (await txOf(user)).length;
    const c = new PowensClient(cfg, (async (url: string | URL | Request) => {
      if (String(url).includes("/connections?")) return json({ connections: [conn] });
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    const r = await as(user, (ctx) => bank.pullSync(ctx, "manual", undefined, c));
    expect(r.error).toBeDefined();
    expect((await txOf(user)).length).toBe(before);
  });

  it("réussite : suit la pagination de l'API Powens uniquement (jamais un autre hôte), état de connexion mis à jour", async () => {
    const seen: string[] = [];
    const c = new PowensClient(cfg, (async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/users/me/connections?")) return json({ connections: [{ ...conn, state: "SCARequired" }] });
      if (u.includes("/accounts")) return json({ accounts: [A1, A2] });
      if (u.includes("page=2")) return json({ transactions: [T(61, 501, "2026-03-20", -3, "CB PAGE 2")], _links: { next: { href: "https://evil.example.com/steal" } } });
      if (u.includes("/users/me/transactions")) return json({ transactions: [T(60, 501, "2026-03-20", -2, "CB PAGE 1")], _links: { next: { href: "http://127.0.0.1:9/2.0/users/me/transactions?limit=1000&page=2" } } });
      return json({}, 404);
    }) as typeof fetch);
    const r = await as(user, (ctx) => bank.pullSync(ctx, "manual", undefined, c));
    expect(r.error).toBeUndefined();
    expect(r.created).toBe(2);
    expect(seen.some((u) => u.includes("evil"))).toBe(false);
    expect(seen.find((u) => u.includes("/users/me/transactions"))).toMatch(/limit=1000/);
    const [cn] = await as(user, (ctx) => ctx.tx.select().from(s.bankConnections));
    expect(cn.state).toBe("SCARequired");
    const views = await as(user, (ctx) => bank.connectionViews(ctx));
    expect(views[0].info.label).toBe("Autorisation expirée");
    expect(views[0].info.action).toBe("reconnect");
    expect(JSON.stringify(views)).not.toContain(TOKEN);
    expect(JSON.stringify(views)).not.toContain("7001"); // identifiant externe non exposé au navigateur
  });
});

describe("carte à débit différé et comptes en devise étrangère", () => {
  const conn2 = { ...conn, id: 7002, connector: { ...conn.connector, name: "Banque Test 2" } };
  const C: PowensAccount = { id: 601, id_connection: 7002, name: "Courant 2", balance: 1000, currency: { id: "EUR" }, type: "checking" };
  const K: PowensAccount = { id: 602, id_connection: 7002, id_parent: 601, name: "Carte différée", balance: -50, currency: { id: "EUR" }, type: "card" };
  const U: PowensAccount = { id: 603, id_connection: 7002, name: "Compte USD", balance: 2000, currency: { id: "USD" }, type: "checking" };

  it("le prélèvement mensuel de la carte (summary_card) devient un transfert : dépenses comptées une seule fois", async () => {
    await as(user, (ctx) =>
      ingestConnection(ctx, conn2, [C, K, U], [T(800, 602, "2026-03-05", -30, "CB LIBRAIRIE", { type: "deferred_card" }), T(801, 602, "2026-03-08", -20, "CB CINEMA", { type: "deferred_card" }), T(802, 601, "2026-03-18", -50, "RELEVE CARTE DIFFEREE", { type: "summary_card" })], "callback"),
    );
    const txs = await txOf(user);
    const summary = txs.find((t) => t.externalId === "802")!;
    expect(summary.kind).toBe("transfer");
    expect(summary.toAccountId).toBe(await accountId("602"));
    expect(summary.categoryId).toBeNull();
    expect(txs.filter((t) => ["800", "801"].includes(t.externalId ?? "")).every((t) => t.kind === "expense")).toBe(true);
    const fin = await as(user, (ctx) => loadFinance(ctx));
    expect(fin.balances.get(await accountId("601"))).toBe(100000);
    expect(fin.balances.get(await accountId("602"))).toBe(-5000);
  });

  it("une connexion réussie met à jour la date de dernière synchronisation", async () => {
    const [c] = await as(user, (ctx) => ctx.tx.select().from(s.bankConnections).where(eq(s.bankConnections.externalConnectionId, "7002")));
    expect(c.lastSyncAt).not.toBeNull();
  });

  it("un compte dans une autre devise n'est jamais additionné aux euros", async () => {
    const usd = await accountId("603");
    await as(user, (ctx) => ingestConnection(ctx, conn2, [{ ...U, balance: 1900 }], [T(803, 603, "2026-03-19", -100, "CB NEW YORK SHOP")], "webhook"));
    const fin = await as(user, (ctx) => loadFinance(ctx));
    expect(fin.foreignAccountIds.has(usd)).toBe(true);
    expect(fin.balances.get(usd)).toBe(190000); // solde propre en USD calculé normalement
    expect(fin.summary.byAccount.find((a) => a.id === usd)?.archived).toBe(true); // exclu des totaux
    expect(fin.txs.some((t) => t.accountId === usd)).toBe(false); // exclu des statistiques et budgets
    expect(fin.allTxs.some((t) => t.accountId === usd)).toBe(true);
    const totalWithout = fin.summary.byAccount.filter((a) => !a.archived).reduce((s2, a) => s2 + a.balance, 0);
    expect(fin.summary.totalFinancial).toBe(totalWithout);
  });
});

describe("gestion des comptes et connexions", () => {
  it("suspendre la synchronisation d'un compte : ses opérations ne sont plus importées", async () => {
    const acc = await accountId("502");
    await as(user, (ctx) => bank.setAccountSync(ctx, acc, false));
    const st = await as(user, (ctx) => ingestConnection(ctx, conn, [A2], [T(70, 502, "2026-03-20", 15, "INTERETS")], "webhook"));
    expect(st.created).toBe(0);
    await as(user, (ctx) => bank.setAccountSync(ctx, acc, true));
  });

  it("rapprocher un compte manuel d'un compte synchronisé : déplacement + propositions, rien supprimé", async () => {
    const [m] = await as(user, (ctx) => ctx.tx.insert(s.accounts).values({ userId: user.id, name: "Courant (manuel)", type: "checking", currency: "EUR", initialBalance: 0, openedOn: "2026-01-01" }).returning());
    await manual(user, { kind: "expense", amount: "2", accountId: m.id, date: "2026-03-20", description: "CB page 1" });
    const bankAcc = await accountId("501");
    const r = await as(user, (ctx) => bank.mergeManualIntoBank(ctx, m.id, bankAcc));
    expect(r.moved).toBe(1);
    expect(r.suggestions).toBe(1); // « CB page 1 » ressemble à l'opération bancaire 60 : proposée, pas supprimée
    expect((await as(user, (ctx) => ctx.tx.select().from(s.accounts).where(eq(s.accounts.id, m.id))))).toHaveLength(0);
    expect((await txOf(user)).filter((t) => t.amount === 200 && t.accountId === bankAcc && t.status !== "cancelled")).toHaveLength(2);
  });

  it("supprimer une connexion en conservant les données : comptes devenus manuels, opérations intactes", async () => {
    const before = (await txOf(user)).filter((t) => t.status !== "cancelled").length;
    for (const cn of await as(user, (ctx) => ctx.tx.select().from(s.bankConnections))) await as(user, (ctx) => bank.deleteConnection(ctx, cn.id, true));
    expect(await as(user, (ctx) => ctx.tx.select().from(s.bankConnections))).toHaveLength(0);
    expect(await as(user, (ctx) => ctx.tx.select().from(s.bankAccountLinks))).toHaveLength(0);
    expect((await txOf(user)).filter((t) => t.status !== "cancelled").length).toBe(before);
    const accs = await as(user, (ctx) => ctx.tx.select().from(s.accounts).where(ne(s.accounts.name, "")));
    expect(accs.length).toBeGreaterThanOrEqual(2);
  });
});
