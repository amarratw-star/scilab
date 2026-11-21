/**
 * Données de démonstration FICTIVES. Elles ne sont chargées que dans un espace vide, sont signalées
 * partout par un bandeau, et peuvent être supprimées en un clic pour démarrer avec un espace vierge.
 */
import "server-only";
import { revokeBankAccess } from "@/server/bank/service";
import { eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import { ensureDefaultCategories } from "./categories";
import { addDays, addMonths, startOfMonth, type ISODate } from "@/lib/dates";
import { occurrences } from "@/lib/finance/recurring";
import type { Frequency } from "@/lib/finance/types";

function prng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function isWorkspaceEmpty(ctx: Ctx) {
  const [a] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.accounts);
  const [t] = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(s.transactions);
  return a.n === 0 && t.n === 0;
}

export async function seedDemoData(ctx: Ctx) {
  if (!(await isWorkspaceEmpty(ctx))) throw new ServiceError("Les données de démonstration ne peuvent être chargées que dans un espace vide.");
  await ensureDefaultCategories(ctx);
  const cats = await ctx.tx.select().from(s.categories);
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;
  const rand = prng(42);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const today = ctx.today;
  const start = startOfMonth(addMonths(today, -6));
  const opened = addDays(start, -1);

  const [checking, livret, cash, pea] = await ctx.tx
    .insert(s.accounts)
    .values([
      { userId: ctx.userId, name: "Compte courant (démo)", institution: "Banque Démo", type: "checking", initialBalance: 284_250, openedOn: opened, color: "#6366f1", icon: "wallet", sortOrder: 0, description: "Compte fictif de démonstration" },
      { userId: ctx.userId, name: "Livret A (démo)", institution: "Banque Démo", type: "savings", initialBalance: 420_000, openedOn: opened, color: "#10b981", icon: "piggy-bank", sortOrder: 1, description: "Compte fictif de démonstration" },
      { userId: ctx.userId, name: "Espèces (démo)", institution: null, type: "cash", initialBalance: 6_000, openedOn: opened, color: "#f59e0b", icon: "banknote", sortOrder: 2 },
      { userId: ctx.userId, name: "PEA (démo)", institution: "Courtier Démo", type: "investment", initialBalance: 350_000, openedOn: opened, color: "#0ea5e9", icon: "trending-up", sortOrder: 3 },
    ])
    .returning();

  type R = { name: string; kind: "expense" | "income" | "transfer"; amount: number; frequency: Frequency; day: number; category?: string; sub?: boolean; to?: string; merchant?: string; pm?: "direct_debit" | "transfer" | "card" };
  const ruleDefs: R[] = [
    { name: "Salaire", kind: "income", amount: 215_000, frequency: "monthly", day: 28, category: "Salaire", merchant: "Employeur Démo SAS", pm: "transfer" },
    { name: "Loyer", kind: "expense", amount: 69_000, frequency: "monthly", day: 5, category: "Loyer", merchant: "Agence Démo Immobilier", pm: "transfer" },
    { name: "Électricité", kind: "expense", amount: 6_200, frequency: "monthly", day: 10, category: "Électricité et gaz", merchant: "Fournisseur Énergie Démo" },
    { name: "Box Internet", kind: "expense", amount: 2_999, frequency: "monthly", day: 12, category: "Téléphone et Internet", sub: true, merchant: "Opérateur Démo" },
    { name: "Forfait mobile", kind: "expense", amount: 1_299, frequency: "monthly", day: 15, category: "Téléphone et Internet", sub: true, merchant: "Opérateur Démo" },
    { name: "Streaming vidéo A", kind: "expense", amount: 1_349, frequency: "monthly", day: 8, category: "Abonnements", sub: true, merchant: "StreamFlix Démo", pm: "card" },
    { name: "Streaming vidéo B", kind: "expense", amount: 999, frequency: "monthly", day: 18, category: "Abonnements", sub: true, merchant: "CinéPlus Démo", pm: "card" },
    { name: "Musique en ligne", kind: "expense", amount: 1_199, frequency: "monthly", day: 20, category: "Abonnements", sub: true, merchant: "MusicBox Démo", pm: "card" },
    { name: "Salle de sport", kind: "expense", amount: 3_490, frequency: "monthly", day: 3, category: "Sport", sub: true, merchant: "Club Forme Démo" },
    { name: "Assurance habitation", kind: "expense", amount: 1_850, frequency: "monthly", day: 7, category: "Assurances", merchant: "Assureur Démo" },
    { name: "Virement Livret A", kind: "transfer", amount: 20_000, frequency: "monthly", day: 29, to: "livret", pm: "transfer" },
  ];
  const rules = await ctx.tx
    .insert(s.recurringItems)
    .values(
      ruleDefs.map((r) => {
        const startDate = addDays(start, r.day - 1);
        return {
          userId: ctx.userId,
          name: r.name,
          kind: r.kind,
          amount: r.amount,
          frequency: r.frequency,
          startDate,
          accountId: checking.id,
          toAccountId: r.to === "livret" ? livret.id : null,
          categoryId: r.category ? cat(r.category) : null,
          isSubscription: r.sub ?? false,
          merchant: r.merchant ?? null,
          paymentMethod: r.pm ?? "direct_debit",
          lastReviewedAt: r.name === "Streaming vidéo B" ? addMonths(today, -8) : today,
        };
      }),
    )
    .returning();

  const txs: (typeof s.transactions.$inferInsert)[] = [];
  const base = { userId: ctx.userId, status: "posted" as const, source: "demo" as const };
  // Échéances passées : confirmées (sauf celles d'aujourd'hui et après)
  for (const r of rules) {
    for (const d of occurrences({ frequency: r.frequency, startDate: r.startDate, endDate: null, status: "active" }, start, addDays(today, -1))) {
      txs.push({ ...base, kind: r.kind, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId, categoryId: r.categoryId, date: d, description: r.name, merchant: r.merchant, paymentMethod: r.paymentMethod, isRecurring: true, recurringId: r.id, occurrenceDate: d });
    }
  }
  // Dépenses variables
  const variable: { cat: string; perMonth: [number, number]; amount: [number, number]; merchants: string[]; pm: "card" | "cash" | "mobile" }[] = [
    { cat: "Courses alimentaires", perMonth: [7, 9], amount: [1_800, 8_500], merchants: ["Supermarché Démo", "Épicerie du coin (démo)", "Marché Démo"], pm: "card" },
    { cat: "Restaurants", perMonth: [4, 7], amount: [1_200, 4_200], merchants: ["Bistrot Démo", "Pizzeria Démo", "Sushi Démo"], pm: "card" },
    { cat: "Livraison", perMonth: [1, 3], amount: [1_500, 3_200], merchants: ["Livraison Repas Démo"], pm: "mobile" },
    { cat: "Cafés", perMonth: [6, 10], amount: [250, 520], merchants: ["Café Démo", "Boulangerie Démo"], pm: "mobile" },
    { cat: "Transports en commun", perMonth: [1, 1], amount: [8_640, 8_640], merchants: ["Pass transport (démo)"], pm: "card" },
    { cat: "Taxi et VTC", perMonth: [0, 2], amount: [1_100, 2_600], merchants: ["VTC Démo"], pm: "mobile" },
    { cat: "Shopping", perMonth: [1, 3], amount: [1_500, 7_000], merchants: ["Grand Magasin Démo", "Boutique en ligne Démo"], pm: "card" },
    { cat: "Vêtements", perMonth: [0, 2], amount: [2_000, 8_000], merchants: ["Mode Démo"], pm: "card" },
    { cat: "Sorties", perMonth: [2, 4], amount: [1_000, 4_500], merchants: ["Bar Démo", "Cinéma Démo", "Concert Démo"], pm: "card" },
    { cat: "Pharmacie", perMonth: [0, 2], amount: [600, 2_800], merchants: ["Pharmacie Démo"], pm: "card" },
    { cat: "Loisirs", perMonth: [1, 2], amount: [1_000, 5_000], merchants: ["Librairie Démo", "Jeux Démo"], pm: "card" },
    { cat: "Frais bancaires", perMonth: [1, 1], amount: [250, 250], merchants: ["Banque Démo"], pm: "card" },
  ];
  for (let m = 0; m <= 6; m++) {
    const monthStart = addMonths(start, m);
    for (const v of variable) {
      const n = between(v.perMonth[0], v.perMonth[1]);
      for (let i = 0; i < n; i++) {
        const date = addDays(monthStart, between(0, 27));
        if (date >= today) continue;
        const merchant = v.merchants[between(0, v.merchants.length - 1)];
        txs.push({ ...base, kind: "expense", amount: between(v.amount[0], v.amount[1]), accountId: v.pm === "cash" ? cash.id : checking.id, categoryId: cat(v.cat), date, merchant, description: merchant, paymentMethod: v.pm });
      }
    }
    // retrait d'espèces
    const w = addDays(monthStart, between(1, 20));
    if (w < today) txs.push({ ...base, kind: "transfer", amount: 4_000, accountId: checking.id, toAccountId: cash.id, date: w, description: "Retrait DAB (démo)", paymentMethod: "card" });
    const c = addDays(monthStart, between(2, 25));
    if (c < today) txs.push({ ...base, kind: "expense", amount: between(500, 1_800), accountId: cash.id, categoryId: cat("Marché") ?? cat("Courses alimentaires"), date: c, merchant: "Marché Démo", description: "Marché (espèces)", paymentMethod: "cash" });
  }
  // Mission ponctuelle, remboursement santé, dépense inhabituelle récente
  const mission = addDays(startOfMonth(addMonths(today, -2)), 14);
  txs.push({ ...base, kind: "income", amount: 45_000, accountId: checking.id, categoryId: cat("Missions ponctuelles"), date: mission, description: "Mission freelance (démo)", merchant: "Client Démo" });
  const health = addDays(startOfMonth(addMonths(today, -1)), 9);
  txs.push({ ...base, kind: "expense", amount: 6_000, accountId: checking.id, categoryId: cat("Consultations"), date: health, description: "Consultation spécialiste (démo)", merchant: "Cabinet Démo", paymentMethod: "card" });
  txs.push({ ...base, kind: "refund", amount: 4_200, accountId: checking.id, categoryId: cat("Consultations"), date: addDays(health, 6), description: "Remboursement Assurance maladie (démo)", merchant: "Assurance maladie Démo" });
  const unusual = addDays(today, -2) >= startOfMonth(today) ? addDays(today, -2) : today;
  if (unusual < today || unusual === today) txs.push({ ...base, kind: "expense", amount: 18_900, accountId: checking.id, categoryId: cat("Restaurants"), date: unusual, merchant: "Restaurant gastronomique Démo", description: "Dîner d'anniversaire (démo)", paymentMethod: "card" });
  // Opération prévue
  txs.push({ userId: ctx.userId, status: "planned", source: "demo", kind: "expense", amount: 18_000, accountId: checking.id, categoryId: cat("Entretien") ?? cat("Autres"), date: addDays(today, 9), description: "Révision voiture (prévue)", merchant: "Garage Démo" });

  for (let i = 0; i < txs.length; i += 500) await ctx.tx.insert(s.transactions).values(txs.slice(i, i + 500));
  // Intérêts annuels du livret / variation PEA (régularisation explicite)
  await ctx.tx.insert(s.transactions).values({ ...base, kind: "adjustment", amount: 12_400, accountId: pea.id, date: addDays(startOfMonth(today), -1), description: "Revalorisation du PEA (démo)" });

  // Budgets
  const budgetDefs: [string | null, string, number][] = [
    [null, "Budget global du mois", 200_000],
    ["Restaurants", "Restaurants", 20_000],
    ["Courses alimentaires", "Courses", 30_000],
    ["Shopping", "Shopping", 20_000],
    ["Transport", "Transport", 12_000],
    ["Loisirs", "Loisirs", 12_000],
    ["Sorties", "Sorties", 10_000],
  ];
  await ctx.tx.insert(s.budgets).values(budgetDefs.map(([c, name, amount]) => ({ userId: ctx.userId, name, categoryId: c ? cat(c) : null, period: "monthly" as const, amount, rollover: name === "Shopping" })));

  // Objectifs
  const [secu, japon, pc] = await ctx.tx
    .insert(s.goals)
    .values([
      { userId: ctx.userId, name: "Épargne de sécurité", description: "3 mois de dépenses de côté", targetAmount: 500_000, startDate: start, deadline: addMonths(today, 8), priority: 1, accountId: livret.id, icon: "shield", color: "#10b981" },
      { userId: ctx.userId, name: "Voyage au Japon", description: "Deux semaines au printemps", targetAmount: 300_000, startDate: start, deadline: addMonths(today, 10), priority: 2, accountId: livret.id, icon: "plane", color: "#f43f5e" },
      { userId: ctx.userId, name: "Nouvel ordinateur", targetAmount: 150_000, startDate: addMonths(today, -2), deadline: addMonths(today, 4), priority: 3, icon: "laptop", color: "#6366f1" },
    ])
    .returning();
  const contribs: (typeof s.goalContributions.$inferInsert)[] = [];
  for (let m = 0; m < 6; m++) {
    const d = addDays(addMonths(start, m), 28);
    if (d >= today) continue;
    contribs.push({ userId: ctx.userId, goalId: secu.id, amount: 15_000, date: d, note: "Versement mensuel" });
    contribs.push({ userId: ctx.userId, goalId: japon.id, amount: 5_000, date: d, note: "Versement mensuel" });
  }
  contribs.push({ userId: ctx.userId, goalId: secu.id, amount: 250_000, date: start, note: "Épargne existante" });
  contribs.push({ userId: ctx.userId, goalId: pc.id, amount: 30_000, date: addMonths(today, -1), note: "Premier versement" });
  await ctx.tx.insert(s.goalContributions).values(contribs);

  // Patrimoine
  const [car] = await ctx.tx.insert(s.wealthItems).values({ userId: ctx.userId, kind: "asset", category: "vehicle", name: "Voiture (démo)" }).returning();
  const [loan] = await ctx.tx.insert(s.wealthItems).values({ userId: ctx.userId, kind: "liability", category: "car_loan", name: "Crédit auto (démo)" }).returning();
  await ctx.tx.insert(s.wealthValuations).values([
    { userId: ctx.userId, itemId: car.id, date: start, value: 900_000, method: "estimated" },
    { userId: ctx.userId, itemId: car.id, date: addMonths(today, -1), value: 850_000, method: "estimated" },
    ...Array.from({ length: 7 }, (_, i) => ({ userId: ctx.userId, itemId: loan.id, date: addMonths(start, i) as ISODate, value: 480_000 - i * 15_000, method: "manual" as const })).filter((v) => v.date <= today),
  ]);

  await ctx.tx.update(s.users).set({ hasDemoData: true, onboardedAt: new Date(), settings: sql`settings || ${JSON.stringify({ safetyCushion: 30_000, monthlySavingsTarget: 30_000 })}::jsonb` }).where(eq(s.users.id, ctx.userId));
  await audit(ctx, "demo.seed", "user", ctx.userId, { transactions: txs.length });
  return { transactions: txs.length };
}

/** Supprime TOUTES les données financières de l'utilisateur (démo ou non) et repart d'un espace vide. */
export async function wipeFinancialData(ctx: Ctx, keepCategories = true) {
  const t = ctx.tx;
  await revokeBankAccess(ctx); // en premier : en cas d'échec chez l'agrégateur, rien n'est supprimé
  await t.delete(s.txReconciliations);
  await t.delete(s.syncRuns);
  await t.delete(s.merchantRules);
  await t.delete(s.documents);
  await t.delete(s.goalContributions);
  await t.delete(s.transactions);
  await t.delete(s.budgets);
  await t.delete(s.recurringItems);
  await t.delete(s.goals);
  await t.delete(s.wealthValuations);
  await t.delete(s.wealthItems);
  await t.delete(s.bankAccountLinks);
  await t.delete(s.bankConnections);
  await t.delete(s.accounts);
  await t.delete(s.notifications);
  if (!keepCategories) await t.delete(s.categories);
  await t.update(s.users).set({ hasDemoData: false }).where(eq(s.users.id, ctx.userId));
  await audit(ctx, "data.wipe", "user", ctx.userId, { keepCategories });
  if (!keepCategories) await ensureDefaultCategories(ctx);
}
