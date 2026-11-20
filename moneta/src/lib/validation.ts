/**
 * Schémas de validation partagés client / serveur (Zod).
 * Les montants sont saisis en texte (format français) et convertis en centimes entiers.
 */
import { z } from "zod";
import { isValidISODate } from "@/lib/dates";
import { parseAmountToCents } from "@/lib/money";

const MAX_CENTS = 100_000_000_000; // 1 milliard d'euros : borne de sécurité

export const isoDate = z.string().refine(isValidISODate, { message: "Date invalide" });
export const optionalIsoDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidISODate(v), { message: "Date invalide" });

const uuid = z.string().uuid({ message: "Identifiant invalide" });
const optionalUuid = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[0-9a-f-]{36}$/i.test(v), { message: "Identifiant invalide" });

const text = (max: number) =>
  z
    .string()
    .max(max, { message: `${max} caractères maximum` })
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));

/** Montant strictement positif (saisi en texte ou en nombre). */
export const positiveAmount = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const cents = parseAmountToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Montant invalide" });
      return z.NEVER;
    }
    if (cents <= 0) {
      ctx.addIssue({ code: "custom", message: cents === 0 ? "Le montant ne peut pas être nul" : "Le montant doit être positif" });
      return z.NEVER;
    }
    if (cents > MAX_CENTS) {
      ctx.addIssue({ code: "custom", message: "Montant trop élevé" });
      return z.NEVER;
    }
    return cents;
  });

/** Montant signé (peut être négatif ou nul). */
export const signedAmount = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const cents = parseAmountToCents(v);
  if (cents === null || Math.abs(cents) > MAX_CENTS) {
    ctx.addIssue({ code: "custom", message: "Montant invalide" });
    return z.NEVER;
  }
  return cents;
});

export const nonNegativeAmount = signedAmount.refine((v) => v >= 0, { message: "Le montant ne peut pas être négatif" });

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: "Couleur invalide" })
  .optional()
  .default("#6366f1");
const icon = z.string().regex(/^[a-z0-9-]{1,40}$/).optional().default("wallet");

export const ACCOUNT_TYPES = ["checking", "savings", "secondary", "cash", "investment", "placement", "other"] as const;
export const PAYMENT_METHODS = ["card", "cash", "transfer", "direct_debit", "mobile", "other"] as const;
export const FREQUENCIES = ["weekly", "monthly", "quarterly", "semiannual", "yearly"] as const;

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire").max(80),
  institution: text(80),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  initialBalance: signedAmount.default(0),
  openedOn: isoDate,
  description: text(500),
  color,
  icon,
});

export const transactionSchema = z
  .object({
    kind: z.enum(["expense", "income", "transfer", "refund", "adjustment"]),
    status: z.enum(["posted", "planned", "cancelled"]).default("posted"),
    amount: z.union([z.string(), z.number()]),
    accountId: uuid,
    toAccountId: optionalUuid,
    categoryId: optionalUuid,
    date: isoDate,
    time: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v), { message: "Heure invalide" }),
    description: text(200),
    merchant: text(120),
    paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable().transform((v) => v ?? null),
    tags: z
      .union([z.array(z.string()), z.string()])
      .optional()
      .transform((v) =>
        (Array.isArray(v) ? v : (v ?? "").split(","))
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 10)
          .map((t) => t.slice(0, 30)),
      ),
    isRecurring: z.coerce.boolean().optional().default(false),
    notes: text(1000),
    refundOfId: optionalUuid,
    goalId: optionalUuid,
  })
  .transform((v, ctx) => {
    const cents = parseAmountToCents(v.amount);
    if (cents === null || Math.abs(cents) > MAX_CENTS) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Montant invalide" });
      return z.NEVER;
    }
    if (v.kind === "adjustment") {
      if (cents === 0) {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Une régularisation ne peut pas être nulle" });
        return z.NEVER;
      }
    } else if (cents <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: cents === 0 ? "Le montant ne peut pas être nul" : "Le montant doit être positif" });
      return z.NEVER;
    }
    if (v.kind === "transfer") {
      if (!v.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choisis le compte de destination" });
        return z.NEVER;
      }
      if (v.toAccountId === v.accountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Les deux comptes doivent être différents" });
        return z.NEVER;
      }
    }
    return { ...v, amount: cents, toAccountId: v.kind === "transfer" ? v.toAccountId : null, categoryId: v.kind === "transfer" || v.kind === "adjustment" ? null : v.categoryId };
  });

export type TransactionInput = z.infer<typeof transactionSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire").max(60),
  kind: z.enum(["expense", "income"]),
  parentId: optionalUuid,
  icon: icon.default("tag"),
  color: color.default("#64748b"),
  isFixed: z.coerce.boolean().optional().default(false),
});

export const recurringSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est obligatoire").max(80),
    kind: z.enum(["expense", "income", "transfer"]),
    amount: positiveAmount,
    frequency: z.enum(FREQUENCIES),
    startDate: isoDate,
    endDate: optionalIsoDate,
    accountId: uuid,
    toAccountId: optionalUuid,
    categoryId: optionalUuid,
    isSubscription: z.coerce.boolean().optional().default(false),
    merchant: text(120),
    paymentMethod: z.enum(PAYMENT_METHODS).default("direct_debit"),
    status: z.enum(["active", "paused", "ended"]).default("active"),
    notes: text(500),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La date de fin précède la date de début" });
    if (v.kind === "transfer" && (!v.toAccountId || v.toAccountId === v.accountId))
      ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Choisis un compte de destination différent" });
  })
  .transform((v) => ({ ...v, toAccountId: v.kind === "transfer" ? v.toAccountId : null }));

export const budgetSchema = z
  .object({
    name: z.string().trim().min(1, "Le nom est obligatoire").max(60),
    categoryId: optionalUuid,
    period: z.enum(["monthly", "weekly", "custom"]),
    amount: positiveAmount,
    startDate: optionalIsoDate,
    endDate: optionalIsoDate,
    rollover: z.coerce.boolean().optional().default(false),
    alertThresholds: z
      .union([z.array(z.coerce.number()), z.string()])
      .optional()
      .transform((v) => {
        const arr = Array.isArray(v) ? v : (v ?? "50,75,90,100").split(",").map(Number);
        return [...new Set(arr.filter((n) => Number.isInteger(n) && n > 0 && n <= 200))].sort((a, b) => a - b);
      }),
  })
  .superRefine((v, ctx) => {
    if (v.period === "custom") {
      if (!v.startDate || !v.endDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Indique les dates de début et de fin" });
      else if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "La date de fin précède la date de début" });
    }
  });

export const goalSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire").max(80),
  description: text(500),
  targetAmount: positiveAmount,
  startDate: isoDate,
  deadline: optionalIsoDate,
  priority: z.coerce.number().int().min(1).max(3).default(2),
  accountId: optionalUuid,
  icon: icon.default("target"),
  color: color.default("#10b981"),
});

export const contributionSchema = z.object({
  goalId: uuid,
  direction: z.enum(["deposit", "withdraw"]),
  amount: positiveAmount,
  date: isoDate,
  note: text(200),
  /** Si renseigné, un transfert réel est enregistré entre ces deux comptes. */
  fromAccountId: optionalUuid,
  toAccountId: optionalUuid,
});

export const wealthItemSchema = z.object({
  kind: z.enum(["asset", "liability"]),
  category: z.string().min(1).max(40),
  name: z.string().trim().min(1, "Le nom est obligatoire").max(80),
  notes: text(500),
  value: nonNegativeAmount,
  date: isoDate,
  method: z.enum(["manual", "estimated"]).default("manual"),
});

export const valuationSchema = z.object({
  itemId: uuid,
  value: nonNegativeAmount,
  date: isoDate,
  method: z.enum(["manual", "estimated"]).default("manual"),
  note: text(200),
});

export const passwordSchema = z
  .string()
  .min(10, "10 caractères minimum")
  .max(200, "200 caractères maximum")
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), { message: "Utilise au moins une lettre et un chiffre" });

export const registerSchema = z.object({
  displayName: z.string().trim().min(1, "Indique ton prénom").max(60),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(200),
  password: passwordSchema,
  acceptTerms: z.literal("on", { message: "Tu dois accepter la politique de confidentialité" }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis").max(200),
});

export const settingsSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1).max(60),
  safetyCushion: nonNegativeAmount,
  monthlySavingsTarget: nonNegativeAmount,
});

export type FieldErrors = Record<string, string>;

export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: FieldErrors };
