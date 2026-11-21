-- MONETA V3 — sécurité des données bancaires
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_users', 'merchant_rules', 'tx_reconciliations', 'sync_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_isolation ON %I', t);
    EXECUTE format('CREATE POLICY owner_isolation ON %I FOR ALL USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user())', t);
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE merchant_rules ADD CONSTRAINT merchant_rules_category_owner FOREIGN KEY (category_id, user_id) REFERENCES categories (id, user_id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_connection_owner FOREIGN KEY (connection_id, user_id) REFERENCES bank_connections (id, user_id);--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_bank_status_valid CHECK (bank_status IS NULL OR bank_status IN ('coming', 'booked', 'deleted'));--> statement-breakpoint
ALTER TABLE transactions ADD CONSTRAINT tx_category_confidence_range CHECK (category_confidence IS NULL OR category_confidence BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE bank_account_links ADD CONSTRAINT bank_links_account_unique UNIQUE (account_id);--> statement-breakpoint

-- Le webhook n'a pas de session : retrouver l'utilisateur MONETA à partir de l'utilisateur Powens
-- sans ouvrir la lecture de bank_users à tous. La fonction ne renvoie qu'un identifiant et le jeton chiffré.
CREATE OR REPLACE FUNCTION bank_user_lookup(p_provider text, p_external_user_id text)
RETURNS TABLE (user_id uuid, access_token_enc text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT b.user_id, b.access_token_enc FROM bank_users b WHERE b.provider = p_provider AND b.external_user_id = p_external_user_id LIMIT 1 $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION bank_user_lookup(text, text) FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneta_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bank_users, merchant_rules, tx_reconciliations, sync_runs, webhook_events TO moneta_app;
    GRANT EXECUTE ON FUNCTION bank_user_lookup(text, text) TO moneta_app;
  END IF;
END $$;
