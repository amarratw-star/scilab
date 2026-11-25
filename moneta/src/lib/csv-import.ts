/**
 * Import de relevés bancaires CSV : détection du séparateur, correspondance intelligente des colonnes,
 * analyse des montants (format français ou international), débit/crédit séparés, empreinte anti-doublon.
 * Fonctions pures : utilisables côté client (aperçu) et côté serveur (validation).
 */
import Papa from "papaparse";
import { parseFrenchDate, type ISODate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";
import { normalizeLabel } from "@/lib/finance/insights";

export type ColumnRole = "date" | "label" | "amount" | "debit" | "credit" | "account" | "category" | "ignore";

export interface ColumnMapping {
  date: number | null;
  label: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  account: number | null;
  category: number | null;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export function parseCsvText(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, "");
  const res = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimiter: "" });
  const data = (res.data as string[][]).filter((r) => r.some((c) => c && c.trim()));
  if (!data.length) return { headers: [], rows: [], delimiter: res.meta.delimiter };
  // Certaines banques ajoutent des lignes d'en-tête (titulaire, période...) : on cherche la première
  // ligne qui ressemble à une ligne d'en-têtes (au moins 2 colonnes, et la suivante contient une date).
  let headerIndex = 0;
  const looksLikeHeader = (row: string[]) =>
    row.some((c) => PATTERNS.date.test(c.trim())) && row.some((c) => PATTERNS.label.test(c) || PATTERNS.amount.test(c.trim()) || PATTERNS.debit.test(c));
  const explicit = data.slice(0, 15).findIndex(looksLikeHeader);
  if (explicit >= 0) headerIndex = explicit;
  else for (let i = 0; i < Math.min(15, data.length - 1); i++) {
    const row = data[i];
    const next = data[i + 1];
    if (row.length >= 2 && next.length === row.length && next.some((c) => parseFrenchDate(c.trim()) !== null) && !row.some((c) => parseFrenchDate(c.trim()) !== null)) {
      headerIndex = i;
      break;
    }
  }
  const headers = data[headerIndex].map((h) => h.trim());
  const rows = data.slice(headerIndex + 1).filter((r) => r.length >= Math.min(2, headers.length));
  return { headers, rows, delimiter: res.meta.delimiter };
}

const PATTERNS: Record<Exclude<ColumnRole, "ignore">, RegExp> = {
  date: /^(date|date op(e|é)ration|date d.op(e|é)ration|date comptable|date de comptabilisation|date valeur|booking date|transaction date|jour)/i,
  label: /(libell(e|é)|description|d(e|é)tail|intitul(e|é)|nature|label|wording|motif|b(e|é)n(e|é)ficiaire|communication|merchant|payee)/i,
  amount: /^(montant|amount|somme|valeur|montant \(eur\)|montant eur|montant en euros)$/i,
  debit: /(d(e|é)bit|sortie|withdrawal|d(e|é)penses?)/i,
  credit: /(cr(e|é)dit|entr(e|é)e|deposit|recettes?)/i,
  account: /(compte|account|iban|rib)/i,
  category: /(cat(e|é)gorie|category)/i,
};

/** Devine la correspondance des colonnes à partir des en-têtes et du contenu. */
export function guessMapping(csv: ParsedCsv): ColumnMapping {
  const m: ColumnMapping = { date: null, label: null, amount: null, debit: null, credit: null, account: null, category: null };
  const used = new Set<number>();
  const pick = (role: keyof ColumnMapping, test: (h: string, i: number) => boolean) => {
    if (m[role] !== null) return;
    const idx = csv.headers.findIndex((h, i) => !used.has(i) && test(h, i));
    if (idx >= 0) {
      m[role] = idx;
      used.add(idx);
    }
  };
  pick("date", (h) => PATTERNS.date.test(h));
  pick("debit", (h) => PATTERNS.debit.test(h) && !PATTERNS.date.test(h));
  pick("credit", (h) => PATTERNS.credit.test(h) && !PATTERNS.date.test(h));
  pick("amount", (h) => PATTERNS.amount.test(h) || /montant/i.test(h));
  pick("label", (h) => PATTERNS.label.test(h));
  pick("category", (h) => PATTERNS.category.test(h));
  pick("account", (h) => PATTERNS.account.test(h));
  const sample = csv.rows.slice(0, 20);
  // Repli sur le contenu
  if (m.date === null) {
    pick("date", (_h, i) => sample.length > 0 && sample.filter((r) => parseFrenchDate((r[i] ?? "").trim())).length >= sample.length * 0.8);
  }
  if (m.amount === null && m.debit === null && m.credit === null) {
    pick("amount", (_h, i) => sample.length > 0 && sample.filter((r) => parseAmountToCents(r[i] ?? "") !== null && /\d/.test(r[i] ?? "")).length >= sample.length * 0.8);
  }
  if (m.label === null) {
    let best = -1;
    let bestLen = 0;
    csv.headers.forEach((_h, i) => {
      if (used.has(i)) return;
      const avg = sample.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / Math.max(1, sample.length);
      if (avg > bestLen) {
        bestLen = avg;
        best = i;
      }
    });
    if (best >= 0) m.label = best;
  }
  // Si débit ET montant détectés, on privilégie débit/crédit uniquement si crédit est aussi présent
  if (m.amount !== null && (m.debit === null || m.credit === null)) {
    m.debit = null;
    m.credit = null;
  }
  return m;
}

export interface ImportRow {
  index: number;
  date: ISODate | null;
  label: string;
  amount: number | null; // signé : négatif = sortie
  accountLabel: string | null;
  categoryLabel: string | null;
  errors: string[];
}

export function extractRows(csv: ParsedCsv, mapping: ColumnMapping): ImportRow[] {
  return csv.rows.map((r, index) => {
    const errors: string[] = [];
    const get = (i: number | null) => (i === null ? "" : (r[i] ?? "").trim());
    const date = parseFrenchDate(get(mapping.date));
    if (!date) errors.push("Date invalide");
    let amount: number | null = null;
    if (mapping.amount !== null) {
      amount = parseAmountToCents(get(mapping.amount));
    } else if (mapping.debit !== null || mapping.credit !== null) {
      const d = get(mapping.debit);
      const c = get(mapping.credit);
      const dv = d ? parseAmountToCents(d) : 0;
      const cv = c ? parseAmountToCents(c) : 0;
      if (dv === null || cv === null) amount = null;
      else amount = Math.abs(cv) - Math.abs(dv);
    }
    if (amount === null) errors.push("Montant invalide");
    else if (amount === 0) errors.push("Montant nul");
    const label = get(mapping.label) || "(sans libellé)";
    return {
      index,
      date,
      label,
      amount,
      accountLabel: mapping.account !== null ? get(mapping.account) || null : null,
      categoryLabel: mapping.category !== null ? get(mapping.category) || null : null,
      errors,
    };
  });
}

/** Empreinte stable d'une opération importée (compte + date + montant + libellé normalisé). */
export async function importFingerprint(accountId: string, date: ISODate, amount: number, label: string): Promise<string> {
  const raw = `${accountId}|${date}|${amount}|${normalizeLabel(label) || label.toLowerCase().trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Règles simples de catégorisation automatique à partir du libellé (suggestion, modifiable avant import). */
/**
 * Moteur local de suggestion (aucun appel externe) : enseignes et motifs fréquents des libellés bancaires
 * français. L'ordre compte : les motifs les plus spécifiques d'abord. Les noms renvoyés sont ceux des
 * catégories par défaut de MONETA (sous-catégories comprises) ; une catégorie absente chez l'utilisateur
 * est simplement ignorée.
 */
const CATEGORY_HINTS: [RegExp, string][] = [
  // Frais et opérations bancaires
  [/(cotisation (carte|offre|forfait)|cotis carte|frais (de )?tenue|frais bancaires?|commission d intervention|commission|agios|interets debiteurs|frais (sur )?(retrait|paiement|virement|rejet|opposition)|abonnement (cyberplus|banque a distance)|offre (cristal|equilibre|initiatives)|frais carte|carte (visa|mastercard) (premier|classic|gold)|tenue de compte|frais d incident)/, "Frais bancaires"],
  // Logement
  [/(loyer|foncia|nexity|citya|orpi|century 21|laforet|syndic|copropriete|bailleur|habitat|immobiliere|opac|cdc habitat|sogeprom|location appartement)/, "Loyer"],
  [/(edf|engie|electricite|total ?energies (electricite|gaz)|total direct energie|ekwateur|ohm energie|mint energie|eni gaz|gaz de bordeaux|vattenfall|planete oui|enercoop|gazprom energy|happ e)/, "Électricité et gaz"],
  [/(veolia|suez|eau de paris|saur|eaux de|service des eaux|regie des eaux)/, "Eau"],
  [/(leroy merlin|castorama|brico|mr bricolage|weldom|point p|bricomarche|truffaut|jardiland|gamm vert|plombier|serrurier)/, "Entretien"],
  // Alimentation
  [/(deliveroo|uber ?eats|just ?eat|frichti|getir|flink|gorillas|stuart)/, "Livraison"],
  [/(mcdo|mc do|mcdonald|burger king|kfc|quick|five guys|subway|o tacos|otacos|domino|pizza hut|big fernand|bagelstein|pret a manger|class croute|brioche doree|paul |la mie caline)/, "Fast-food"],
  [/(starbucks|columbus|coffee|cafe |cafeteria|nespresso|boulangerie|patisserie|bakery|maison kayser|eric kayser)/, "Cafés"],
  [/(carrefour|leclerc|auchan|lidl|intermarche|monoprix|monop|franprix|casino|geant|super ?u|hyper ?u|systeme u|u express|picard|aldi|biocoop|grand frais|naturalia|la vie claire|netto|leader price|cora|match |spar |vival|proxi|coccinelle|diagonal|g20|marche frais|la grande epicerie|bio c bon|thiriet|chronodrive|epicerie|primeur|boucherie|poissonnerie|fromagerie|halles|marche )/, "Courses alimentaires"],
  [/(restaurant|resto|brasserie|bistrot|bistro|creperie|pizzeria|sushi|traiteur|kebab|tacos|grill|buffalo|hippopotamus|courtepaille|flunch|del arte|la boucherie|leon de bruxelles|au bureau|les 3 brasseurs|wok|ramen|noodle|thai|indien|libanais)/, "Restaurants"],
  // Transport
  [/(ratp|navigo|tcl |tisseo|tan |tbm |star |transpole|ilevia|keolis|transdev|rtm |velib|velo v|lime|dott|tier |cityscoot|cooltra|bus |tram|metro)/, "Transports en commun"],
  [/(uber|bolt|heetch|marcel|g7|taxi|free ?now|lecab|blablacar daily)/, "Taxi et VTC"],
  [/(parking|indigo|effia|onepark|saemes|zenpark|interparking|autoroute|peage|sanef|vinci autoroutes|aprr|asf |cofiroute|area |bip ?& ?go|ulys|fourriere)/, "Parking et péage"],
  [/(sncf|ouigo|tgv|ter |intercites|trainline|eurostar|thalys|blablacar|flixbus|blablabus|air france|transavia|easyjet|ryanair|vueling|volotea|lufthansa|klm|aeroport|airport)/, "Transport"],
  [/(total |totalenergies station|esso|shell|bp |avia|station service|carburant|essence|gazole|intermarche carbu|leclerc carbu|carrefour station|dyneff|agip|ionity|tesla supercharger|freshmile|chargemap|recharge)/, "Essence"],
  [/(norauto|feu vert|midas|speedy|point s|euromaster|controle technique|dekra|autosur|garage|carrosserie)/, "Transport"],
  // Santé
  [/(pharmacie|pharma|parapharmacie)/, "Pharmacie"],
  [/(docteur|dr |medecin|dentiste|orthodont|kine|kinesitherapeute|osteopathe|ophtalmo|dermato|gyneco|pediatre|psychologue|laboratoire|labo |biologie|radiologie|imagerie|clinique|hopital|centre hospitalier|doctolib|optique|opticien|krys|afflelou|optic 2000|audition)/, "Consultations"],
  [/(mutuelle|harmonie|mgen|malakoff|ag2r|apicil)/, "Santé"],
  // Sport, loisirs, sorties
  [/(basic ?fit|fitness park|neoness|keep cool|l orange bleue|on air|cmg sports|salle de sport|club sportif|piscine|decathlon|go sport|intersport|sport 2000|foot|tennis|golf|escalade|climb)/, "Sport"],
  [/(netflix|spotify|deezer|disney|canal ?\+|canal plus|amazon prime|prime video|apple\.com|apple com|itunes|icloud|youtube|adobe|microsoft|office 365|google (storage|one|play)|chatgpt|openai|anthropic|claude|notion|dropbox|patreon|twitch|crunchyroll|molotov|dazn|bein|audible|kindle|playstation plus|xbox game pass|nintendo online)/, "Abonnements"],
  [/(free mobile|free telecom|freebox|orange|sosh|sfr|red by sfr|bouygues|b ?& ?you|la poste mobile|prixtel|nrj mobile|lebara|lycamobile|syma)/, "Téléphone et Internet"],
  [/(cinema|ugc|pathe|gaumont|mk2|cgr|kinepolis|concert|spectacle|theatre|musee|exposition|fnac spectacles|ticketmaster|see tickets|digitick|billetreduc|parc asterix|disneyland|futuroscope|bowling|escape game|laser game|karting|steam|playstation|nintendo|xbox|epic games|riot|blizzard|micromania|cultura)/, "Loisirs"],
  [/(bar |pub |club|discotheque|boite de nuit|soiree|cave a|nicolas |v and b|v ?& ?b)/, "Sorties"],
  [/(airbnb|booking|hotel|ibis|accor|novotel|mercure|campanile|b ?& ?b hotel|premiere classe|kyriad|abritel|gites|camping|expedia|hostel|logis)/, "Voyages"],
  [/(club med|pierre et vacances|center parcs|belambra|vvf|odalys|ucpa|location vacances)/, "Vacances"],
  // Shopping
  [/(zara|h ?& ?m|h et m|uniqlo|kiabi|celio|jules|primark|vinted|zalando|shein|bershka|pull ?& ?bear|stradivarius|mango|promod|camaieu|etam|undiz|jennyfer|gemo|la halle|c ?& ?a |courir|foot locker|jd sports|nike|adidas|lacoste|galeries lafayette|printemps|bon marche|sephora|nocibe|marionnaud|yves rocher|kiko|lush|coiffeur|coiffure|barbier|esthetique|onglerie)/, "Vêtements"],
  [/(amazon|amzn|fnac|darty|boulanger|cdiscount|ikea|maisons du monde|but |conforama|alinea|action |gifi|la foirfouille|hema|normal |flying tiger|aliexpress|temu|wish|ebay|rakuten|leboncoin|back market|apple store|samsung|ldlc|materiel\.net|rue du commerce|veepee|showroomprive|la redoute|etsy|paypal \*|sumup|zettle)/, "Shopping"],
  [/(fleuriste|interflora|cadeau|cadeaux|nature et decouvertes|la grande recre|king jouet|jouet|toys)/, "Cadeaux"],
  // Études
  [/(universite|ecole|lycee|college|cours |formation|udemy|coursera|openclassrooms|librairie|gibert|crous|cantine|scolarite|frais d inscription)/, "Études"],
  // Impôts, assurances
  [/(impot|impots|dgfip|tresor public|finances publiques|taxe|amende|antai|urssaf|cfe )/, "Impôts"],
  [/(assurance|assur|maif|macif|matmut|axa|allianz|gmf|groupama|maaf|mma |generali|swisslife|ag2r|alan|luko|lovys|leocare|direct assurance|olivier assurance|amv|april |cardif|pacifica|predica|bpce assurances|bpce vie)/, "Assurances"],
  // Retraits d'espèces au distributeur
  [/(retrait dab|retrait gab|retrait especes|retrait au distributeur|retrait cb|^ ?ret dab| dab | gab )/, "Retraits d'espèces"],
];

const INCOME_HINTS: [RegExp, string][] = [
  [/(salaire|paie|payroll|remuneration|virement salaire|vir salaire)/, "Salaire"],
  [/(caf |c a f|allocation|pole emploi|france travail|apl |prime d activite|msa )/, "Allocations"],
  [/(bourse|crous)/, "Bourses"],
  [/(remboursement|rembt|rbt|ameli|cpam|caisse primaire|mutuelle|harmonie|mgen|avoir|refund|retour)/, "Remboursements"],
  [/(interets|interet|remuneration livret)/, "Intérêts"],
  [/(dividende|coupon)/, "Dividendes"],
  [/(loyer recu|locataire|loyer)/, "Revenus locatifs"],
  [/(facture|prestation|honoraires|malt|urssaf|stripe|sumup payout|paypal payout|shopify)/, "Revenus indépendants"],
];

export function suggestCategoryName(label: string, isIncome: boolean): string | null {
  const n = " " + normalizeLabel(label) + " ";
  const raw = " " + label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
  for (const [re, name] of isIncome ? INCOME_HINTS : CATEGORY_HINTS) if (re.test(n) || re.test(raw)) return name;
  return null;
}
