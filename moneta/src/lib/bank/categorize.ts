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

/**
 * Codes de catégories Powens (documentation « Categorization », référentiels français et « lending ») →
 * catégories MONETA. Option payante chez Powens, désactivée par défaut : en son absence, les sources
 * suivantes (historique, moteur local) prennent le relais.
 */
const BANK_CODES: Record<string, string> = {
  taxes: "Impôts", social_contributions: "Impôts", government_fees_and_taxes: "Impôts", taxes_and_government_fees: "Impôts", fines_and_penalties: "Impôts",
  banking_fees: "Frais bancaires", "banking fees": "Frais bancaires", account_card_maintenance: "Frais bancaires", account_and_card_maintenance: "Frais bancaires", irregularity_and_incident_fees: "Frais bancaires", intervention_fees: "Frais bancaires", foreign_exchange_fees: "Frais bancaires", rejection_fees: "Frais bancaires", unauthorized_debit_fees: "Frais bancaires",
  insurances: "Assurances", insurance: "Assurances", life_insurance: "Assurances", non_life_insurance: "Assurances", general_insurance: "Assurances", other_insurance: "Assurances", medical_insurance: "Santé", health_insurance_fees: "Santé",
  baker: "Cafés", bakery: "Cafés", bars_restaurants: "Restaurants", restaurant_bar_coffee: "Restaurants", cafes_restaurants_bars: "Restaurants", food_delivery: "Livraison",
  butcher_fishmongers_produce: "Courses alimentaires", supermarket_and_groceries: "Courses alimentaires", supermarkets_and_groceries: "Courses alimentaires", groceries_and_supermarkets: "Courses alimentaires", organic_and_specialty_food: "Courses alimentaires", vending: "Courses alimentaires",
  home_services_cleaning: "Entretien", home_maintenance: "Entretien", works_diy_gardening: "Entretien", kitchen_and_appliances: "Shopping", furniture_and_decoration: "Shopping", homegoods_and_gardening: "Shopping",
  education_and_training: "Études", education_and_courses: "Études", tuition: "Études", online_courses_training_certifications: "Études", child_care_kindergarten: "Études",
  doctors_specialist_dentists_hospitals: "Consultations", doctors_and_hospitals: "Consultations", pharmacy: "Pharmacie", health_and_pharmaceuticals: "Pharmacie", others_healthcare: "Santé",
  energy: "Électricité et gaz", electricity: "Électricité et gaz", natural_gas: "Électricité et gaz", rent: "Loyer", rent_and_maintenance: "Loyer", water: "Eau", others_housing: "Logement",
  cinema_theater_culture: "Loisirs", theatre_cinema_and_culture: "Loisirs", theatre_music_cinema: "Loisirs", hobbies_and_recreation_activities: "Loisirs", others_leisure: "Loisirs", hotels: "Voyages", hotels_and_accommodation: "Voyages", accommodation_travel_expenses: "Voyages",
  sports: "Sport", sport_and_sports_goods: "Sport", fitness_gym_spa_wellness: "Sport", sports_goods: "Sport",
  media_subscriptions: "Abonnements", gaming_software_apps: "Abonnements", phone_internet_tv: "Téléphone et Internet", internet_mobile_tv: "Téléphone et Internet", telephone_internet_tv_computer: "Téléphone et Internet",
  beauty_hairdressing_aesthetic: "Vêtements", beauty_and_cosmetics: "Vêtements", clothing_and_accessories: "Vêtements", clothing_and_shoes: "Vêtements", jewelry_and_accessories: "Vêtements",
  ecommerce: "Shopping", online_shopping: "Shopping", multimedia_books_stationery: "Shopping", books_media_stationery: "Shopping", tech_accessories_and_electronics: "Shopping", department_stores: "Shopping", others_shopping: "Shopping", gifts_and_florists: "Cadeaux",
  fuel_and_vehicle_charging: "Essence", fuel_and_gas: "Essence", fuel: "Essence", parking_maintenance_tolls: "Parking et péage", parking_and_tolls: "Parking et péage", public_transportation: "Transports en commun", local_transportation: "Transports en commun",
  rental_and_taxis: "Taxi et VTC", train_travel: "Transport", plane_or_boat_travel: "Transport", plane_train_boat_travel: "Transport", others_travel_and_transport: "Transport", car_rental: "Transport", vehicle_maintenance_and_repairs: "Transport",
  withdrawal: "Autres", cash_withdrawal: "Autres",
  // revenus
  salary: "Salaire", pensions: "Allocations", pension: "Allocations", family_benefits: "Allocations", unemployment_benefits: "Allocations", other_benefits: "Allocations", housing_benefits: "Allocations",
  rental_income: "Revenus locatifs", income_from_rent: "Revenus locatifs", health_insurance_reimbursement: "Remboursements", insurance_repayments: "Remboursements", refund: "Remboursements", interest_received: "Intérêts", dividends_received: "Dividendes",
};

/** Repli par mots-clés pour des codes non répertoriés (référentiel susceptible d'évoluer). */
const BANK_CODE_HINTS: [RegExp, string][] = [
  [/grocer|supermarket|food_shop/i, "Courses alimentaires"],
  [/restaurant|fast.?food|food_and_drink/i, "Restaurants"],
  [/rent|housing|mortgage/i, "Logement"],
  [/energy|electric|utilit/i, "Logement"],
  [/transport|train|taxi|parking|toll/i, "Transport"],
  [/fuel|gas_station/i, "Essence"],
  [/health|pharma|medical|doctor/i, "Santé"],
  [/sport|gym|fitness/i, "Sport"],
  [/subscription|streaming/i, "Abonnements"],
  [/phone|internet|telecom|mobile/i, "Téléphone et Internet"],
  [/cloth|apparel/i, "Vêtements"],
  [/shopping|retail|electronics|commerce/i, "Shopping"],
  [/travel|hotel|flight/i, "Voyages"],
  [/leisure|entertainment|culture/i, "Loisirs"],
  [/insurance/i, "Assurances"],
  [/tax/i, "Impôts"],
  [/bank_fee|fees/i, "Frais bancaires"],
  [/education|school/i, "Études"],
  [/gift|donation/i, "Cadeaux"],
  [/salary|payroll/i, "Salaire"],
  [/refund|reimburse/i, "Remboursements"],
  [/interest/i, "Intérêts"],
  [/dividend/i, "Dividendes"],
  [/allowance|benefit/i, "Allocations"],
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
  // Codes précis (enfants) avant les codes parents
  for (const code of input.bankCategories ?? []) {
    const exact = BANK_CODES[code.trim()];
    const id = exact ? byName(exact) : null;
    if (id) return { categoryId: id, confidence: 80, source: "bank" };
  }
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
