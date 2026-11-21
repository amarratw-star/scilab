CREATE TABLE "bank_users" (
	"user_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.user_id', true), '')::uuid NOT NULL,
	"provider" text DEFAULT 'powens' NOT NULL,
	"external_user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid NOT NULL,
	"pattern" text NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid NOT NULL,
	"connection_id" uuid,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"accounts" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tx_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"kept_tx_id" uuid,
	"other_tx_id" uuid,
	"score" integer,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "sync_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "external_name" text;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "external_type" text;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "iban_masked" text;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "bank_balance" bigint;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "bank_coming" bigint;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "balance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "disabled_at_bank" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "external_connection_id" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "connector_uuid" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "connector_name" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "connector_color" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "next_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "syncing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_status" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_label" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "bank_category" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "value_date" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_confidence" smallint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_users" ADD CONSTRAINT "bank_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tx_reconciliations" ADD CONSTRAINT "tx_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_pattern" ON "merchant_rules" USING btree ("user_id","pattern");--> statement-breakpoint
CREATE INDEX "sync_runs_user_idx" ON "sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "tx_reco_user_idx" ON "tx_reconciliations" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_connections_external" ON "bank_connections" USING btree ("user_id","provider","external_connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_external_unique" ON "transactions" USING btree ("user_id","external_id");