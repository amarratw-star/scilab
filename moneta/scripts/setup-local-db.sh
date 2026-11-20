#!/usr/bin/env bash
# Crée une base PostgreSQL locale pour MONETA avec deux rôles distincts :
#  - moneta_owner : propriétaire du schéma, utilisé uniquement pour les migrations ;
#  - moneta_app   : rôle d'exécution, SANS BYPASSRLS, soumis aux politiques Row Level Security.
# Usage : bash scripts/setup-local-db.sh [nom_de_base]   (nécessite un accès superutilisateur via `sudo -u postgres` ou PG* env)
set -euo pipefail
DB="${1:-moneta}"
OWNER_PW="${MONETA_OWNER_PASSWORD:-moneta_owner_dev}"
APP_PW="${MONETA_APP_PASSWORD:-moneta_app_dev}"

run_psql() {
  if command -v sudo >/dev/null 2>&1 && [ "$(id -u)" != "$(id -u postgres 2>/dev/null || echo x)" ] && [ -z "${PGHOST:-}" ]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
  elif [ "$(id -u)" = "0" ] && [ -z "${PGHOST:-}" ]; then
    su postgres -c "psql -v ON_ERROR_STOP=1 $(printf '%q ' "$@")"
  else
    psql -v ON_ERROR_STOP=1 "$@"
  fi
}

run_psql -d postgres <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneta_owner') THEN
    CREATE ROLE moneta_owner LOGIN PASSWORD '${OWNER_PW}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'moneta_app') THEN
    CREATE ROLE moneta_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
SQL

if ! run_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB}'" | grep -q 1; then
  run_psql -d postgres -c "CREATE DATABASE \"${DB}\" OWNER moneta_owner"
fi
run_psql -d "${DB}" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent; GRANT CONNECT ON DATABASE \"${DB}\" TO moneta_app;"
echo "Base ${DB} prête."
echo "  MIGRATION_DATABASE_URL=postgres://moneta_owner:${OWNER_PW}@localhost:5432/${DB}"
echo "  DATABASE_URL=postgres://moneta_app:${APP_PW}@localhost:5432/${DB}"
