<?php
declare(strict_types=1);

namespace TtTurnier;

/** Eine ausgehende Mail (reiner Text, optional ein Anhang). */
final class Mail
{
    public function __construct(
        public readonly string $an,
        public readonly string $betreff,
        public readonly string $text,
        public readonly ?string $antwortAn = null,
        public readonly ?string $anhangName = null,
        public readonly ?string $anhangInhalt = null,
        public readonly string $anhangTyp = 'application/json',
        /** Weitere Kopfzeilen (ab 0.18, z. B. List-Unsubscribe); Name => Wert, ohne Zeilenumbrüche */
        public readonly array $zusatz = [],
    ) {
    }
}

interface Mailer
{
    /** true, wenn die Mail zur Zustellung übergeben wurde. Wirft nie. */
    public function senden(Mail $m): bool;

    public function bereit(): bool;
}

/** Versand über PHP-mail() des Webspace (Strato), Absender eine Adresse der eigenen Domain. */
final class PhpMailer implements Mailer
{
    public function __construct(private readonly string $absender, private readonly string $absenderName = 'Tischtennis-Turnier')
    {
    }

    public function bereit(): bool
    {
        return filter_var($this->absender, FILTER_VALIDATE_EMAIL) !== false;
    }

    public function senden(Mail $m): bool
    {
        if (!$this->bereit() || filter_var($m->an, FILTER_VALIDATE_EMAIL) === false) {
            return false;
        }
        [$kopf, $rumpf] = MailAufbau::bauen($m, $this->absender, $this->absenderName);
        $betreff = mb_encode_mimeheader($m->betreff, 'UTF-8', 'Q', "\r\n");
        try {
            // „-f“ setzt den Umschlag-Absender; Strato stellt sonst teils nicht zu.
            return @mail($m->an, $betreff, $rumpf, $kopf, '-f' . $this->absender);
        } catch (\Throwable $t) {
            error_log('tt-turnier mail: ' . $t->getMessage());
            return false;
        }
    }
}

/**
 * Versand über SMTP eines Postfachs (ab 0.18, z. B. Strato: smtp.strato.de, Port 465 mit SSL oder 587 mit STARTTLS).
 * Reines PHP ohne Zusatzpakete: EHLO, STARTTLS, AUTH LOGIN, MAIL FROM, RCPT TO, DATA. Eine Verbindung je Mail;
 * die gedrosselte Warteschlange (Nachrichten::abarbeiten) sorgt dafür, dass nicht zu viele auf einmal gehen.
 */
final class SmtpMailer implements Mailer
{
    private string $letzterFehler = '';

    /**
     * @param string $sicherheit 'ssl' (Port 465), 'starttls' (Port 587) oder 'keine' (nur für Tests und lokale Relays)
     * @param float $zeitlimit Sekunden je Schritt
     */
    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly string $benutzer,
        private readonly string $passwort,
        private readonly string $absender,
        private readonly string $sicherheit = 'ssl',
        private readonly string $absenderName = 'Tischtennis-Turnier',
        private readonly float $zeitlimit = 8.0,
    ) {
    }

    public function bereit(): bool
    {
        return $this->host !== '' && filter_var($this->absender, FILTER_VALIDATE_EMAIL) !== false;
    }

    public function fehler(): string
    {
        return $this->letzterFehler;
    }

    public function senden(Mail $m): bool
    {
        $this->letzterFehler = '';
        if (!$this->bereit() || filter_var($m->an, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n<>]/', $m->an)) {
            $this->letzterFehler = 'ungültige Adresse';
            return false;
        }
        $verbindung = null;
        try {
            $ziel = ($this->sicherheit === 'ssl' ? 'ssl://' : 'tcp://') . $this->host . ':' . $this->port;
            $kontext = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true, 'peer_name' => $this->host]]);
            $verbindung = @stream_socket_client($ziel, $nr, $text, $this->zeitlimit, STREAM_CLIENT_CONNECT, $kontext);
            if ($verbindung === false) {
                throw new \RuntimeException("Verbindung zu {$this->host}:{$this->port} fehlgeschlagen ({$text})");
            }
            stream_set_timeout($verbindung, (int)ceil($this->zeitlimit));
            $this->erwarte($verbindung, [220]);
            $ich = $this->rechnername();
            $this->befehl($verbindung, "EHLO {$ich}", [250]);
            if ($this->sicherheit === 'starttls') {
                $this->befehl($verbindung, 'STARTTLS', [220]);
                if (!@stream_socket_enable_crypto($verbindung, true, STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT)) {
                    throw new \RuntimeException('STARTTLS fehlgeschlagen');
                }
                $this->befehl($verbindung, "EHLO {$ich}", [250]);
            }
            if ($this->benutzer !== '') {
                $this->befehl($verbindung, 'AUTH LOGIN', [334]);
                $this->befehl($verbindung, base64_encode($this->benutzer), [334]);
                $this->befehl($verbindung, base64_encode($this->passwort), [235], true);
            }
            $this->befehl($verbindung, "MAIL FROM:<{$this->absender}>", [250]);
            $this->befehl($verbindung, "RCPT TO:<{$m->an}>", [250, 251]);
            $this->befehl($verbindung, 'DATA', [354]);
            [$kopf, $rumpf] = MailAufbau::bauen($m, $this->absender, $this->absenderName);
            $nachricht = 'To: ' . $m->an . "\r\n"
                . 'Subject: ' . mb_encode_mimeheader($m->betreff, 'UTF-8', 'Q', "\r\n") . "\r\n"
                . 'Date: ' . date(DATE_RFC2822) . "\r\n"
                . 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (explode('@', $this->absender)[1] ?? 'localhost') . ">\r\n"
                . $kopf . "\r\n\r\n" . $rumpf;
            // Punkt am Zeilenanfang verdoppeln (RFC 5321, 4.5.2)
            $nachricht = preg_replace('/^\./m', '..', str_replace("\r\n", "\n", $nachricht)) ?? '';
            $nachricht = str_replace("\n", "\r\n", rtrim($nachricht, "\n"));
            $this->schreiben($verbindung, $nachricht . "\r\n.");
            $this->erwarte($verbindung, [250]);
            @fwrite($verbindung, "QUIT\r\n");
            return true;
        } catch (\Throwable $t) {
            $this->letzterFehler = mb_substr((string)preg_replace('/[^\s<>"]+@[^\s<>"]+/', '…@…', $t->getMessage()), 0, 240); // ohne Adressen im Protokoll
            error_log('tt-turnier smtp: ' . $this->letzterFehler);
            return false;
        } finally {
            if (is_resource($verbindung)) {
                @fclose($verbindung);
            }
        }
    }

    private function rechnername(): string
    {
        $h = explode('@', $this->absender)[1] ?? 'localhost';
        return preg_match('/^[A-Za-z0-9.-]{1,190}$/', $h) ? $h : 'localhost';
    }

    /** @param resource $v */
    private function schreiben($v, string $zeile): void
    {
        if (@fwrite($v, $zeile . "\r\n") === false) {
            throw new \RuntimeException('Schreiben zum SMTP-Server fehlgeschlagen');
        }
    }

    /**
     * @param resource $v
     * @param list<int> $codes
     */
    private function befehl($v, string $zeile, array $codes, bool $geheim = false): void
    {
        $this->schreiben($v, $zeile);
        $this->erwarte($v, $codes, $geheim ? 'AUTH' : explode(' ', $zeile)[0]);
    }

    /**
     * Antwort lesen (mehrzeilig „250-…“ bis „250 …“) und Code prüfen.
     * @param resource $v
     * @param list<int> $codes
     */
    private function erwarte($v, array $codes, string $schritt = 'Begrüßung'): void
    {
        $antwort = '';
        while (true) {
            $z = fgets($v, 1024);
            if ($z === false) {
                throw new \RuntimeException("SMTP: keine Antwort ({$schritt})");
            }
            $antwort .= $z;
            if (strlen($z) < 4 || $z[3] !== '-') {
                break;
            }
        }
        $code = (int)substr($antwort, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new \RuntimeException("SMTP {$schritt}: " . trim(preg_replace('/\s+/', ' ', $antwort) ?? ''));
        }
    }
}

/** Legt Mails als Dateien ab (Entwicklung, Oberflächentests). */
final class DateiMailer implements Mailer
{
    public function __construct(private readonly string $ordner, private readonly string $absender = 'test@example.org')
    {
    }

    public function bereit(): bool
    {
        return true;
    }

    public function senden(Mail $m): bool
    {
        if (!is_dir($this->ordner)) {
            @mkdir($this->ordner, 0777, true);
        }
        [$kopf, $rumpf] = MailAufbau::bauen($m, $this->absender, 'Tischtennis-Turnier');
        $datei = sprintf('%s/%s-%s.eml', $this->ordner, gmdate('Ymd-His'), bin2hex(random_bytes(4)));
        $inhalt = "To: {$m->an}\r\nSubject: {$m->betreff}\r\n{$kopf}\r\n\r\n{$rumpf}";
        return file_put_contents($datei, $inhalt) !== false;
    }
}

/** Sammelt Mails im Arbeitsspeicher (Server-Tests). */
final class TestMailer implements Mailer
{
    /** @var list<Mail> */
    public array $mails = [];

    public function bereit(): bool
    {
        return true;
    }

    public function senden(Mail $m): bool
    {
        $this->mails[] = $m;
        return true;
    }
}

/** Kein Versand eingerichtet. */
final class KeinMailer implements Mailer
{
    public function bereit(): bool
    {
        return false;
    }

    public function senden(Mail $m): bool
    {
        return false;
    }
}

final class MailAufbau
{
    /** @return array{0:string,1:string} Kopfzeilen und Rumpf */
    public static function bauen(Mail $m, string $absender, string $absenderName): array
    {
        $kopf = [
            'From: ' . mb_encode_mimeheader($absenderName, 'UTF-8', 'Q') . " <{$absender}>",
            'MIME-Version: 1.0',
            'X-Mailer: tt-turnier',
        ];
        if ($m->antwortAn !== null && filter_var($m->antwortAn, FILTER_VALIDATE_EMAIL) !== false) {
            $kopf[] = 'Reply-To: ' . $m->antwortAn;
        }
        foreach ($m->zusatz as $name => $wert) {
            if (is_string($name) && preg_match('/^[A-Za-z][A-Za-z0-9-]{1,40}$/', $name) && is_string($wert) && !preg_match('/[\r\n]/', $wert)) {
                $kopf[] = $name . ': ' . $wert;
            }
        }
        $text = self::zeilenumbrueche($m->text);
        if ($m->anhangName === null || $m->anhangInhalt === null) {
            $kopf[] = 'Content-Type: text/plain; charset=UTF-8';
            $kopf[] = 'Content-Transfer-Encoding: base64';
            return [implode("\r\n", $kopf), chunk_split(base64_encode($text))];
        }
        $grenze = 'tt-' . bin2hex(random_bytes(12));
        $kopf[] = "Content-Type: multipart/mixed; boundary=\"{$grenze}\"";
        $name = preg_replace('/[^A-Za-z0-9._-]/', '_', $m->anhangName);
        $rumpf = "--{$grenze}\r\n"
            . "Content-Type: text/plain; charset=UTF-8\r\n"
            . "Content-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($text))
            . "--{$grenze}\r\n"
            . "Content-Type: {$m->anhangTyp}; name=\"{$name}\"\r\n"
            . "Content-Transfer-Encoding: base64\r\n"
            . "Content-Disposition: attachment; filename=\"{$name}\"\r\n\r\n"
            . chunk_split(base64_encode($m->anhangInhalt))
            . "--{$grenze}--\r\n";
        return [implode("\r\n", $kopf), $rumpf];
    }

    private static function zeilenumbrueche(string $t): string
    {
        return preg_replace("/\r?\n/", "\r\n", $t) ?? $t;
    }
}
