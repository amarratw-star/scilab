/**
 * Schéma de base de données MONETA.
 *
 * Règles :
 *  - Tous les montants sont des entiers en centimes (bigint, mode "number" : sûr jusqu'à 2^53 centimes).
 *  - Toutes les tables financières portent un `user_id` et sont protégées par Row Level Security
 *    (voir drizzle/0001_rls.sql). L'application se connecte avec un rôle sans BYPASSRLS.
 *  - Les dates d'opération sont des dates calendaires (type `date`) exprimées dans le fuseau de l'utilisateur.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const cents = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const accountTypeEnum = pgEnum("account_type", [
  "checking", // compte courant
  "savings", // livret d'épargne
  "secondary", // compte bancaire secondaire
  "cash", // espèces
  "investment", // compte d'investissement
  "placement", // compte de placement
  "other",
]);

export const txKindEnum = pgEnum("tx_kind", [
  "expense",
  "income",
  "transfer",
  "refund",
  "adjustment",
]);

export const txStatusEnum = pgEnum("tx_status", ["posted", "planned", "cancelled"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "card",
  "cash",
  "transfer",
  "direct_debit",
  "mobile",
  "other",
]);

export const txSourceEnum = pgEnum("tx_source", ["manual", "csv", "ocr", "bank", "demo", "recurring", "assistant"]);

export const categoryKindEnum = pgEnum("category_kind", ["expense", "income"]);

export const frequencyEnum = pgEnum("frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
]);

export const recurringStatusEnum = pgEnum("recurring_status", ["active", "paused", "ended"]);

export const budgetPeriodEnum = pgEnum("budget_period", ["monthly", "weekly", "custom"]);

export const wealthKindEnum = pgEnum("wealth_kind", ["asset", "liability"]);

export const valuationMethodEnum = pgEnum("valuation_method", ["manual", "estimated"]);

/* ------------------------------------------------------------------ */
/* Utilisateurs & authentification (hors RLS : accédées par le module auth) */
/* ------------------------------------------------------------------ */

export type UserSettings = {
  safetyCushion?: number; // centimes à toujours conserver
  monthlySavingsTarget?: number; // centimes que l'utilisateur veut épargner chaque mois
  dashboard?: { hidden?: string[] };
  notifications?: Partial<Record<NotificationType, boolean>>;
  privacy?: { aiEnabled?: boolean; ocrCloudEnabled?: boolean };
};

export type NotificationType =
  | "budget_exceeded"
  | "budget_warning"
  | "upcoming_debit"
  | "goal_reached"
  | "unusual_expense"
  | "low_balance"
  | "weekly_digest"
  | "monthly_digest";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    currency: text("currency").notNull().default("EUR"),
    locale: text("locale").notNull().default("fr-FR"),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    isDemo: boolean("is_demo").notNull().default(false),
    hasDemoData: boolean("has_demo_data").notNull().default(false),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    settings: jsonb("settings").$type<UserSettings>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // SHA-256 du jeton (le jeton brut n'est jamais stocké)
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});

/* ------------------------------------------------------------------ */
/* Données financières (protégées par RLS)                             */
/* ------------------------------------------------------------------ */

const owner = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .default(sql`nullif(current_setting('app.user_id', true), '')::uuid`);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    institution: text("institution"),
    type: accountTypeEnum("type").notNull(),
    currency: text("currency").notNull().default("EUR"),
    initialBalance: cents("initial_balance").notNull().default(0),
    openedOn: date("opened_on", { mode: "string" }).notNull(),
    description: text("description"),
    color: text("color").notNull().default("#6366f1"),
    icon: text("icon").notNull().default("wallet"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    kind: categoryKindEnum("kind").notNull(),
    parentId: uuid("parent_id"),
    icon: text("icon").notNull().default("tag"),
    color: text("color").notNull().default("#64748b"),
    isFixed: boolean("is_fixed").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("categories_user_idx").on(t.userId)],
);

export const recurringItems = pgTable(
  "recurring_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    kind: txKindEnum("kind").notNull(), // expense | income | transfer
    amount: cents("amount").notNull(),
    frequency: frequencyEnum("frequency").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(), // première échéance
    endDate: date("end_date", { mode: "string" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    isSubscription: boolean("is_subscription").notNull().default(false),
    merchant: text("merchant"),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("direct_debit"),
    status: recurringStatusEnum("status").notNull().default("active"),
    lastReviewedAt: date("last_reviewed_at", { mode: "string" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recurring_user_idx").on(t.userId)],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    description: text("description"),
    targetAmount: cents("target_amount").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    deadline: date("deadline", { mode: "string" }),
    priority: smallint("priority").notNull().default(2), // 1 haute, 2 normale, 3 basse
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    icon: text("icon").notNull().default("target"),
    color: text("color").notNull().default("#10b981"),
    imageDocumentId: uuid("image_document_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_user_idx").on(t.userId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    kind: txKindEnum("kind").notNull(),
    status: txStatusEnum("status").notNull().default("posted"),
    /** Toujours > 0, sauf pour `adjustment` (signé, ≠ 0). */
    amount: cents("amount").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    toAccountId: uuid("to_account_id").references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    date: date("date", { mode: "string" }).notNull(),
    time: time("time"),
    description: text("description"),
    merchant: text("merchant"),
    paymentMethod: paymentMethodEnum("payment_method"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringId: uuid("recurring_id").references(() => recurringItems.id, { onDelete: "set null" }),
    occurrenceDate: date("occurrence_date", { mode: "string" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    refundOfId: uuid("refund_of_id"),
    source: txSourceEnum("source").notNull().default("manual"),
    importHash: text("import_hash"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tx_user_date_idx").on(t.userId, t.date),
    index("tx_account_idx").on(t.accountId),
    index("tx_to_account_idx").on(t.toAccountId),
    index("tx_category_idx").on(t.categoryId),
    index("tx_recurring_idx").on(t.recurringId, t.occurrenceDate),
    index("tx_import_hash_idx").on(t.userId, t.importHash),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }), // null = budget global
    period: budgetPeriodEnum("period").notNull().default("monthly"),
    amount: cents("amount").notNull(),
    startDate: date("start_date", { mode: "string" }), // pour period = custom
    endDate: date("end_date", { mode: "string" }),
    rollover: boolean("rollover").notNull().default(false),
    alertThresholds: integer("alert_thresholds").array().notNull().default(sql`'{50,75,90,100}'::int[]`),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("budgets_user_idx").on(t.userId)],
);

export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    amount: cents("amount").notNull(), // > 0 dépôt, < 0 retrait
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("goal_contrib_goal_idx").on(t.goalId)],
);

export const wealthItems = pgTable(
  "wealth_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    kind: wealthKindEnum("kind").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("wealth_items_user_idx").on(t.userId)],
);

export const wealthValuations = pgTable(
  "wealth_valuations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => wealthItems.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    value: cents("value").notNull(), // toujours positif ; le signe vient de `kind`
    method: valuationMethodEnum("method").notNull().default("manual"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("wealth_val_item_idx").on(t.itemId, t.date)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("receipt"), // receipt | invoice | proof | other
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("documents_user_idx").on(t.userId), index("documents_tx_idx").on(t.transactionId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"), // info | warning | danger | success
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: owner(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: owner(),
  provider: text("provider").notNull(), // "powens"
  externalUserId: text("external_user_id"),
  accessTokenEnc: text("access_token_enc"), // chiffré AES-256-GCM (APP_ENCRYPTION_KEY)
  status: text("status").notNull().default("pending"), // pending | active | error | revoked
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const bankAccountLinks = pgTable(
  "bank_account_links",
  {
    userId: owner(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => bankConnections.id, { onDelete: "cascade" }),
    externalAccountId: text("external_account_id").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.externalAccountId] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: owner(),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_user_idx").on(t.userId, t.createdAt)],
);
