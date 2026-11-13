#!/usr/bin/env bash
# Baut das Server-Paket für einen PHP-Webspace (z. B. Strato) nach paket/:
#
#   paket/
#     public/          ← hierauf zeigt die Subdomain (App + api/)
#       index.html, assets/ …
#       api/index.php, api/.htaccess
#     src/             ← PHP-Programmcode, außerhalb des Webroots
#     config.php       ← NICHT im Paket; wird beim Deploy erzeugt bzw. einmalig angelegt
#
# Voraussetzung: App gebaut (npm run build in app/).
set -euo pipefail
cd "$(dirname "$0")/.."

ZIEL="${1:-paket}"
test -f app/dist/index.html || { echo "app/dist fehlt – zuerst: (cd app && npm run build)"; exit 1; }

rm -rf "$ZIEL"
mkdir -p "$ZIEL/public/api" "$ZIEL/src"
cp -R app/dist/. "$ZIEL/public/"
cp server-php/public/api/index.php server-php/public/api/.htaccess "$ZIEL/public/api/"
cp server-php/src/*.php "$ZIEL/src/"
# Zusätzlicher Schutz, falls die Subdomain doch auf den Oberordner zeigt
printf 'Require all denied\n' > "$ZIEL/src/.htaccess"
# Markierung: Dieser Ordner gehört der App (der Deploy löscht nur in eigenen Ordnern)
printf 'tt-turnier\n' > "$ZIEL/public/.tt-turnier-app"
git rev-parse --short HEAD > "$ZIEL/public/version.txt" 2>/dev/null || date -u +%Y%m%d%H%M > "$ZIEL/public/version.txt"
echo "Paket gebaut: $ZIEL"
