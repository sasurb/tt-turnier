package de.saschaurban.ttturnier.kern;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * Der Turnier-Server der Android-Zentrale. Verhält sich nach außen wie der PHP-Server
 * (shared/protokoll.ts, docs/schnittstelle.md), ohne Konten-Verwaltung: Die Zentrale hat
 * genau ein eigenes Konto, angemeldet wird es nur vom Gerät der Zentrale selbst.
 * Dazu kommen die Routen „zentrale.*“ (nur vom Gerät selbst): WLAN, Online-Konto,
 * Übernahme und Rückgabe von Online-Turnieren, Sicherungen über den Online-Server.
 */
public final class Zentrale implements HttpServer.Bearbeiter {
    public static final String VERSION = "0.17.0";
    /** Platzhalter für Namen entfernter Spieler (wie PHP Api::ENTFERNT_NAME) */
    static final String ENTFERNT_NAME = "Entfernt";
    public static final int PROTOKOLL = 1;
    public static final String ONLINE_STANDARD = "https://saschaurban.de/tt-turnier/api/index.php";

    private static final int MAX_EREIGNISSE = 200;
    private static final int MAX_JE_TURNIER = 50000;
    private static final int MAX_DATEN_BYTES = 16384;
    private static final long SITZUNG_DAUER = 60L * 60 * 24 * 30;
    private static final long VERSUCHE_FENSTER = 15 * 60;
    private static final int VERSUCHE_MAX = 10;
    private static final String ID_ZEICHEN = "abcdefghijkmnpqrstuvwxyz23456789";
    private static final List<Long> TAKTE = Arrays.asList(0L, 15L, 30L, 60L, -1L);
    private static final int MAX_EMPFAENGER = 3;
    private static final String ART_ABGESCHLOSSEN = "turnier.abgeschlossen";
    private static final List<String> ARTEN_SPIELER = Arrays.asList("spiel.ergebnis", "spiel.bestaetigt", "spiel.angefochten", "mannschaft.aufgestellt");
    private static final List<String> ARTEN_HELFER = Arrays.asList("spiel.ergebnis", "spiel.aufgerufen", "spiel.aufruf_zurueck", "mannschaft.aufgestellt");
    private static final List<String> ARTEN_SPIELER_HELFER = Arrays.asList("spiel.ergebnis", "spiel.bestaetigt", "spiel.angefochten", "spiel.aufgerufen", "spiel.aufruf_zurueck", "mannschaft.aufgestellt");
    private static final int MAX_CODES = 400;
    private static final int MAX_POOL = 3000;
    private static final int MAX_UEBERSICHT = 60000;
    private static final long KONTO_ID = 1;
    /** Geräte gelten so lange als verbunden, wie ihr letzter Abruf her ist (Sekunden). */
    private static final long GERAET_AKTIV = 180;

    private static final Pattern P_EREIGNIS_ID = Pattern.compile("^[A-Za-z0-9-]{8,64}$");
    private static final Pattern P_ART = Pattern.compile("^[a-z][a-z0-9_.]{1,63}$");
    private static final Pattern P_GERAET = Pattern.compile("^[A-Za-z0-9-]{4,64}$");
    private static final Pattern P_ZEIT = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}([T ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,9})?)?)?(Z|[+-]\\d{2}:?\\d{2})?$");
    /**
     * Turnierkennung (ab 0.17, wie Api::TURNIER_ID_MUSTER): Zufall aus 8 Zeichen ohne Verwechsler oder Wunschkennung
     * 4–12 Zeichen A–Z, 0–9, Bindestrich (nicht am Rand); ohne Groß/klein. Ältere Kennungen aus 8 Ziffern passen.
     */
    static final Pattern P_TURNIER_ID = Pattern.compile("^[A-Z0-9][A-Z0-9-]{2,10}[A-Z0-9]$");
    private static final String KENNUNG_ZEICHEN = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final List<String> CODE_ROLLEN = Arrays.asList("leitung", "helfer", "spieler");
    /** shared/protokoll.ts ALLE_AUFGABEN, HELFER_STANDARD, ARTEN_JE_AUFGABE, NUR_VOLLE_SICHT */
    static final List<String> AUFGABEN = Arrays.asList("ergebnisse", "aufruf", "kasse", "oberschiri");
    static final List<String> HELFER_STANDARD = Arrays.asList("ergebnisse", "aufruf");
    private static final Map<String, List<String>> ARTEN_JE_AUFGABE = new HashMap<>();
    static {
        ARTEN_JE_AUFGABE.put("ergebnisse", Arrays.asList("spiel.ergebnis", "mannschaft.aufgestellt"));
        ARTEN_JE_AUFGABE.put("aufruf", Arrays.asList("spiel.aufgerufen", "spiel.aufruf_zurueck"));
        ARTEN_JE_AUFGABE.put("kasse", Arrays.asList("startgeld.gebucht", "startgeld.storniert", "teilnehmer.eingecheckt"));
        ARTEN_JE_AUFGABE.put("oberschiri", Arrays.asList("spiel.ergebnis", "spiel.entschieden", "spiel.zurueckgesetzt", "mannschaft.aufgestellt"));
    }
    static final List<String> NUR_VOLLE_SICHT = Arrays.asList("startgeld.gebucht", "startgeld.storniert", "teilnehmer.eingecheckt");
    private static final int MAX_KLASSEN = 40;
    /** Unbekannte Turnierkennungen je Anschluss und Viertelstunde, bevor gebremst wird */
    private static final int SUCHE_MAX = 30;
    /** Fehlversuche je Turnier (alle Anschlüsse) in 15 Minuten; danach nur noch richtige Kennungen */
    private static final int ZUGANG_TURNIER_MAX = 200;
    /** ab so vielen Fehlversuchen je Anschluss und Turnier wird verzögert statt ausgesperrt */
    private static final int ZUGANG_VERZOEGERN_AB = 5;
    /** Wartezeiten abschaltbar (Tests) */
    static volatile boolean ohneWarten = false;
    private static final Pattern P_DATUM = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern P_BEZUG = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final Pattern P_POOL_ID = Pattern.compile("^[A-Za-z0-9_-]{1,40}$");
    private static final Pattern P_TOKEN = Pattern.compile("^[a-f0-9]{64}$");
    private static final Pattern P_EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private final Speicher speicher;
    private final Plattform plattform;
    private final Online online;
    private final LongSupplier uhr;
    private final SecureRandom zufall = new SecureRandom();

    private final Map<String, Speicher.Turnier> turniere;
    private final Map<String, Map<String, Object>> sitzungen = new LinkedHashMap<>();
    private final Map<String, Object> einst;
    private final Map<String, Map<String, Object>> pool = new LinkedHashMap<>();
    private final Map<String, Map<String, Object>> warteschlange = new LinkedHashMap<>();
    private final Map<String, List<Long>> versuche = new HashMap<>();
    private final Map<String, Long> geraete = new HashMap<>();
    private int gemeldeteGeraete = -1;
    private volatile int port = 0;
    /**
     * Geheimnis für Aufrufe vom Gerät selbst: Die Hülle (Android/PC) öffnet die App mit
     * …/?zentrale=<geheimnis>; die App schickt es als Kopfzeile X-TT-Zentrale mit. Ohne dieses Geheimnis
     * gilt auch eine Loopback-Verbindung nicht als „Gerät selbst“ (sonst könnte eine Webseite im Browser
     * des Handys die Zentrale fernsteuern).
     */
    private volatile String geraetGeheimnis;
    /** Nur ein Versand der Warteschlange gleichzeitig */
    private final Object versandSperre = new Object();

    public Zentrale(Speicher speicher, Plattform plattform, Online online, LongSupplier uhrSekunden) {
        this.speicher = speicher;
        this.plattform = plattform;
        this.online = online;
        this.uhr = uhrSekunden;
        this.turniere = speicher.ladeTurniere();
        this.einst = speicher.ladeObjekt("zentrale.json");
        byte[] g = new byte[16];
        zufall.nextBytes(g);
        StringBuilder gh = new StringBuilder();
        for (byte b : g) gh.append(String.format("%02x", b));
        this.geraetGeheimnis = gh.toString();
        if (!(einst.get("id") instanceof String)) {
            einst.put("id", "z-" + zufallsText(10));
            einst.put("angelegt", iso(jetzt()));
            speicher.speichereObjekt("zentrale.json", einst);
        }
        Map<String, Object> s = speicher.ladeObjekt("sitzungen.json");
        for (Map.Entry<String, Object> e : s.entrySet()) {
            Map<String, Object> m = Json.alsObjekt(e.getValue());
            if (m != null) sitzungen.put(e.getKey(), m);
        }
        Map<String, Object> p = speicher.ladeObjekt("pool.json");
        for (Map.Entry<String, Object> e : p.entrySet()) {
            Map<String, Object> m = Json.alsObjekt(e.getValue());
            if (m != null) pool.put(e.getKey(), m);
        }
        Map<String, Object> w = speicher.ladeObjekt("warteschlange.json");
        for (Map.Entry<String, Object> e : w.entrySet()) {
            Map<String, Object> m = Json.alsObjekt(e.getValue());
            if (m != null) warteschlange.put(e.getKey(), m);
        }
    }

    public Zentrale(Speicher speicher, Plattform plattform) {
        this(speicher, plattform, new Online(10_000), () -> System.currentTimeMillis() / 1000);
    }

    public void setzePort(int port) {
        this.port = port;
    }

    /** Adresse, mit der die Hülle die App am Gerät selbst öffnet (enthält das Geheimnis). */
    public String startAdresse() {
        return "http://127.0.0.1:" + port + "/?zentrale=" + geraetGeheimnis;
    }

    /** Das Geheimnis dieses Laufs (für Tests und die Hülle) */
    public String geraetGeheimnis() {
        return geraetGeheimnis;
    }

    /** Festes Geheimnis setzen – nur für Tests (Start.java --geheimnis); 32 Hex-Zeichen. */
    public void setzeGeraetGeheimnis(String g) {
        if (g == null || !g.matches("^[0-9a-f]{32}$")) throw new IllegalArgumentException("Geheimnis: 32 Hex-Zeichen");
        this.geraetGeheimnis = g;
    }

    /* ======================================================================
     * HTTP
     * ==================================================================== */

    @Override
    public HttpServer.Antwort bearbeiten(HttpServer.Anfrage a) {
        if (!a.vomGeraetSelbst) {
            synchronized (geraete) {
                geraete.put(a.ip, jetzt());
            }
        }
        if (a.pfad.startsWith("/api/")) return api(a);
        if (!"GET".equals(a.methode) && !"HEAD".equals(a.methode)) {
            return new HttpServer.Antwort(405, "text/plain; charset=utf-8", "Nicht erlaubt".getBytes(StandardCharsets.UTF_8));
        }
        return datei(a.pfad);
    }

    private HttpServer.Antwort datei(String pfad) {
        String p = pfad.replaceFirst("^/+", "");
        if (p.isEmpty()) p = "index.html";
        if (p.contains("..") || p.contains("\\") || p.contains("\0")) {
            return new HttpServer.Antwort(404, "text/plain; charset=utf-8", "Nicht gefunden".getBytes(StandardCharsets.UTF_8));
        }
        byte[] inhalt = plattform.datei(p);
        if (inhalt == null && !p.contains(".")) {
            p = "index.html";
            inhalt = plattform.datei(p);
        }
        if (inhalt == null) {
            return new HttpServer.Antwort(404, "text/plain; charset=utf-8", "Nicht gefunden".getBytes(StandardCharsets.UTF_8));
        }
        HttpServer.Antwort a = new HttpServer.Antwort(200, dateiTyp(p), inhalt);
        a.kopf.put("Cache-Control", p.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
        if (p.endsWith(".html")) {
            // Gleiche Sicherheitsregeln wie public/.htaccess beim Online-Server (scripts/paket-bauen.sh)
            a.kopf.put("Content-Security-Policy", CSP);
            a.kopf.put("X-Frame-Options", "DENY");
            a.kopf.put("Referrer-Policy", "strict-origin-when-cross-origin");
            a.kopf.put("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        }
        return a;
    }

    /** Inhaltssicherheitsregel der App; data: für QR-Codes und Icons, blob: für Downloads */
    static final String CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        + "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    static String dateiTyp(String p) {
        String e = p.contains(".") ? p.substring(p.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        switch (e) {
            case "html": return "text/html; charset=utf-8";
            case "js":
            case "mjs": return "text/javascript; charset=utf-8";
            case "css": return "text/css; charset=utf-8";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ico": return "image/x-icon";
            case "json": return "application/json; charset=utf-8";
            case "webmanifest": return "application/manifest+json";
            case "woff2": return "font/woff2";
            case "txt": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    /** Eine API-Anfrage; öffentlich für Tests ohne Netzwerk. */
    public HttpServer.Antwort api(HttpServer.Anfrage a) {
        String route = a.query.getOrDefault("r", "");
        String token = a.kopf.get("x-tt-token");
        String auth = a.kopf.get("authorization");
        if (token == null && auth != null && auth.regionMatches(true, 0, "Bearer ", 0, 7)) token = auth.substring(7).trim();
        try {
            Map<String, Object> rumpf = new LinkedHashMap<>();
            if (a.rumpf.length > 0) {
                try {
                    Map<String, Object> m = Json.alsObjekt(Json.lesen(new String(a.rumpf, StandardCharsets.UTF_8)));
                    if (m == null) throw new ApiFehler("ungueltig", "Der Inhalt der Anfrage ist kein gültiges JSON.");
                    rumpf = m;
                } catch (Json.Fehler x) {
                    throw new ApiFehler("ungueltig", "Der Inhalt der Anfrage ist kein gültiges JSON.");
                }
            }
            Anf f = new Anf(a, route, rumpf, token);
            Object daten = route(a.methode + " " + route, f);
            return HttpServer.Antwort.json(200, daten);
        } catch (ApiFehler x) {
            return HttpServer.Antwort.json(x.status(), Json.obj("fehler", x.code, "meldung", x.getMessage()));
        } catch (RuntimeException x) {
            plattform.protokoll("Fehler bei " + route + ": " + x);
            return HttpServer.Antwort.json(500, Json.obj("fehler", "serverfehler", "meldung", "Interner Fehler auf der Zentrale."));
        }
    }

    /** Anfrage mit gelesenem Rumpf */
    private static final class Anf {
        final HttpServer.Anfrage http;
        final String route;
        final Map<String, Object> rumpf;
        final String token;

        Anf(HttpServer.Anfrage http, String route, Map<String, Object> rumpf, String token) {
            this.http = http;
            this.route = route;
            this.rumpf = rumpf;
            this.token = token;
        }

        String q(String k) {
            return http.query.getOrDefault(k, "");
        }
    }

    private Object route(String schluessel, Anf a) {
        switch (schluessel) {
            case "GET info": return info();
            case "GET ich": return ich(a);
            case "POST logout": return logout(a);
            case "GET turniere": return turniereListe(a);
            case "POST turnier.anlegen": return turnierAnlegen(a);
            case "GET turnier": return turnier(a);
            case "POST turnier.zugang": return turnierZugang(a);
            case "GET turnier.einstellungen": return einstellungen(turnierLaden(a.q("id"), a), a);
            case "POST turnier.einstellungen": return einstellungenSetzen(a);
            case "POST turnier.sichern": return sichernJetzt(a);
            case "GET codes": return codes(a);
            case "POST codes.anlegen": return codesAnlegen(a);
            case "POST code.neu": return codeNeu(a);
            case "POST code.sperren": return codeSperren(a);
            case "POST code.entfernen": return codeEntfernen(a);
            case "POST code.helfer": return codeHelfer(a);
            case "POST code.aufgaben": return codeAufgaben(a);
            case "GET konto.einstellungen": return kontoEinstellungen(a);
            case "POST konto.einstellungen": return kontoEinstellungenSetzen(a);
            case "GET pool": return poolListe(a);
            case "POST pool.speichern": return poolSpeichern(a);
            case "POST pool.loeschen": return poolLoeschen(a);
            case "POST turnier.uebersicht": return uebersichtSetzen(a);
            case "GET events": return abholen(a);
            case "POST events": return senden(a);

            case "POST login":
                throw new ApiFehler("nicht_eingerichtet", "Auf der Zentrale meldet sich niemand mit E-Mail an: Turniere legt man am Gerät der Zentrale an, "
                    + "andere Geräte treten mit Leitungs-, Helfer- oder Spieler-Code bei.");
            case "POST setup":
            case "POST registrieren":
            case "POST passwort.vergessen":
            case "POST passwort.zuruecksetzen":
            case "POST passwort.aendern":
            case "POST konto.loeschen":
            case "POST konto.anlegen":
            case "POST konto.sperren":
            case "GET konten":
            case "POST rueckmeldung":
                throw new ApiFehler("nicht_eingerichtet", "Auf der Zentrale nicht verfügbar – bitte die Online-Seite nutzen.");

            /* --- nur vom Gerät der Zentrale --- */
            case "POST zentrale.anmelden": return zentraleAnmelden(a);
            case "GET zentrale.status": selbst(a); return zentraleStatus();
            case "POST zentrale.wlan": return zentraleWlan(a);
            case "POST zentrale.hotspot": return zentraleHotspot(a);
            case "POST zentrale.oeffnen": selbst(a); return Json.obj("ok", plattform.oeffnen(text(a, "ziel", 1, 20)));
            case "POST zentrale.online.anmelden": return onlineAnmelden(a);
            case "POST zentrale.online.abmelden": return onlineAbmelden(a);
            case "GET zentrale.online.turniere": return onlineTurniere(a);
            case "POST zentrale.uebernehmen": return uebernehmen(a);
            case "POST zentrale.rueckgabe": return rueckgabe(a);
            case "POST zentrale.pool.abgleichen": return poolAbgleichen(a);
            case "POST zentrale.sicherungen.senden": selbst(a); warteschlangeSenden(); return zentraleStatus();
            case "POST zentrale.turnier.loeschen": return turnierLoeschen(a);
            default:
                throw new ApiFehler("nicht_gefunden", "Unbekannte Route: " + schluessel);
        }
    }

    /* ======================================================================
     * Hilfen
     * ==================================================================== */

    private long jetzt() {
        return uhr.getAsLong();
    }

    static String iso(long sekunden) {
        return Instant.ofEpochSecond(sekunden).toString();
    }

    private static long ausIso(Object o, long ersatz) {
        if (!(o instanceof String)) return ersatz;
        try {
            return Instant.parse((String) o).getEpochSecond();
        } catch (RuntimeException x) {
            return ersatz;
        }
    }

    private String zufallsText(int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(ID_ZEICHEN.charAt(zufall.nextInt(ID_ZEICHEN.length())));
        return b.toString();
    }

    static String sha256(String s) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : h) b.append(String.format("%02x", x & 0xff));
            return b.toString();
        } catch (NoSuchAlgorithmException x) {
            throw new IllegalStateException(x);
        }
    }

    private static boolean gleich(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    private static String text(Anf a, String feld, int min, int max) {
        String w = Json.alsText(a.rumpf.get(feld));
        if (w == null) throw new ApiFehler("ungueltig", "Feld „" + feld + "“ fehlt.");
        w = w.trim();
        int n = w.codePointCount(0, w.length());
        if (n < min || n > max) throw new ApiFehler("ungueltig", "Feld „" + feld + "“ muss " + min + " bis " + max + " Zeichen lang sein.");
        return w;
    }

    private static String kuerzen(String s, int max) {
        if (s.codePointCount(0, s.length()) <= max) return s;
        return s.substring(0, s.offsetByCodePoints(0, max));
    }

    private static String email(String e) {
        if (e == null) return null;
        e = e.trim().toLowerCase(Locale.ROOT);
        return e.length() <= 190 && P_EMAIL.matcher(e).matches() ? e : null;
    }

    /** Kennung: 8 Ziffern, nicht alle gleich, keine Ziffernfolge */
    static boolean codeGueltig(String code) {
        if (code == null || !code.matches("^[0-9]{8}$")) return false;
        boolean gleich = true, auf = true, ab = true;
        for (int i = 1; i < 8; i++) {
            int v = code.charAt(i - 1) - '0', c = code.charAt(i) - '0';
            gleich = gleich && c == v;
            auf = auf && c == (v + 1) % 10;
            ab = ab && c == (v + 9) % 10;
        }
        return !gleich && !auf && !ab;
    }

    private static List<Object> empfaengerFeld(Object o) {
        List<Object> l = Json.alsListe(o);
        if (l == null || l.size() > MAX_EMPFAENGER) {
            throw new ApiFehler("ungueltig", "Höchstens " + MAX_EMPFAENGER + " Empfänger für die Sicherung.");
        }
        Set<String> aus = new LinkedHashSet<>();
        for (Object x : l) {
            String e = x instanceof String ? ((String) x).trim().toLowerCase(Locale.ROOT) : "";
            if (e.isEmpty()) continue;
            if (email(e) == null) throw new ApiFehler("ungueltig", "Ungültige E-Mail-Adresse: " + e);
            aus.add(e);
        }
        return new ArrayList<>(aus);
    }

    private static List<String> empfaengerAus(Speicher.Turnier t) {
        List<String> aus = new ArrayList<>();
        List<Object> l = Json.alsListe(t.kopf.get("sicherungAn"));
        if (l != null) for (Object o : l) if (o instanceof String) aus.add((String) o);
        return aus;
    }

    private static long zahl(Object o, long ersatz) {
        return o instanceof Number ? ((Number) o).longValue() : ersatz;
    }

    private static boolean wahr(Object o) {
        return Boolean.TRUE.equals(o);
    }

    private void bremse(String schluessel) {
        if (anzahlVersuche(schluessel, VERSUCHE_FENSTER) >= VERSUCHE_MAX) {
            throw new ApiFehler("zu_viele_versuche", "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
        }
    }

    private int anzahlVersuche(String schluessel, long fenster) {
        synchronized (versuche) {
            List<Long> l = versuche.get(schluessel);
            if (l == null) return 0;
            long grenze = jetzt() - fenster;
            l.removeIf(z -> z < grenze - VERSUCHE_FENSTER);
            int n = 0;
            for (long z : l) if (z >= grenze) n++;
            return n;
        }
    }

    private void fehlversuch(String schluessel) {
        synchronized (versuche) {
            versuche.computeIfAbsent(schluessel, k -> new ArrayList<>()).add(jetzt());
        }
    }

    private void versucheLoeschen(String schluessel) {
        synchronized (versuche) {
            versuche.remove(schluessel);
        }
    }

    private void begrenzen(String schluessel, int max, long fenster, String meldung) {
        if (anzahlVersuche(schluessel, fenster) >= max) throw new ApiFehler("zu_viele_versuche", meldung);
        fehlversuch(schluessel);
    }

    /* ---------------- Sitzungen ---------------- */

    private String neuesToken(boolean konto, String turnier, String rolle, String name, String bezug) {
        return neuesToken(konto, turnier, rolle, name, bezug, false);
    }

    private String neuesToken(boolean konto, String turnier, String rolle, String name, String bezug, boolean helfer) {
        byte[] b = new byte[32];
        zufall.nextBytes(b);
        StringBuilder t = new StringBuilder();
        for (byte x : b) t.append(String.format("%02x", x & 0xff));
        String token = t.toString();
        synchronized (this) {
            sitzungen.put(sha256(token), Json.obj(
                "konto", konto, "turnier", turnier, "rolle", rolle, "name", name, "bezug", bezug, "helfer", helfer,
                "ablauf", jetzt() + SITZUNG_DAUER));
            sitzungenSpeichern();
        }
        return token;
    }

    private void sitzungenSpeichern() {
        long j = jetzt();
        sitzungen.values().removeIf(s -> zahl(s.get("ablauf"), 0) < j);
        speicher.speichereObjekt("sitzungen.json", sitzungen);
    }

    /** Sitzung zum Token oder null */
    private synchronized Map<String, Object> sitzung(Anf a) {
        if (a.token == null || !P_TOKEN.matcher(a.token).matches()) return null;
        Map<String, Object> s = sitzungen.get(sha256(a.token));
        if (s == null || zahl(s.get("ablauf"), 0) < jetzt()) return null;
        return s;
    }

    private static boolean istKonto(Map<String, Object> s) {
        return s != null && wahr(s.get("konto"));
    }

    private Map<String, Object> konto(Anf a) {
        Map<String, Object> s = sitzung(a);
        if (!istKonto(s)) throw new ApiFehler("nicht_angemeldet", "Bitte am Gerät der Zentrale öffnen.");
        return s;
    }

    /**
     * Nur vom Gerät selbst: Loopback-Verbindung, passendes Geheimnis und – falls ein Browser einen
     * Origin mitschickt – nur der eigene (127.0.0.1/localhost mit unserem Port).
     */
    private void selbst(Anf a) {
        if (!a.http.vomGeraetSelbst) throw new ApiFehler("keine_berechtigung", "Nur am Gerät der Zentrale möglich.");
        String g = a.http.kopf.get("x-tt-zentrale");
        if (g == null || !MessageDigest.isEqual(g.getBytes(StandardCharsets.UTF_8), geraetGeheimnis.getBytes(StandardCharsets.UTF_8))) {
            throw new ApiFehler("keine_berechtigung", "Nur aus der Zentrale-App möglich.");
        }
        String origin = a.http.kopf.get("origin");
        if (origin != null && !eigeneHerkunft(origin)) throw new ApiFehler("keine_berechtigung", "Fremde Herkunft.");
        String referer = a.http.kopf.get("referer");
        if (referer != null && !eigeneHerkunft(referer)) throw new ApiFehler("keine_berechtigung", "Fremde Herkunft.");
    }

    private boolean eigeneHerkunft(String url) {
        String u = url.toLowerCase(Locale.ROOT);
        for (String h : new String[]{"http://127.0.0.1:" + port, "http://localhost:" + port}) {
            if (u.equals(h) || u.startsWith(h + "/")) return true;
        }
        return false;
    }

    private synchronized void sitzungenEntfernen(String turnier, String rolle, String bezug) {
        boolean geaendert = sitzungen.values().removeIf(s -> turnier.equals(s.get("turnier")) && rolle.equals(s.get("rolle")) && bezug.equals(s.get("bezug")));
        if (geaendert) sitzungenSpeichern();
    }

    /* ---------------- Konto der Zentrale ---------------- */

    private synchronized Map<String, Object> onlineKonto() {
        return Json.alsObjekt(einst.get("onlineKonto"));
    }

    private synchronized String onlineToken() {
        return Json.alsText(einst.get("onlineToken"));
    }

    private synchronized String onlineUrl() {
        String u = Json.alsText(einst.get("onlineUrl"));
        return u == null || u.isEmpty() ? ONLINE_STANDARD : u;
    }

    private synchronized boolean verbunden() {
        return onlineToken() != null;
    }

    private synchronized boolean mailBereit() {
        return verbunden() && wahr(einst.get("onlineMail"));
    }

    private synchronized String kontoName() {
        Map<String, Object> k = onlineKonto();
        String n = k == null ? null : Json.alsText(k.get("name"));
        return n == null || n.isEmpty() ? "Zentrale" : n;
    }

    private synchronized Map<String, Object> kontoAusgabe() {
        Map<String, Object> k = onlineKonto();
        String mail = k == null ? null : Json.alsText(k.get("email"));
        return Json.obj("id", KONTO_ID, "name", kontoName(), "email", mail == null ? "" : mail, "rolle", "veranstalter",
            "gesperrt", false, "angelegt", einst.get("angelegt"), "letzteAnmeldung", null, "zuletztAktiv", null,
            "turniere", (long) turniere.size());
    }

    private void einstSpeichern() {
        speicher.speichereObjekt("zentrale.json", einst);
    }

    /* ---------------- Turniere ---------------- */

    private Speicher.Turnier turnierLaden(String id) {
        return turnierLaden(id, null);
    }

    /**
     * Unbekannte Kennungen werden je Anschluss gezählt: Durchprobieren wird gebremst.
     * Bekannte Turniere bleiben immer erreichbar (alle Geräte in der Halle teilen sich oft eine Adresse).
     */
    /** Kennung aus einer Anfrage: Leerzeichen raus, Großbuchstaben */
    static String turnierId(String id) {
        return id == null ? null : id.replaceAll("\\s+", "").toUpperCase(java.util.Locale.ROOT);
    }

    private Speicher.Turnier turnierLaden(String id, Anf a) {
        id = turnierId(id);
        Speicher.Turnier t;
        synchronized (this) {
            t = id == null || !P_TURNIER_ID.matcher(id).matches() ? null : turniere.get(id);
        }
        if (t == null) {
            if (a != null) {
                String schluessel = "turnier-suche|" + a.http.ip;
                if (anzahlVersuche(schluessel, VERSUCHE_FENSTER) >= SUCHE_MAX) {
                    throw new ApiFehler("zu_viele_versuche", "Zu viele unbekannte Turnierkennungen. Bitte in 15 Minuten erneut versuchen.");
                }
                fehlversuch(schluessel);
            }
            throw new ApiFehler("nicht_gefunden", "Turnier nicht gefunden.");
        }
        return t;
    }

    /** Was darf eine Sitzung in diesem Turnier? */
    private String rechte(Map<String, Object> s, Speicher.Turnier t) {
        if (leitungsRecht(s, t)) return "leitung";
        if (t.id.equals(s.get("turnier")) && ("helfer".equals(s.get("rolle")) || "spieler".equals(s.get("rolle")))) return (String) s.get("rolle");
        return null;
    }

    private Map<String, Object> turnier(Anf a) {
        Speicher.Turnier t = turnierLaden(a.q("id"), a);
        Map<String, Object> aus = turnierAusgabe(t);
        if (a.token != null) {
            Map<String, Object> s = sitzung(a);
            aus.put("rechte", s == null ? null : rechte(s, t));
            if ("helfer".equals(aus.get("rechte"))) aus.put("aufgaben", aufgabenDerSitzung(s));
        }
        return Json.obj("turnier", aus);
    }

    private Map<String, Object> turnierAusgabe(Speicher.Turnier t) {
        return Json.obj(
            "id", t.id,
            "name", t.kopf.get("name"),
            "datum", t.kopf.get("datum"),
            "angelegt", t.kopf.get("angelegt"),
            "veranstalter", kontoName(),
            "herkunft", t.kopf.get("herkunft"),
            "abgegeben", wahr(t.kopf.get("abgegeben")));
    }

    /** Neue Turnierkennung: 8 Zeichen ohne Verwechsler (0/O, 1/I/L), mit Buchstaben und Ziffern, frei */
    private String neueTurnierId() {
        while (true) {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 8; i++) b.append(KENNUNG_ZEICHEN.charAt(zufall.nextInt(KENNUNG_ZEICHEN.length())));
            String id = b.toString();
            if (id.matches(".*[A-Z].*") && id.matches(".*[0-9].*") && !turniere.containsKey(id)) return id;
        }
    }

    private boolean leitungsRecht(Map<String, Object> s, Speicher.Turnier t) {
        if (s == null) return false;
        return (t.id.equals(s.get("turnier")) && "leitung".equals(s.get("rolle"))) || istKonto(s);
    }

    private void leitungPruefen(Anf a, Speicher.Turnier t) {
        Map<String, Object> s = sitzung(a);
        if (s == null) throw new ApiFehler("nicht_angemeldet", "Bitte als Turnierleitung anmelden.");
        if (!leitungsRecht(s, t)) throw new ApiFehler("keine_berechtigung", "Nur für die Turnierleitung.");
    }

    /** Nach der Rückgabe an den Online-Server ist das Turnier auf der Zentrale nur noch lesbar. */
    private static void beschreibbar(Speicher.Turnier t) {
        if (wahr(t.kopf.get("rueckgabeLaeuft"))) {
            throw new ApiFehler("konflikt", "Das Turnier wird gerade an den Online-Server zurückgegeben. Bitte kurz warten.");
        }
        if (wahr(t.kopf.get("abgegeben"))) {
            throw new ApiFehler("konflikt", "Dieses Turnier wurde an den Online-Server zurückgegeben. Weitere Einträge bitte online "
                + "oder nach erneuter Übernahme auf die Zentrale.");
        }
    }

    /* ======================================================================
     * Endpunkte wie beim PHP-Server
     * ==================================================================== */

    private Map<String, Object> info() {
        List<String> adr = plattform.adressen();
        String adresse = adr.isEmpty() || port <= 0 ? null : "http://" + adr.get(0) + ":" + port + "/";
        return Json.obj(
            "app", "tt-turnier",
            "protokoll", (long) PROTOKOLL,
            "version", VERSION,
            "eingerichtet", true,
            "zeit", iso(jetzt()),
            "registrierung", false,
            "mail", mailBereit(),
            "codes", true,
            "kennungen", true,
            "aufgaben", true,
            "anmeldung", false,
            "zentrale", Json.obj("version", VERSION, "adresse", adresse, "online", verbunden()));
    }

    private Map<String, Object> ich(Anf a) {
        Map<String, Object> s = sitzung(a);
        if (s == null) throw new ApiFehler("nicht_angemeldet", "Nicht angemeldet.");
        Map<String, Object> aus = Json.obj("rolle", s.get("rolle"), "name", s.get("name"), "turnier", s.get("turnier"));
        if ("spieler".equals(s.get("rolle")) && s.get("bezug") != null) {
            aus.put("spieler", s.get("bezug"));
            if (wahr(s.get("helfer"))) aus.put("helfer", true);
        }
        if ("helfer".equals(s.get("rolle"))) aus.put("aufgaben", aufgabenDerSitzung(s));
        if (istKonto(s)) aus.put("konto", kontoAusgabe());
        return aus;
    }

    private synchronized Map<String, Object> logout(Anf a) {
        if (a.token != null && sitzungen.remove(sha256(a.token)) != null) sitzungenSpeichern();
        return Json.obj("ok", true);
    }

    private synchronized Map<String, Object> turniereListe(Anf a) {
        konto(a);
        List<Speicher.Turnier> l = new ArrayList<>(turniere.values());
        l.sort((x, y) -> String.valueOf(y.kopf.get("angelegt")).compareTo(String.valueOf(x.kopf.get("angelegt"))));
        List<Object> aus = new ArrayList<>();
        for (Speicher.Turnier t : l) aus.add(turnierAusgabe(t));
        return Json.obj("turniere", aus);
    }

    private Map<String, Object> turnierAnlegen(Anf a) {
        konto(a);
        String name = text(a, "name", 2, 160);
        Object datum = a.rumpf.get("datum");
        if (datum != null && (!(datum instanceof String) || !P_DATUM.matcher((String) datum).matches())) {
            throw new ApiFehler("ungueltig", "Datum im Format JJJJ-MM-TT angeben.");
        }
        List<Object> empf;
        if (a.rumpf.containsKey("sicherungAn")) {
            empf = empfaengerFeld(a.rumpf.get("sicherungAn"));
        } else {
            empf = new ArrayList<>();
            Map<String, Object> k = onlineKonto();
            String m = k == null ? null : email(Json.alsText(k.get("email")));
            if (m != null) empf.add(m);
        }
        String wunsch = Json.alsText(a.rumpf.get("kennung"));
        wunsch = wunsch == null || wunsch.trim().isEmpty() ? null : turnierId(wunsch);
        if (wunsch != null && (!P_TURNIER_ID.matcher(wunsch).matches() || wunsch.contains("--"))) {
            throw new ApiFehler("ungueltig", "Die Wunschkennung braucht 4 bis 12 Zeichen: Buchstaben A–Z, Ziffern und Bindestriche (nicht am Anfang oder Ende).");
        }
        Speicher.Turnier t;
        synchronized (this) {
            if (wunsch != null && turniere.containsKey(wunsch)) {
                throw new ApiFehler("konflikt", "Die Kennung „" + wunsch + "“ ist schon vergeben. Bitte eine andere wählen.");
            }
            String id = wunsch != null ? wunsch : neueTurnierId();
            long j = jetzt();
            t = new Speicher.Turnier(id, Json.obj(
                "name", name, "datum", datum, "angelegt", iso(j), "angelegtSek", j,
                "sicherungAn", empf, "sicherungTakt", 30L,
                "sicherungLetzte", null, "sicherungSeq", 0L, "uebersicht", null, "uebersichtZeit", null,
                "herkunft", "zentrale", "abgegeben", false));
            speicher.turnierAnlegen(t);
            turniere.put(id, t);
        }
        Map<String, Object> leitung;
        synchronized (this) {
            // Leitungskennung für die anlegende Person (die Zentrale selbst leitet über ihr Konto)
            leitung = codeAnlegen(t, "leitung", "l-" + zufallsText(10), kontoName());
            speicher.codesSpeichern(t);
        }
        String token = neuesToken(true, t.id, "leitung", kontoName(), null);
        return Json.obj("turnier", turnierAusgabe(t), "token", token, "leitung", codeAusgabe(leitung));
    }

    private Map<String, Object> turnierZugang(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        // Bremsen ohne Aussperren richtiger Kennungen (siehe PHP-Server): Verzögerung ab dem 5. Fehlversuch je
        // Anschluss, 429 für falsche Kennungen ab 30 je Anschluss bzw. 200 je Turnier.
        String schluessel = "zugang|" + t.id + "|" + a.http.ip;
        String schluesselTurnier = "zugang-turnier|" + t.id;
        int fehl = anzahlVersuche(schluessel, VERSUCHE_FENSTER);
        if (fehl >= ZUGANG_VERZOEGERN_AB && !ohneWarten) {
            try {
                Thread.sleep(Math.min(2000L, 250L * (fehl - ZUGANG_VERZOEGERN_AB + 1)));
            } catch (InterruptedException x) {
                Thread.currentThread().interrupt();
            }
        }
        String roh = Json.alsText(a.rumpf.get("code"));
        String code = roh == null ? "" : roh.replaceAll("\\s+", "");
        Map<String, Object> c = null;
        if (code.matches("^[0-9]{8}$")) {
            synchronized (this) {
                for (Map<String, Object> x : t.codes) {
                    if (gleich(code, String.valueOf(x.get("code"))) && !wahr(x.get("gesperrt"))) { c = x; break; }
                }
            }
        }
        if (c == null) {
            fehlversuch(schluessel);
            fehlversuch(schluesselTurnier);
            if (fehl + 1 >= VERSUCHE_MAX * 3 || anzahlVersuche(schluesselTurnier, VERSUCHE_FENSTER) > ZUGANG_TURNIER_MAX) {
                throw new ApiFehler("zu_viele_versuche", "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
            }
            throw new ApiFehler("falsche_zugangsdaten", "Diese Kennung passt nicht zu diesem Turnier.");
        }
        versucheLoeschen(schluessel);
        String rolle = (String) c.get("rolle");
        boolean helfer = "spieler".equals(rolle) && wahr(c.get("helfer"));
        String token = neuesToken(false, t.id, rolle, (String) c.get("name"), (String) c.get("bezug"), helfer);
        Map<String, Object> aus = Json.obj("token", token, "rolle", rolle, "name", c.get("name"));
        if ("spieler".equals(rolle)) {
            aus.put("spieler", c.get("bezug"));
            if (helfer) aus.put("helfer", true);
        }
        if ("helfer".equals(rolle)) aus.put("aufgaben", aufgabenLesen(c.get("aufgaben")));
        return aus;
    }

    private Map<String, Object> abholen(Anf a) {
        Speicher.Turnier t = turnierLaden(a.q("turnier"), a);
        long ab;
        try {
            ab = Long.parseLong(a.q("ab").isEmpty() ? "0" : a.q("ab"));
        } catch (NumberFormatException x) {
            ab = 0;
        }
        String sicht = sicht(a, t);
        synchronized (this) {
            List<Object> aus = new ArrayList<>();
            boolean mehr = false;
            // Laufnummern sind lückenlos 1..n, also direkt ab Position ab
            int start = (int) Math.max(0, Math.min(ab, t.ereignisse.size()));
            while (start > 0 && zahl(t.ereignisse.get(start - 1).get("seq"), 0) > ab) start--;
            long bis = ab;
            // Spieler und Zuschauer: Namen entfernter Spieler ersetzen (wie PHP, Etappe 10)
            Set<String> weg = ("spieler".equals(sicht) || "zuschauer".equals(sicht) || "kurz".equals(sicht)) ? entfernteSpieler(t.ereignisse) : Collections.emptySet();
            // Mannschaften: noch nicht aufgedeckte Aufstellungen (wie PHP, ab 0.13)
            Set<String> verdeckt = Collections.emptySet();
            Set<String> offen = Collections.emptySet();
            // Kasse-Helfer haben die volle Sicht (Zahlungen), sehen Aufstellungen aber erst nach dem Aufdecken (ab 0.16)
            boolean kasseSicht = "voll".equals(sicht) && !leitungsSicht(a, t);
            if (!"voll".equals(sicht) || kasseSicht) {
                String bezug = null;
                if ("spieler".equals(sicht) || "helfer".equals(sicht)) {
                    try {
                        Map<String, Object> sz = sitzung(a);
                        bezug = sz == null || sz.get("bezug") == null ? null : String.valueOf(sz.get("bezug"));
                    } catch (ApiFehler f) {
                        bezug = null;
                    }
                }
                List<Set<String>> v = verdeckteAufstellungen(t.ereignisse, bezug);
                verdeckt = v.get(0);
                offen = v.get(1);
            }
            for (int i = start; i < t.ereignisse.size(); i++) {
                Map<String, Object> e = t.ereignisse.get(i);
                long seq = zahl(e.get("seq"), 0);
                if (seq <= ab) continue;
                if (aus.size() == MAX_EREIGNISSE) { mehr = true; break; }
                bis = seq;
                // Zahlungen und Check-in nur in der vollen Sicht (wie PHP)
                if (!"voll".equals(sicht) && NUR_VOLLE_SICHT.contains(e.get("art"))) continue;
                if (verdeckt.contains(String.valueOf(e.get("id")))) continue;
                Map<String, Object> m = ausgabe(e, true);
                aus.add("voll".equals(sicht) ? m : gefiltert(m, sicht, weg));
            }
            Map<String, Object> antwort = Json.obj("ereignisse", aus, "hoechsteSeq", t.hoechsteSeq(), "mehr", mehr, "sicht", sicht, "bis", bis);
            Set<String> filter = new TreeSet<>(weg);
            for (String b : offen) filter.add("aufgedeckt:" + b);
            // Eigene Kennung für die Kasse-Sicht (wie PHP): Wechsel Kasse ↔ Leitung lädt alles neu
            if (kasseSicht) filter.add("sicht:kasse");
            if (!filter.isEmpty()) antwort.put("filter", filterKennung(filter));
            return antwort;
        }
    }

    /**
     * Was ein Gerät beim Abholen sieht (Datenschutz, ab 0.9, wie server-php Api::sicht): Wer im
     * Turnier angemeldet ist, bekommt alles; Zuschauer keine Jahrgänge, kein Geschlecht, keine
     * Pool-Bezüge, keine Namen von Eintragenden und keine frei eingetippten Schiedsrichter-Namen,
     * bei „Namen für Zuschauer: Kurzform“ auch nur „Max M.“.
     */
    /** Hat diese Anfrage Leitungsrechte im Turnier? (volle Sicht ohne verdeckte Aufstellungen) */
    private boolean leitungsSicht(Anf a, Speicher.Turnier t) {
        if (a.token == null) return false;
        try {
            Map<String, Object> s = sitzung(a);
            return s != null && "leitung".equals(rechte(s, t));
        } catch (ApiFehler f) {
            return false;
        }
    }

    private String sicht(Anf a, Speicher.Turnier t) {
        if (a.token != null) {
            Map<String, Object> s;
            try {
                s = sitzung(a);
            } catch (ApiFehler f) {
                s = null;
            }
            String r = s == null ? null : rechte(s, t);
            if ("leitung".equals(r) || ("helfer".equals(r) && aufgabenDerSitzung(s).contains("kasse"))) return "voll";
            // Helfer ohne Aufgabe „Kasse“: alles außer Zahlungen, Check-in und Bankverbindung (wie PHP)
            if ("helfer".equals(r) || ("spieler".equals(r) && wahr(s.get("helfer")))) return "helfer";
            if ("spieler".equals(r)) return "spieler";
        }
        synchronized (this) {
            for (int i = t.ereignisse.size() - 1; i >= 0; i--) {
                Map<String, Object> e = t.ereignisse.get(i);
                if (!"turnier.daten".equals(e.get("art"))) continue;
                Map<String, Object> au = Json.alsObjekt(e.get("autor"));
                String rolle = au == null ? "" : String.valueOf(au.get("rolle"));
                if (!("leitung".equals(rolle) || "admin".equals(rolle) || "veranstalter".equals(rolle))) continue;
                Map<String, Object> d = Json.alsObjekt(e.get("daten"));
                Object n = d == null ? null : d.get("namen");
                if ("kurz".equals(n)) return "kurz";
                if ("voll".equals(n)) return "zuschauer";
            }
        }
        return "zuschauer";
    }

    /** Kurzform eines Nachnamens: „Müller“ → „M.“ */
    static String kurzname(String nachname) {
        String n = nachname == null ? "" : nachname.trim();
        if (n.isEmpty()) return "";
        return n.substring(0, n.offsetByCodePoints(0, 1)).toUpperCase(Locale.GERMAN) + ".";
    }

    /** Mannschaften laut letzter Meldung der Leitung: "<konkurrenz>|<id>" → Daten (wie PHP Api::mannschaftenLaut) */
    static Map<String, Map<String, Object>> mannschaftenLaut(List<Map<String, Object>> liste) {
        Map<String, Map<String, Object>> aus = new HashMap<>();
        for (Map<String, Object> e : liste) {
            if (!"mannschaft.gemeldet".equals(e.get("art")) || !leitungAutor(e)) continue;
            Map<String, Object> x = Json.alsObjekt(e.get("daten"));
            if (x == null || Json.alsText(x.get("konkurrenz")) == null || Json.alsText(x.get("id")) == null || !(x.get("spieler") instanceof List)) continue;
            aus.put(x.get("konkurrenz") + "|" + x.get("id"), x);
        }
        return aus;
    }

    static boolean istMitglied(Map<String, Object> team, String spieler) {
        if (team == null || spieler == null) return false;
        for (Object o : (List<?>) team.get("spieler")) if (spieler.equals(o)) return true;
        return false;
    }

    /** Aufstellung von Helfern und Spielern prüfen (wie PHP Api::aufstellungPruefen); null = in Ordnung */
    static final List<String> AUFSTELLUNG_FELDER = Arrays.asList("konkurrenz", "spiel", "mannschaft", "gegner", "einzel", "doppel");
    static final String SPIEL_ID_MANNSCHAFT = "^(g\\d{1,3}-m-[A-Za-z0-9-]{4,38}-m-[A-Za-z0-9-]{4,38}|(ko|tr|vl|fi)-\\d{1,2}-\\d{1,3}|ko-p3)$";

    static String aufstellungPruefen(List<Map<String, Object>> liste, Object daten, boolean spieler, boolean helfer, String bezug) {
        Map<String, Object> d = Json.alsObjekt(daten);
        if (d == null || !AUFSTELLUNG_FELDER.containsAll(d.keySet()) || Json.schreiben(d).getBytes(StandardCharsets.UTF_8).length > 2048) return "Aufstellung ungültig.";
        String k = Json.alsText(d.get("konkurrenz"));
        String spiel = Json.alsText(d.get("spiel"));
        String m = Json.alsText(d.get("mannschaft"));
        String g = Json.alsText(d.get("gegner"));
        String muster = "^m-[A-Za-z0-9-]{4,38}$";
        if (k == null || spiel == null || !spiel.matches(SPIEL_ID_MANNSCHAFT) || m == null || g == null || m.equals(g) || !m.matches(muster) || !g.matches(muster)) return "Aufstellung ungültig.";
        java.util.regex.Matcher t = java.util.regex.Pattern.compile("^g\\d+-(.+)$").matcher(spiel);
        if (t.matches() && !t.group(1).equals(m + "-" + g) && !t.group(1).equals(g + "-" + m)) return "Diese Mannschaften spielen nicht in dieser Begegnung.";
        Map<String, Map<String, Object>> teams = mannschaftenLaut(liste);
        Map<String, Object> team = teams.get(k + "|" + m);
        if (team == null || !teams.containsKey(k + "|" + g)) return "Mannschaft nicht gemeldet.";
        boolean mitglied = istMitglied(team, bezug) || istMitglied(teams.get(k + "|" + g), bezug);
        if (spieler && (!helfer || mitglied) && (bezug == null || !bezug.equals(team.get("fuehrer")))) return "Die Aufstellung gibt die Mannschaftsführung ab.";
        Object einzelRoh = d.get("einzel") == null ? new ArrayList<>() : d.get("einzel");
        Object doppelRoh = d.get("doppel") == null ? new ArrayList<>() : d.get("doppel");
        if (!(einzelRoh instanceof List) || !(doppelRoh instanceof List) || ((List<?>) einzelRoh).size() > 8 || ((List<?>) doppelRoh).size() > 8) return "Aufstellung ungültig.";
        List<Object> alle = new ArrayList<>();
        for (Object x : (List<?>) einzelRoh) if (x != null) alle.add(x);
        List<Object> imDoppel = new ArrayList<>();
        for (Object p : (List<?>) doppelRoh) {
            if (p == null) continue;
            if (!(p instanceof List) || ((List<?>) p).size() != 2 || java.util.Objects.equals(((List<?>) p).get(0), ((List<?>) p).get(1))) return "Aufstellung ungültig.";
            imDoppel.addAll((List<?>) p);
        }
        List<Object> zusammen = new ArrayList<>(alle);
        zusammen.addAll(imDoppel);
        for (Object x : zusammen) if (!(x instanceof String) || !istMitglied(team, (String) x)) return "In der Aufstellung steht ein Spieler, der nicht zur Mannschaft gehört.";
        if (new HashSet<>(alle).size() != alle.size() || new HashSet<>(imDoppel).size() != imDoppel.size() || zusammen.isEmpty()) return "Aufstellung ungültig (leer oder doppelt besetzt).";
        int n = 0;
        Set<Object> begegnungen = new HashSet<>();
        for (Map<String, Object> e : liste) {
            if (!"mannschaft.aufgestellt".equals(e.get("art"))) continue;
            Map<String, Object> x = Json.alsObjekt(e.get("daten"));
            if (x == null || !m.equals(x.get("mannschaft")) || !k.equals(x.get("konkurrenz"))) continue;
            begegnungen.add(x.get("spiel"));
            if (spiel.equals(x.get("spiel"))) n++;
        }
        if (!begegnungen.contains(spiel) && begegnungen.size() >= 200) return "Zu viele Aufstellungen für diese Mannschaft.";
        return n >= 5 ? "Diese Aufstellung wurde schon zu oft geändert. Bitte die Turnierleitung fragen." : null;
    }

    /**
     * Verdeckte Aufstellungen (wie PHP Api::verdeckteAus): aufgedeckt erst, wenn sich zwei Aufstellungen gegenseitig
     * als Gegner nennen; vorher nur für die Spieler der eigenen Mannschaft. Ergebnis: [verdeckte IDs, aufgedeckte Begegnungen].
     */
    static List<Set<String>> verdeckteAufstellungen(List<Map<String, Object>> liste, String bezug) {
        Set<String> verdeckt = new TreeSet<>();
        Set<String> offen = new TreeSet<>();
        Map<String, Set<String>> nennt = new HashMap<>(); // "<schluessel>|<mannschaft>" → Gegner
        List<Map<String, Object>> auf = new ArrayList<>();
        for (Map<String, Object> e : liste) {
            if (!"mannschaft.aufgestellt".equals(e.get("art"))) continue;
            auf.add(e);
            Map<String, Object> d = Json.alsObjekt(e.get("daten"));
            if (d == null || Json.alsText(d.get("konkurrenz")) == null || Json.alsText(d.get("spiel")) == null || Json.alsText(d.get("mannschaft")) == null || Json.alsText(d.get("gegner")) == null) continue;
            nennt.computeIfAbsent(d.get("konkurrenz") + "|" + d.get("spiel") + "|" + d.get("mannschaft"), x -> new HashSet<>()).add((String) d.get("gegner"));
        }
        if (auf.isEmpty()) return Arrays.asList(verdeckt, offen);
        Map<String, Map<String, Object>> teams = bezug == null ? Collections.emptyMap() : mannschaftenLaut(liste);
        for (Map<String, Object> e : auf) {
            Map<String, Object> d = Json.alsObjekt(e.get("daten"));
            boolean ok = d != null && Json.alsText(d.get("konkurrenz")) != null && Json.alsText(d.get("spiel")) != null && Json.alsText(d.get("mannschaft")) != null && Json.alsText(d.get("gegner")) != null;
            String id = String.valueOf(e.get("id"));
            if (!ok) {
                verdeckt.add(id);
                continue;
            }
            String schluessel = d.get("konkurrenz") + "|" + d.get("spiel");
            boolean aufgedeckt = nennt.getOrDefault(schluessel + "|" + d.get("gegner"), Collections.emptySet()).contains(d.get("mannschaft"));
            if (aufgedeckt) offen.add(schluessel);
            else if (!istMitglied(teams.get(d.get("konkurrenz") + "|" + d.get("mannschaft")), bezug)) verdeckt.add(id);
        }
        return Arrays.asList(verdeckt, offen);
    }

    /** Fingerabdruck der Menge entfernter Spieler (wie PHP Api::filterKennung) */
    static String filterKennung(Set<String> weg) {
        List<String> ids = new ArrayList<>(weg);
        Collections.sort(ids);
        return sha256(String.join(",", ids)).substring(0, 16);
    }

    private static boolean leitungAutor(Map<String, Object> e) {
        Map<String, Object> au = Json.alsObjekt(e.get("autor"));
        String r = au == null ? "" : String.valueOf(au.get("rolle"));
        return "leitung".equals(r) || "admin".equals(r) || "veranstalter".equals(r);
    }

    /** Entfernte Spieler (spieler.entfernt nicht zurückgenommen, oder jedes Anlegen zurückgenommen) – wie PHP Api::entfernteAus */
    static Set<String> entfernteSpieler(List<Map<String, Object>> liste) {
        Map<String, String[]> ziel = new LinkedHashMap<>();
        Map<String, Boolean> zurueck = new HashMap<>();
        for (Map<String, Object> e : liste) {
            String art = String.valueOf(e.get("art"));
            if (!"spieler.angelegt".equals(art) && !"spieler.entfernt".equals(art) && !"eintrag.zurueckgenommen".equals(art)) continue;
            Map<String, Object> d = Json.alsObjekt(e.get("daten"));
            if (d == null) continue;
            if ("eintrag.zurueckgenommen".equals(art)) {
                if (!leitungAutor(e) || !(d.get("ereignisse") instanceof List)) continue;
                boolean z = !Boolean.FALSE.equals(d.get("zurueck"));
                List<?> ids = (List<?>) d.get("ereignisse");
                for (int i = 0; i < Math.min(200, ids.size()); i++) {
                    Object id = ids.get(i);
                    if (id instanceof String && ziel.containsKey(id)) zurueck.put((String) id, z);
                }
                continue;
            }
            Object sp = d.get("id");
            if (!(sp instanceof String) || ("spieler.entfernt".equals(art) && !leitungAutor(e))) continue;
            String eid = String.valueOf(e.get("id"));
            if (!ziel.containsKey(eid)) ziel.put(eid, new String[] {art, (String) sp});
        }
        Map<String, Boolean> angelegt = new HashMap<>();
        Set<String> weg = new TreeSet<>();
        for (Map.Entry<String, String[]> z : ziel.entrySet()) {
            boolean gilt = !Boolean.TRUE.equals(zurueck.get(z.getKey()));
            String sp = z.getValue()[1];
            if ("spieler.angelegt".equals(z.getValue()[0])) angelegt.put(sp, angelegt.getOrDefault(sp, false) || gilt);
            else if (gilt) weg.add(sp);
        }
        for (Map.Entry<String, Boolean> a : angelegt.entrySet()) if (!a.getValue()) weg.add(a.getKey());
        return weg;
    }

    private static Map<String, Object> gefiltert(Map<String, Object> e, String sicht, Set<String> weg) {
        if ("helfer".equals(sicht)) {
            Map<String, Object> d0 = Json.alsObjekt(e.get("daten"));
            String art0 = String.valueOf(e.get("art"));
            boolean spielerArt = "spieler.angelegt".equals(art0) || "spieler.geaendert".equals(art0);
            if (d0 == null || !(("turnier.daten".equals(art0) && d0.containsKey("kasse")) || spielerArt)) return e;
            Map<String, Object> m = new LinkedHashMap<>(e);
            Map<String, Object> d = new LinkedHashMap<>(d0);
            d.remove("kasse");
            if (spielerArt) {
                // Datensparsamkeit (wie PHP): Jahrgang, Geschlecht, Pool-Bezug und Lizenz nur für Leitung und Kasse
                d.remove("jahrgang");
                d.remove("geschlecht");
                d.remove("pool");
                d.remove("lizenz");
                d.remove("ttrGeschaetzt");
            }
            m.put("daten", d);
            return m;
        }
        boolean kurz = "kurz".equals(sicht);
        boolean zuschauer = !"spieler".equals(sicht);
        Map<String, Object> m = new LinkedHashMap<>(e);
        Map<String, Object> au0 = Json.alsObjekt(e.get("autor"));
        if (!zuschauer && au0 != null && au0.get("spieler") instanceof String && weg.contains(au0.get("spieler"))) {
            // Entfernte Person hat selbst eingetragen: Name nicht mehr am Eintrag (wie PHP)
            Map<String, Object> autor = new LinkedHashMap<>(au0);
            autor.put("name", "");
            m.put("autor", autor);
        }
        if (zuschauer) {
            Map<String, Object> au = Json.alsObjekt(e.get("autor"));
            Map<String, Object> autor = new LinkedHashMap<>();
            autor.put("rolle", au == null ? "leitung" : au.get("rolle"));
            autor.put("name", "");
            if (au != null && au.containsKey("spieler")) autor.put("spieler", au.get("spieler"));
            if (au != null && au.containsKey("helfer")) autor.put("helfer", au.get("helfer"));
            if (au != null && au.containsKey("aufgaben")) autor.put("aufgaben", au.get("aufgaben"));
            m.put("autor", autor);
        }
        Map<String, Object> d0 = Json.alsObjekt(e.get("daten"));
        if (d0 == null) return m;
        Map<String, Object> d = new LinkedHashMap<>(d0);
        String art = String.valueOf(e.get("art"));
        if ("turnier.daten".equals(art)) {
            d.remove("kasse"); // Kasse und Bankverbindung nur für Leitung und Helfer
        } else if ("spieler.angelegt".equals(art) || "spieler.geaendert".equals(art)) {
            d.remove("jahrgang");
            d.remove("geschlecht");
            d.remove("pool");
            d.remove("lizenz");
            d.remove("ttrGeschaetzt");
            if (d.get("id") instanceof String && weg.contains(d.get("id"))) {
                // Entfernter Spieler: keine Angaben zur Person mehr
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("id", d.get("id"));
                if ("spieler.angelegt".equals(art)) {
                    r.put("vorname", ENTFERNT_NAME);
                    r.put("nachname", "");
                    r.put("verein", "");
                }
                d = r;
            } else if (kurz && d.get("nachname") instanceof String) d.put("nachname", kurzname((String) d.get("nachname")));
        } else if ("spiel.aufgerufen".equals(art) && d.containsKey("schiri")) {
            Map<String, Object> sc = Json.alsObjekt(d.get("schiri"));
            Object sp = sc == null ? null : sc.get("spieler");
            if (!(sp instanceof String)) {
                if (zuschauer) d.remove("schiri");
            } else if (zuschauer || weg.contains(sp)) {
                d.put("schiri", Json.obj("spieler", sp));
            }
        }
        m.put("daten", d);
        return m;
    }

    private static Map<String, Object> ausgabe(Map<String, Object> e, boolean mitSeqZuerst) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (mitSeqZuerst) m.put("seq", e.get("seq"));
        m.put("id", e.get("id"));
        m.put("art", e.get("art"));
        m.put("daten", e.get("daten"));
        m.put("zeit", e.get("zeit"));
        m.put("geraet", e.get("geraet"));
        if (!mitSeqZuerst) m.put("seq", e.get("seq"));
        m.put("empfangen", e.get("empfangen"));
        m.put("autor", e.get("autor"));
        return m;
    }

    private Map<String, Object> senden(Anf a) {
        Speicher.Turnier t = turnierLaden(a.q("turnier"), a);
        Map<String, Object> s = sitzung(a);
        if (s == null) throw new ApiFehler("nicht_angemeldet", "Zum Eintragen bitte anmelden.");
        String srolle = (String) s.get("rolle");
        boolean darf = (t.id.equals(s.get("turnier")) && Arrays.asList("leitung", "helfer", "spieler").contains(srolle)) || istKonto(s);
        if (!darf) throw new ApiFehler("keine_berechtigung", "Keine Berechtigung für dieses Turnier.");
        List<Object> liste = Json.alsListe(a.rumpf.get("ereignisse"));
        if (liste == null || liste.size() > MAX_EREIGNISSE) {
            throw new ApiFehler("ungueltig", "Feld „ereignisse“ muss eine Liste mit höchstens " + MAX_EREIGNISSE + " Einträgen sein.");
        }
        if (t.ereignisse.size() + liste.size() > MAX_JE_TURNIER) {
            throw new ApiFehler("zu_gross", "Das Turnier hat die Höchstzahl an Einträgen erreicht.");
        }
        String rolle = istKonto(s) ? "leitung" : srolle;
        List<Object> aufgaben = "helfer".equals(rolle) ? aufgabenDerSitzung(s) : null;
        List<String> erlaubt;
        if ("spieler".equals(rolle)) erlaubt = wahr(s.get("helfer")) ? ARTEN_SPIELER_HELFER : ARTEN_SPIELER;
        else if ("helfer".equals(rolle)) {
            erlaubt = new ArrayList<>();
            for (Object x : aufgaben) for (String art : ARTEN_JE_AUFGABE.get(String.valueOf(x))) if (!erlaubt.contains(art)) erlaubt.add(art);
        } else erlaubt = null;
        // Helfer und Spieler: höchstens 60 Sendungen pro Minute je Kennung (wie PHP, Schutz vor Dauerschleifen)
        if ("helfer".equals(rolle) || "spieler".equals(rolle)) {
            begrenzen("ev:" + sha256(a.token).substring(0, 24), 60, 60, "Zu viele Einträge in kurzer Zeit. Bitte kurz warten.");
        }
        Map<String, Object> autor = Json.obj("rolle", rolle, "name", s.get("name"));
        if ("spieler".equals(rolle) && s.get("bezug") != null) {
            autor.put("spieler", s.get("bezug"));
            if (wahr(s.get("helfer"))) autor.put("helfer", true);
        }
        if (aufgaben != null) autor.put("aufgaben", aufgaben);

        // Einzelne Einträge ablehnen statt den ganzen Block (ab 0.11, wie PHP)
        List<Map<String, Object>> geprueft = new ArrayList<>();
        List<Object> abgelehnt = new ArrayList<>();
        for (Object o : liste) {
            Map<String, Object> roh = Json.alsObjekt(o);
            String eid = roh == null || Json.alsText(roh.get("id")) == null ? "" : kuerzen(Json.alsText(roh.get("id")), 64);
            if (erlaubt != null && (roh == null || !erlaubt.contains(roh.get("art")))) {
                abgelehnt.add(Json.obj("id", eid, "fehler", "keine_berechtigung", "meldung",
                    "helfer".equals(rolle) ? "Diese Aufgabe hat deine Helferkennung nicht." : "Mit dieser Kennung dürfen nur Ergebnisse eingetragen werden."));
                continue;
            }
            // Aufstellung von Helfern und Spielern: Inhalt wie die Engine prüfen (wie PHP)
            if (!"leitung".equals(rolle) && "mannschaft.aufgestellt".equals(roh.get("art"))) {
                String f;
                synchronized (this) {
                    // auch die schon geprüften Einträge dieser Sendung mitzählen (Grenze je Begegnung)
                    List<Map<String, Object>> bisher = new ArrayList<>(t.ereignisse);
                    bisher.addAll(geprueft);
                    f = aufstellungPruefen(bisher, roh.get("daten"), "spieler".equals(rolle), wahr(s.get("helfer")), s.get("bezug") == null ? null : String.valueOf(s.get("bezug")));
                }
                if (f != null) {
                    abgelehnt.add(Json.obj("id", eid, "fehler", "ungueltig", "meldung", f));
                    continue;
                }
            }
            try {
                geprueft.add(ereignisPruefen(o));
            } catch (ApiFehler f) {
                if (!"ungueltig".equals(f.code)) throw f;
                abgelehnt.add(Json.obj("id", eid, "fehler", "ungueltig", "meldung", f.getMessage()));
            }
        }

        List<Object> angenommen = new ArrayList<>();
        boolean abschluss = false;
        synchronized (this) {
            beschreibbar(t);
            List<Map<String, Object>> neu = new ArrayList<>();
            Map<String, Long> inDiesemAufruf = new HashMap<>();
            long seq = t.hoechsteSeq();
            for (Map<String, Object> e : geprueft) {
                String id = (String) e.get("id");
                Integer pos = t.index.get(id);
                if (pos != null) {
                    angenommen.add(Json.obj("id", id, "seq", t.ereignisse.get(pos).get("seq")));
                    continue;
                }
                Long schon = inDiesemAufruf.get(id);
                if (schon != null) {
                    angenommen.add(Json.obj("id", id, "seq", schon));
                    continue;
                }
                Map<String, Object> z = new LinkedHashMap<>(e);
                z.put("seq", ++seq);
                z.put("empfangen", iso(jetzt()));
                z.put("autor", autor);
                z.put("online", false);
                neu.add(z);
                inDiesemAufruf.put(id, seq);
                angenommen.add(Json.obj("id", id, "seq", seq));
                abschluss = abschluss || ART_ABGESCHLOSSEN.equals(e.get("art"));
            }
            speicher.ereignisseAnhaengen(t, neu);
            for (Map<String, Object> z : neu) t.aufnehmen(z);
            if (abschluss) sicherungEinreihen(t, "Turnier abgeschlossen");
            Map<String, Object> aus = Json.obj("angenommen", angenommen, "hoechsteSeq", t.hoechsteSeq());
            if (!abgelehnt.isEmpty()) aus.put("abgelehnt", abgelehnt);
            return aus;
        }
    }

    /** Prüft ein Ereignis wie der PHP-Server; liefert {id, art, daten, zeit, geraet}. */
    static Map<String, Object> ereignisPruefen(Object o) {
        Map<String, Object> e = Json.alsObjekt(o);
        if (e == null) throw new ApiFehler("ungueltig", "Ereignis muss ein Objekt sein.");
        String id = Json.alsText(e.get("id"));
        String art = Json.alsText(e.get("art"));
        String zeit = Json.alsText(e.get("zeit"));
        String geraet = Json.alsText(e.get("geraet"));
        Map<String, Object> daten = Json.alsObjekt(e.get("daten"));
        if (id == null || !P_EREIGNIS_ID.matcher(id).matches()) throw new ApiFehler("ungueltig", "Ereignis-ID ungültig.");
        if (art == null || !P_ART.matcher(art).matches()) throw new ApiFehler("ungueltig", "Ereignis-Art ungültig.");
        if (zeit == null || zeit.length() > 40 || !P_ZEIT.matcher(zeit).matches()) throw new ApiFehler("ungueltig", "Ereignis-Zeit ungültig.");
        if (geraet == null || !P_GERAET.matcher(geraet).matches()) throw new ApiFehler("ungueltig", "Geräte-Kennung ungültig.");
        if (daten == null) throw new ApiFehler("ungueltig", "Ereignis-Daten müssen ein Objekt sein.");
        if (Json.schreiben(daten).getBytes(StandardCharsets.UTF_8).length > MAX_DATEN_BYTES) {
            throw new ApiFehler("ungueltig", "Ereignis-Daten sind zu groß.");
        }
        return Json.obj("id", id, "art", art, "daten", daten, "zeit", zeit, "geraet", geraet);
    }

    /* ---------------- Einstellungen und Sicherung ---------------- */

    private synchronized Map<String, Object> einstellungen(Speicher.Turnier t, Anf a) {
        leitungPruefen(a, t);
        return Json.obj(
            "sicherungAn", new ArrayList<Object>(empfaengerAus(t)),
            "sicherungTakt", zahl(t.kopf.get("sicherungTakt"), 30),
            "letzteSicherung", t.kopf.get("sicherungLetzte"),
            "mail", mailBereit(),
            "wartend", warteschlange.containsKey(t.id));
    }

    private Map<String, Object> einstellungenSetzen(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        synchronized (this) {
            beschreibbar(t);
            if (a.rumpf.containsKey("sicherungAn")) t.kopf.put("sicherungAn", empfaengerFeld(a.rumpf.get("sicherungAn")));
            // Name und Datum (ab 0.11; die App trägt zusätzlich turnier.umbenannt ein)
            if (a.rumpf.containsKey("name")) t.kopf.put("name", text(a, "name", 2, 160));
            if (a.rumpf.containsKey("datum")) {
                Object d = a.rumpf.get("datum");
                if (d != null && !(d instanceof String && P_DATUM.matcher((String) d).matches())) throw new ApiFehler("ungueltig", "Datum im Format JJJJ-MM-TT angeben.");
                t.kopf.put("datum", d);
            }
            if (a.rumpf.containsKey("sicherungTakt")) {
                Long takt = Json.alsGanzzahl(a.rumpf.get("sicherungTakt"));
                if (takt == null || !TAKTE.contains(takt)) throw new ApiFehler("ungueltig", "Ungültiger Abstand für die Sicherung.");
                t.kopf.put("sicherungTakt", takt);
            }
            speicher.kopfSpeichern(t);
            return einstellungen(t, a);
        }
    }

    private Map<String, Object> sichernJetzt(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        if (!mailBereit()) {
            throw new ApiFehler("nicht_eingerichtet", "Für Sicherungsmails das Online-Konto auf der Zentrale verbinden (Seite „Zentrale“).");
        }
        List<String> empf;
        synchronized (this) {
            empf = empfaengerAus(t);
            if (empf.isEmpty()) throw new ApiFehler("ungueltig", "Bitte zuerst mindestens einen Empfänger eintragen.");
            begrenzen("sichern|" + t.id, 3, 600, "Bitte einige Minuten warten, bevor erneut gesichert wird.");
            sicherungEinreihen(t, "auf Anforderung");
        }
        warteschlangeSenden();
        synchronized (this) {
            boolean wartend = warteschlange.containsKey(t.id);
            Map<String, Object> aus = Json.obj("ok", true, "gesendetAn", new ArrayList<Object>(empf), "zeit", iso(jetzt()), "wartend", wartend);
            if (wartend) {
                Object f = warteschlange.get(t.id).get("fehler");
                if (f != null) aus.put("meldung", f);
            }
            return aus;
        }
    }

    /** Sicherung für den Versand vormerken (eine je Turnier; die neueste zählt). */
    private synchronized void sicherungEinreihen(Speicher.Turnier t, String anlass) {
        if (empfaengerAus(t).isEmpty()) return;
        Map<String, Object> alt = warteschlange.get(t.id);
        // „Turnier abgeschlossen“ bleibt als Anlass stehen, bis gesendet ist
        if (alt != null && "Turnier abgeschlossen".equals(alt.get("anlass")) && !"auf Anforderung".equals(anlass)) anlass = "Turnier abgeschlossen";
        warteschlange.put(t.id, Json.obj("turnier", t.id, "anlass", anlass, "seit", alt == null ? iso(jetzt()) : alt.get("seit"), "fehler", null));
        speicher.speichereObjekt("warteschlange.json", warteschlange);
    }

    /** Fällige automatische Sicherungen vormerken (wie der PHP-Server: nur bei Änderungen, im eingestellten Abstand). */
    private synchronized void sicherungenPruefen() {
        long j = jetzt();
        for (Speicher.Turnier t : turniere.values()) {
            if (wahr(t.kopf.get("abgegeben")) || warteschlange.containsKey(t.id)) continue;
            long takt = zahl(t.kopf.get("sicherungTakt"), 30);
            if (takt <= 0 || t.hoechsteSeq() <= zahl(t.kopf.get("sicherungSeq"), 0)) continue;
            long basis = t.kopf.get("sicherungLetzte") != null ? ausIso(t.kopf.get("sicherungLetzte"), j) : zahl(t.kopf.get("angelegtSek"), j);
            if (j - basis < takt * 60) continue;
            sicherungEinreihen(t, "automatisch, alle " + takt + " Minuten");
        }
    }

    /** Sicherungsdatei im Format von shared/protokoll.ts (Sicherung) */
    private synchronized Map<String, Object> sicherungErstellen(Speicher.Turnier t) {
        List<Object> ev = new ArrayList<>();
        for (Map<String, Object> e : t.ereignisse) ev.add(ausgabe(e, false));
        return Json.obj(
            "format", "tt-turnier-sicherung",
            "version", 1L,
            "erstellt", iso(jetzt()),
            "turnier", Json.obj("id", t.id, "name", t.kopf.get("name"), "datum", t.kopf.get("datum"), "modus", "online"),
            "ereignisse", ev);
    }

    /** Vorgemerkte Sicherungen über den Online-Server versenden, wenn möglich. Blockiert die Geräte nicht. */
    public void warteschlangeSenden() {
        synchronized (versandSperre) {
            List<String> ids;
            synchronized (this) {
                if (!verbunden() || warteschlange.isEmpty()) return;
                ids = new ArrayList<>(warteschlange.keySet());
            }
            for (String id : ids) {
                Map<String, Object> rumpf;
                String anlass;
                long seq;
                List<String> empf;
                String token;
                synchronized (this) {
                    Map<String, Object> w = warteschlange.get(id);
                    Speicher.Turnier t = turniere.get(id);
                    if (w == null) continue;
                    if (t == null || empfaengerAus(t).isEmpty()) {
                        warteschlange.remove(id);
                        speicher.speichereObjekt("warteschlange.json", warteschlange);
                        continue;
                    }
                    anlass = String.valueOf(w.get("anlass"));
                    seq = t.hoechsteSeq();
                    empf = empfaengerAus(t);
                    token = onlineToken();
                    Object ueb = t.kopf.get("uebersicht");
                    rumpf = Json.obj(
                        "turnier", Json.obj("id", t.id, "name", t.kopf.get("name"), "datum", t.kopf.get("datum"), "veranstalter", kontoName()),
                        "empfaenger", new ArrayList<Object>(empf),
                        "anlass", anlass + " (Zentrale)",
                        "uebersicht", ueb == null ? null : Json.obj("text", ueb, "zeit", t.kopf.get("uebersichtZeit")),
                        "sicherung", sicherungErstellen(t));
                }
                if (token == null) return;
                try {
                    online.rufe(onlineUrl(), "sicherung.senden", null, rumpf, token);
                    synchronized (this) {
                        Speicher.Turnier t = turniere.get(id);
                        if (t != null) {
                            t.kopf.put("sicherungLetzte", iso(jetzt()));
                            t.kopf.put("sicherungSeq", seq);
                            speicher.kopfSpeichern(t);
                        }
                        Map<String, Object> w = warteschlange.get(id);
                        // Nur entfernen, wenn inzwischen nichts Neues vorgemerkt wurde
                        if (w != null && anlass.equals(w.get("anlass"))) warteschlange.remove(id);
                        speicher.speichereObjekt("warteschlange.json", warteschlange);
                    }
                    plattform.protokoll("Sicherung gesendet: " + id + " (" + anlass + ")");
                } catch (Online.Fehler f) {
                    synchronized (this) {
                        Map<String, Object> w = warteschlange.get(id);
                        if (w != null) {
                            w.put("fehler", f.netzwerk() ? "Wartet auf Internet." : f.getMessage());
                            speicher.speichereObjekt("warteschlange.json", warteschlange);
                        }
                        if ("nicht_angemeldet".equals(f.code) || "gesperrt".equals(f.code)) {
                            einst.put("onlineFehler", "Die Anmeldung am Online-Konto ist abgelaufen. Bitte neu anmelden.");
                            einst.remove("onlineToken");
                            einstSpeichern();
                        }
                    }
                    if (f.netzwerk()) return; // kein Internet: Rest später
                }
            }
        }
    }

    /**
     * Regelmäßige Aufgaben (etwa alle 15 Sekunden aufrufen): Sicherungen prüfen und senden,
     * verbundene Geräte zählen.
     */
    public void takt() {
        try {
            sicherungenPruefen();
            if (plattform.internet()) warteschlangeSenden();
        } catch (RuntimeException x) {
            plattform.protokoll("Takt: " + x);
        }
        int n = geraeteAnzahl();
        if (n != gemeldeteGeraete) {
            gemeldeteGeraete = n;
            plattform.geraeteGeaendert(n);
        }
    }

    private int geraeteAnzahl() {
        long grenze = jetzt() - GERAET_AKTIV;
        synchronized (geraete) {
            geraete.values().removeIf(z -> z < grenze);
            return geraete.size();
        }
    }

    /* ---------------- Codes ---------------- */

    private static Map<String, Object> codeAusgabe(Map<String, Object> c) {
        Map<String, Object> aus = Json.obj("rolle", c.get("rolle"), "bezug", c.get("bezug"), "name", c.get("name"), "code", c.get("code"), "gesperrt", wahr(c.get("gesperrt")));
        if ("spieler".equals(c.get("rolle"))) aus.put("helfer", wahr(c.get("helfer")));
        if ("helfer".equals(c.get("rolle"))) aus.put("aufgaben", aufgabenLesen(c.get("aufgaben")));
        return aus;
    }

    /** Aufgaben aus gespeicherter Liste bzw. Anfrage; fehlt sie, gilt der Standard (Ergebnisse + Aufruf) */
    static List<Object> aufgabenLesen(Object o) {
        List<Object> l = Json.alsListe(o);
        List<Object> aus = new ArrayList<>();
        if (l == null) {
            aus.addAll(HELFER_STANDARD);
            return aus;
        }
        for (String x : AUFGABEN) if (l.contains(x)) aus.add(x);
        return aus;
    }

    /** Aufgaben einer Helfer-Sitzung, live aus der Kennung (Änderungen gelten sofort) */
    private synchronized List<Object> aufgabenDerSitzung(Map<String, Object> s) {
        if (s == null || !"helfer".equals(s.get("rolle"))) return new ArrayList<>();
        Speicher.Turnier t = turniere.get(String.valueOf(s.get("turnier")));
        Map<String, Object> c = t == null || s.get("bezug") == null ? null : codeSuchen(t, "helfer", String.valueOf(s.get("bezug")));
        return c == null ? new ArrayList<>() : aufgabenLesen(c.get("aufgaben"));
    }

    private synchronized Map<String, Object> codesListe(Speicher.Turnier t) {
        List<Map<String, Object>> l = new ArrayList<>(t.codes);
        // wie PHP: Leitung, Helfer, Spieler – je Rolle nach Name
        l.sort((x, y) -> {
            int r = Integer.compare(CODE_ROLLEN.indexOf(String.valueOf(x.get("rolle"))), CODE_ROLLEN.indexOf(String.valueOf(y.get("rolle"))));
            return r != 0 ? r : String.valueOf(x.get("name")).compareTo(String.valueOf(y.get("name")));
        });
        List<Object> aus = new ArrayList<>();
        for (Map<String, Object> c : l) aus.add(codeAusgabe(c));
        return Json.obj("codes", aus);
    }

    private String freierCode(Speicher.Turnier t) {
        for (int i = 0; i < 1000; i++) {
            String code = String.valueOf(10_000_000 + zufall.nextInt(90_000_000));
            if (!codeGueltig(code) || code.equals(t.id)) continue;
            boolean belegt = false;
            for (Map<String, Object> c : t.codes) if (code.equals(c.get("code"))) { belegt = true; break; }
            if (!belegt) return code;
        }
        throw new ApiFehler("serverfehler", "Es konnte keine freie Kennung erzeugt werden.");
    }

    /** Eine Kennung anlegen (Aufruf unter synchronized) */
    private Map<String, Object> codeAnlegen(Speicher.Turnier t, String rolle, String bezug, String name) {
        return codeAnlegen(t, rolle, bezug, name, null);
    }

    private Map<String, Object> codeAnlegen(Speicher.Turnier t, String rolle, String bezug, String name, List<Object> aufgaben) {
        if (t.codes.size() >= MAX_CODES) throw new ApiFehler("ungueltig", "Höchstens " + MAX_CODES + " Kennungen je Turnier.");
        Map<String, Object> c = Json.obj("rolle", rolle, "bezug", bezug, "name", name, "code", freierCode(t), "gesperrt", false, "angelegt", jetzt(), "helfer", false);
        if ("helfer".equals(rolle) && aufgaben != null) c.put("aufgaben", aufgaben);
        t.codes.add(c);
        return c;
    }

    /** Mindestens eine Leitungskennung muss nutzbar bleiben */
    private static void letzteLeitungPruefen(Speicher.Turnier t, String rolle, String bezug) {
        if (!"leitung".equals(rolle)) return;
        for (Map<String, Object> c : t.codes) {
            if ("leitung".equals(c.get("rolle")) && !wahr(c.get("gesperrt")) && !bezug.equals(c.get("bezug"))) return;
        }
        throw new ApiFehler("konflikt", "Das ist die letzte gültige Leitungskennung. Bitte zuerst eine weitere anlegen.");
    }

    private static String[] codeZiel(Anf a) {
        Object rolle = a.rumpf.get("rolle");
        String bezug = Json.alsText(a.rumpf.get("bezug"));
        if (!CODE_ROLLEN.contains(rolle) || bezug == null || !P_BEZUG.matcher(bezug).matches()) {
            throw new ApiFehler("ungueltig", "Rolle oder Bezug ungültig.");
        }
        return new String[] {(String) rolle, bezug};
    }

    private static Map<String, Object> codeSuchen(Speicher.Turnier t, String rolle, String bezug) {
        for (Map<String, Object> c : t.codes) if (rolle.equals(c.get("rolle")) && bezug.equals(c.get("bezug"))) return c;
        return null;
    }

    private Map<String, Object> codes(Anf a) {
        Speicher.Turnier t = turnierLaden(a.q("turnier"), a);
        leitungPruefen(a, t);
        return codesListe(t);
    }

    private Map<String, Object> codesAnlegen(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        List<Object> liste = Json.alsListe(a.rumpf.get("eintraege"));
        if (liste == null || liste.size() > MAX_CODES) throw new ApiFehler("ungueltig", "Feld „eintraege“ muss eine Liste sein.");
        synchronized (this) {
            beschreibbar(t);
            List<Map<String, Object>> sicherung = new ArrayList<>();
            for (Map<String, Object> c : t.codes) sicherung.add(new LinkedHashMap<>(c));
            try {
                for (Object o : liste) {
                    Map<String, Object> e = Json.alsObjekt(o);
                    Object rolle = e == null ? null : e.get("rolle");
                    String bezug = e == null ? null : Json.alsText(e.get("bezug"));
                    String name = e == null || Json.alsText(e.get("name")) == null ? "" : kuerzen(Json.alsText(e.get("name")).trim(), 160);
                    if (!CODE_ROLLEN.contains(rolle) || bezug == null || !P_BEZUG.matcher(bezug).matches() || name.isEmpty()) {
                        throw new ApiFehler("ungueltig", "Ungültiger Eintrag für eine Kennung.");
                    }
                    Map<String, Object> alt = codeSuchen(t, (String) rolle, bezug);
                    if (alt != null) {
                        if (!name.equals(alt.get("name"))) {
                            alt.put("name", name);
                            for (Map<String, Object> s : sitzungen.values()) {
                                if (t.id.equals(s.get("turnier")) && rolle.equals(s.get("rolle")) && bezug.equals(s.get("bezug"))) s.put("name", name);
                            }
                            sitzungenSpeichern();
                        }
                        continue;
                    }
                    List<Object> auf = null;
                    if (e.get("aufgaben") != null) {
                        if (Json.alsListe(e.get("aufgaben")) == null || aufgabenLesen(e.get("aufgaben")).isEmpty()) {
                            throw new ApiFehler("ungueltig", "Bitte mindestens eine Aufgabe wählen.");
                        }
                        auf = aufgabenLesen(e.get("aufgaben"));
                    }
                    codeAnlegen(t, (String) rolle, bezug, name, auf);
                }
            } catch (RuntimeException x) {
                t.codes.clear();
                t.codes.addAll(sicherung);
                throw x;
            }
            speicher.codesSpeichern(t);
            return codesListe(t);
        }
    }

    private Map<String, Object> codeNeu(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String[] z = codeZiel(a);
        synchronized (this) {
            beschreibbar(t);
            Map<String, Object> c = codeSuchen(t, z[0], z[1]);
            if (c == null) throw new ApiFehler("nicht_gefunden", "Code nicht gefunden.");
            c.put("code", freierCode(t));
            c.put("gesperrt", false);
            speicher.codesSpeichern(t);
            sitzungenEntfernen(t.id, z[0], z[1]);
            return Json.obj("code", codeAusgabe(c));
        }
    }

    private Map<String, Object> codeSperren(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String[] z = codeZiel(a);
        synchronized (this) {
            beschreibbar(t);
            Map<String, Object> c = codeSuchen(t, z[0], z[1]);
            if (c == null) throw new ApiFehler("nicht_gefunden", "Code nicht gefunden.");
            boolean gesperrt = wahr(a.rumpf.get("gesperrt"));
            if (gesperrt) letzteLeitungPruefen(t, z[0], z[1]);
            c.put("gesperrt", gesperrt);
            speicher.codesSpeichern(t);
            if (gesperrt) sitzungenEntfernen(t.id, z[0], z[1]);
            return Json.obj("code", codeAusgabe(c));
        }
    }

    private Map<String, Object> codeEntfernen(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String[] z = codeZiel(a);
        synchronized (this) {
            beschreibbar(t);
            letzteLeitungPruefen(t, z[0], z[1]);
            t.codes.removeIf(c -> z[0].equals(c.get("rolle")) && z[1].equals(c.get("bezug")));
            speicher.codesSpeichern(t);
            sitzungenEntfernen(t.id, z[0], z[1]);
            return Json.obj("ok", true);
        }
    }

    /** Spielerkennung zusätzlich Helfer-Recht geben oder nehmen; laufende Anmeldungen enden */
    private Map<String, Object> codeHelfer(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String bezug = Json.alsText(a.rumpf.get("bezug"));
        if (bezug == null || !P_BEZUG.matcher(bezug).matches()) throw new ApiFehler("ungueltig", "Bezug ungültig.");
        synchronized (this) {
            beschreibbar(t);
            Map<String, Object> c = codeSuchen(t, "spieler", bezug);
            if (c == null) throw new ApiFehler("nicht_gefunden", "Kennung nicht gefunden.");
            c.put("helfer", wahr(a.rumpf.get("helfer")));
            speicher.codesSpeichern(t);
            sitzungenEntfernen(t.id, "spieler", bezug);
            return Json.obj("code", codeAusgabe(c));
        }
    }

    /** Aufgaben einer Helferkennung ändern – gilt sofort, ohne neue Anmeldung */
    private Map<String, Object> codeAufgaben(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String bezug = Json.alsText(a.rumpf.get("bezug"));
        if (bezug == null || !P_BEZUG.matcher(bezug).matches()) throw new ApiFehler("ungueltig", "Bezug ungültig.");
        List<Object> auf = Json.alsListe(a.rumpf.get("aufgaben")) == null ? new ArrayList<>() : aufgabenLesen(a.rumpf.get("aufgaben"));
        if (auf.isEmpty()) throw new ApiFehler("ungueltig", "Bitte mindestens eine Aufgabe wählen.");
        synchronized (this) {
            beschreibbar(t);
            Map<String, Object> c = codeSuchen(t, "helfer", bezug);
            if (c == null) throw new ApiFehler("nicht_gefunden", "Kennung nicht gefunden.");
            c.put("aufgaben", auf);
            speicher.codesSpeichern(t);
            return Json.obj("code", codeAusgabe(c));
        }
    }

    /* ---------------- Einstellungen des Kontos (Leistungsklassen, Kasse) ---------------- */

    private synchronized Map<String, Object> kontoEinstellungen(Anf a) {
        konto(a);
        List<Object> l = Json.alsListe(einst.get("klassen"));
        List<Object> aus = new ArrayList<>();
        if (l != null) for (Object o : l) if (o instanceof String) aus.add(o);
        return Json.obj("klassen", aus, "kasse", einst.get("kasse"));
    }

    /** Kasse/Quittung (shared/protokoll.ts KasseEinstellungen) wie PHP Api::kasseLesen */
    static Map<String, Object> kasseLesen(Object o) {
        Map<String, Object> k = Json.alsObjekt(o);
        if (k == null) return null;
        String iban = feld(k, "iban", 40).replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (!iban.isEmpty() && !ibanGueltig(iban)) throw new ApiFehler("ungueltig", "Die IBAN ist ungültig.");
        String bic = feld(k, "bic", 11).replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
        if (!bic.isEmpty() && !bic.matches("^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$")) throw new ApiFehler("ungueltig", "Die BIC ist ungültig.");
        Object ust = k.get("ust");
        Object satz = k.get("ustSatz");
        return Json.obj(
            "aussteller", feld(k, "aussteller", 160), "anschrift", feld(k, "anschrift", 300),
            "ust", "befreit".equals(ust) || "enthalten".equals(ust) ? ust : "keiner",
            "ustSatz", satz instanceof Number && ((Number) satz).longValue() == 7 ? 7L : 19L,
            "fusstext", feld(k, "fusstext", 500), "empfaenger", feld(k, "empfaenger", 70), "iban", iban, "bic", bic);
    }

    private static String feld(Map<String, Object> m, String f, int max) {
        Object v = m.get(f);
        return v instanceof String ? kuerzen(((String) v).trim(), max) : "";
    }

    /** IBAN-Prüfziffer (ISO 13616, mod 97) */
    static boolean ibanGueltig(String iban) {
        if (!iban.matches("^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$") || (iban.startsWith("DE") && iban.length() != 22)) return false;
        String u = iban.substring(4) + iban.substring(0, 4);
        int rest = 0;
        for (char z : u.toCharArray()) {
            String w = Character.isLetter(z) ? String.valueOf(z - 55) : String.valueOf(z);
            for (char ziffer : w.toCharArray()) rest = (rest * 10 + (ziffer - '0')) % 97;
        }
        return rest == 1;
    }

    private synchronized Map<String, Object> kontoEinstellungenSetzen(Anf a) {
        konto(a);
        if (a.rumpf.containsKey("klassen")) {
            List<Object> l = Json.alsListe(a.rumpf.get("klassen"));
            if (l == null || l.size() > MAX_KLASSEN) throw new ApiFehler("ungueltig", "Höchstens " + MAX_KLASSEN + " Leistungsklassen.");
            List<Object> klassen = new ArrayList<>();
            for (Object o : l) {
                String k = o instanceof String ? kuerzen(((String) o).trim(), 40) : "";
                if (!k.isEmpty() && !klassen.contains(k)) klassen.add(k);
            }
            einst.put("klassen", klassen);
        }
        if (a.rumpf.containsKey("kasse")) einst.put("kasse", kasseLesen(a.rumpf.get("kasse")));
        einstSpeichern();
        return kontoEinstellungen(a);
    }

    /* ---------------- Spielerpool ---------------- */

    private static Object[] poolEintrag(Object o) {
        Map<String, Object> e = Json.alsObjekt(o);
        if (e == null) throw new ApiFehler("ungueltig", "Spieler muss ein Objekt sein.");
        String id = Json.alsText(e.get("id"));
        if (id == null || !P_POOL_ID.matcher(id).matches()) throw new ApiFehler("ungueltig", "Spieler-ID ungültig.");
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("vorname", poolText(e.get("vorname"), 80));
        d.put("nachname", poolText(e.get("nachname"), 80));
        d.put("verein", poolText(e.get("verein"), 120));
        if (((String) d.get("vorname")).isEmpty() && ((String) d.get("nachname")).isEmpty()) {
            throw new ApiFehler("ungueltig", "Spieler braucht einen Namen.");
        }
        Long ttr = Json.alsGanzzahl(e.get("ttr"));
        d.put("ttr", ttr != null && ttr >= 0 && ttr <= 4000 ? ttr : null);
        Long jg = Json.alsGanzzahl(e.get("jahrgang"));
        d.put("jahrgang", jg != null && jg >= 1900 && jg <= 2100 ? jg : null);
        String k = poolText(e.get("klasse"), 40);
        d.put("klasse", k.isEmpty() ? null : k);
        Object g = e.get("geschlecht");
        d.put("geschlecht", "m".equals(g) || "w".equals(g) || "d".equals(g) ? g : null);
        // ab 0.15: geschätzter Wert (Hobby), App-Spiele; click-TT-Lizenz
        if (Boolean.TRUE.equals(e.get("ttrGeschaetzt")) && d.get("ttr") != null) d.put("ttrGeschaetzt", true);
        Long n = Json.alsGanzzahl(e.get("appSpiele"));
        if (n != null && n > 0 && n <= 100000) d.put("appSpiele", n);
        String li = e.get("lizenz") instanceof String ? ((String) e.get("lizenz")).trim() : null;
        if (li != null && li.matches("^[A-Za-z0-9-]{1,20}$")) d.put("lizenz", li);
        return new Object[] {id, d};
    }

    private static String poolText(Object o, int max) {
        return o instanceof String ? kuerzen(((String) o).replaceAll("[\\x00-\\x1F\\x7F]", "").trim(), max) : "";
    }

    private synchronized Map<String, Object> poolAusgabe() {
        List<String> ids = new ArrayList<>(pool.keySet());
        Collections.sort(ids);
        List<Object> aus = new ArrayList<>();
        for (String id : ids) {
            Map<String, Object> d = new LinkedHashMap<>(pool.get(id));
            d.remove("wertungTurniere"); // nur kurz in 0.15-Tests gespeichert, nicht mehr ausgeben
            d.put("id", id);
            aus.add(d);
        }
        return Json.obj("spieler", aus);
    }

    private Map<String, Object> poolListe(Anf a) {
        konto(a);
        return poolAusgabe();
    }

    private Map<String, Object> poolSpeichern(Anf a) {
        konto(a);
        List<Object> liste = Json.alsListe(a.rumpf.get("spieler"));
        if (liste == null || liste.size() > 500) throw new ApiFehler("ungueltig", "Feld „spieler“ muss eine Liste mit höchstens 500 Einträgen sein.");
        List<Object[]> eintraege = new ArrayList<>();
        for (Object o : liste) eintraege.add(poolEintrag(o));
        synchronized (this) {
            int neu = 0;
            for (Object[] e : eintraege) if (!pool.containsKey((String) e[0])) neu++;
            if (pool.size() + neu > MAX_POOL) throw new ApiFehler("ungueltig", "Höchstens " + MAX_POOL + " Spieler im Pool.");
            List<Object> geloescht = poolGeloescht();
            for (Object[] e : eintraege) {
                @SuppressWarnings("unchecked")
                Map<String, Object> d = (Map<String, Object>) e[1];
                d.put("geaendert", iso(jetzt()));
                pool.put((String) e[0], d);
                geloescht.remove(e[0]);
            }
            speicher.speichereObjekt("pool.json", pool);
            einstSpeichern();
        }
        return poolAusgabe();
    }

    private List<Object> poolGeloescht() {
        List<Object> l = Json.alsListe(einst.get("poolGeloescht"));
        if (l == null) {
            l = new ArrayList<>();
            einst.put("poolGeloescht", l);
        }
        return l;
    }

    private Map<String, Object> poolLoeschen(Anf a) {
        konto(a);
        List<Object> ids = Json.alsListe(a.rumpf.get("ids"));
        if (ids == null || ids.size() > MAX_POOL) throw new ApiFehler("ungueltig", "Feld „ids“ muss eine Liste sein.");
        synchronized (this) {
            List<Object> geloescht = poolGeloescht();
            for (Object id : ids) {
                if (id instanceof String && pool.remove(id) != null && !geloescht.contains(id)) geloescht.add(id);
            }
            speicher.speichereObjekt("pool.json", pool);
            einstSpeichern();
        }
        return Json.obj("ok", true);
    }

    /* ---------------- Übersicht ---------------- */

    private Map<String, Object> uebersichtSetzen(Anf a) {
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        leitungPruefen(a, t);
        String text = Json.alsText(a.rumpf.get("text"));
        if (text == null || text.codePointCount(0, text.length()) > MAX_UEBERSICHT) throw new ApiFehler("ungueltig", "Übersicht fehlt oder ist zu lang.");
        synchronized (this) {
            if (wahr(t.kopf.get("abgegeben"))) return Json.obj("ok", true); // still ignorieren: die App sendet sie nebenbei
            t.kopf.put("uebersicht", text);
            t.kopf.put("uebersichtZeit", iso(jetzt()));
            speicher.kopfSpeichern(t);
        }
        return Json.obj("ok", true);
    }

    /* ======================================================================
     * Zentrale: Gerät, WLAN, Online-Konto
     * ==================================================================== */

    private Map<String, Object> zentraleAnmelden(Anf a) {
        selbst(a);
        String token = neuesToken(true, null, "veranstalter", kontoName(), null);
        return Json.obj("token", token, "konto", kontoAusgabe());
    }

    public synchronized Map<String, Object> zentraleStatus() {
        List<Object> adressen = new ArrayList<>();
        for (String ip : plattform.adressen()) adressen.add("http://" + ip + ":" + port + "/");
        List<Object> warte = new ArrayList<>();
        for (Map<String, Object> w : warteschlange.values()) {
            Speicher.Turnier t = turniere.get(String.valueOf(w.get("turnier")));
            Map<String, Object> m = new LinkedHashMap<>(w);
            m.put("name", t == null ? null : t.kopf.get("name"));
            warte.add(m);
        }
        Map<String, Object> k = onlineKonto();
        return Json.obj(
            "version", VERSION,
            "id", einst.get("id"),
            "port", (long) port,
            "adressen", adressen,
            "geraete", (long) geraeteAnzahl(),
            "wlan", Json.obj("ssid", einst.get("wlanSsid"), "passwort", einst.get("wlanPasswort")),
            "hotspot", plattform.hotspotStatus(),
            "akkuAusnahme", plattform.akkuAusnahme(),
            "internet", plattform.internet(),
            "online", Json.obj(
                "url", onlineUrl(),
                "verbunden", verbunden(),
                "konto", k == null ? null : Json.obj("name", k.get("name"), "email", k.get("email")),
                "mail", wahr(einst.get("onlineMail")),
                "fehler", einst.get("onlineFehler")),
            "warteschlange", warte);
    }

    private Map<String, Object> zentraleWlan(Anf a) {
        selbst(a);
        String ssid = Json.alsText(a.rumpf.get("ssid"));
        String pw = Json.alsText(a.rumpf.get("passwort"));
        synchronized (this) {
            einst.put("wlanSsid", ssid == null || ssid.trim().isEmpty() ? null : kuerzen(ssid.trim(), 64));
            einst.put("wlanPasswort", pw == null || pw.isEmpty() ? null : kuerzen(pw, 64));
            einstSpeichern();
        }
        return zentraleStatus();
    }

    private Map<String, Object> zentraleHotspot(Anf a) {
        selbst(a);
        Map<String, Object> r = plattform.hotspot(wahr(a.rumpf.get("an")));
        Map<String, Object> s = zentraleStatus();
        s.put("meldung", r.get("meldung"));
        return s;
    }

    private Map<String, Object> onlineAnmelden(Anf a) {
        selbst(a);
        String mail = email(Json.alsText(a.rumpf.get("email")));
        Object pw = a.rumpf.get("passwort");
        if (mail == null) throw new ApiFehler("ungueltig", "Die E-Mail-Adresse ist ungültig.");
        if (!(pw instanceof String) || ((String) pw).isEmpty()) throw new ApiFehler("ungueltig", "Bitte das Passwort eingeben.");
        String url = Json.alsText(a.rumpf.get("url"));
        url = url == null || url.trim().isEmpty() ? onlineUrl() : url.trim();
        if (!url.matches("^https?://[^\\s]+$")) throw new ApiFehler("ungueltig", "Die Adresse des Online-Servers ist ungültig.");
        if (!url.contains("index.php")) url = url.replaceAll("/+$", "") + (url.endsWith("/api") ? "/index.php" : "/api/index.php");
        Map<String, Object> info;
        Map<String, Object> login;
        try {
            info = online.rufe(url, "info", null, null, null);
            if (!"tt-turnier".equals(info.get("app"))) throw new ApiFehler("ungueltig", "Unter dieser Adresse läuft kein Turnier-Server.");
            if (!wahr(info.get("codes")) || Json.alsObjekt(info.get("zentrale")) != null) {
                throw new ApiFehler("ungueltig", "Der Online-Server ist zu alt oder ist selbst eine Zentrale.");
            }
            login = online.rufe(url, "login", null, Json.obj("email", mail, "passwort", pw), null);
        } catch (Online.Fehler f) {
            throw onlineFehler(f);
        }
        Map<String, Object> k = Json.alsObjekt(login.get("konto"));
        synchronized (this) {
            einst.put("onlineUrl", url);
            einst.put("onlineToken", login.get("token"));
            einst.put("onlineKonto", Json.obj("id", k == null ? null : k.get("id"), "name", k == null ? null : k.get("name"), "email", k == null ? mail : k.get("email")));
            einst.put("onlineMail", wahr(info.get("mail")));
            einst.remove("onlineFehler");
            einstSpeichern();
            // Sicherungen ohne Empfänger bekommen die Konto-Mail
            for (Speicher.Turnier t : turniere.values()) {
                if (empfaengerAus(t).isEmpty() && "zentrale".equals(t.kopf.get("herkunft")) && t.kopf.get("sicherungAnGesetzt") == null) {
                    t.kopf.put("sicherungAn", new ArrayList<Object>(Collections.singletonList(k == null ? mail : k.get("email"))));
                    speicher.kopfSpeichern(t);
                }
            }
        }
        warteschlangeSenden();
        return zentraleStatus();
    }

    private Map<String, Object> onlineAbmelden(Anf a) {
        selbst(a);
        String token;
        String url;
        synchronized (this) {
            token = onlineToken();
            url = onlineUrl();
            einst.remove("onlineToken");
            einst.remove("onlineKonto");
            einst.remove("onlineFehler");
            einst.put("onlineMail", false);
            einstSpeichern();
        }
        if (token != null) {
            try {
                online.rufe(url, "logout", null, Json.obj(), token);
            } catch (Online.Fehler ignoriert) {
                // ohne Internet: Token läuft von selbst ab
            }
        }
        return zentraleStatus();
    }

    private ApiFehler onlineFehler(Online.Fehler f) {
        if (f.netzwerk()) return new ApiFehler("serverfehler", "Keine Verbindung zum Online-Server. Hat das Gerät gerade Internet?");
        if ("nicht_angemeldet".equals(f.code) || "gesperrt".equals(f.code)) {
            synchronized (this) {
                if (onlineToken() != null) {
                    einst.remove("onlineToken");
                    einst.put("onlineFehler", "Die Anmeldung am Online-Konto ist abgelaufen. Bitte neu anmelden.");
                    einstSpeichern();
                }
            }
            return new ApiFehler("nicht_angemeldet", "Online: " + f.getMessage() + " Bitte das Online-Konto neu verbinden.");
        }
        String code = f.code;
        if (!Arrays.asList("ungueltig", "falsche_zugangsdaten", "keine_berechtigung", "nicht_gefunden", "konflikt", "zu_viele_versuche", "nicht_eingerichtet").contains(code)) {
            code = "serverfehler";
        }
        return new ApiFehler(code, "Online: " + f.getMessage());
    }

    private String[] onlineZugang() {
        synchronized (this) {
            String token = onlineToken();
            if (token == null) throw new ApiFehler("nicht_angemeldet", "Bitte zuerst das Online-Konto auf der Zentrale verbinden.");
            return new String[] {onlineUrl(), token, String.valueOf(einst.get("id"))};
        }
    }

    private String zentraleName() {
        return "Zentrale " + kontoName() + " (" + einst.get("id") + ")";
    }

    private Map<String, Object> onlineTurniere(Anf a) {
        selbst(a);
        String[] z = onlineZugang();
        Map<String, Object> r;
        try {
            r = online.rufe(z[0], "turniere", null, null, z[1]);
        } catch (Online.Fehler f) {
            throw onlineFehler(f);
        }
        List<Object> aus = new ArrayList<>();
        List<Object> l = Json.alsListe(r.get("turniere"));
        synchronized (this) {
            if (l != null) for (Object o : l) {
                Map<String, Object> t = Json.alsObjekt(o);
                if (t == null) continue;
                Map<String, Object> m = new LinkedHashMap<>(t);
                Speicher.Turnier hier = turniere.get(Json.alsText(t.get("id")));
                m.put("aufDieserZentrale", hier != null && !wahr(hier.kopf.get("abgegeben")));
                m.put("vonDieserZentrale", z[2].equals(t.get("zentraleId")));
                aus.add(m);
            }
        }
        return Json.obj("turniere", aus);
    }

    /* ---------------- Übernahme vom Online-Server ---------------- */

    private Map<String, Object> uebernehmen(Anf a) {
        selbst(a);
        String id = turnierId(Json.alsText(a.rumpf.get("turnier")));
        if (id == null || !P_TURNIER_ID.matcher(id).matches()) throw new ApiFehler("ungueltig", "Turnier fehlt.");
        String[] z = onlineZugang();
        synchronized (this) {
            Speicher.Turnier hier = turniere.get(id);
            if (hier != null && !"online".equals(hier.kopf.get("herkunft"))) {
                throw new ApiFehler("konflikt", "Auf der Zentrale gibt es schon ein eigenes Turnier mit dieser Kennung.");
            }
            if (hier != null && !wahr(hier.kopf.get("abgegeben"))) {
                throw new ApiFehler("konflikt", "Dieses Turnier liegt bereits auf der Zentrale.");
            }
        }
        Map<String, Object> r;
        List<Map<String, Object>> online1 = new ArrayList<>();
        try {
            r = online.rufe(z[0], "zentrale.uebernehmen", null,
                Json.obj("turnier", id, "zentrale", zentraleName(), "zentraleId", z[2], "erzwingen", wahr(a.rumpf.get("erzwingen"))), z[1]);
            long ab = 0;
            for (int runde = 0; runde < 10_000; runde++) {
                Map<String, Object> e = online.rufe(z[0], "events", strMap("turnier", id, "ab", String.valueOf(ab)), null, z[1]);
                Object sicht = e.get("sicht");
                if (sicht != null && !"voll".equals(sicht)) {
                    throw new ApiFehler("keine_berechtigung", "Das verbundene Online-Konto darf dieses Turnier nicht vollständig lesen.");
                }
                List<Object> l = Json.alsListe(e.get("ereignisse"));
                if (l != null) for (Object o : l) {
                    Map<String, Object> m = Json.alsObjekt(o);
                    if (m != null) {
                        online1.add(m);
                        ab = Math.max(ab, zahl(m.get("seq"), ab));
                    }
                }
                if (!wahr(e.get("mehr"))) break;
            }
        } catch (Online.Fehler f) {
            throw onlineFehler(f);
        }
        Map<String, Object> info = Json.alsObjekt(r.get("turnier"));
        Map<String, Object> ein = Json.alsObjekt(r.get("einstellungen"));
        Map<String, Object> ueb = Json.alsObjekt(r.get("uebersicht"));
        List<Object> codes = Json.alsListe(r.get("codes"));
        if (info == null || ein == null) throw new ApiFehler("serverfehler", "Unerwartete Antwort des Online-Servers.");
        int neu = 0;
        synchronized (this) {
            Speicher.Turnier t = turniere.get(id);
            boolean anlegen = t == null;
            if (anlegen) {
                long j = jetzt();
                t = new Speicher.Turnier(id, Json.obj("angelegt", info.get("angelegt"), "angelegtSek", ausIso(info.get("angelegt"), j)));
            }
            t.kopf.put("name", info.get("name"));
            t.kopf.put("datum", info.get("datum"));
            t.kopf.put("sicherungAn", empfaengerFeldStill(ein.get("sicherungAn")));
            t.kopf.put("sicherungTakt", zahl(ein.get("sicherungTakt"), 30));
            t.kopf.put("sicherungLetzte", ein.get("letzteSicherung"));
            t.kopf.put("uebersicht", ueb == null ? null : ueb.get("text"));
            t.kopf.put("uebersichtZeit", ueb == null ? null : ueb.get("zeit"));
            t.kopf.put("herkunft", "online");
            t.kopf.put("abgegeben", false);
            t.kopf.put("rueckgabeLaeuft", false);
            t.kopf.put("uebernommen", iso(jetzt()));
            t.codes.clear();
            if (codes != null) for (Object o : codes) {
                Map<String, Object> c = Json.alsObjekt(o);
                if (c == null) continue;
                Map<String, Object> kopie = Json.obj("rolle", c.get("rolle"), "bezug", c.get("bezug"), "name", c.get("name"), "code", c.get("code"),
                    "gesperrt", wahr(c.get("gesperrt")), "angelegt", jetzt(), "helfer", wahr(c.get("helfer")));
                if ("helfer".equals(c.get("rolle")) && c.get("aufgaben") != null) kopie.put("aufgaben", aufgabenLesen(c.get("aufgaben")));
                t.codes.add(kopie);
            }
            if (anlegen) {
                speicher.turnierAnlegen(t);
                turniere.put(id, t);
            } else {
                speicher.kopfSpeichern(t);
                speicher.codesSpeichern(t);
            }
            List<Map<String, Object>> dazu = new ArrayList<>();
            long seq = t.hoechsteSeq();
            for (Map<String, Object> e : online1) {
                String eid = Json.alsText(e.get("id"));
                if (eid == null || t.index.containsKey(eid)) continue;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", eid);
                m.put("art", e.get("art"));
                m.put("daten", e.get("daten"));
                m.put("zeit", e.get("zeit"));
                m.put("geraet", e.get("geraet"));
                m.put("seq", ++seq);
                m.put("empfangen", e.get("empfangen"));
                m.put("autor", e.get("autor"));
                m.put("online", true);
                dazu.add(m);
                t.aufnehmen(m);
            }
            speicher.ereignisseAnhaengen(t, dazu);
            neu = dazu.size();
            // Bereits online gesicherter Stand gilt als gesichert
            t.kopf.put("sicherungSeq", t.hoechsteSeq());
            speicher.kopfSpeichern(t);
            return Json.obj("turnier", turnierAusgabe(t), "neu", (long) neu);
        }
    }

    private static Map<String, String> strMap(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    private static List<Object> empfaengerFeldStill(Object o) {
        try {
            return empfaengerFeld(o);
        } catch (ApiFehler x) {
            return new ArrayList<>();
        }
    }

    /* ---------------- Rückgabe an den Online-Server ---------------- */

    private Map<String, Object> rueckgabe(Anf a) {
        selbst(a);
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        String[] z = onlineZugang();
        List<Map<String, Object>> offen = new ArrayList<>();
        Map<String, Object> neu = null;
        Map<String, Object> abschluss;
        synchronized (this) {
            if (wahr(t.kopf.get("abgegeben"))) throw new ApiFehler("konflikt", "Dieses Turnier wurde schon zurückgegeben.");
            if (wahr(t.kopf.get("rueckgabeLaeuft"))) throw new ApiFehler("konflikt", "Die Rückgabe läuft bereits.");
            for (Map<String, Object> e : t.ereignisse) if (!wahr(e.get("online"))) offen.add(e);
            if ("zentrale".equals(t.kopf.get("herkunft"))) {
                neu = Json.obj("name", t.kopf.get("name"), "datum", t.kopf.get("datum"));
            }
            List<Object> codes = new ArrayList<>();
            for (Map<String, Object> c : t.codes) codes.add(codeAusgabe(c));
            Object ueb = t.kopf.get("uebersicht");
            abschluss = Json.obj(
                "turnier", t.id, "zentraleId", z[2], "codes", codes,
                "einstellungen", Json.obj("sicherungAn", new ArrayList<Object>(empfaengerAus(t)),
                    "sicherungTakt", zahl(t.kopf.get("sicherungTakt"), 30)),
                "uebersicht", ueb == null ? null : Json.obj("text", ueb));
            t.kopf.put("rueckgabeLaeuft", true);
            speicher.kopfSpeichern(t);
        }
        Set<String> gesendet = new HashSet<>();
        try {
            int i = 0;
            do {
                List<Object> block = new ArrayList<>();
                for (int k = i; k < Math.min(i + MAX_EREIGNISSE, offen.size()); k++) {
                    Map<String, Object> e = offen.get(k);
                    block.add(Json.obj("id", e.get("id"), "art", e.get("art"), "daten", e.get("daten"), "zeit", e.get("zeit"),
                        "geraet", e.get("geraet"), "autor", e.get("autor")));
                }
                Map<String, Object> rumpf = Json.obj("turnier", t.id, "zentrale", zentraleName(), "zentraleId", z[2], "ereignisse", block);
                if (neu != null) rumpf.put("neu", neu);
                online.rufe(z[0], "zentrale.rueckgabe", null, rumpf, z[1]);
                for (Object b : block) gesendet.add((String) Json.alsObjekt(b).get("id"));
                i += MAX_EREIGNISSE;
            } while (i < offen.size());
            online.rufe(z[0], "zentrale.freigeben", null, abschluss, z[1]);
        } catch (Online.Fehler f) {
            synchronized (this) {
                for (Map<String, Object> e : t.ereignisse) if (gesendet.contains(e.get("id"))) e.put("online", true);
                if (!gesendet.isEmpty()) speicher.ereignisseNeuSchreiben(t);
                if (neu != null && !gesendet.isEmpty()) t.kopf.put("herkunft", "online");
                t.kopf.put("rueckgabeLaeuft", false);
                speicher.kopfSpeichern(t);
            }
            throw onlineFehler(f);
        }
        synchronized (this) {
            for (Map<String, Object> e : t.ereignisse) e.put("online", true);
            speicher.ereignisseNeuSchreiben(t);
            t.kopf.put("herkunft", "online");
            t.kopf.put("abgegeben", true);
            t.kopf.put("rueckgabeLaeuft", false);
            t.kopf.put("zurueckgegeben", iso(jetzt()));
            speicher.kopfSpeichern(t);
            warteschlange.remove(t.id);
            speicher.speichereObjekt("warteschlange.json", warteschlange);
            return Json.obj("turnier", turnierAusgabe(t), "gesendet", (long) offen.size());
        }
    }

    private Map<String, Object> turnierLoeschen(Anf a) {
        selbst(a);
        Speicher.Turnier t = turnierLaden(Json.alsText(a.rumpf.get("turnier")), a);
        synchronized (this) {
            boolean ungesichert = false;
            for (Map<String, Object> e : t.ereignisse) if (!wahr(e.get("online"))) { ungesichert = true; break; }
            if (ungesichert && !wahr(a.rumpf.get("trotzdem"))) {
                throw new ApiFehler("konflikt", "Dieses Turnier hat Einträge, die noch nicht beim Online-Server liegen.");
            }
            turniere.remove(t.id);
            speicher.turnierLoeschen(t.id);
            final String tid = t.id;
            sitzungen.values().removeIf(s -> tid.equals(s.get("turnier")));
            sitzungenSpeichern();
            warteschlange.remove(t.id);
            speicher.speichereObjekt("warteschlange.json", warteschlange);
        }
        return Json.obj("ok", true);
    }

    /* ---------------- Spielerpool abgleichen ---------------- */

    private Map<String, Object> poolAbgleichen(Anf a) {
        selbst(a);
        String[] z = onlineZugang();
        List<Object> geloescht;
        Map<String, Map<String, Object>> lokal;
        synchronized (this) {
            geloescht = new ArrayList<>(poolGeloescht());
            lokal = new LinkedHashMap<>();
            for (Map.Entry<String, Map<String, Object>> e : pool.entrySet()) lokal.put(e.getKey(), new LinkedHashMap<>(e.getValue()));
        }
        List<Object> ergebnis;
        int hoch = 0;
        try {
            if (!geloescht.isEmpty()) online.rufe(z[0], "pool.loeschen", null, Json.obj("ids", geloescht), z[1]);
            Map<String, Object> r = online.rufe(z[0], "pool", null, null, z[1]);
            Map<String, String> onlineStand = new HashMap<>();
            List<Object> l = Json.alsListe(r.get("spieler"));
            if (l != null) for (Object o : l) {
                Map<String, Object> m = Json.alsObjekt(o);
                if (m != null) onlineStand.put(String.valueOf(m.get("id")), String.valueOf(m.get("geaendert")));
            }
            List<Object> hochladen = new ArrayList<>();
            for (Map.Entry<String, Map<String, Object>> e : lokal.entrySet()) {
                String o = onlineStand.get(e.getKey());
                String g = String.valueOf(e.getValue().get("geaendert"));
                if (o == null || g.compareTo(o) > 0) {
                    Map<String, Object> m = new LinkedHashMap<>(e.getValue());
                    m.put("id", e.getKey());
                    m.remove("geaendert");
                    hochladen.add(m);
                }
            }
            hoch = hochladen.size();
            for (int i = 0; i < hochladen.size(); i += 500) {
                r = online.rufe(z[0], "pool.speichern", null, Json.obj("spieler", new ArrayList<>(hochladen.subList(i, Math.min(i + 500, hochladen.size())))), z[1]);
            }
            ergebnis = Json.alsListe(r.get("spieler"));
        } catch (Online.Fehler f) {
            throw onlineFehler(f);
        }
        synchronized (this) {
            pool.clear();
            if (ergebnis != null) for (Object o : ergebnis) {
                Map<String, Object> m = Json.alsObjekt(o);
                if (m == null || !(m.get("id") instanceof String)) continue;
                Map<String, Object> d = new LinkedHashMap<>(m);
                String id = (String) d.remove("id");
                pool.put(id, d);
            }
            poolGeloescht().removeAll(geloescht);
            speicher.speichereObjekt("pool.json", pool);
            einstSpeichern();
            return Json.obj("ok", true, "hochgeladen", (long) hoch, "anzahl", (long) pool.size());
        }
    }

    /* ---------------- für Tests ---------------- */

    public synchronized int anzahlTurniere() {
        return turniere.size();
    }

    public synchronized Iterator<String> turnierIds() {
        return new ArrayList<>(turniere.keySet()).iterator();
    }
}
