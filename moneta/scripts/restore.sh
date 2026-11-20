#!/usr/bin/env bash
# Restauration d'une sauvegarde MONETA dans une base NEUVE et VIDE (sans migrations appliquées).
# La sauvegarde contient le schéma complet, les politiques RLS et l'historique des migrations.
#
#   1. bash scripts/setup-local-db.sh moneta_restauree          # crée la base vide + rôles
#   2. MIGRATION_DATABASE_URL=postgres://moneta_owner:...@hote:5432/moneta_restauree \
#        bash scripts/restore.sh backups/moneta-XXXX.dump
#   3. Pointer DATABASE_URL (rôle moneta_app) vers la base restaurée.
set -euo pipefail
URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL requis (rôle propriétaire de la base cible)}"
FILE="${1:?Chemin du fichier .dump requis}"
COUNT=$(psql "$URL" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$COUNT" != "0" ]; then
  echo "La base cible n'est pas vide ($COUNT tables). Créez une base neuve avec scripts/setup-local-db.sh." >&2
  exit 1
fi
# Les avertissements « must be owner of extension » (commentaires de pg_trgm / unaccent) sont attendus.
pg_restore --no-owner --no-privileges --dbname="$URL" "$FILE" || echo "pg_restore a signalé des avertissements (voir ci-dessus)."
# Les privilèges ne sont pas restaurés (--no-privileges) : on les réapplique au rôle d'exécution.
psql "$URL" -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO moneta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO moneta_app;
REVOKE UPDATE ON audit_log FROM moneta_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO moneta_app;
GRANT EXECUTE ON FUNCTION app_current_user() TO moneta_app;
SQL
echo "Restauration terminée : $(psql "$URL" -tAc 'select count(*) from transactions') opération(s), politiques RLS et droits rétablis."
