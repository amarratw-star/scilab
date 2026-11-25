ALTER TABLE "bank_account_links" ADD COLUMN "duplicate_of_account_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_account_links" ADD CONSTRAINT "bank_links_duplicate_owner" FOREIGN KEY ("duplicate_of_account_id", "user_id") REFERENCES "accounts" ("id", "user_id") ON DELETE SET NULL ("duplicate_of_account_id");
