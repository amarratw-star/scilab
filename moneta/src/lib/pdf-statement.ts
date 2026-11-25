/**
 * Lecture d'un relevé de compte bancaire PDF (texte, non scanné) à partir des fragments de texte positionnés
 * extraits par PDF.js. Conçu pour les relevés « tableau » des banques françaises (Banque Populaire et réseau
 * BPCE notamment) : colonnes DATE · LIBELLÉ · (DATE VALEUR) · DÉBIT · CRÉDIT, soldes « ancien / nouveau ».
 *
 * Fonction pure, testable : aucune donnée n'est inventée. Une ligne dont le montant ou la date est illisible est
 * ignorée et signalée ; le rapprochement « ancien solde + mouvements = nouveau solde » indique si la lecture
 * est complète.
 */

export interface PdfTextItem {
  str: string;
  x: number; // abscisse gauche (points PDF)
  y: number; // ordonnée de la ligne de base (points PDF, origine en bas)
  w: number; // largeur
  page: number;
}

export interface StatementRow {
  date: string; // AAAA-MM-JJ
  label: string;
  amount: number; // centimes, signé (− débit, + crédit)
}

export interface StatementSection {
  title: string | null;
  rows: StatementRow[];
  opening: { amount: number; date: string | null } | null;
  closing: { amount: number; date: string | null } | null;
  /** ancien solde + mouvements − nouveau solde (centimes) ; 0 = lecture complète ; null = soldes absents */
  gap: number | null;
}

export interface StatementResult {
  sections: StatementSection[];
  period: { from: string; to: string } | null;
  warnings: string[];
}

const AMOUNT_RE = /^[-+]?\s?\d{1,3}(?:[ .  ]\d{3})*,\d{2}\s?(?:€|EUR)?\s?[-+]?$/i;
const DATE_START_RE = /^(\d{2})[/.](\d{2})(?:[/.](\d{2}|\d{4}))?(?=\s|$)/;
const FULL_DATE_RE = /(\d{2})[/.](\d{2})[/.](\d{4})/g;
const BALANCE_RE = /solde/i;
const SKIP_RE = /total des (mouvements|op[ée]rations)|^report|sous[- ]total|solde interm[ée]diaire/i;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;

export function parseFrenchAmount(s: string): number | null {
  const t = s.replace(/[€\s  ]|EUR/gi, "");
  const neg = t.startsWith("-") || t.endsWith("-");
  const core = t.replace(/^[-+]|[-+]$/g, "").replace(/\./g, "").replace(",", ".");
  if (!/^\d+\.\d{2}$/.test(core)) return null;
  const cents = Math.round(Number(core) * 100);
  return neg ? -cents : cents;
}

type Line = { page: number; y: number; items: PdfTextItem[]; text: string };

/** Regroupe les fragments en lignes (même page, même ordonnée à ±2,5 pt), triées de haut en bas. */
export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
    else lines.push({ page: it.page, y: it.y, items: [it], text: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines;
}

/** Découpe un fragment qui contient plusieurs colonnes collées (« 12/10 CB CARREFOUR 45,20 »). */
function splitItem(it: PdfTextItem): PdfTextItem[] {
  const parts = it.str.split(/(\s{2,})/);
  if (parts.length === 1) return [it];
  const out: PdfTextItem[] = [];
  const charW = it.str.length ? it.w / it.str.length : 0;
  let offset = 0;
  for (const p of parts) {
    if (p.trim()) out.push({ ...it, str: p.trim(), x: it.x + offset * charW, w: p.length * charW });
    offset += p.length;
  }
  return out;
}

export function parseStatement(items: PdfTextItem[]): StatementResult {
  const lines = groupLines(items.flatMap(splitItem));
  const all = lines.map((l) => l.text).join("\n");
  const warnings: string[] = [];

  // Période du relevé : « du 01/10/2026 au 31/10/2026 », sinon dates complètes extrêmes
  let period: StatementResult["period"] = null;
  const per = /du\s+(\d{2})[/.](\d{2})[/.](\d{4})\s+au\s+(\d{2})[/.](\d{2})[/.](\d{4})/i.exec(all);
  if (per) period = { from: iso(+per[3], +per[2], +per[1]), to: iso(+per[6], +per[5], +per[4]) };
  else {
    const full = [...all.matchAll(FULL_DATE_RE)].map((m) => iso(+m[3], +m[2], +m[1])).filter((d) => validDate(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8))).sort();
    if (full.length) period = { from: full[0], to: full[full.length - 1] };
  }
  if (!period) warnings.push("Période du relevé introuvable : l'année des opérations est déduite de la date du jour.");
  const endYear = period ? +period.to.slice(0, 4) : new Date().getFullYear();
  const endMonth = period ? +period.to.slice(5, 7) : 12;
  const resolveDate = (d: number, m: number, y?: string): string | null => {
    let year = y ? (y.length === 2 ? 2000 + +y : +y) : endYear;
    if (!y && period && m > endMonth && period.from.slice(0, 4) !== period.to.slice(0, 4)) year = endYear - 1;
    return validDate(year, m, d) ? iso(year, m, d) : null;
  };

  // Colonnes Débit / Crédit (bord droit des intitulés, mis à jour à chaque en-tête de page)
  let debitRight: number | null = null;
  let creditRight: number | null = null;
  let valueCol: { from: number; to: number } | null = null; // colonne « date de valeur », exclue du libellé
  const classify = (it: PdfTextItem): "debit" | "credit" | null => {
    if (debitRight === null || creditRight === null) return null;
    const right = it.x + it.w;
    return Math.abs(right - debitRight) <= Math.abs(right - creditRight) ? "debit" : "credit";
  };

  const sections: StatementSection[] = [];
  let cur: StatementSection | null = null;
  let labelX: number | null = null;
  let last: StatementRow | null = null;
  let pendingTitle: string | null = null;
  const newSection = () => {
    cur = { title: pendingTitle, rows: [], opening: null, closing: null, gap: null };
    sections.push(cur);
    pendingTitle = null;
    return cur;
  };
  let skipped = 0;

  for (const line of lines) {
    const t = line.text;
        // En-tête de tableau
    if (/d[ée]bit/i.test(t) && /cr[ée]dit/i.test(t) && !line.items.some((i) => AMOUNT_RE.test(i.str.trim()))) {
      const d = line.items.find((i) => /d[ée]bit/i.test(i.str));
      const c = line.items.find((i) => /cr[ée]dit/i.test(i.str));
      if (d && c) {
        debitRight = d.x + d.w;
        creditRight = c.x + c.w;
      }
      // Colonne « date de valeur » : intitulé « VALEUR », ou deuxième intitulé « DATE » de l'en-tête
      // (« DATE VALEUR » est souvent découpé, voire écrit sur deux lignes)
      const dates = line.items.filter((i) => /^date\b/i.test(i.str.trim()));
      const v = line.items.find((i) => /valeur/i.test(i.str)) ?? (dates.length > 1 ? dates[dates.length - 1] : undefined);
      valueCol = v ? { from: v.x - 6, to: v.x + Math.max(v.w, 30) + 6 } : null;
      last = null;
      continue;
    }
    // Titre de compte (pour distinguer plusieurs comptes dans un même relevé)
    if (/^(compte|livret|cpte|ldd|pel|cel|plan|n°)/i.test(t) && !line.items.some((i) => AMOUNT_RE.test(i.str.trim())) && t.length < 90) {
      pendingTitle = t;
      continue;
    }
    const amountItems = line.items.filter((i) => AMOUNT_RE.test(i.str.trim()));
    // Soldes
    if (BALANCE_RE.test(t) && amountItems.length) {
      const it = amountItems[amountItems.length - 1];
      let amount = parseFrenchAmount(it.str) ?? 0;
      const col = classify(it);
      if (/d[ée]biteur/i.test(t) || col === "debit") amount = -Math.abs(amount);
      const dm = /au\s+(\d{2})[/.](\d{2})[/.](\d{2,4})/i.exec(t);
      const date = dm ? resolveDate(+dm[1], +dm[2], dm[3]) : null;
      const isOpeningLabel = /ancien|pr[ée]c[ée]dent/i.test(t);
      const s0 = cur as StatementSection | null;
      if (!s0 || s0.closing !== null || (isOpeningLabel && s0.rows.length > 0)) {
        // Nouveau compte (ou relevé suivant) : ce solde est un solde d'ouverture
        newSection().opening = { amount, date };
      } else if (s0.opening === null && s0.rows.length === 0) s0.opening = { amount, date };
      else s0.closing = { amount, date };
      last = null;
      continue;
    }
    if (SKIP_RE.test(t)) {
      last = null;
      continue;
    }
    const dm = DATE_START_RE.exec(t);
    if (dm && amountItems.length) {
      const date = resolveDate(+dm[1], +dm[2], dm[3]);
      const amIt = amountItems[amountItems.length - 1];
      let cents = parseFrenchAmount(amIt.str);
      if (!date || cents === null || cents === 0) {
        skipped++;
        continue;
      }
      const col = classify(amIt);
      if (col === "debit") cents = -Math.abs(cents);
      else if (col === "credit") cents = Math.abs(cents);
      else if (!/[-+]/.test(amIt.str)) {
        cents = -Math.abs(cents);
        if (!warnings.some((w) => w.startsWith("Colonnes"))) warnings.push("Colonnes Débit/Crédit non détectées : les montants sans signe ont été considérés comme des débits. Vérifie l'aperçu.");
      }
      // Libellé : fragments entre la date et le montant, hors date de valeur
      const inValueCol = (i: PdfTextItem) => valueCol !== null && i.x + i.w / 2 >= valueCol.from && i.x + i.w / 2 <= valueCol.to && DATE_START_RE.test(i.str.trim());
      const labelItems = line.items.filter((i) => i !== amIt && !amountItems.includes(i) && i.x + i.w < amIt.x + 1 && !inValueCol(i));
      let label = labelItems
        .map((i) => i.str.trim())
        .join(" ")
        .replace(DATE_START_RE, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!label) label = "Opération";
      const firstLabel = labelItems.find((i) => !DATE_START_RE.test(i.str.trim()));
      labelX = firstLabel ? firstLabel.x : labelX;
      if (!cur) newSection();
      const row: StatementRow = { date, label: label.slice(0, 200), amount: cents };
      (cur as unknown as StatementSection).rows.push(row);
      last = row;
      continue;
    }
    // Suite du libellé sur la ligne suivante (même colonne, sans date ni montant)
    if (last && !dm && !amountItems.length && labelX !== null && Math.abs(line.items[0].x - labelX) <= 20 && t.length <= 80) {
      last.label = `${last.label} ${t}`.slice(0, 200);
      continue;
    }
    last = null;
  }

  for (const s of sections) {
    if (s.opening && s.closing) s.gap = s.opening.amount + s.rows.reduce((a, r) => a + r.amount, 0) - s.closing.amount;
  }
  if (skipped) warnings.push(`${skipped} ligne(s) au format inattendu ignorée(s).`);
  const kept = sections.filter((s) => s.rows.length || s.opening || s.closing);
  if (!kept.some((s) => s.rows.length)) warnings.push("Aucune opération reconnue dans ce PDF. S'agit-il d'un relevé scanné (image) ? Utilise plutôt l'export CSV de ta banque.");
  return { sections: kept, period, warnings };
}
