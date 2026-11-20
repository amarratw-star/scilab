/**
 * Patrimoine.
 *  - Patrimoine brut = comptes (soldes positifs et négatifs) + actifs déclarés (dernière valorisation).
 *  - Patrimoine net  = patrimoine brut − passifs (dernier capital restant dû déclaré).
 * Les valorisations sont déclaratives (manuelles ou estimées) : jamais des valorisations officielles.
 */
import { endOfMonth, eachMonth, type ISODate } from "@/lib/dates";

export interface WealthItemInput {
  id: string;
  kind: "asset" | "liability";
  name: string;
  category: string;
  archived: boolean;
  valuations: { date: ISODate; value: number; method: "manual" | "estimated" }[];
}

export function latestValuation(item: WealthItemInput, asOf: ISODate) {
  let best: WealthItemInput["valuations"][number] | null = null;
  for (const v of item.valuations) if (v.date <= asOf && (!best || v.date > best.date)) best = v;
  return best;
}

export interface NetWorth {
  accountsTotal: number;
  assetsTotal: number;
  liabilitiesTotal: number;
  gross: number;
  net: number;
  estimatedShare: number; // part des actifs basée sur des estimations
}

export function netWorth(accountsTotal: number, items: WealthItemInput[], asOf: ISODate): NetWorth {
  let assetsTotal = 0;
  let liabilitiesTotal = 0;
  let estimated = 0;
  for (const it of items) {
    if (it.archived) continue;
    const v = latestValuation(it, asOf);
    if (!v) continue;
    if (it.kind === "asset") {
      assetsTotal += v.value;
      if (v.method === "estimated") estimated += v.value;
    } else liabilitiesTotal += v.value;
  }
  const gross = accountsTotal + assetsTotal;
  return {
    accountsTotal,
    assetsTotal,
    liabilitiesTotal,
    gross,
    net: gross - liabilitiesTotal,
    estimatedShare: assetsTotal > 0 ? estimated / assetsTotal : 0,
  };
}

/** Évolution mensuelle (fin de mois) du patrimoine net. `accountsAt` donne le total des comptes à une date. */
export function netWorthHistory(
  from: ISODate,
  to: ISODate,
  items: WealthItemInput[],
  accountsAt: (date: ISODate) => number,
): { month: string; date: ISODate; accounts: number; assets: number; liabilities: number; net: number }[] {
  return eachMonth(from, to).map((m) => {
    const end = endOfMonth(`${m}-01`);
    const date = end > to ? to : end;
    const nw = netWorth(accountsAt(date), items, date);
    return { month: m, date, accounts: nw.accountsTotal, assets: nw.assetsTotal, liabilities: nw.liabilitiesTotal, net: nw.net };
  });
}

export const ASSET_CATEGORIES: Record<string, string> = {
  real_estate: "Immobilier",
  vehicle: "Véhicule",
  investment: "Placement / investissement",
  retirement: "Épargne retraite",
  valuables: "Objets de valeur",
  other_asset: "Autre actif",
};

export const LIABILITY_CATEGORIES: Record<string, string> = {
  mortgage: "Crédit immobilier",
  car_loan: "Crédit automobile",
  student_loan: "Prêt étudiant",
  consumer_loan: "Crédit à la consommation",
  personal_debt: "Dette personnelle",
  other_liability: "Autre engagement",
};
