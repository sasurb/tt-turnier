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
