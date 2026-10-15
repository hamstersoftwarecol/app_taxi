#!/bin/sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${CONFIRM_RESTORE:-}" = YES ] && [ "${1:-}" = --confirm-replace-database ] && [ "$#" -eq 2 ] || {
 echo 'Uso destructivo: CONFIRM_RESTORE=YES deploy/restore.sh --confirm-replace-database /ruta/backup.dump' >&2
 exit 2
}
file=$2
[ -f "$file" ] && [ -r "$file" ] || { echo 'Backup no legible.' >&2; exit 2; }
"$DEPLOY_DIR/compose.sh" exec -T postgres sh -eu -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --exit-on-error --single-transaction --no-owner --no-acl' < "$file"
printf 'Restauración completada. Verifica integridad antes de iniciar servicios.\n'
