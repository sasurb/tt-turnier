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
# Sicherheits-Header für die App (Apache/Strato). Gleiche Regeln setzt die Android-Zentrale in Zentrale.java (CSP).
cat > "$ZIEL/public/.htaccess" <<'HT'
Options -Indexes
<IfModule mod_headers.c>
  Header always set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  Header always set X-Frame-Options "DENY"
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
  Header always set Strict-Transport-Security "max-age=31536000" env=HTTPS
  <FilesMatch "\.(js|css|svg|woff2?)$">
    Header unset Content-Security-Policy
  </FilesMatch>
</IfModule>
HT
# Markierung: Dieser Ordner gehört der App (der Deploy löscht nur in eigenen Ordnern)
printf 'tt-turnier\n' > "$ZIEL/public/.tt-turnier-app"
git rev-parse --short HEAD > "$ZIEL/public/version.txt" 2>/dev/null || date -u +%Y%m%d%H%M > "$ZIEL/public/version.txt"
echo "Paket gebaut: $ZIEL"
