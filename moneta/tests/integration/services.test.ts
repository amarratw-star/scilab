/**
 * Tests d'intégration sur une vraie base PostgreSQL (rôle moneta_app, RLS active).
 * Prérequis : bash scripts/setup-local-db.sh moneta_test && MIGRATION_DATABASE_URL=... npm run db:migrate
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://moneta_app:moneta_app_dev@localhost:5432/moneta_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://moneta_owner:moneta_owner_dev@localhost:5432/moneta_test";

const { getDb, withUser, closeDb } = await import("@/server/db");
const s = await import("@/server/db/schema");
const { runAsUser } = await import("@/server/services/context");
const { registerUser, authenticate, exportAllData, deleteUserAccount } = await import("@/server/services/user");
const { createAccount, reconcileAccount, accountBalance, deleteAccount } = await import("@/server/services/accounts");
const { createTransaction, updateTransaction, deleteTransaction, listTransactions, duplicateTransaction } = await import("@/server/services/transactions");
const { createRecurring, resolveOccurrence, createBudget, createGoal, addContribution } = await import("@/server/services/planning");
const { loadFinance } = await import("@/server/services/snapshot");
const { computeOverview } = await import("@/server/services/overview");
const { importRows, checkDuplicates } = await import("@/server/services/imports");
const { seedDemoData, wipeFinancialData } = await import("@/server/services/demo");
const { globalSearch } = await import("@/server/services/search");
const { generateNotifications } = await import("@/server/services/notifications");
const { uploadDocument } = await import("@/server/services/documents");
const { transactionSchema, accountSchema, recurringSchema, budgetSchema, goalSchema, contributionSchema } = await import("@/lib/validation");

type User = Awaited<ReturnType<typeof registerUser>>;
let alice: User;
let bob: User;
const TODAY = "2026-03-20";

const as = <T>(u: User, fn: Parameters<typeof runAsUser<T>>[1]) => runAsUser(u, fn, TODAY);

beforeAll(async () => {
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin`truncate users, rate_limits cascade`;
  await admin.end();
  alice = await registerUser({ email: "alice@test.local", password: "motdepasse123", displayName: "Alice" });
  bob = await registerUser({ email: "bob@test.local", password: "motdepasse456", displayName: "Bob" });
});

afterAll(async () => {
  await closeDb();
});

async function account(u: User, name: string, type: "checking" | "savings" | "cash" = "checking", initial = "1000") {
  return as(u, (ctx) => createAccount(ctx, accountSchema.parse({ name, type, initialBalance: initial, openedOn: "2026-01-01" })));
}

describe("authentification", () => {
  it("vérifie le mot de passe (argon2) et refuse un mauvais mot de passe", async () => {
    expect((await authenticate("ALICE@test.local", "motdepasse123"))?.id).toBe(alice.id);
    expect(await authenticate("alice@test.local", "mauvais")).toBeNull();
    expect(await authenticate("inconnu@test.local", "x")).toBeNull();
  });
  it("refuse une adresse déjà utilisée", async () => {
    await expect(registerUser({ email: "Alice@Test.local", password: "abcdef12345", displayName: "A2" })).rejects.toThrow(/existe déjà/);
  });
  it("crée les catégories par défaut", async () => {
    const fin = await as(alice, (ctx) => loadFinance(ctx));
    expect(fin.categories.find((c) => c.name === "Restaurants")).toBeTruthy();
    expect(fin.categories.find((c) => c.name === "Salaire")?.kind).toBe("income");
  });
});

describe("isolation des données (RLS)", () => {
  it("un utilisateur ne voit jamais les données d'un autre", async () => {
    const acc = await account(alice, "Courant Alice");
    await as(alice, (ctx) => createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "42,50", accountId: acc.id, date: "2026-03-01" })));
    const bobView = await as(bob, (ctx) => loadFinance(ctx));
    expect(bobView.accounts).toHaveLength(0);
    expect(bobView.txs).toHaveLength(0);
    const raw = await withUser(bob.id, (tx) => tx.execute(sql`select count(*)::int as n from transactions`));
    expect((raw as unknown as { n: number }[])[0].n).toBe(0);
  });
  it("sans contexte utilisateur, aucune ligne n'est visible", async () => {
    const rows = await getDb().execute(sql`select count(*)::int as n from transactions`);
    expect((rows as unknown as { n: number }[])[0].n).toBe(0);
  });
  it("impossible de référencer ou modifier le compte d'un autre utilisateur", async () => {
    const accA = await account(alice, "Secret");
    await expect(as(bob, (ctx) => createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "1", accountId: accA.id, date: "2026-03-01" })))).rejects.toThrow(/Compte introuvable/);
    // Même en contournant le service : la clé étrangère composite et la RLS bloquent
    await expect(
      withUser(bob.id, (tx) => tx.insert(s.transactions).values({ userId: bob.id, kind: "expense", amount: 100, accountId: accA.id, date: "2026-03-01" })),
    ).rejects.toThrow();
    await expect(
      withUser(bob.id, (tx) => tx.insert(s.accounts).values({ userId: alice.id, name: "Intrus", type: "checking", openedOn: "2026-01-01" })),
    ).rejects.toThrow();
    const updated = await withUser(bob.id, (tx) => tx.update(s.accounts).set({ name: "Piraté" }).returning());
    expect(updated).toHaveLength(0);
  });
});

describe("opérations et soldes", () => {
  it("dépenses, revenus, transferts, remboursements et suppression restent cohérents", async () => {
    const chk = await account(alice, "Compte courant", "checking", "1000");
    const sav = await account(alice, "Livret", "savings", "0");
    await as(alice, async (ctx) => {
      const exp = await createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "100", accountId: chk.id, date: "2026-03-02" }));
      await createTransaction(ctx, transactionSchema.parse({ kind: "income", amount: "2000", accountId: chk.id, date: "2026-03-03" }));
      await createTransaction(ctx, transactionSchema.parse({ kind: "transfer", amount: "500", accountId: chk.id, toAccountId: sav.id, date: "2026-03-04" }));
      await createTransaction(ctx, transactionSchema.parse({ kind: "refund", amount: "30", accountId: chk.id, refundOfId: exp.id, date: "2026-03-05" }));
      expect(await accountBalance(ctx, chk.id)).toBe((1000 - 100 + 2000 - 500 + 30) * 100);
      expect(await accountBalance(ctx, sav.id)).toBe(50000);
      // Modification puis suppression
      await updateTransaction(ctx, exp.id, transactionSchema.parse({ kind: "expense", amount: "150", accountId: chk.id, date: "2026-03-02" }));
      expect(await accountBalance(ctx, chk.id)).toBe((1000 - 150 + 2000 - 500 + 30) * 100);
      await deleteTransaction(ctx, exp.id);
      expect(await accountBalance(ctx, chk.id)).toBe((1000 + 2000 - 500 + 30) * 100);
    });
  });
  it("le transfert n'est compté ni en revenu ni en dépense", async () => {
    const fin = await as(alice, (ctx) => loadFinance(ctx));
    const ov = computeOverview(fin, TODAY, {});
    expect(ov.month.income).toBe(200000);
    expect(ov.month.grossExpenses).toBe(4250); // 42,50 € de la première dépense ; la dépense de 150 € a été supprimée
    expect(ov.month.refunds).toBe(3000);
  });
  it("refuse montant nul, négatif, date invalide et transfert vers le même compte", () => {
    const base = { kind: "expense", accountId: "00000000-0000-0000-0000-000000000000", date: "2026-03-01" };
    expect(transactionSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: "-5" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: "5", date: "2026-02-30" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "transfer", amount: "5", toAccountId: base.accountId }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "adjustment", amount: "-5" }).success).toBe(true);
  });
  it("la base refuse un montant invalide même hors validation", async () => {
    const fin = await as(alice, (ctx) => loadFinance(ctx));
    await expect(withUser(alice.id, (tx) => tx.insert(s.transactions).values({ userId: alice.id, kind: "expense", amount: -100, accountId: fin.accounts[0].id, date: "2026-03-01" }))).rejects.toThrow();
  });
  it("rapprochement : crée une régularisation traçable", async () => {
    const acc = await account(alice, "À rapprocher", "checking", "100");
    const r = await as(alice, (ctx) => reconcileAccount(ctx, acc.id, 9550, TODAY));
    expect(r.gap).toBe(-450);
    expect(await as(alice, (ctx) => accountBalance(ctx, acc.id))).toBe(9550);
    const again = await as(alice, (ctx) => reconcileAccount(ctx, acc.id, 9550, TODAY));
    expect(again.transactionId).toBeNull();
  });
  it("recherche, filtres et duplication", async () => {
    const acc = await account(alice, "Recherche", "checking", "0");
    const t = await as(alice, (ctx) => createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "12,90", accountId: acc.id, date: "2026-03-10", merchant: "Boulangerie Dupont", tags: "pain, matin" })));
    await as(alice, (ctx) => duplicateTransaction(ctx, t.id, "2026-03-11"));
    const res = await as(alice, (ctx) => listTransactions(ctx, { q: "boulangrie", accountId: acc.id }));
    expect(res.total).toBe(2);
    const byTag = await as(alice, (ctx) => listTransactions(ctx, { tag: "pain" }));
    expect(byTag.total).toBe(2);
    const range = await as(alice, (ctx) => listTransactions(ctx, { min: 1000, max: 1300, accountId: acc.id }));
    expect(range.total).toBe(2);
    const hits = await as(alice, (ctx) => globalSearch(ctx, "dupont"));
    expect(hits.some((h) => h.type === "transaction")).toBe(true);
  });
  it("suppression d'un compte avec ses opérations", async () => {
    const acc = await account(alice, "À supprimer", "cash", "10");
    await as(alice, (ctx) => createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "1", accountId: acc.id, date: "2026-03-01" })));
    const r = await as(alice, (ctx) => deleteAccount(ctx, acc.id));
    expect(r.deletedTransactions).toBe(1);
  });
});

describe("récurrences, budgets, objectifs", () => {
  it("confirmer une échéance crée une opération liée ; impossible deux fois", async () => {
    const acc = await account(bob, "Courant Bob", "checking", "2000");
    const rule = await as(bob, (ctx) =>
      createRecurring(ctx, recurringSchema.parse({ name: "Loyer", kind: "expense", amount: "700", frequency: "monthly", startDate: "2026-01-05", accountId: acc.id, isSubscription: false })),
    );
    let ov = computeOverview(await as(bob, (ctx) => loadFinance(ctx)), TODAY, {});
    expect(ov.available.status === "ok" && ov.available.pendingFixedCharges).toBe(70000);
    await as(bob, (ctx) => resolveOccurrence(ctx, rule.id, "2026-03-05", { action: "pay" }));
    await expect(as(bob, (ctx) => resolveOccurrence(ctx, rule.id, "2026-03-05", { action: "pay" }))).rejects.toThrow(/déjà/);
    await expect(as(bob, (ctx) => resolveOccurrence(ctx, rule.id, "2026-03-06", { action: "pay" }))).rejects.toThrow(/aucune échéance/);
    ov = computeOverview(await as(bob, (ctx) => loadFinance(ctx)), TODAY, {});
    expect(ov.available.status === "ok" && ov.available.pendingFixedCharges).toBe(0);
    expect(ov.summary.available).toBe(130000);
    expect(ov.fixedPaid).toBe(70000);
  });
  it("budget mis à jour automatiquement par les dépenses", async () => {
    const fin0 = await as(bob, (ctx) => loadFinance(ctx));
    const resto = fin0.categories.find((c) => c.name === "Restaurants")!;
    await as(bob, (ctx) => createBudget(ctx, budgetSchema.parse({ name: "Restos", categoryId: resto.id, period: "monthly", amount: "100" })));
    await as(bob, (ctx) => createTransaction(ctx, transactionSchema.parse({ kind: "expense", amount: "80", accountId: fin0.accounts[0].id, categoryId: resto.id, date: "2026-03-15" })));
    const ov = computeOverview(await as(bob, (ctx) => loadFinance(ctx)), TODAY, {});
    const b = ov.budgets.find((x) => x.budget.name === "Restos")!;
    expect(b.spent).toBe(8000);
    expect(b.reachedThreshold).toBe(75);
  });
  it("versement sur objectif avec transfert réel : ni dépense ni double comptage", async () => {
    const fin0 = await as(bob, (ctx) => loadFinance(ctx));
    const sav = await account(bob, "Livret Bob", "savings", "0");
    const goal = await as(bob, (ctx) => createGoal(ctx, goalSchema.parse({ name: "Vacances", targetAmount: "1000", startDate: "2026-01-01", deadline: "2026-12-31" })));
    await as(bob, (ctx) => addContribution(ctx, contributionSchema.parse({ goalId: goal.id, direction: "deposit", amount: "200", date: TODAY, fromAccountId: fin0.accounts[0].id, toAccountId: sav.id })));
    const fin = await as(bob, (ctx) => loadFinance(ctx));
    const ov = computeOverview(fin, TODAY, {});
    expect(ov.month.grossExpenses).toBe(70000 + 8000);
    expect(fin.contributions.reduce((a, c) => a + c.amount, 0)).toBe(20000);
    expect(fin.summary.totalFinancial).toBe(200000 - 70000 - 8000);
  });
});

describe("import CSV", () => {
  it("importe puis ignore les doublons à la seconde importation", async () => {
    const acc = await account(bob, "Import", "checking", "0");
    const rows = [
      { date: "2026-03-01", label: "CB CARREFOUR", amount: -4520, categoryId: null, include: true },
      { date: "2026-03-02", label: "VIR SALAIRE", amount: 210000, categoryId: null, include: true },
      { date: "2026-03-02", label: "VIR SALAIRE", amount: 210000, categoryId: null, include: true },
    ];
    const first = await as(bob, (ctx) => importRows(ctx, { accountId: acc.id, rows }));
    expect(first).toEqual({ imported: 2, skipped: 1 });
    const dup = await as(bob, (ctx) => checkDuplicates(ctx, acc.id, rows));
    expect(dup.map((d) => d.status)).toEqual(["imported", "imported", "imported"]);
    const second = await as(bob, (ctx) => importRows(ctx, { accountId: acc.id, rows }));
    expect(second.imported).toBe(0);
    expect(await as(bob, (ctx) => accountBalance(ctx, acc.id))).toBe(210000 - 4520);
  });
});

describe("documents, notifications, démo, export, suppression", () => {
  it("refuse un fichier dont le contenu n'est pas une image ou un PDF", async () => {
    await expect(as(bob, (ctx) => uploadDocument(ctx, { name: "x.pdf", data: Buffer.from("<script>alert(1)</script>") }))).rejects.toThrow(/Format/);
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 32)]);
    const doc = await as(bob, (ctx) => uploadDocument(ctx, { name: "facture.pdf", data: pdf, kind: "invoice" }));
    expect(doc.id).toBeTruthy();
  });
  it("les notifications ne sont pas dupliquées", async () => {
    const n1 = await as(bob, (ctx) => generateNotifications(ctx));
    const n2 = await as(bob, (ctx) => generateNotifications(ctx));
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
  });
  it("données de démonstration : chargées seulement dans un espace vide puis supprimables", async () => {
    const demo = await registerUser({ email: "demo@test.local", password: "demodemo123", displayName: "Démo", isDemo: true });
    const r = await as(demo, (ctx) => seedDemoData(ctx));
    expect(r.transactions).toBeGreaterThan(150);
    await expect(as(demo, (ctx) => seedDemoData(ctx))).rejects.toThrow(/espace vide/);
    const fin = await as(demo, (ctx) => loadFinance(ctx));
    const ov = computeOverview(fin, TODAY, { safetyCushion: 30000, monthlySavingsTarget: 30000 });
    expect(ov.available.status).toBe("ok");
    expect(fin.summary.totalFinancial).toBeGreaterThan(0);
    await as(demo, (ctx) => wipeFinancialData(ctx));
    const after = await as(demo, (ctx) => loadFinance(ctx));
    expect(after.txs).toHaveLength(0);
    expect(after.categories.length).toBeGreaterThan(10);
  });
  it("export RGPD sans mot de passe haché", async () => {
    const data = await as(alice, (ctx) => exportAllData(ctx));
    expect(JSON.stringify(data)).not.toContain("argon2");
    expect(data.transactions.length).toBeGreaterThan(0);
  });
  it("suppression du compte : mot de passe exigé, puis toutes les données disparaissent", async () => {
    await expect(deleteUserAccount(bob.id, "mauvais")).rejects.toThrow();
    await deleteUserAccount(bob.id, "motdepasse456");
    const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    const [{ n }] = await admin`select count(*)::int as n from transactions where user_id = ${bob.id}`;
    await admin.end();
    expect(n).toBe(0);
  });
});
