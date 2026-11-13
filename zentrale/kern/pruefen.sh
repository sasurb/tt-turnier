#!/usr/bin/env bash
# Übersetzt den Kern der Zentrale (nur JDK, keine Fremdbibliotheken) und führt die Tests aus.
#   ./pruefen.sh            Tests im Arbeitsspeicher
#   ./pruefen.sh --online   zusätzlich gegen einen echten PHP-Server (php -S, SQLite, Mails als Dateien)
# Ergebnis: build/kern.jar (zum Starten am PC: java -jar build/kern.jar --app ../../app/dist)
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/klassen build/tests
javac --release 11 -encoding UTF-8 -Xlint:all,-serial -Werror -d build/klassen $(find src/main -name '*.java')
printf 'Main-Class: de.saschaurban.ttturnier.kern.Start\n' > build/manifest.txt
jar cfm build/kern.jar build/manifest.txt -C build/klassen .
javac --release 11 -encoding UTF-8 -cp build/klassen -d build/tests $(find src/test -name '*.java')

if [ "${1:-}" = "--online" ]; then
  ZIEL=$(mktemp -d)
  PORT="${PORT:-8097}"
  mkdir -p "$ZIEL/mails"
  cat > "$ZIEL/config.php" <<PHP
<?php
return [
  'db' => ['dsn' => 'sqlite:$ZIEL/daten.sqlite'],
  'setup_code' => 'einrichtung-123456',
  'app_url' => 'http://127.0.0.1:$PORT/',
  'mail' => ['absender' => 'turnier@example.org', 'admin' => 'betreiber@example.org', 'datei' => '$ZIEL/mails'],
];
PHP
  TT_CONFIG="$ZIEL/config.php" php -S "127.0.0.1:$PORT" -t ../../server-php/public > "$ZIEL/php.log" 2>&1 &
  PHP_PID=$!
  trap 'kill $PHP_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/api/index.php?r=info" > /dev/null && break; sleep 0.1; done
  TT_ONLINE="http://127.0.0.1:$PORT/api/index.php" TT_MAILS="$ZIEL/mails" java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp build/klassen:build/tests de.saschaurban.ttturnier.kern.KernTest
else
  java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp build/klassen:build/tests de.saschaurban.ttturnier.kern.KernTest
fi
