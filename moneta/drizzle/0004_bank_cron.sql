-- Tâche quotidienne (sans session) : utilisateurs dont une connexion bancaire n'a reçu aucune mise à jour depuis 26 h.
-- Ne renvoie que des identifiants d'utilisateurs, jamais de données bancaires.
CREATE OR REPLACE FUNCTION bank_stale_users()
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT c.user_id FROM bank_connections c
  WHERE c.status <> 'revoked' AND c.external_connection_id IS NOT NULL
    AND (c.last_sync_at IS NULL OR c.last_sync_at < now() - interval '26 hours')
    AND (c.last_attempt_at IS NULL OR c.last_attempt_at < now() - interval '6 hours')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION bank_stale_users() FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneta_app') THEN
    GRANT EXECUTE ON FUNCTION bank_stale_users() TO moneta_app;
  END IF;
END $$;
