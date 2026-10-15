#!/bin/sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${DEPLOY_ENV:=$DEPLOY_DIR/.local/.env.local}"
case "$DEPLOY_ENV" in /*) ;; *) echo 'DEPLOY_ENV debe ser una ruta absoluta.' >&2; exit 2;; esac
[ -f "$DEPLOY_ENV" ] || { echo 'Falta configuración privada. Ejecuta node deploy/init-local.mjs para uso local.' >&2; exit 2; }
export RAYO_ENV_FILE="$DEPLOY_ENV"
case "${DEPLOY_TARGET:-local}" in
 local) set -- -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.local.yaml" --profile local "$@" ;;
 production) set -- -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.production.yaml" --profile production "$@" ;;
 *) echo 'DEPLOY_TARGET admite local o production.' >&2; exit 2 ;;
esac
if [ "${DEPLOY_MONITORING:-false}" = true ]; then
 # Compose global options precede the supplied subcommand.
 case "${DEPLOY_TARGET:-local}" in
  local) shift 6; set -- -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.local.yaml" -f "$DEPLOY_DIR/compose.monitoring.yaml" --profile local --profile monitoring "$@" ;;
  production) shift 6; set -- -f "$DEPLOY_DIR/compose.yaml" -f "$DEPLOY_DIR/compose.production.yaml" -f "$DEPLOY_DIR/compose.monitoring.yaml" --profile production --profile monitoring "$@" ;;
 esac
fi
exec docker compose --env-file "$DEPLOY_ENV" "$@"
