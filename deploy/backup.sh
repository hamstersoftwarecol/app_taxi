#!/bin/sh
set -eu
umask 077
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${BACKUP_DIR:=$DEPLOY_DIR/.local/backups}"
: "${BACKUP_RETENTION_DAYS:=14}"
case "$BACKUP_RETENTION_DAYS" in ''|*[!0-9]*) echo 'BACKUP_RETENTION_DAYS debe ser entero positivo.' >&2; exit 2;; esac
[ "$BACKUP_RETENTION_DAYS" -gt 0 ] || exit 2
case "$BACKUP_DIR" in /*) ;; *) echo 'BACKUP_DIR debe ser absoluto.' >&2; exit 2;; esac
mkdir -p -- "$BACKUP_DIR"
file="$BACKUP_DIR/rayo-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
trap 'rm -f -- "$file.partial"' EXIT HUP INT TERM
"$DEPLOY_DIR/compose.sh" exec -T postgres sh -eu -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$file.partial"
[ -s "$file.partial" ]
mv -- "$file.partial" "$file"
# Rotate only this script's regular dump files, after a successful backup.
find "$BACKUP_DIR" -type f -name 'rayo-*.dump' -mtime "+$BACKUP_RETENTION_DAYS" -exec rm -f -- {} \;
printf 'Backup creado: %s\n' "$file"
