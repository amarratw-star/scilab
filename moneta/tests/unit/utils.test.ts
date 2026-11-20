import { describe, expect, it } from "vitest";
import { centsToInput, formatMoneyPlain, formatPct, parseAmountToCents, pctChange, safeRatio } from "@/lib/money";
import { addMonths, daysInMonth, diffDays, formatDateFR, isLeapYear, isValidISODate, parseFrenchDate, startOfWeek, todayInTimeZone } from "@/lib/dates";
import { extractRows, guessMapping, parseCsvText, suggestCategoryName } from "@/lib/csv-import";
import { parseReceiptText } from "@/lib/receipt-parser";

describe("montants", () => {
  it.each([
    ["12", 1200],
    ["12,5", 1250],
    ["12.50", 1250],
    ["1 234,56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-8,90", -890],
    ["8,90-", -890],
    ["12 €", 1200],
    ["0,10", 10],
    ["0.1", 10],
    ["1.234", 123400],
    ["19,999", 2000],
    ["(15,00)", -1500],
  ])("parse %s", (input, expected) => {
    expect(parseAmountToCents(input)).toBe(expected);
  });
  it.each(["", "abc", "12,3a", "--", "€"])("rejette %s", (input) => {
    expect(parseAmountToCents(input)).toBeNull();
  });
  it("pas d'erreur de flottant (0,1 + 0,2)", () => {
    expect(parseAmountToCents("0,1")! + parseAmountToCents("0,2")!).toBe(30);
  });
  it("formatage français", () => {
    expect(formatMoneyPlain(123456)).toBe("1 234,56 €");
    expect(formatMoneyPlain(-500)).toBe("-5,00 €");
    expect(centsToInput(1205)).toBe("12,05");
    expect(centsToInput(-7)).toBe("-0,07");
    expect(formatPct(0.325)).toBe("32,5 %");
  });
  it("divisions par zéro", () => {
    expect(safeRatio(5, 0)).toBeNull();
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(120, 100)).toBeCloseTo(0.2);
  });
});

describe("dates", () => {
  it("années bissextiles", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(isValidISODate("2027-02-29")).toBe(false);
    expect(isValidISODate("2028-02-29")).toBe(true);
  });
  it("ajout de mois borné", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
  it("différences et semaines", () => {
    expect(diffDays("2028-02-28", "2028-03-01")).toBe(2);
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16");
  });
  it("dates françaises", () => {
    expect(parseFrenchDate("05/03/2026")).toBe("2026-03-05");
    expect(parseFrenchDate("5/3/26")).toBe("2026-03-05");
    expect(parseFrenchDate("31/02/2026")).toBeNull();
    expect(parseFrenchDate("2026-03-05")).toBe("2026-03-05");
    expect(formatDateFR("2026-03-05")).toBe("05/03/2026");
  });
  it("date du jour selon le fuseau", () => {
    const d = new Date("2026-03-31T23:30:00Z");
    expect(todayInTimeZone("Europe/Paris", d)).toBe("2026-04-01");
    expect(todayInTimeZone("America/New_York", d)).toBe("2026-03-31");
  });
});

describe("import CSV", () => {
  it("relevé français avec débit/crédit et lignes d'en-tête", () => {
    const text = `Compte courant;FR76...
Date;Libellé;Débit;Crédit
05/03/2026;CB CARREFOUR MARKET;45,20;
06/03/2026;VIR SALAIRE ACME;;2 100,00
07/03/2026;PRLV NETFLIX;13,99;
`;
    const csv = parseCsvText(text);
    expect(csv.headers).toEqual(["Date", "Libellé", "Débit", "Crédit"]);
    const m = guessMapping(csv);
    expect(m.date).toBe(0);
    expect(m.label).toBe(1);
    expect(m.debit).toBe(2);
    expect(m.credit).toBe(3);
    const rows = extractRows(csv, m);
    expect(rows.map((r) => r.amount)).toEqual([-4520, 210000, -1399]);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
  });
  it("montant signé unique, séparateur virgule", () => {
    const csv = parseCsvText(`date,description,amount\n2026-03-05,Uber Eats,-23.40\n2026-03-06,Refund,10.00\n`);
    const rows = extractRows(csv, guessMapping(csv));
    expect(rows.map((r) => r.amount)).toEqual([-2340, 1000]);
  });
  it("signale les lignes invalides", () => {
    const csv = parseCsvText(`Date;Libellé;Montant\n32/13/2026;X;abc\n05/03/2026;Y;0\n`);
    const rows = extractRows(csv, guessMapping(csv));
    expect(rows[0].errors).toContain("Date invalide");
    expect(rows[0].errors).toContain("Montant invalide");
    expect(rows[1].errors).toContain("Montant nul");
  });
  it("suggestion de catégorie", () => {
    expect(suggestCategoryName("CB CARREFOUR CITY", false)).toBe("Courses alimentaires");
    expect(suggestCategoryName("PRLV NETFLIX", false)).toBe("Abonnements");
    expect(suggestCategoryName("VIR SALAIRE ACME", true)).toBe("Salaire");
  });
});

describe("tickets de caisse", () => {
  it("extrait commerçant, date, total et articles", () => {
    const r = parseReceiptText(`MONOPRIX PARIS 11
12 rue de la Roquette
Tel 01 23 45 67 89
15/03/2026 18:42
LAIT DEMI ECREME 1,15
PAIN COMPLET 2,30
POMMES 3,49
TOTAL 6,94 EUR
CB EMV 6,94`);
    expect(r.merchant.value).toBe("MONOPRIX PARIS 11");
    expect(r.date.value).toBe("2026-03-15");
    expect(r.total.value).toBe(694);
    expect(r.total.confidence).toBe("high");
    expect(r.items).toHaveLength(3);
    expect(r.needsReview).toBe(true);
  });
  it("texte illisible -> confiance nulle", () => {
    const r = parseReceiptText("~~~ ### ...");
    expect(r.total.value).toBeNull();
    expect(r.date.confidence).toBe("none");
  });
});
