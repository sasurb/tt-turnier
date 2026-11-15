<?php
declare(strict_types=1);

namespace TtTurnier;

/** Eine eingehende Anfrage, unabhängig von PHP-Globals (testbar). */
final class Anfrage
{
    /**
     * @param array<string,string> $query
     * @param array<string,mixed>|null $rumpf
     */
    public function __construct(
        public readonly string $methode,
        public readonly string $route,
        public readonly array $query = [],
        public readonly ?array $rumpf = null,
        public readonly ?string $token = null,
        public readonly string $ip = '0.0.0.0',
    ) {
    }

    public static function ausGlobals(): self
    {
        $methode = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $query = [];
        foreach ($_GET as $k => $v) {
            if (is_string($v)) {
                $query[(string)$k] = $v;
            }
        }
        $route = $query['r'] ?? '';

        $rumpf = null;
        if ($methode === 'POST') {
            $roh = file_get_contents('php://input');
            if ($roh !== false && $roh !== '') {
                // Als Objekte decodieren, damit leere {} in Ereignis-Daten erhalten bleiben;
                // nur die oberste Ebene wird zum Array.
                $daten = json_decode($roh, false);
                $rumpf = $daten instanceof \stdClass ? get_object_vars($daten) : ['__ungueltig' => true];
            } else {
                $rumpf = [];
            }
        }

        // Eigene Kopfzeile zuerst: Strato (FastCGI) reicht "Authorization" nicht immer durch.
        $token = $_SERVER['HTTP_X_TT_TOKEN'] ?? null;
        if ($token === null) {
            $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
            if (stripos($auth, 'Bearer ') === 0) {
                $token = trim(substr($auth, 7));
            }
        }

        return new self($methode, $route, $query, $rumpf, $token ?: null, self::ipNormalisieren($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'));
    }

    /**
     * Anschluss für die Bremsen: IPv6-Adressen auf ihr /64-Netz zusammenfassen, damit ein Angreifer
     * nicht mit jeder neuen Adresse aus demselben Netz von vorn zählt.
     */
    public static function ipNormalisieren(string $ip): string
    {
        if (!str_contains($ip, ':')) {
            return $ip;
        }
        $bin = @inet_pton($ip);
        if ($bin === false || strlen($bin) !== 16) {
            return $ip;
        }
        return (inet_ntop(substr($bin, 0, 8) . str_repeat("\0", 8)) ?: $ip) . '/64';
    }
}

/** Fachlicher Fehler, wird als JSON { fehler, meldung } ausgeliefert. */
final class ApiFehler extends \RuntimeException
{
    private const STATUS = [
        'ungueltig' => 400,
        'nicht_angemeldet' => 401,
        'falsche_zugangsdaten' => 401,
        'gesperrt' => 403,
        'keine_berechtigung' => 403,
        'nicht_gefunden' => 404,
        'konflikt' => 409,
        'zu_gross' => 413,
        'zu_viele_versuche' => 429,
        'serverfehler' => 500,
        'nicht_eingerichtet' => 503,
    ];

    public function __construct(public readonly string $code_, string $meldung)
    {
        parent::__construct($meldung);
    }

    public function status(): int
    {
        return self::STATUS[$this->code_] ?? 500;
    }
}

final class Antwort
{
    /** @param array<string,mixed> $daten */
    public function __construct(public readonly int $status, public readonly array $daten)
    {
    }

    public function senden(): void
    {
        http_response_code($this->status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($this->daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
