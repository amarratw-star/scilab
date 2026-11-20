-- MONETA — Sécurité au niveau de la base de données
-- 1. Contraintes d'intégrité financière
-- 2. Clés étrangères composites (id, user_id) : empêche de référencer la ressource d'un autre utilisateur
-- 3. Row Level Security : chaque utilisateur ne voit et ne modifie que ses propres lignes
-- 4. Rôle d'exécution `moneta_app` sans BYPASSRLS

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;--> statement-breakpoint

-- 1. Contraintes ---------------------------------------------------------------
ALTER TABLE transactions ADD CONSTRAINT tx_amount_valid CHECK (
  (kind = 'adjustment' AND amount <> 0) OR (kind <> 'adjustment' AND amount > 0)
);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_transfer_accounts CHECK (
  (kind = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id)
  OR (kind <> 'transfer' AND to_account_id IS NULL)
);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_amount_positive CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_kind_valid CHECK (kind IN ('expense', 'income', 'transfer'));--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_transfer_accounts CHECK (
  (kind = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id)
  OR (kind <> 'transfer' AND to_account_id IS NULL)
);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_dates CHECK (end_date IS NULL OR end_date >= start_date);--> statement-breakpoint
ALTER TABLE budgets ADD CONSTRAINT budget_amount_positive CHECK (amount > 0);--> statement-breakpoint
ALTER TABLE budgets ADD CONSTRAINT budget_custom_dates CHECK (
  period <> 'custom' OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date)
);--> statement-breakpoint
ALTER TABLE goals ADD CONSTRAINT goal_target_positive CHECK (target_amount > 0);--> statement-breakpoint
ALTER TABLE goals ADD CONSTRAINT goal_priority_valid CHECK (priority BETWEEN 1 AND 3);--> statement-breakpoint
ALTER TABLE goal_contributions ADD CONSTRAINT contribution_nonzero CHECK (amount <> 0);--> statement-breakpoint
ALTER TABLE wealth_valuations ADD CONSTRAINT valuation_nonnegative CHECK (value >= 0);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT document_size_limit CHECK (size > 0 AND size <= 10485760);--> statement-breakpoint

-- 2. Clés composites -------------------------------------------------------------
ALTER TABLE accounts ADD CONSTRAINT accounts_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE goals ADD CONSTRAINT goals_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT transactions_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE wealth_items ADD CONSTRAINT wealth_items_id_user UNIQUE (id, user_id);--> statement-breakpoint
ALTER TABLE bank_connections ADD CONSTRAINT bank_connections_id_user UNIQUE (id, user_id);--> statement-breakpoint

ALTER TABLE transactions ADD CONSTRAINT tx_account_owner FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_to_account_owner FOREIGN KEY (to_account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_category_owner FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_goal_owner FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_recurring_owner FOREIGN KEY (recurring_id, user_id) REFERENCES recurring_items (id, user_id);--> statement-breakpoint
ALTER TABLE categories ADD CONSTRAINT categories_parent_owner FOREIGN KEY (parent_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_account_owner FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_to_account_owner FOREIGN KEY (to_account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint
ALTER TABLE recurring_items ADD CONSTRAINT recurring_category_owner FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id);--> statement-breakpoint
ALTER TABLE budgets ADD CONSTRAINT budgets_category_owner FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id);--> statement-breakpoint
ALTER TABLE goals ADD CONSTRAINT goals_account_owner FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint
ALTER TABLE goal_contributions ADD CONSTRAINT contrib_goal_owner FOREIGN KEY (goal_id, user_id) REFERENCES goals (id, user_id);--> statement-breakpoint
ALTER TABLE goal_contributions ADD CONSTRAINT contrib_tx_owner FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id);--> statement-breakpoint
ALTER TABLE wealth_valuations ADD CONSTRAINT valuation_item_owner FOREIGN KEY (item_id, user_id) REFERENCES wealth_items (id, user_id);--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_tx_owner FOREIGN KEY (transaction_id, user_id) REFERENCES transactions (id, user_id);--> statement-breakpoint
ALTER TABLE bank_account_links ADD CONSTRAINT links_connection_owner FOREIGN KEY (connection_id, user_id) REFERENCES bank_connections (id, user_id);--> statement-breakpoint
ALTER TABLE bank_account_links ADD CONSTRAINT links_account_owner FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id);--> statement-breakpoint

-- Recherche approximative (trigrammes) ---------------------------------------------
CREATE INDEX tx_search_trgm ON transactions USING gin ((lower(coalesce(description, '') || ' ' || coalesce(merchant, ''))) gin_trgm_ops);--> statement-breakpoint

-- 3. Row Level Security --------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'categories', 'transactions', 'recurring_items', 'budgets', 'goals',
    'goal_contributions', 'wealth_items', 'wealth_valuations', 'documents', 'notifications',
    'push_subscriptions', 'bank_connections', 'bank_account_links', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY owner_isolation ON %I FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user())',
      t
    );
  END LOOP;
END $$;--> statement-breakpoint

-- 4. Rôle d'exécution ----------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneta_app') THEN
    CREATE ROLE moneta_app NOLOGIN NOBYPASSRLS;
    RAISE NOTICE 'Rôle moneta_app créé sans LOGIN : exécutez ALTER ROLE moneta_app LOGIN PASSWORD ''...''';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Impossible de créer le rôle moneta_app (privilèges insuffisants) : créez-le manuellement.';
END $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO moneta_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO moneta_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO moneta_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user() TO moneta_app;--> statement-breakpoint
-- Le journal d'audit est en ajout seul pour l'application
REVOKE UPDATE ON audit_log FROM moneta_app;
