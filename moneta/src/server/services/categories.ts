import "server-only";
import { and, eq, sql } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { audit, ServiceError, type Ctx } from "./context";
import type { z } from "zod";
import type { categorySchema } from "@/lib/validation";

type Def = { name: string; icon: string; color: string; isFixed?: boolean; children?: string[] };

export const DEFAULT_EXPENSE_CATEGORIES: Def[] = [
  { name: "Logement", icon: "home", color: "#6366f1", isFixed: true, children: ["Loyer", "Électricité et gaz", "Eau", "Entretien"] },
  { name: "Courses alimentaires", icon: "shopping-cart", color: "#22c55e" },
  { name: "Restaurants", icon: "utensils", color: "#f97316", children: ["Livraison", "Fast-food"] },
  { name: "Cafés", icon: "coffee", color: "#a16207" },
  { name: "Shopping", icon: "shopping-bag", color: "#ec4899" },
  { name: "Vêtements", icon: "shirt", color: "#d946ef" },
  { name: "Transport", icon: "train", color: "#0ea5e9", children: ["Transports en commun", "Taxi et VTC", "Parking et péage"] },
  { name: "Essence", icon: "fuel", color: "#64748b" },
  { name: "Santé", icon: "heart-pulse", color: "#ef4444", children: ["Pharmacie", "Consultations"] },
  { name: "Sport", icon: "dumbbell", color: "#14b8a6" },
  { name: "Loisirs", icon: "gamepad-2", color: "#8b5cf6" },
  { name: "Sorties", icon: "party-popper", color: "#f43f5e" },
  { name: "Voyages", icon: "plane", color: "#06b6d4" },
  { name: "Vacances", icon: "palmtree", color: "#10b981" },
  { name: "Abonnements", icon: "repeat", color: "#7c3aed", isFixed: true },
  { name: "Téléphone et Internet", icon: "smartphone", color: "#3b82f6", isFixed: true },
  { name: "Études", icon: "graduation-cap", color: "#eab308" },
  { name: "Cadeaux", icon: "gift", color: "#e11d48" },
  { name: "Impôts", icon: "landmark", color: "#475569", isFixed: true },
  { name: "Assurances", icon: "shield", color: "#0f766e", isFixed: true },
  { name: "Frais bancaires", icon: "credit-card", color: "#78716c" },
  { name: "Retraits d'espèces", icon: "banknote", color: "#64748b" },
  { name: "Autres", icon: "tag", color: "#94a3b8" },
];

export const DEFAULT_INCOME_CATEGORIES: Def[] = [
  { name: "Salaire", icon: "briefcase", color: "#16a34a" },
  { name: "Revenus indépendants", icon: "laptop", color: "#15803d" },
  { name: "Missions ponctuelles", icon: "zap", color: "#65a30d" },
  { name: "Allocations", icon: "hand-coins", color: "#0d9488" },
  { name: "Bourses", icon: "graduation-cap", color: "#0891b2" },
  { name: "Remboursements", icon: "undo-2", color: "#2563eb" },
  { name: "Revenus locatifs", icon: "building", color: "#4f46e5" },
  { name: "Intérêts", icon: "percent", color: "#059669" },
  { name: "Dividendes", icon: "trending-up", color: "#047857" },
  { name: "Autres revenus", icon: "plus-circle", color: "#22c55e" },
];

export async function ensureDefaultCategories(ctx: Ctx) {
  const existing = await ctx.tx.select({ c: sql<number>`count(*)::int` }).from(s.categories);
  if ((existing[0]?.c ?? 0) > 0) return;
  let order = 0;
  for (const [kind, defs] of [
    ["expense", DEFAULT_EXPENSE_CATEGORIES],
    ["income", DEFAULT_INCOME_CATEGORIES],
  ] as const) {
    for (const d of defs) {
      const [parent] = await ctx.tx
        .insert(s.categories)
        .values({ userId: ctx.userId, name: d.name, kind, icon: d.icon, color: d.color, isFixed: d.isFixed ?? false, sortOrder: order++ })
        .returning({ id: s.categories.id });
      if (d.children?.length) {
        await ctx.tx.insert(s.categories).values(
          d.children.map((name, i) => ({ userId: ctx.userId, name, kind, icon: d.icon, color: d.color, isFixed: d.isFixed ?? false, parentId: parent.id, sortOrder: i })),
        );
      }
    }
  }
}

export async function createCategory(ctx: Ctx, input: z.infer<typeof categorySchema>) {
  if (input.parentId) {
    const [parent] = await ctx.tx.select().from(s.categories).where(eq(s.categories.id, input.parentId));
    if (!parent) throw new ServiceError("Catégorie parente introuvable");
    if (parent.parentId) throw new ServiceError("Une sous-catégorie ne peut pas contenir d'autres sous-catégories");
    if (parent.kind !== input.kind) throw new ServiceError("La catégorie parente n'est pas du même type");
  }
  const [{ max }] = await ctx.tx.select({ max: sql<number>`coalesce(max(sort_order), 0)::int` }).from(s.categories);
  const [row] = await ctx.tx.insert(s.categories).values({ ...input, userId: ctx.userId, sortOrder: max + 1 }).returning();
  await audit(ctx, "category.create", "category", row.id);
  return row;
}

export async function updateCategory(ctx: Ctx, id: string, input: z.infer<typeof categorySchema>) {
  if (input.parentId === id) throw new ServiceError("Une catégorie ne peut pas être sa propre parente");
  if (input.parentId) {
    const children = await ctx.tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.parentId, id));
    if (children.length) throw new ServiceError("Cette catégorie a des sous-catégories : elle ne peut pas devenir une sous-catégorie");
  }
  const [row] = await ctx.tx.update(s.categories).set(input).where(eq(s.categories.id, id)).returning();
  if (!row) throw new ServiceError("Catégorie introuvable");
  await audit(ctx, "category.update", "category", id);
  return row;
}

/** Supprime une catégorie : les opérations concernées deviennent « non catégorisées » (ou passent dans `replacementId`). */
export async function deleteCategory(ctx: Ctx, id: string, replacementId: string | null) {
  const [cat] = await ctx.tx.select().from(s.categories).where(eq(s.categories.id, id));
  if (!cat) throw new ServiceError("Catégorie introuvable");
  const ids = [id, ...(await ctx.tx.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.parentId, id))).map((r) => r.id)];
  if (replacementId && ids.includes(replacementId)) throw new ServiceError("La catégorie de remplacement doit être différente");
  for (const cid of ids) {
    await ctx.tx.update(s.transactions).set({ categoryId: replacementId }).where(eq(s.transactions.categoryId, cid));
    await ctx.tx.update(s.recurringItems).set({ categoryId: replacementId }).where(eq(s.recurringItems.categoryId, cid));
    await ctx.tx.delete(s.budgets).where(eq(s.budgets.categoryId, cid));
  }
  await ctx.tx.delete(s.categories).where(and(eq(s.categories.id, id)));
  await audit(ctx, "category.delete", "category", id, { replacementId });
}

export async function reorderCategories(ctx: Ctx, orderedIds: string[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await ctx.tx.update(s.categories).set({ sortOrder: i }).where(eq(s.categories.id, orderedIds[i]));
  }
}
