/**
 * Catégorisation automatique — sources considérées, par ordre de priorité :
 *  1. Règle personnelle de l'utilisateur (prioritaire : c'est un choix explicite)     confiance 95
 *  2. Catégorie fournie par la banque / l'agrégateur, si elle correspond à une catégorie MONETA   70
 *  3. Historique : commerçant déjà rencontré, catégorie constante                       85 (≥ 3 fois) / 75 (2 fois)
 *  4. Moteur local de mots-clés                                                         60
 * En dessous de 70, la catégorie est proposée mais demande confirmation.
 */
import { normalizeLabel } from "@/lib/finance/labels";
import { suggestCategoryName } from "@/lib/csv-import";

export type CategorySource = "rule" | "bank" | "history" | "local" | "ai" | "user";
export interface CategoryGuess {
  categoryId: string | null;
  confidence: number;
  source: CategorySource | null;
}
export const CONFIRM_THRESHOLD = 70;

export interface CategorizeContext {
  categories: { id: string; name: string; kind: "expense" | "income" }[];
  rules: { pattern: string; categoryId: string }[];
  /** clé commerçant → { catégorie → nombre } */
  history: Map<string, Map<string, number>>;
}

/** Correspondances des codes de catégorie bancaires (codes non garantis : rapprochement par mots-clés). */
const BANK_CODE_HINTS: [RegExp, string][] = [
  [/grocer|supermarket|alimentation|food_shop/i, "Courses alimentaires"],
  [/restaurant|fast.?food|food_and_drink|bar/i, "Restaurants"],
  [/coffee|cafe/i, "Cafés"],
  [/rent|loyer|housing|logement|mortgage/i, "Logement"],
  [/energy|electric|gas_|water|utilit/i, "Logement"],
  [/transport|train|taxi|parking|toll|public_transport/i, "Transport"],
  [/fuel|carburant|gas_station/i, "Essence"],
  [/health|pharma|medical|doctor|sante/i, "Santé"],
  [/sport|gym|fitness/i, "Sport"],
  [/subscription|streaming|abonnement/i, "Abonnements"],
  [/phone|internet|telecom|mobile/i, "Téléphone et Internet"],
  [/cloth|apparel|vetement/i, "Vêtements"],
  [/shopping|retail|electronics|e.?commerce/i, "Shopping"],
  [/travel|hotel|flight|voyage/i, "Voyages"],
  [/leisure|entertainment|culture|loisir/i, "Loisirs"],
  [/insurance|assurance/i, "Assurances"],
  [/tax|impot/i, "Impôts"],
  [/bank_fee|fees|frais/i, "Frais bancaires"],
  [/education|school|etude/i, "Études"],
  [/gift|cadeau|donation/i, "Cadeaux"],
  [/salary|salaire|payroll/i, "Salaire"],
  [/refund|rembourse/i, "Remboursements"],
  [/interest|interet/i, "Intérêts"],
  [/dividend/i, "Dividendes"],
  [/allowance|benefit|allocation/i, "Allocations"],
];

export function merchantKey(merchant: string | null | undefined, label: string | null | undefined): string {
  return normalizeLabel(merchant || label || "").split(" ").slice(0, 3).join(" ");
}

export function categorize(input: { label: string; merchant?: string | null; bankCategories?: string[]; isIncome: boolean }, ctx: CategorizeContext): CategoryGuess {
  const kind = input.isIncome ? "income" : "expense";
  const byName = (name: string) => ctx.categories.find((c) => c.kind === kind && c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const key = merchantKey(input.merchant, input.label);
  const fullKey = normalizeLabel(`${input.merchant ?? ""} ${input.label}`);
  // 1. Règles personnelles
  const rule = ctx.rules.find((r) => r.pattern && (key.includes(r.pattern) || fullKey.includes(r.pattern)));
  if (rule && ctx.categories.some((c) => c.id === rule.categoryId && c.kind === kind)) return { categoryId: rule.categoryId, confidence: 95, source: "rule" };
  // 2. Catégorie bancaire
  for (const code of input.bankCategories ?? []) {
    const hint = BANK_CODE_HINTS.find(([re]) => re.test(code));
    const id = hint ? byName(hint[1]) : null;
    if (id) return { categoryId: id, confidence: 70, source: "bank" };
  }
  // 3. Historique du commerçant
  const h = key ? ctx.history.get(key) : undefined;
  if (h && h.size) {
    const total = [...h.values()].reduce((s, v) => s + v, 0);
    const [best, count] = [...h.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count >= 2 && count / total >= 0.8 && ctx.categories.some((c) => c.id === best && c.kind === kind)) return { categoryId: best, confidence: count >= 3 ? 85 : 75, source: "history" };
  }
  // 4. Moteur local
  const local = suggestCategoryName(`${input.merchant ?? ""} ${input.label}`, input.isIncome);
  const localId = local ? byName(local) : null;
  if (localId) return { categoryId: localId, confidence: 60, source: "local" };
  return { categoryId: null, confidence: 0, source: null };
}

/** Suggestions de règles à mémoriser : un commerçant corrigé au moins 2 fois vers la même catégorie. */
export function ruleSuggestions(corrections: { key: string; categoryId: string }[], existing: { pattern: string }[]): { pattern: string; categoryId: string; count: number }[] {
  const m = new Map<string, Map<string, number>>();
  for (const c of corrections) {
    if (!c.key) continue;
    const inner = m.get(c.key) ?? new Map<string, number>();
    inner.set(c.categoryId, (inner.get(c.categoryId) ?? 0) + 1);
    m.set(c.key, inner);
  }
  const out: { pattern: string; categoryId: string; count: number }[] = [];
  for (const [key, inner] of m) {
    if (existing.some((r) => r.pattern === key)) continue;
    const [cat, count] = [...inner.entries()].sort((a, b) => b[1] - a[1])[0];
    if (count >= 2) out.push({ pattern: key, categoryId: cat, count });
  }
  return out.sort((a, b) => b.count - a.count);
}
