#!/bin/sh
# Leaves the local production stack ready for a demo in one command: the stack up, Garage initialized, the map of
# Chile uploaded, the 3 demo restaurants with every photo, and the demo account as platform admin.
#
# Usage (from the repo root, Git Bash/WSL/Linux):
#   sh infra/scripts/demo-reset.sh              # WIPES the stack's volumes first (asks for confirmation)
#   sh infra/scripts/demo-reset.sh --yes        # same, without asking
#   sh infra/scripts/demo-reset.sh --keep-data  # keeps the data: only fills what is missing (idempotent)
#   add --no-map to skip the map (the first upload downloads ~580 MB into .maps-cache/)
#
# Wiping deletes the database, Valkey and Garage (photos, PDFs, map). Caddy's volumes are kept on purpose: its
# local CA stays the same, so a browser or Windows that already trusts it keeps showing the photos served from
# media.localhost (images from an untrusted host fail silently). The downloaded photos (.demo-cache/) and the map
# (.maps-cache/) live outside Docker and are reused, so nothing is downloaded again.
set -eu
export MSYS_NO_PATHCONV=1

COMPOSE="docker compose -f compose.yaml -f compose.prod.yaml -f compose.local.yaml"
DEMO_EMAIL="${DEMO_EMAIL:-demo@munchmate.local}"
WIPE=1
ASK=1
MAP=1
for arg in "$@"; do
  case "$arg" in
    --keep-data) WIPE=0 ;;
    --yes) ASK=0 ;;
    --no-map) MAP=0 ;;
    --) ;; # `pnpm demo:reset -- --no-map` may pass the separator through
    *)
      echo "Uso: sh infra/scripts/demo-reset.sh [--yes] [--keep-data] [--no-map]" >&2
      exit 2
      ;;
  esac
done

if [ ! -f .env ]; then
  echo "✗ Falta .env: corre primero pnpm env:init (y pnpm push:keys si quieres notificaciones)." >&2
  exit 1
fi

step() { printf '\n▶ %s\n' "$1"; }

if [ "$WIPE" -eq 1 ]; then
  if [ "$ASK" -eq 1 ]; then
    echo "Esto BORRA los datos del stack local: base de datos, Valkey y Garage (fotos, PDF y mapa)."
    echo "El certificado local de Caddy se conserva."
    echo "Las fotos de .demo-cache/ y el mapa de .maps-cache/ se conservan y se vuelven a subir."
    printf 'Escribe BORRAR para continuar: '
    read -r answer
    if [ "$answer" != "BORRAR" ]; then
      echo "Cancelado: no se borró nada."
      exit 1
    fi
  fi
  step "Bajando el stack y borrando sus datos"
  $COMPOSE down --remove-orphans
  for volume in mongo_data mongo_config valkey_data garage_data garage_meta; do
    docker volume rm -f "munch-mate_$volume" > /dev/null
  done
fi

step "Levantando el stack (construye las imágenes; la primera vez tarda varios minutos)"
$COMPOSE up -d --build --wait

step "Confiando en el certificado local de Caddy (fotos de media.localhost y «No es seguro»)"
# Not fatal: the demo works without it, the browser just shows warnings and hides the photos.
node infra/scripts/trust-cert.mjs || echo "• Sigue sin el certificado; puedes repetirlo luego con pnpm cert:trust."

step "Inicializando Garage (layout, llave y buckets)"
sh infra/scripts/garage-init.sh compose.yaml compose.prod.yaml compose.local.yaml

if [ "$MAP" -eq 1 ]; then
  step "Subiendo el mapa de Chile"
  node infra/scripts/maps-init.mjs
else
  echo "• Mapa omitido (--no-map): las zonas se eligen de una lista hasta que corras pnpm maps:init."
fi

step "Cargando los 3 locales de la demo con sus fotos"
node infra/scripts/seed-demo.mjs

step "Dando el rol de administrador de plataforma a $DEMO_EMAIL"
sh infra/scripts/platform-admin.sh "$DEMO_EMAIL"

cat <<EOF

✓ Demo lista en https://localhost
  Cuenta:      $DEMO_EMAIL / ${DEMO_PASSWORD:-munchmate demo 2026}
  Repartidor:  repartidor@munchmate.local (misma contraseña)
  Mailpit:     http://localhost:8025
  Los links de mesa (/m/…) son los que imprimió el paso de la demo, más arriba.
EOF
echo "  ¿Fotos que no cargan o «No es seguro»? Corre pnpm cert:trust y reinicia el navegador."
