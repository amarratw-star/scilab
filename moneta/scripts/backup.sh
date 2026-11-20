#!/usr/bin/env bash
# Sauvegarde complète de la base MONETA (format custom pg_dump, compressé).
# Usage : MIGRATION_DATABASE_URL=... bash scripts/backup.sh [dossier]
set -euo pipefail
[ -f .env ] && set -a && . ./.env && set +a
URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL requis (rôle propriétaire)}"
DIR="${1:-backups}"
mkdir -p "$DIR"
FILE="$DIR/moneta-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$URL" --file="$FILE"
chmod 600 "$FILE"
echo "Sauvegarde créée : $FILE ($(du -h "$FILE" | cut -f1))"
echo "Conseil : chiffrez-la avant de la stocker hors du serveur, ex. : gpg -c \"$FILE\""
