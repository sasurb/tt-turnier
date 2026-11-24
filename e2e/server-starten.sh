#!/usr/bin/env bash
# Startet App + PHP-Server für die Oberflächentests: SQLite, Mails als Dateien.
#   PORT (Standard 8090), ZIEL (Standard /tmp/tt-e2e)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8090}"
ZIEL="${ZIEL:-/tmp/tt-e2e}"

if [ "${OHNE_BAU:-}" != "1" ]; then
  (cd app && VITE_BETREIBER_NAME="Erika Muster" VITE_BETREIBER_ANSCHRIFT="Musterweg 1, 12345 Musterstadt" \
    VITE_BETREIBER_MAIL="turnier@example.org" VITE_SPENDEN_PAYPAL="https://www.paypal.com/paypalme/beispiel" \
    VITE_SPENDEN_KOFI="https://ko-fi.com/beispiel" npm run build --silent)
fi
rm -rf "$ZIEL"
./scripts/paket-bauen.sh "$ZIEL" > /dev/null
mkdir -p "$ZIEL/mails"
cat > "$ZIEL/config.php" <<PHP
<?php
return [
  'db' => ['dsn' => 'sqlite:$ZIEL/daten.sqlite'],
  'setup_code' => 'e2e-einrichtung-123',
  'registrieren_je_stunde' => 1000,
  'app_url' => 'http://127.0.0.1:$PORT/',
  'mail' => ['absender' => 'turnier@example.org', 'admin' => 'betreiber@example.org', 'datei' => '$ZIEL/mails'],
];
PHP
echo "Server: http://127.0.0.1:$PORT/  ·  Mails: $ZIEL/mails"
PHP_CLI_SERVER_WORKERS=4 exec php -S "127.0.0.1:$PORT" -t "$ZIEL/public"
