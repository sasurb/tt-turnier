package de.saschaurban.ttturnier.kern;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Tests der Zentrale ohne Fremdbibliotheken: {@code java -cp … KernTest}.
 * Mit TT_ONLINE=&lt;URL der PHP-API&gt; (und TT_ONLINE_ADMIN_SETUP) zusätzlich Übernahme,
 * Rückgabe und Sicherung gegen einen echten PHP-Server; TT_MAILS = Ordner der Datei-Mails.
 */
public final class KernTest {
    private static int anzahl, fehler;
    private static long uhr = 1_800_000_000L;

    static void pruefe(boolean b, String text) {
        anzahl++;
        if (b) {
            System.out.println("  ok  " + text);
        } else {
            fehler++;
            System.out.println("  FEHLER  " + text);
        }
    }

    /** Antwort: [status, daten] */
    static final class A {
        final int s;
        final Map<String, Object> d;
        A(int s, Map<String, Object> d) { this.s = s; this.d = d; }
        Object g(String k) { return d.get(k); }
        String t(String k) { return (String) d.get(k); }
        @SuppressWarnings("unchecked")
        List<Object> l(String k) { return (List<Object>) d.get(k); }
    }

    static A rufe(Zentrale z, String methode, String route, Object rumpf, String token, Map<String, String> query, boolean selbst) {
        Map<String, String> q = new LinkedHashMap<>();
        q.put("r", route);
        if (query != null) q.putAll(query);
        Map<String, String> kopf = new LinkedHashMap<>();
        if (token != null) kopf.put("x-tt-token", token);
        if (selbst) kopf.put("x-tt-zentrale", z.geraetGeheimnis());
        byte[] b = rumpf == null ? new byte[0] : Json.schreiben(rumpf).getBytes(StandardCharsets.UTF_8);
        HttpServer.Antwort a = z.api(new HttpServer.Anfrage(methode, "/api/index.php", q, kopf, b, selbst ? "127.0.0.1" : "192.168.43.20", selbst));
        return new A(a.status, Json.objekt(new String(a.inhalt, StandardCharsets.UTF_8)));
    }

    /** Antwort „einzeln abgelehnt“ (ab 0.11): nichts angenommen, alle mit diesem Fehler abgelehnt */
    static boolean abgelehnt(A a, String fehler) {
        if (a.s != 200 || a.l("angenommen") == null || !a.l("angenommen").isEmpty() || a.l("abgelehnt") == null || a.l("abgelehnt").isEmpty()) return false;
        for (Object o : a.l("abgelehnt")) if (!fehler.equals(Json.alsObjekt(o).get("fehler"))) return false;
        return true;
    }

    static long zahlAus(Object o) {
        return o instanceof Number ? ((Number) o).longValue() : 0;
    }

    static A rufe(Zentrale z, String methode, String route, Object rumpf, String token) {
        return rufe(z, methode, route, rumpf, token, null, false);
    }

    static Map<String, String> q(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    static Map<String, Object> ev(String id, String art, Map<String, Object> daten) {
        return Json.obj("id", id, "art", art, "daten", daten, "zeit", "2026-11-13T10:00:00.000Z", "geraet", "geraet-a");
    }

    static List<Object> liste(Object... o) {
        List<Object> l = new ArrayList<>();
        for (Object x : o) l.add(x);
        return l;
    }

    static Path neuerOrdner() throws IOException {
        return Files.createTempDirectory("tt-zentrale-test");
    }

    public static void main(String[] args) throws Exception {
        Zentrale.ohneWarten = true;
        json();
        protokoll();
        ergebnisfrist();
        etappe9();
        etappe10();
        etappe11();
        paket18();
        http();
        String online = System.getenv("TT_ONLINE");
        if (online != null && !online.isEmpty()) zusammenspiel(online);
        System.out.println();
        System.out.println(anzahl + " Prüfungen, " + fehler + " Fehler");
        System.exit(fehler == 0 ? 0 : 1);
    }

    static void json() {
        System.out.println("JSON");
        Object o = Json.lesen("{\"a\":[1,2.5,-3e2,true,null,\"x\\u00e4\\n\"],\"b\":{},\"c\":[]}");
        pruefe(Json.schreiben(o).equals("{\"a\":[1,2.5,-300,true,null,\"xä\\n\"],\"b\":{},\"c\":[]}"), "lesen und schreiben, leere {} und [] bleiben");
        boolean geworfen = false;
        try {
            Json.lesen("{\"a\":1,}");
        } catch (Json.Fehler x) {
            geworfen = true;
        }
        pruefe(geworfen, "fehlerhaftes JSON wird abgelehnt");
        pruefe(Json.schreiben(Json.obj("t", "a\"b\\c\u0001")).equals("{\"t\":\"a\\\"b\\\\c\\u0001\"}"), "Sonderzeichen werden maskiert");
    }

    static void ergebnisfrist() throws Exception {
        long bisher = uhr;
        try {
            uhr = java.time.Instant.parse("2026-12-06T22:55:00Z").getEpochSecond();
            Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(null), new Online(2000), () -> uhr);
            String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
            A erstellt = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Fristtest", "datum", "2026-12-06"), konto);
            String id = (String) Json.alsObjekt(erstellt.g("turnier")).get("id");
            Map<String, String> query = q("turnier", id);
            Map<String, Object> rechtzeitig = ev("frist-0002", "spiel.ergebnis", Json.obj());
            rechtzeitig.put("zeit", "2026-12-06T22:55:00Z");
            A a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("frist-0001", "turnier.daten", Json.obj("enddatum", "2026-12-06")), rechtzeitig)), konto, query, false);
            pruefe(a.s == 200 && a.l("angenommen").size() == 2, "V-002: Zentrale nimmt am letzten Tag Ergebnis an");

            uhr = java.time.Instant.parse("2026-12-06T23:10:00Z").getEpochSecond();
            Map<String, Object> offline = new LinkedHashMap<>(rechtzeitig);
            offline.put("id", "frist-0003");
            Map<String, Object> zuSpaet = new LinkedHashMap<>(rechtzeitig);
            zuSpaet.put("id", "frist-0004");
            zuSpaet.put("zeit", "2026-12-06T23:05:00Z");
            a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(rechtzeitig, offline, zuSpaet)), konto, query, false);
            pruefe(a.l("angenommen").size() == 2 && a.l("abgelehnt").size() == 1, "V-002: Zentrale bewahrt Offline-Meldung und sperrt Neueingabe");
            a = rufe(z, "GET", "events", null, konto, q("turnier", id, "ab", "0"), false);
            pruefe(a.l("ereignisse").stream().map(Json::alsObjekt).anyMatch(e ->
                "frist-0003".equals(e.get("id")) && "spiel.ergebnis_spaet".equals(e.get("art"))), "V-002: Zentrale kennzeichnet Nachversand zur Prüfung");
            a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("frist-0005", "turnier.daten", Json.obj("enddatum", "2026-12-07")), zuSpaet)), konto, query, false);
            pruefe(a.l("angenommen").size() == 2, "V-002: Zentrale nimmt nach Verlängerung neue Ergebnisse an");
        } finally {
            uhr = bisher;
        }
    }

    @SuppressWarnings("unchecked")
    static void protokoll() throws Exception {
        System.out.println("Protokoll wie der PHP-Server");
        Path ordner = neuerOrdner();
        Zentrale z = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        z.setzePort(8080);

        A a = rufe(z, "GET", "info", null, null);
        pruefe(a.s == 200 && "tt-turnier".equals(a.g("app")) && Long.valueOf(1).equals(a.g("protokoll")) && Boolean.TRUE.equals(a.g("eingerichtet"))
            && Json.alsObjekt(a.g("zentrale")) != null && Boolean.FALSE.equals(a.g("registrierung")), "info meldet Zentrale");
        a = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null);
        pruefe(a.s == 403, "Konto der Zentrale nur vom Gerät selbst");
        a = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true);
        pruefe(a.s == 200 && a.t("token").length() == 64, "Konto der Zentrale am Gerät selbst");
        // Loopback allein reicht nicht: Geheimnis und Herkunft werden geprüft (fremde Webseite im Browser des Handys)
        Map<String, String> q0 = new LinkedHashMap<>();
        q0.put("r", "zentrale.anmelden");
        HttpServer.Antwort ohne = z.api(new HttpServer.Anfrage("POST", "/api/index.php", q0, new LinkedHashMap<>(), "{}".getBytes(StandardCharsets.UTF_8), "127.0.0.1", true));
        pruefe(ohne.status == 403, "Loopback ohne Geheimnis abgewiesen");
        Map<String, String> k1 = new LinkedHashMap<>();
        k1.put("x-tt-zentrale", z.geraetGeheimnis());
        k1.put("origin", "https://boese.example");
        HttpServer.Antwort fremd = z.api(new HttpServer.Anfrage("POST", "/api/index.php", q0, k1, "{}".getBytes(StandardCharsets.UTF_8), "127.0.0.1", true));
        pruefe(fremd.status == 403, "Loopback mit fremdem Origin abgewiesen");
        Map<String, String> k2 = new LinkedHashMap<>();
        k2.put("x-tt-zentrale", z.geraetGeheimnis());
        k2.put("origin", "http://127.0.0.1:8080");
        HttpServer.Antwort eigen = z.api(new HttpServer.Anfrage("POST", "/api/index.php", q0, k2, "{}".getBytes(StandardCharsets.UTF_8), "127.0.0.1", true));
        pruefe(eigen.status == 200, "Loopback mit eigenem Origin erlaubt");
        String konto = a.t("token");
        a = rufe(z, "GET", "ich", null, konto);
        pruefe(a.s == 200 && Json.alsObjekt(a.g("konto")) != null, "ich: Konto");
        a = rufe(z, "POST", "login", Json.obj("email", "a@b.de", "passwort", "x"), null);
        pruefe(a.s == 503, "login gibt es auf der Zentrale nicht");
        a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "X"), konto);
        pruefe(a.s == 400, "Name zu kurz");
        a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Hallencup", "datum", "2026-12-01"), null);
        pruefe(a.s == 401, "Anlegen nur mit Konto");
        a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Hallencup", "datum", "2026-12-01"), konto);
        String tid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String kontoKennung = (String) Json.alsObjekt(a.g("leitung")).get("code");
        pruefe(a.s == 200 && tid.matches("^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$") && Zentrale.codeGueltig(kontoKennung), "Turnier angelegt: Kennung 8 Zeichen ohne Verwechsler, Leitungskennung");
        pruefe(rufe(z, "GET", "turnier", null, null, q("id", tid.toLowerCase(java.util.Locale.ROOT)), false).s == 200, "Kennung ohne Groß/klein");
        A w = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Wunschturnier", "kennung", "hallen-cup"), konto);
        pruefe(w.s == 200 && "HALLEN-CUP".equals(Json.alsObjekt(w.g("turnier")).get("id")), "Wunschkennung (Großbuchstaben)");
        pruefe(rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Wunschturnier", "kennung", "HALLEN-CUP"), konto).s == 409, "Wunschkennung schon vergeben");
        pruefe(rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Wunschturnier", "kennung", "-X-"), konto).s == 400, "ungültige Wunschkennung");
        String leitA = a.t("token");
        a = rufe(z, "GET", "turnier", null, null, q("id", tid), false);
        pruefe(a.s == 200 && "Hallencup".equals(Json.alsObjekt(a.g("turnier")).get("name")) && !Json.alsObjekt(a.g("turnier")).containsKey("rechte"), "Turnier öffentlich lesbar");
        a = rufe(z, "GET", "turnier", null, konto, q("id", tid), false);
        pruefe("leitung".equals(Json.alsObjekt(a.g("turnier")).get("rechte")), "Konto: Rechte = leitung");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", "00000000"), null);
        pruefe(a.s == 401, "falsche Kennung");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "leitung", "bezug", "l-helga", "name", "Helga"))), leitA);
        String helgaKennung = null;
        for (Object o : a.l("codes")) if ("l-helga".equals(Json.alsObjekt(o).get("bezug"))) helgaKennung = (String) Json.alsObjekt(o).get("code");
        pruefe(a.s == 200 && helgaKennung != null, "zweite Leitungskennung angelegt");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", helgaKennung.substring(0, 4) + " " + helgaKennung.substring(4)), null);
        pruefe(a.s == 200 && "leitung".equals(a.t("rolle")) && "Helga".equals(a.t("name")), "Leitungskennung mit Namen");
        String leitB = a.t("token");
        a = rufe(z, "POST", "code.sperren", Json.obj("turnier", tid, "rolle", "leitung", "bezug", "l-helga", "gesperrt", true), leitA);
        pruefe(a.s == 200, "Leitungskennung gesperrt");
        a = rufe(z, "GET", "turnier", null, leitB, q("id", tid), false);
        pruefe(Json.alsObjekt(a.g("turnier")).get("rechte") == null, "gesperrt: Anmeldung ohne Rechte");
        a = rufe(z, "GET", "codes", null, leitA, q("turnier", tid), false);
        String kb = null;
        for (Object o : a.l("codes")) if ("leitung".equals(Json.alsObjekt(o).get("rolle")) && !"l-helga".equals(Json.alsObjekt(o).get("bezug"))) kb = (String) Json.alsObjekt(o).get("bezug");
        a = rufe(z, "POST", "code.sperren", Json.obj("turnier", tid, "rolle", "leitung", "bezug", kb, "gesperrt", true), leitA);
        pruefe(a.s == 409, "letzte gültige Leitungskennung lässt sich nicht sperren");
        rufe(z, "POST", "code.sperren", Json.obj("turnier", tid, "rolle", "leitung", "bezug", "l-helga", "gesperrt", false), leitA);
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", helgaKennung), null);
        leitB = a.t("token");
        pruefe(a.s == 200, "entsperrt: Zugang wieder möglich");

        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000001", "test.notiz", Json.obj("text", "A")))), null, q("turnier", tid), false);
        pruefe(a.s == 401, "Senden ohne Anmeldung");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000001", "test.notiz", Json.obj("text", "A")),
            ev("e-0000002", "test.notiz", Json.obj("leer", Json.obj(), "liste", liste())))), leitA, q("turnier", tid), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 2 && Long.valueOf(2).equals(a.g("hoechsteSeq")), "zwei Ereignisse angenommen");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000001", "test.notiz", Json.obj("text", "A")),
            ev("e-0000003", "test.notiz", Json.obj("text", "B")))), leitB, q("turnier", tid), false);
        List<Object> an = a.l("angenommen");
        pruefe(a.s == 200 && Long.valueOf(1).equals(Json.alsObjekt(an.get(0)).get("seq")) && Long.valueOf(3).equals(Json.alsObjekt(an.get(1)).get("seq")),
            "Doppelsendung liefert alte Laufnummer");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(Json.obj("id", "kurz", "art", "x", "daten", liste(), "zeit", "nie", "geraet", "g"))), leitA, q("turnier", tid), false);
        pruefe(abgelehnt(a, "ungueltig"), "ungültiges Ereignis");
        StringBuilder gross = new StringBuilder();
        for (int i = 0; i < 20000; i++) gross.append('x');
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000009", "test.notiz", Json.obj("text", gross.toString())))), leitA, q("turnier", tid), false);
        pruefe(abgelehnt(a, "ungueltig"), "zu große Daten");
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe("zuschauer".equals(a.t("sicht")) && "".equals(Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(2)).get("autor")).get("name")), "Zuschauer: keine Namen der Eintragenden");
        a = rufe(z, "GET", "events", null, leitA, q("turnier", tid, "ab", "0"), false);
        List<Object> evs = a.l("ereignisse");
        Map<String, Object> e2 = Json.alsObjekt(evs.get(1));
        pruefe(evs.size() == 3 && "Helga".equals(Json.alsObjekt(Json.alsObjekt(evs.get(2)).get("autor")).get("name"))
            && Json.schreiben(e2.get("daten")).equals("{\"leer\":{},\"liste\":[]}"), "Abholen: Autor gesetzt, leere Objekte bleiben");
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "2"), false);
        pruefe(a.l("ereignisse").size() == 1, "Abholen ab Laufnummer");
        List<Object> viele = new ArrayList<>();
        for (int i = 0; i < 200; i++) viele.add(ev(String.format("v-%07d", i), "test.notiz", Json.obj("i", (long) i)));
        rufe(z, "POST", "events", Json.obj("ereignisse", viele), leitA, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe(a.l("ereignisse").size() == 200 && Boolean.TRUE.equals(a.g("mehr")), "Blöcke zu 200 mit „mehr“");
        viele.add(ev("v-9999999", "test.notiz", Json.obj()));
        a = rufe(z, "POST", "events", Json.obj("ereignisse", viele), leitA, q("turnier", tid), false);
        pruefe(a.s == 400, "höchstens 200 je Aufruf");

        System.out.println("Codes");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(
            Json.obj("rolle", "spieler", "bezug", "sp1", "name", "Anna"), Json.obj("rolle", "spieler", "bezug", "sp2", "name", "Ben"),
            Json.obj("rolle", "helfer", "bezug", "h1", "name", "Hilde"))), leitB);
        pruefe(a.s == 200 && a.l("codes").size() == 5 && "leitung".equals(Json.alsObjekt(a.l("codes").get(0)).get("rolle")), "Kennungen angelegt, Leitung zuerst");
        Map<String, String> codes = new LinkedHashMap<>();
        for (Object o : a.l("codes")) codes.put((String) Json.alsObjekt(o).get("bezug"), (String) Json.alsObjekt(o).get("code"));
        pruefe(Zentrale.codeGueltig(codes.get("sp1")) && !codes.get("sp1").equals(kontoKennung) && !codes.get("sp1").equals(tid), "Kennung gültig, nicht Leitung/Turnier");
        a = rufe(z, "GET", "codes", null, null, q("turnier", tid), false);
        pruefe(a.s == 401, "Codes nur für die Leitung");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("sp1")), null);
        pruefe(a.s == 200 && "spieler".equals(a.t("rolle")) && "sp1".equals(a.t("spieler")), "Spieler-Code");
        String sp = a.t("token");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000001", "test.notiz", Json.obj()))), sp, q("turnier", tid), false);
        pruefe(abgelehnt(a, "keine_berechtigung"), "Spieler: nur Ergebnisse");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000002", "spiel.ergebnis", Json.obj("spiel", "g1-a-b")))), sp, q("turnier", tid), false);
        pruefe(a.s == 200, "Spieler: Ergebnis");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000009", "spiel.aufgerufen", Json.obj()))), sp, q("turnier", tid), false);
        pruefe(abgelehnt(a, "keine_berechtigung"), "Spieler: kein Aufruf");
        a = rufe(z, "GET", "events", null, sp, q("turnier", tid, "ab", "203"), false);
        Map<String, Object> autor = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("autor"));
        pruefe("spieler".equals(autor.get("rolle")) && "sp1".equals(autor.get("spieler")) && "Anna".equals(autor.get("name")), "Autor mit Spieler-ID");
        a = rufe(z, "POST", "code.neu", Json.obj("turnier", tid, "rolle", "spieler", "bezug", "sp1"), leitB);
        pruefe(a.s == 200 && !codes.get("sp1").equals(Json.alsObjekt(a.g("code")).get("code")), "neuer Code");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000003", "spiel.ergebnis", Json.obj()))), sp, q("turnier", tid), false);
        pruefe(a.s == 401, "alter Code: Anmeldung beendet");
        rufe(z, "POST", "code.sperren", Json.obj("turnier", tid, "rolle", "spieler", "bezug", "sp2", "gesperrt", true), leitB);
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("sp2")), null);
        pruefe(a.s == 401, "gesperrter Code");
        a = rufe(z, "POST", "code.helfer", Json.obj("turnier", tid, "bezug", "sp2", "helfer", true), leitB);
        pruefe(a.s == 200 && Boolean.TRUE.equals(Json.alsObjekt(a.g("code")).get("helfer")), "Spieler mit Helfer-Recht");
        rufe(z, "POST", "code.sperren", Json.obj("turnier", tid, "rolle", "spieler", "bezug", "sp2", "gesperrt", false), leitB);
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("sp2")), null);
        pruefe(a.s == 200 && Boolean.TRUE.equals(a.g("helfer")), "Zugang: Spieler mit Helfer-Recht");
        String spH = a.t("token");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000010", "tisch.gesperrt", Json.obj()))), spH, q("turnier", tid), false);
        pruefe(abgelehnt(a, "keine_berechtigung"), "Spieler-Helfer: keine Tische sperren");
        // Etappe 8: Vorplanen, Auslosung ändern, Rückgängig – nur Leitung
        String[] nurLeitung = {"spiel.geplant", "auslosung.geaendert", "eintrag.zurueckgenommen"};
        for (int i = 0; i < nurLeitung.length; i++) {
            a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-00008" + i + "0", nurLeitung[i], Json.obj()))), spH, q("turnier", tid), false);
            pruefe(abgelehnt(a, "keine_berechtigung"), "Spieler-Helfer: kein " + nurLeitung[i]);
        }
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("s-0000004", "spiel.ergebnis", Json.obj()))), spH, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, spH, q("turnier", tid, "ab", "204"), false);
        autor = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("autor"));
        pruefe(Boolean.TRUE.equals(autor.get("helfer")) && "sp2".equals(autor.get("spieler")), "Autor mit Helfer-Recht");
        a = rufe(z, "GET", "konto.einstellungen", null, konto);
        pruefe(a.s == 200 && a.l("klassen").isEmpty(), "Konto-Einstellungen leer");
        a = rufe(z, "POST", "konto.einstellungen", Json.obj("klassen", liste("A", " B ", "A", "")), konto);
        pruefe(a.s == 200 && a.l("klassen").size() == 2, "Klassen gespeichert");
        a = rufe(z, "POST", "turnier.einstellungen", Json.obj("turnier", tid, "sicherungTakt", 15L, "sicherungAn", liste("a@example.org")), leitB);
        pruefe(a.s == 200 && Long.valueOf(15).equals(a.g("sicherungTakt")) && Boolean.FALSE.equals(a.g("mail")), "Einstellungen; ohne Online-Konto keine Mail");
        a = rufe(z, "POST", "turnier.sichern", Json.obj("turnier", tid), leitB);
        pruefe(a.s == 503, "Sichern per Mail braucht verbundenes Online-Konto");

        System.out.println("Datenschutz beim Abholen (Zuschauer)");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(
            ev("d-0000001", "spieler.angelegt", Json.obj("id", "sp1", "vorname", "Lea", "nachname", "Löwe", "verein", "TSV", "jahrgang", 2012L, "geschlecht", "w", "pool", "p-1", "ttr", 1025L, "ttrGeschaetzt", true)),
            ev("d-0000002", "spiel.aufgerufen", Json.obj("konkurrenz", "k", "spiel", "x", "tisch", 2L, "schiri", Json.obj("name", "Opa Paul"))),
            ev("d-0000003", "spiel.aufgerufen", Json.obj("konkurrenz", "k", "spiel", "y", "tisch", 3L, "schiri", Json.obj("name", "Lea", "spieler", "sp1"))))), leitB, q("turnier", tid), false);
        long vorher = zahlAus(rufe(z, "GET", "events", null, leitB, q("turnier", tid, "ab", "0"), false).g("hoechsteSeq")) - 3;
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", String.valueOf(vorher)), false);
        Map<String, Object> lea = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("daten"));
        pruefe("zuschauer".equals(a.t("sicht")) && "Löwe".equals(lea.get("nachname")) && !lea.containsKey("jahrgang") && !lea.containsKey("geschlecht") && !lea.containsKey("pool") && !lea.containsKey("ttrGeschaetzt") && Long.valueOf(1025).equals(lea.get("ttr")), "Zuschauer: kein Jahrgang, Geschlecht, Pool, nicht „geschätzt“");
        pruefe(!Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(1)).get("daten")).containsKey("schiri")
            && Json.schreiben(Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(2)).get("daten")).get("schiri")).equals("{\"spieler\":\"sp1\"}"), "Zuschauer: Schiedsrichter nur als Spieler-Bezug");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "spieler", "bezug", "sp9", "name", "Pia"))), leitB);
        String piaCode = null;
        for (Object o : a.l("codes")) if ("sp9".equals(Json.alsObjekt(o).get("bezug"))) piaCode = (String) Json.alsObjekt(o).get("code");
        String pia = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", piaCode), null).t("token");
        a = rufe(z, "GET", "events", null, pia, q("turnier", tid, "ab", String.valueOf(vorher)), false);
        lea = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("daten"));
        pruefe("spieler".equals(a.t("sicht")) && "Löwe".equals(lea.get("nachname")) && !lea.containsKey("jahrgang")
            && "Opa Paul".equals(Json.alsObjekt(Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(1)).get("daten")).get("schiri")).get("name"))
            && !"".equals(Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("autor")).get("name")), "Spielerkennung: Namen ja, Jahrgang nein");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("d-0000004", "turnier.daten", Json.obj("namen", "kurz")))), leitB, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", String.valueOf(vorher)), false);
        lea = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("daten"));
        pruefe("kurz".equals(a.t("sicht")) && "L.".equals(lea.get("nachname")), "Kurzform für Zuschauer");
        a = rufe(z, "GET", "events", null, leitB, q("turnier", tid, "ab", String.valueOf(vorher)), false);
        lea = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("daten"));
        pruefe("voll".equals(a.t("sicht")) && "Löwe".equals(lea.get("nachname")) && Long.valueOf(2012).equals(lea.get("jahrgang")), "Leitung sieht alles");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("d-0000005", "turnier.daten", Json.obj("namen", "voll")))), leitB, q("turnier", tid), false);
        pruefe("zuschauer".equals(rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false).t("sicht")) && "É.".equals(Zentrale.kurzname(" élise")), "Kurzform zurückgenommen");

        System.out.println("Zugriffsschutz");
        for (int i = 0; i < 30; i++) rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", "99999999"), null);
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", "99999998"), null);
        pruefe(a.s == 429, "falsche Kennungen nach 30 Fehlversuchen gebremst");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", helgaKennung), null);
        pruefe(a.s == 200, "richtige Kennung trotz Bremse angenommen (Hallen-WLAN)");
        for (int i = 0; i < 30; i++) rufe(z, "GET", "turnier", null, null, q("id", String.valueOf(20000000 + i)), false);
        a = rufe(z, "GET", "turnier", null, null, q("id", "20000099"), false);
        pruefe(a.s == 429, "Durchprobieren von Turnierkennungen wird gebremst");
        a = rufe(z, "GET", "turnier", null, null, q("id", tid), false);
        pruefe(a.s == 200, "bekannte Turniere bleiben erreichbar");
        a = rufe(z, "GET", "zentrale.status", null, konto);
        pruefe(a.s == 403, "Zentrale-Status nicht für andere Geräte");
        a = rufe(z, "GET", "zentrale.status", null, null, null, true);
        pruefe(a.s == 200 && a.l("adressen") != null, "Zentrale-Status am Gerät");

        System.out.println("Pool und Übersicht");
        a = rufe(z, "POST", "pool.speichern", Json.obj("spieler", liste(
            Json.obj("id", "p1", "vorname", "Anna", "nachname", "A", "verein", "TTC", "ttr", 1500L, "fremd", "x"),
            Json.obj("id", "p2", "vorname", "Ben", "nachname", "B", "verein", "TSV", "ttr", 99999L))), konto);
        Map<String, Object> p2 = Json.alsObjekt(a.l("spieler").get(1));
        pruefe(a.s == 200 && a.l("spieler").size() == 2 && p2.get("ttr") == null && !Json.alsObjekt(a.l("spieler").get(0)).containsKey("fremd"), "Pool speichern, Felder geprüft");
        a = rufe(z, "POST", "pool.speichern", Json.obj("spieler", liste(
            Json.obj("id", "h1", "vorname", "Han\nna", "nachname", "H", "verein", "", "ttr", 1025L, "ttrGeschaetzt", true, "appSpiele", 7L,
                "wertungTurniere", liste("12345678"), "lizenz", "NU-123"),
            Json.obj("id", "h2", "vorname", "Hugo", "nachname", "H", "verein", "", "ttrGeschaetzt", true, "appSpiele", -3L, "lizenz", "<script>"))), konto);
        Map<String, Object> h1 = null, h2 = null;
        for (Object o : a.l("spieler")) {
            Map<String, Object> m = Json.alsObjekt(o);
            if ("h1".equals(m.get("id"))) h1 = m;
            if ("h2".equals(m.get("id"))) h2 = m;
        }
        pruefe(h1 != null && Boolean.TRUE.equals(h1.get("ttrGeschaetzt")) && Long.valueOf(7).equals(h1.get("appSpiele")) && "Hanna".equals(h1.get("vorname"))
            && !h1.containsKey("wertungTurniere") && "NU-123".equals(h1.get("lizenz")), "Pool: geschätzter Wert, App-Spiele, Lizenz; Steuerzeichen raus; keine Turnierliste");
        pruefe(h2 != null && !h2.containsKey("ttrGeschaetzt") && !h2.containsKey("appSpiele") && !h2.containsKey("lizenz"), "Pool: ungültige Zusatzfelder verworfen");
        rufe(z, "POST", "pool.loeschen", Json.obj("ids", liste("p2", "h1", "h2")), konto);
        a = rufe(z, "GET", "pool", null, konto);
        pruefe(a.l("spieler").size() == 1, "Pool löschen");
        a = rufe(z, "POST", "turnier.uebersicht", Json.obj("turnier", tid, "text", "Gruppe A"), leitB);
        pruefe(a.s == 200, "Übersicht");

        System.out.println("Neustart (Daten bleiben)");
        Zentrale z2 = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        a = rufe(z2, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe(a.s == 200 && Long.valueOf(210).equals(a.g("hoechsteSeq")), "Ereignisse nach Neustart");
        a = rufe(z2, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("h1")), null);
        pruefe(a.s == 200 && "helfer".equals(a.t("rolle")), "Codes nach Neustart");
        a = rufe(z2, "GET", "turnier.einstellungen", null, leitB, q("id", tid), false);
        pruefe(a.s == 200 && Long.valueOf(15).equals(a.g("sicherungTakt")), "Anmeldungen nach Neustart");
        // halb geschriebene letzte Zeile (Akku leer)
        Path j = ordner.resolve("turniere").resolve(tid).resolve("ereignisse.jsonl");
        Files.write(j, "{\"id\":\"kaputt-00".getBytes(StandardCharsets.UTF_8), java.nio.file.StandardOpenOption.APPEND);
        Zentrale z3 = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        a = rufe(z3, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe(a.s == 200 && Long.valueOf(210).equals(a.g("hoechsteSeq")), "beschädigte letzte Zeile wird übersprungen");
    }

    static void etappe10() throws Exception {
        System.out.println("Etappe 10: Namen entfernter Spieler für Zuschauer");
        Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(null), new Online(2000), () -> uhr);
        z.setzePort(8080);
        String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        A a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Entfernt-Cup"), konto);
        String tid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String leit = a.t("token");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(
            ev("x-0000001", "spieler.angelegt", Json.obj("id", "anna", "vorname", "Anna", "nachname", "Arm", "verein", "TTC")),
            ev("x-0000002", "spieler.angelegt", Json.obj("id", "bert", "vorname", "Bert", "nachname", "Bein", "verein", "TTC")),
            ev("x-0000003", "spieler.entfernt", Json.obj("id", "bert")))), leit, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        List<String> namen = new ArrayList<>();
        for (Object o : a.l("ereignisse")) {
            Map<String, Object> e = Json.alsObjekt(o);
            if ("spieler.angelegt".equals(e.get("art"))) namen.add(Json.alsObjekt(e.get("daten")).get("vorname") + "/" + Json.alsObjekt(e.get("daten")).get("nachname"));
        }
        String f1 = a.t("filter");
        pruefe(liste("Anna/Arm", "Entfernt/").equals(namen) && f1 != null && f1.length() == 16, "Zuschauer: Name des entfernten Spielers ersetzt, Filter gesetzt");
        pruefe(f1.equals(Api10.php("bert")), "Filter-Kennung wie PHP");
        a = rufe(z, "GET", "events", null, leit, q("turnier", tid, "ab", "0"), false);
        pruefe(a.g("filter") == null, "Leitung: kein Filter");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("x-0000004", "eintrag.zurueckgenommen", Json.obj("ereignisse", liste("x-0000003"), "zurueck", true)))), leit, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe(a.g("filter") == null, "Entfernen rückgängig: kein Filter mehr");
    }

    /** Kennung für einen Spieler anlegen und anmelden → Token */
    static String spielerToken(Zentrale z, String tid, String leit, String bezug) {
        A a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "spieler", "bezug", bezug, "name", bezug))), leit);
        String code = null;
        for (Object o : a.l("codes")) if (bezug.equals(Json.alsObjekt(o).get("bezug"))) code = (String) Json.alsObjekt(o).get("code");
        return rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", code), null).t("token");
    }

    static int aufstellungen(A a) {
        int n = 0;
        for (Object o : a.l("ereignisse")) if ("mannschaft.aufgestellt".equals(Json.alsObjekt(o).get("art"))) n++;
        return n;
    }

    static void etappe11() throws Exception {
        System.out.println("Etappe 11: Mannschaften – Aufstellung nur durch die Führung, verdeckt bis beide abgegeben haben");
        Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(null), new Online(2000), () -> uhr);
        z.setzePort(8080);
        String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        A a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Mannschafts-Cup"), konto);
        String tid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String leit = a.t("token");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(
            ev("m-0000001", "spieler.angelegt", Json.obj("id", "a1", "vorname", "A", "nachname", "Eins", "verein", "")),
            ev("m-0000002", "spieler.angelegt", Json.obj("id", "a2", "vorname", "A", "nachname", "Zwei", "verein", "")),
            ev("m-0000003", "spieler.angelegt", Json.obj("id", "b1", "vorname", "B", "nachname", "Eins", "verein", "")),
            ev("m-0000004", "mannschaft.gemeldet", Json.obj("konkurrenz", "m", "id", "m-aaaa", "name", "A", "spieler", liste("a1", "a2"), "fuehrer", "a1")),
            ev("m-0000005", "mannschaft.gemeldet", Json.obj("konkurrenz", "m", "id", "m-bbbb", "name", "B", "spieler", liste("b1"), "fuehrer", "b1")))), leit, q("turnier", tid), false);
        String a1 = spielerToken(z, tid, leit, "a1");
        String a2 = spielerToken(z, tid, leit, "a2");
        String b1 = spielerToken(z, tid, leit, "b1");
        String spiel = "g0-m-aaaa-m-bbbb";
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("m-0000006", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a2"))))), a2, q("turnier", tid), false);
        pruefe(abgelehnt(a, "ungueltig"), "Spieler ohne Führung: Aufstellung abgelehnt");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("m-0000016", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste())))), a1, q("turnier", tid), false);
        pruefe(abgelehnt(a, "ungueltig"), "Leere Aufstellung abgelehnt");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("m-0000007", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", "g0-m-cccc-m-bbbb", "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1"))))), a1, q("turnier", tid), false);
        pruefe(abgelehnt(a, "ungueltig"), "Gruppenspiel einer fremden Begegnung: abgelehnt");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("m-0000008", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a2"))))), a1, q("turnier", tid), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Mannschaftsführung gibt die Aufstellung ab");
        A gegner = rufe(z, "GET", "events", null, b1, q("turnier", tid, "ab", "0"), false);
        A selbst = rufe(z, "GET", "events", null, a1, q("turnier", tid, "ab", "0"), false);
        A zuschauer = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        A leitung = rufe(z, "GET", "events", null, leit, q("turnier", tid, "ab", "0"), false);
        pruefe(aufstellungen(gegner) == 0 && aufstellungen(zuschauer) == 0 && gegner.g("filter") == null, "Gegner und Zuschauer sehen die Aufstellung noch nicht");
        A mitglied = rufe(z, "GET", "events", null, a2, q("turnier", tid, "ab", "0"), false);
        pruefe(aufstellungen(selbst) == 1 && aufstellungen(mitglied) == 1 && aufstellungen(leitung) == 1, "Eigene Mannschaft und Leitung sehen sie");
        // Ab 0.16: Kasse-Helfer (volle Sicht) sehen Aufstellungen erst nach dem Aufdecken
        A ka = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "helfer", "bezug", "hk", "name", "Kasse", "aufgaben", liste("kasse")))), leit);
        String kcode = null;
        for (Object o : ka.l("codes")) if ("hk".equals(Json.alsObjekt(o).get("bezug"))) kcode = (String) Json.alsObjekt(o).get("code");
        String kasse = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", kcode), null).t("token");
        A kas = rufe(z, "GET", "events", null, kasse, q("turnier", tid, "ab", "0"), false);
        pruefe("voll".equals(kas.g("sicht")) && aufstellungen(kas) == 0 && kas.g("filter") != null && leitung.g("filter") == null, "Kasse-Helfer (volle Sicht) sieht die Aufstellung vor dem Aufdecken nicht; eigene Filter-Kennung");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("m-0000009", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-bbbb", "gegner", "m-aaaa", "einzel", liste("b1"))))), b1, q("turnier", tid), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Gegner gibt ab");
        gegner = rufe(z, "GET", "events", null, b1, q("turnier", tid, "ab", "0"), false);
        zuschauer = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", "0"), false);
        pruefe(aufstellungen(gegner) == 2 && aufstellungen(zuschauer) == 2 && Api10.php("aufgedeckt:m|" + spiel).equals(zuschauer.t("filter")), "Beide nennen sich: für alle sichtbar, Filter-Kennung wie PHP");
        kas = rufe(z, "GET", "events", null, kasse, q("turnier", tid, "ab", "0"), false);
        leitung = rufe(z, "GET", "events", null, leit, q("turnier", tid, "ab", "0"), false);
        pruefe(aufstellungen(kas) == 2 && kas.g("filter") != null && aufstellungen(leitung) == 2 && leitung.g("filter") == null, "Kasse-Helfer: nach dem Aufdecken sichtbar, Leitung ohne Filter");
    }

    /** Fingerabdruck wie PHP: sha256 der sortierten IDs, 16 Zeichen */
    static final class Api10 {
        static String php(String... ids) {
            List<String> l = new ArrayList<>(Arrays.asList(ids));
            Collections.sort(l);
            return Zentrale.sha256(String.join(",", l)).substring(0, 16);
        }
    }

    static void etappe9() throws Exception {
        System.out.println("Etappe 9: Aufgaben, abgelehnte Einträge, Kasse nur in voller Sicht");
        Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(null), new Online(2000), () -> uhr);
        z.setzePort(8080);
        String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        A a = rufe(z, "GET", "info", null, null);
        pruefe(Boolean.TRUE.equals(a.g("aufgaben")) && Boolean.FALSE.equals(a.g("anmeldung")) && "0.18.0".equals(a.g("version")) && Boolean.TRUE.equals(a.g("nachrichten")), "info: Aufgaben ja, Online-Anmeldung nein, Posteingang ja");
        a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Kassencup", "datum", "2027-02-01"), konto);
        String tid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String leit = a.t("token");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(
            Json.obj("rolle", "helfer", "bezug", "h-kasse", "name", "Eva", "aufgaben", liste("kasse")),
            Json.obj("rolle", "helfer", "bezug", "h-std", "name", "Ali"),
            Json.obj("rolle", "spieler", "bezug", "sp1", "name", "Sven"))), leit);
        Map<String, Map<String, Object>> c = new LinkedHashMap<>();
        for (Object o : a.l("codes")) c.put(String.valueOf(Json.alsObjekt(o).get("bezug")), Json.alsObjekt(o));
        pruefe(liste("kasse").equals(c.get("h-kasse").get("aufgaben")) && liste("ergebnisse", "aufruf").equals(c.get("h-std").get("aufgaben")), "Helferkennungen mit Aufgaben");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "helfer", "bezug", "h-x", "name", "X", "aufgaben", liste("nix")))), leit);
        pruefe(a.s == 400, "ohne gültige Aufgabe abgewiesen");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", c.get("h-kasse").get("code")), null);
        String kasse = a.t("token");
        pruefe(a.s == 200 && liste("kasse").equals(a.g("aufgaben")), "Zugang als Kasse mit Aufgaben");
        a = rufe(z, "GET", "turnier", null, kasse, q("id", tid), false);
        pruefe(liste("kasse").equals(Json.alsObjekt(a.g("turnier")).get("aufgaben")), "GET turnier: Aufgaben");
        String sp = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", c.get("sp1").get("code")), null).t("token");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(
            ev("k-0000001", "spieler.angelegt", Json.obj("id", "sp1", "vorname", "Sven", "nachname", "S", "verein", "")),
            ev("k-0000002", "turnier.daten", Json.obj("ort", "Halle", "kasse", Json.obj("aussteller", "TTC", "iban", "DE89370400440532013000"))))), leit, q("turnier", tid), false);
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(
            ev("k-0000003", "startgeld.gebucht", Json.obj("id", "b0001", "spieler", "sp1", "betrag", 800L, "art", "bar")),
            ev("k-0000004", "spiel.ergebnis", Json.obj()),
            ev("k-0000005", "teilnehmer.eingecheckt", Json.obj("spieler", "sp1", "da", true)))), kasse, q("turnier", tid), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 2 && a.l("abgelehnt").size() == 1 && "k-0000004".equals(Json.alsObjekt(a.l("abgelehnt").get(0)).get("id")),
            "Kasse: Ergebnis einzeln abgelehnt, Rest angenommen");
        a = rufe(z, "POST", "code.aufgaben", Json.obj("turnier", tid, "bezug", "h-kasse", "aufgaben", liste("kasse", "oberschiri")), kasse);
        pruefe(a.s == 403, "Aufgaben ändern nur die Leitung");
        a = rufe(z, "POST", "code.aufgaben", Json.obj("turnier", tid, "bezug", "h-kasse", "aufgaben", liste("oberschiri", "kasse")), leit);
        pruefe(a.s == 200 && liste("kasse", "oberschiri").equals(Json.alsObjekt(a.g("code")).get("aufgaben")), "Aufgaben geändert (feste Reihenfolge)");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("k-0000006", "spiel.entschieden", Json.obj()), ev("k-0000007", "spiel.aufgerufen", Json.obj()))), kasse, q("turnier", tid), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1 && "k-0000007".equals(Json.alsObjekt(a.l("abgelehnt").get(0)).get("id")), "gilt sofort ohne neue Anmeldung");
        a = rufe(z, "GET", "events", null, leit, q("turnier", tid, "ab", "0"), false);
        long hoechste = zahlAus(a.g("hoechsteSeq"));
        Map<String, Object> autorK = null;
        for (Object o : a.l("ereignisse")) if ("startgeld.gebucht".equals(Json.alsObjekt(o).get("art"))) autorK = Json.alsObjekt(Json.alsObjekt(o).get("autor"));
        pruefe(autorK != null && "helfer".equals(autorK.get("rolle")) && liste("kasse").equals(autorK.get("aufgaben")), "Leitung sieht Kasse; Autor mit Aufgaben");
        for (String tok : new String[] {null, sp}) {
            a = rufe(z, "GET", "events", null, tok, q("turnier", tid, "ab", "0"), false);
            boolean ohne = true;
            Map<String, Object> daten = null;
            for (Object o : a.l("ereignisse")) {
                Object art = Json.alsObjekt(o).get("art");
                if (Zentrale.NUR_VOLLE_SICHT.contains(art)) ohne = false;
                if ("turnier.daten".equals(art)) daten = Json.alsObjekt(Json.alsObjekt(o).get("daten"));
            }
            pruefe(ohne && daten != null && !daten.containsKey("kasse") && "Halle".equals(daten.get("ort")) && zahlAus(a.g("bis")) == hoechste,
                (tok == null ? "Zuschauer" : "Spieler") + ": ohne Zahlungen, Check-in, Bankverbindung; bis = letzte Laufnummer");
        }
        String ali = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", c.get("h-std").get("code")), null).t("token");
        a = rufe(z, "GET", "events", null, ali, q("turnier", tid, "ab", "0"), false);
        boolean ohneKasse = true;
        for (Object o : a.l("ereignisse")) {
            Map<String, Object> e = Json.alsObjekt(o);
            if (Zentrale.NUR_VOLLE_SICHT.contains(e.get("art"))) ohneKasse = false;
            if ("turnier.daten".equals(e.get("art")) && Json.alsObjekt(e.get("daten")).containsKey("kasse")) ohneKasse = false;
        }
        pruefe("helfer".equals(a.t("sicht")) && ohneKasse && zahlAus(a.g("bis")) == hoechste, "Helfer ohne Aufgabe Kasse: Sicht helfer ohne Zahlungen und Bankverbindung");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("k-0000008", "teilnehmer.eingecheckt", Json.obj("spieler", "sp1", "da", false)))), leit, q("turnier", tid), false);
        a = rufe(z, "GET", "events", null, null, q("turnier", tid, "ab", String.valueOf(hoechste)), false);
        pruefe(a.l("ereignisse").isEmpty() && zahlAus(a.g("bis")) == hoechste + 1 && Boolean.FALSE.equals(a.g("mehr")), "nur gefilterte Einträge: bis rückt vor");
        a = rufe(z, "POST", "konto.einstellungen", Json.obj("kasse", Json.obj("aussteller", "TTC", "iban", "DE00123")), konto);
        pruefe(a.s == 400, "Kasse im Konto: falsche IBAN abgewiesen");
        a = rufe(z, "POST", "konto.einstellungen", Json.obj("kasse", Json.obj("aussteller", "TTC", "iban", "de89 3704 0044 0532 0130 00", "ust", "enthalten", "ustSatz", 7L)), konto);
        Map<String, Object> k = Json.alsObjekt(a.g("kasse"));
        pruefe(a.s == 200 && "DE89370400440532013000".equals(k.get("iban")) && Long.valueOf(7).equals(k.get("ustSatz")) && a.l("klassen").isEmpty(), "Kasse im Konto gespeichert");
        a = rufe(z, "GET", "anmeldung", null, null, q("turnier", tid), false);
        pruefe(a.s == 404, "Online-Anmeldung gibt es auf der Zentrale nicht");
    }

    static void http() throws Exception {
        System.out.println("HTTP und App-Dateien");
        Path app = neuerOrdner();
        Files.write(app.resolve("index.html"), "<!doctype html><title>TT</title>".getBytes(StandardCharsets.UTF_8));
        Files.createDirectories(app.resolve("assets"));
        Files.write(app.resolve("assets/app-1.js"), "console.log(1)".getBytes(StandardCharsets.UTF_8));
        Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(app), new Online(2000), () -> uhr);
        HttpServer h = new HttpServer(z);
        int port = h.starten("127.0.0.1", 18_431);
        z.setzePort(port);
        try {
            String[] r = holen("http://127.0.0.1:" + port + "/");
            pruefe(r[0].equals("200") && r[1].contains("<title>TT") && r[2].startsWith("text/html"), "index.html");
            r = holen("http://127.0.0.1:" + port + "/assets/app-1.js");
            pruefe(r[0].equals("200") && r[2].startsWith("text/javascript"), "Skript mit richtigem Typ");
            r = holen("http://127.0.0.1:" + port + "/../../etc/passwd");
            pruefe(!r[1].contains("root:"), "kein Zugriff außerhalb des App-Ordners");
            r = holen("http://127.0.0.1:" + port + "/api/index.php?r=info");
            pruefe(r[0].equals("200") && r[1].contains("\"zentrale\""), "API über HTTP");
        } finally {
            h.stoppen();
        }
    }

    static String[] holen(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        int s = c.getResponseCode();
        java.io.InputStream in = s >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = in == null ? "" : new String(in.readAllBytes(), StandardCharsets.UTF_8);
        return new String[] {String.valueOf(s), text, String.valueOf(c.getContentType())};
    }

    /** Mail-Datei lesbar machen: base64-Teile dekodieren und anhängen. */
    static String mimeText(String roh) {
        StringBuilder b = new StringBuilder(roh);
        String[] teile = roh.split("Content-Transfer-Encoding: base64");
        for (int i = 1; i < teile.length; i++) {
            String rest = teile[i].replaceFirst("^[^\\n]*\\n", "");
            int ende = rest.indexOf("--tt-");
            String daten = (ende < 0 ? rest : rest.substring(0, ende)).replaceAll("^(?s).*?\\r?\\n\\r?\\n", "").replaceAll("\\s", "");
            try {
                b.append('\n').append(new String(java.util.Base64.getDecoder().decode(daten), StandardCharsets.UTF_8));
            } catch (IllegalArgumentException x) {
                // kein base64
            }
        }
        return b.toString();
    }

    /* ---------------- Zusammenspiel mit dem PHP-Server ---------------- */

    static void zusammenspiel(String basis) throws Exception {
        System.out.println("Zusammenspiel mit dem Online-Server " + basis);
        Online o = new Online(5000);
        String zuf = Long.toString(System.nanoTime(), 36);
        Map<String, Object> info = o.rufe(basis, "info", null, null, null);
        if (!Boolean.TRUE.equals(info.get("eingerichtet"))) {
            o.rufe(basis, "setup", null, Json.obj("code", System.getenv().getOrDefault("TT_SETUP_CODE", "einrichtung-123456"),
                "name", "Admin", "email", "admin-" + zuf + "@example.org", "passwort", "admin-passwort"), null);
        }
        String mail = "zentrale-" + zuf + "@example.org";
        Map<String, Object> rechenaufgabe = o.rufe(basis, "registrieraufgabe", null, null, null);
        String aufgabe = (String) rechenaufgabe.get("aufgabe");
        int bits = ((Number) rechenaufgabe.getOrDefault("bits", 12L)).intValue();
        int nonce = 0;
        java.security.MessageDigest sha = java.security.MessageDigest.getInstance("SHA-256");
        while (true) {
            byte[] h = sha.digest((aufgabe + ":" + nonce).getBytes(StandardCharsets.UTF_8));
            int praefix = ((h[0] & 255) << 16) | ((h[1] & 255) << 8) | (h[2] & 255);
            if ((praefix >>> (24 - bits)) == 0) break;
            nonce++;
        }
        o.rufe(basis, "registrierlink", null, Json.obj("email", mail, "aufgabe", aufgabe, "nonce", nonce), null);
        String nachweis = null;
        try (DirectoryStream<Path> d = Files.newDirectoryStream(Paths.get(System.getenv("TT_MAILS")))) {
            for (Path p : d) {
                String roh = Files.readString(p);
                if (!roh.contains(mail)) continue;
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("#/aktivieren/([a-f0-9]{64})").matcher(mimeText(roh));
                if (m.find()) nachweis = m.group(1);
            }
        }
        Map<String, Object> reg = o.rufe(basis, "registrieren", null, Json.obj("nachweis", nachweis, "name", "TTC Zentral", "email", mail, "passwort", "zentral-pw1", "website", "", "volljaehrig", true, "bedingungen", true), null);
        String vk = (String) reg.get("token");
        Map<String, Object> t = o.rufe(basis, "turnier.anlegen", null, Json.obj("name", "Online vorbereitet", "datum", "2026-12-12",
            "sicherungAn", liste(mail)), vk);
        String tid = (String) Json.alsObjekt(t.get("turnier")).get("id");
        String leit = (String) t.get("token");
        o.rufe(basis, "events", q("turnier", tid), Json.obj("ereignisse", liste(ev("o-0000001", "turnier.angelegt", Json.obj("name", "Online vorbereitet")),
            ev("o-0000002", "spieler.angelegt", Json.obj("id", "sp1", "vorname", "Anna", "nachname", "Arndt", "verein", "TTC", "jahrgang", 2011L)))), leit);
        Map<String, Object> cs = o.rufe(basis, "codes.anlegen", null, Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "spieler", "bezug", "sp1", "name", "Anna"))), leit);
        String annaCode = null;
        for (Object c : Json.alsListe(cs.get("codes"))) if ("sp1".equals(Json.alsObjekt(c).get("bezug"))) annaCode = (String) Json.alsObjekt(c).get("code");
        String onlineLeitung = (String) Json.alsObjekt(t.get("leitung")).get("code");
        o.rufe(basis, "pool.speichern", null, Json.obj("spieler", liste(Json.obj("id", "op1", "vorname", "Olga", "nachname", "O", "verein", "TTC"))), vk);

        Zentrale z = new Zentrale(new Speicher(neuerOrdner()), new PlattformJvm(null), o, () -> System.currentTimeMillis() / 1000);
        z.setzePort(8080);
        A a = rufe(z, "POST", "zentrale.online.anmelden", Json.obj("email", mail, "passwort", "falsch", "url", basis), null, null, true);
        pruefe(a.s == 401, "Online-Anmeldung mit falschem Passwort (" + a.s + " " + a.g("meldung") + ")");
        a = rufe(z, "POST", "zentrale.online.anmelden", Json.obj("email", mail, "passwort", "zentral-pw1", "url", basis), null, null, true);
        pruefe(a.s == 200 && Boolean.TRUE.equals(Json.alsObjekt(a.g("online")).get("verbunden")), "Online-Konto verbunden");
        String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        a = rufe(z, "GET", "zentrale.online.turniere", null, null, null, true);
        pruefe(a.s == 200 && a.l("turniere").size() == 1, "Online-Turniere sichtbar");
        a = rufe(z, "POST", "zentrale.uebernehmen", Json.obj("turnier", tid), null, null, true);
        pruefe(a.s == 200 && Long.valueOf(2).equals(a.g("neu")), "Übernahme: Ereignisse geladen");
        a = rufe(z, "GET", "events", null, rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token"), q("turnier", tid, "ab", "0"), false);
        Map<String, Object> annaD = Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(1)).get("daten"));
        pruefe(Long.valueOf(2011).equals(annaD.get("jahrgang")) && "TTC Zentral".equals(Json.alsObjekt(Json.alsObjekt(a.l("ereignisse").get(0)).get("autor")).get("name")), "Übernahme: volle Daten (mit Anmeldung abgeholt)");
        Map<String, Object> on = o.rufe(basis, "turnier", q("id", tid), null, null);
        pruefe(Json.alsObjekt(on.get("turnier")).get("zentrale") != null, "online als „auf Zentrale“ gesperrt");
        boolean gesperrt = false;
        try {
            o.rufe(basis, "events", q("turnier", tid), Json.obj("ereignisse", liste(ev("o-0000003", "test.notiz", Json.obj()))), leit);
        } catch (Online.Fehler f) {
            gesperrt = "konflikt".equals(f.code);
        }
        pruefe(gesperrt, "online keine Einträge während der Übernahme");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", annaCode), null);
        pruefe(a.s == 200 && "sp1".equals(a.t("spieler")), "Spieler-Code von online gilt auf der Zentrale");
        String anna = a.t("token");
        a = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", onlineLeitung), null);
        pruefe(a.s == 200 && "leitung".equals(a.t("rolle")) && "TTC Zentral".equals(a.t("name")), "Leitungskennung von online gilt auf der Zentrale");
        String halle = a.t("token");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("h-0000001", "spiel.ergebnis", Json.obj("s", "1")))), anna, q("turnier", tid), false);
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("h-0000002", "turnier.abgeschlossen", Json.obj()))), halle, q("turnier", tid), false);
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "helfer", "bezug", "h1", "name", "Hilde"))), halle);
        String hildeCode = null;
        for (Object c : a.l("codes")) if ("h1".equals(Json.alsObjekt(c).get("bezug"))) hildeCode = (String) Json.alsObjekt(c).get("code");
        rufe(z, "POST", "turnier.uebersicht", Json.obj("turnier", tid, "text", "Sieger: Anna"), halle);

        System.out.println("Sicherung über den Online-Server");
        z.warteschlangeSenden();
        a = rufe(z, "GET", "zentrale.status", null, null, null, true);
        pruefe(a.l("warteschlange").isEmpty(), "Abschluss-Sicherung versendet");
        String mails = System.getenv("TT_MAILS");
        if (mails != null) {
            boolean gefunden = false;
            try (DirectoryStream<Path> d = Files.newDirectoryStream(Paths.get(mails))) {
                for (Path p : d) {
                    String m = mimeText(new String(Files.readAllBytes(p), StandardCharsets.UTF_8));
                    if (m.contains(mail) && m.contains("Sieger: Anna") && m.contains("Android-Zentrale") && m.contains("h-0000002")) gefunden = true;
                }
            }
            pruefe(gefunden, "Mail mit Übersicht und Anhang liegt vor");
        }

        System.out.println("Rückgabe");
        a = rufe(z, "POST", "zentrale.rueckgabe", Json.obj("turnier", tid), null, null, true);
        pruefe(a.s == 200 && Long.valueOf(2).equals(a.g("gesendet")), "Rückgabe: neue Einträge hochgeladen");
        Map<String, Object> evs = o.rufe(basis, "events", q("turnier", tid, "ab", "0"), null, null);
        List<Object> l = Json.alsListe(evs.get("ereignisse"));
        Map<String, Object> au = Json.alsObjekt(Json.alsObjekt(l.get(2)).get("autor"));
        pruefe(l.size() == 4 && "spieler".equals(au.get("rolle")) && "sp1".equals(au.get("spieler")), "online: Einträge mit ursprünglichem Autor");
        Map<String, Object> zug = o.rufe(basis, "turnier.zugang", null, Json.obj("turnier", tid, "code", hildeCode), null);
        pruefe("helfer".equals(zug.get("rolle")), "auf der Zentrale ausgegebener Helfer-Code gilt online");
        o.rufe(basis, "events", q("turnier", tid), Json.obj("ereignisse", liste(ev("o-0000003", "test.notiz", Json.obj()))), leit);
        pruefe(true, "online nach der Rückgabe wieder beschreibbar");
        a = rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("h-0000003", "test.notiz", Json.obj()))), halle, q("turnier", tid), false);
        pruefe(a.s == 409, "auf der Zentrale nach der Rückgabe nur lesen");

        System.out.println("Erneute Übernahme und Turnier der Zentrale hochladen");
        a = rufe(z, "POST", "zentrale.uebernehmen", Json.obj("turnier", tid), null, null, true);
        pruefe(a.s == 200 && Long.valueOf(1).equals(a.g("neu")), "erneute Übernahme holt nur Neues");
        rufe(z, "POST", "zentrale.rueckgabe", Json.obj("turnier", tid), null, null, true);
        a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Nur in der Halle"), konto);
        String hid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        rufe(z, "POST", "events", Json.obj("ereignisse", liste(ev("n-0000001", "turnier.angelegt", Json.obj("name", "Nur in der Halle")))), a.t("token"), q("turnier", hid), false);
        a = rufe(z, "POST", "zentrale.rueckgabe", Json.obj("turnier", hid), null, null, true);
        pruefe(a.s == 200, "Turnier der Zentrale online angelegt");
        Map<String, Object> liste = o.rufe(basis, "turniere", null, null, vk);
        boolean da = false;
        for (Object x : Json.alsListe(liste.get("turniere"))) if (hid.equals(Json.alsObjekt(x).get("id")) && Json.alsObjekt(x).get("zentrale") == null) da = true;
        pruefe(da, "online im Konto, nicht gesperrt");
        a = rufe(z, "POST", "zentrale.turnier.loeschen", Json.obj("turnier", hid), null, null, true);
        pruefe(a.s == 200, "zurückgegebenes Turnier von der Zentrale löschen");

        System.out.println("Spielerpool");
        rufe(z, "POST", "pool.speichern", Json.obj("spieler", liste(Json.obj("id", "zp1", "vorname", "Zora", "nachname", "Z", "verein", "TTC"))), konto);
        a = rufe(z, "POST", "zentrale.pool.abgleichen", Json.obj(), null, null, true);
        pruefe(a.s == 200 && Long.valueOf(2).equals(a.g("anzahl")), "Pool abgeglichen (online + Zentrale)");
        Map<String, Object> op = o.rufe(basis, "pool", null, null, vk);
        pruefe(Json.alsListe(op.get("spieler")).size() == 2, "Pool online ergänzt");
        rufe(z, "POST", "pool.loeschen", Json.obj("ids", liste("op1")), konto);
        rufe(z, "POST", "zentrale.pool.abgleichen", Json.obj(), null, null, true);
        op = o.rufe(basis, "pool", null, null, vk);
        pruefe(Json.alsListe(op.get("spieler")).size() == 1, "Löschen auf der Zentrale wirkt online");
    }
    static void paket18() throws Exception {
        System.out.println("Paket 0.18: Posteingang und Rundmail auf der Zentrale");
        Path ordner = neuerOrdner();
        Zentrale z = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        z.setzePort(8080);
        String konto = rufe(z, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        A a = rufe(z, "POST", "turnier.anlegen", Json.obj("name", "Posteingang-Cup"), konto);
        String tid = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String leit = a.t("token");
        a = rufe(z, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(
            Json.obj("rolle", "spieler", "bezug", "sp1", "name", "Anna"), Json.obj("rolle", "spieler", "bezug", "sp2", "name", "Ben"),
            Json.obj("rolle", "helfer", "bezug", "h1", "name", "Hilde"))), leit);
        Map<String, String> codes = new LinkedHashMap<>();
        for (Object o : a.l("codes")) codes.put((String) Json.alsObjekt(o).get("bezug"), (String) Json.alsObjekt(o).get("code"));
        String anna = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("sp1")), null).t("token");
        String ben = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("sp2")), null).t("token");
        String hilde = rufe(z, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("h1")), null).t("token");
        pruefe(rufe(z, "GET", "nachrichten", null, null, q("turnier", tid), false).s == 401, "Posteingang ohne Kennung abgewiesen");
        pruefe(rufe(z, "POST", "rundmail", Json.obj("turnier", tid, "betreff", "Hallo", "text", "x", "spieler", liste("sp1")), anna).s == 403, "Rundmail nur Leitung");
        pruefe(rufe(z, "POST", "rundmail", Json.obj("turnier", tid, "betreff", "Hallo", "text", "x", "spieler", liste("../x")), leit).s == 400, "ungültige Spieler-ID abgewiesen");
        a = rufe(z, "POST", "rundmail", Json.obj("turnier", tid, "betreff", "Pause", "text", "Zehn Minuten\nPause", "spieler", liste("sp1"), "helfer", true, "mail", true), leit);
        pruefe(a.s == 200 && zahlAus(a.g("postfach")) == 2 && zahlAus(a.g("mails")) == 0, "Rundmail: Posteingang für Anna und Hilde, keine Mails auf der Zentrale");
        a = rufe(z, "GET", "nachrichten", null, anna, q("turnier", tid), false);
        Map<String, Object> n = Json.alsObjekt(a.l("nachrichten").get(0));
        pruefe(a.s == 200 && zahlAus(a.g("ungelesen")) == 1 && "Pause".equals(n.get("titel")) && "Zehn Minuten\nPause".equals(n.get("text")), "Anna sieht die Nachricht");
        pruefe(zahlAus(rufe(z, "GET", "nachrichten", null, ben, q("turnier", tid), false).g("ungelesen")) == 0, "Ben bekommt nichts");
        pruefe(zahlAus(rufe(z, "GET", "nachrichten", null, hilde, q("turnier", tid), false).g("ungelesen")) == 1, "Hilde bekommt die Nachricht");
        rufe(z, "POST", "nachrichten.gelesen", Json.obj("turnier", tid, "bis", n.get("id")), anna);
        pruefe(zahlAus(rufe(z, "GET", "nachrichten", null, anna, q("turnier", tid), false).g("ungelesen")) == 0, "gelesen markiert");
        pruefe(zahlAus(rufe(z, "GET", "nachrichten", null, hilde, q("turnier", tid), false).g("ungelesen")) == 1, "fremde bleiben ungelesen");
        a = rufe(z, "GET", "nachrichten", null, leit, q("turnier", tid), false);
        pruefe(Boolean.TRUE.equals(a.g("gesendet")) && ((String) Json.alsObjekt(a.l("nachrichten").get(0)).get("text")).contains("Posteingang: 2"), "Leitung sieht „Gesendet“");
        // nach Neustart noch da
        Zentrale z2 = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        String hilde2 = rufe(z2, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", codes.get("h1")), null).t("token");
        pruefe(zahlAus(rufe(z2, "GET", "nachrichten", null, hilde2, q("turnier", tid), false).g("ungelesen")) == 1, "Posteingang übersteht einen Neustart");
        rufe(z2, "POST", "code.entfernen", Json.obj("turnier", tid, "rolle", "helfer", "bezug", "h1"), rufe(z2, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token"));
        Zentrale z3 = new Zentrale(new Speicher(ordner), new PlattformJvm(null), new Online(2000), () -> uhr);
        String k3 = rufe(z3, "POST", "zentrale.anmelden", Json.obj(), null, null, true).t("token");
        a = rufe(z3, "POST", "codes.anlegen", Json.obj("turnier", tid, "eintraege", liste(Json.obj("rolle", "helfer", "bezug", "h1", "name", "Hilde"))), k3);
        String neu = null;
        for (Object o : a.l("codes")) if ("h1".equals(Json.alsObjekt(o).get("bezug"))) neu = (String) Json.alsObjekt(o).get("code");
        String hilde3 = rufe(z3, "POST", "turnier.zugang", Json.obj("turnier", tid, "code", neu), null).t("token");
        pruefe(zahlAus(rufe(z3, "GET", "nachrichten", null, hilde3, q("turnier", tid), false).g("ungelesen")) == 0, "Kennung entfernt: Posteingang gelöscht");

        System.out.println("Paket 0.18: Ersatzregel, Wechsel, Begleitperson auf der Zentrale");
        a = rufe(z3, "POST", "turnier.anlegen", Json.obj("name", "Ersatz-Cup"), k3);
        String et = (String) Json.alsObjekt(a.g("turnier")).get("id");
        String el = a.t("token");
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(
            ev("e-0000001", "konkurrenz.angelegt", Json.obj("id", "m", "einst", Json.obj("name", "M", "art", "mannschaft", "modus", "jgj", "mannschaft", Json.obj("system", "corbillon2", "ersatz", 1L, "wechsel", true)))),
            ev("e-0000002", "spieler.angelegt", Json.obj("id", "a1", "vorname", "A", "nachname", "1", "verein", "")),
            ev("e-0000003", "spieler.angelegt", Json.obj("id", "a2", "vorname", "A", "nachname", "2", "verein", "")),
            ev("e-0000004", "spieler.angelegt", Json.obj("id", "b1", "vorname", "B", "nachname", "1", "verein", "")),
            ev("e-0000005", "spieler.angelegt", Json.obj("id", "bl", "vorname", "Be", "nachname", "G", "verein", "", "begleitung", true)),
            ev("e-0000006", "mannschaft.gemeldet", Json.obj("konkurrenz", "m", "id", "m-aaaa", "name", "A", "spieler", liste("a1", "a2"), "fuehrer", "bl")),
            ev("e-0000007", "mannschaft.gemeldet", Json.obj("konkurrenz", "m", "id", "m-bbbb", "name", "B", "spieler", liste("b1"), "fuehrer", "b1")))), el, q("turnier", et), false);
        a = rufe(z3, "POST", "codes.anlegen", Json.obj("turnier", et, "eintraege", liste(Json.obj("rolle", "spieler", "bezug", "bl", "name", "Be G"), Json.obj("rolle", "spieler", "bezug", "b1", "name", "B 1"))), el);
        Map<String, String> ec = new LinkedHashMap<>();
        for (Object o : a.l("codes")) ec.put((String) Json.alsObjekt(o).get("bezug"), (String) Json.alsObjekt(o).get("code"));
        String bl = rufe(z3, "POST", "turnier.zugang", Json.obj("turnier", et, "code", ec.get("bl")), null).t("token");
        String b1 = rufe(z3, "POST", "turnier.zugang", Json.obj("turnier", et, "code", ec.get("b1")), null).t("token");
        String spiel = "g1-m-aaaa-m-bbbb";
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000010", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a2"), "doppel", liste(), "wechsel", Json.obj("4", "a2"))))), bl, q("turnier", et), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Begleitperson gibt die Aufstellung mit Wechsel ab");
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000011", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-bbbb", "gegner", "m-aaaa", "einzel", liste("b1", "b1"), "doppel", liste())))), b1, q("turnier", et), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Ersatzregel: doppelt besetzte Position erlaubt");
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000012", "konkurrenz.geaendert", Json.obj("id", "m", "einst", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 0L, "wechsel", false)))))), el, q("turnier", et), false);
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000013", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-bbbb", "gegner", "m-aaaa", "einzel", liste("b1", "b1"), "doppel", liste())))), b1, q("turnier", et), false);
        pruefe(abgelehnt(a, "ungueltig"), "ohne Ersatzregel abgewiesen");
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000014", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a2"), "doppel", liste(), "wechsel", Json.obj("4", "a2"))))), bl, q("turnier", et), false);
        pruefe(abgelehnt(a, "ungueltig"), "ohne Einstellung kein Wechsel");
        // Prüfung 0.18 (M1): Begleitperson mit Helferrecht stellt nicht für den Gegner auf
        rufe(z3, "POST", "code.helfer", Json.obj("turnier", et, "bezug", "bl", "helfer", true), el);
        bl = rufe(z3, "POST", "turnier.zugang", Json.obj("turnier", et, "code", ec.get("bl")), null).t("token");
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000015", "konkurrenz.geaendert", Json.obj("id", "m", "einst", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 1L, "wechsel", true)))))), el, q("turnier", et), false);
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000016", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-bbbb", "gegner", "m-aaaa", "einzel", liste("b1", "b1"), "doppel", liste())))), bl, q("turnier", et), false);
        pruefe(a.s == 200 && a.l("angenommen").isEmpty(), "Begleitperson mit Helferrecht: keine Aufstellung für den Gegner");
        // N2: Ersatzregel der Endrunde, leere Wechsel-Angabe
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000017", "konkurrenz.geaendert", Json.obj("id", "m", "einst", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 0L, "wechsel", false),
            "endrunde", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 1L, "wechsel", false))))))), el, q("turnier", et), false);
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000018", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a1"), "doppel", liste(), "wechsel", liste())))), bl, q("turnier", et), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Ersatzregel der Endrunde zählt, leere Wechsel-Angabe erlaubt");
        // N4: Zuschauer sehen die Begleitperson ohne Namen
        a = rufe(z3, "GET", "events", null, null, q("turnier", et, "ab", "0"), false);
        Map<String, Object> blz = null;
        for (Object o : a.l("ereignisse")) if ("e-0000005".equals(Json.alsObjekt(o).get("id"))) blz = Json.alsObjekt(Json.alsObjekt(o).get("daten"));
        pruefe(blz != null && "Begleitperson".equals(blz.get("vorname")) && "".equals(blz.get("nachname")), "Zuschauer: Begleitperson ohne Namen");
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000019", "spieler.geaendert", Json.obj("id", "bl", "vorname", "Bea", "nachname", "Neu")))), el, q("turnier", et), false);
        a = rufe(z3, "GET", "events", null, null, q("turnier", et, "ab", "0"), false);
        pruefe(!Json.schreiben(a.l("ereignisse")).contains("Bea") && a.g("filter") != null, "Zuschauer: auch Namensänderung der Begleitperson ohne Namen");
        a = rufe(z3, "GET", "events", null, b1, q("turnier", et, "ab", "0"), false);
        pruefe(Json.schreiben(a.l("ereignisse")).contains("Bea"), "Spieler sehen den Namen der Begleitperson");
        // N2: Endrunden-Regel nach dem Start der Vorrunde
        rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000020", "phase.gestartet", Json.obj("konkurrenz", "m", "phase", "gruppen")),
            ev("e-0000021", "konkurrenz.geaendert", Json.obj("id", "m", "einst", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 0L, "wechsel", false),
                "endrunde", Json.obj("mannschaft", Json.obj("system", "corbillon2", "ersatz", 0L, "wechsel", true))))))), el, q("turnier", et), false);
        a = rufe(z3, "POST", "events", Json.obj("ereignisse", liste(ev("e-0000022", "mannschaft.aufgestellt", Json.obj("konkurrenz", "m", "spiel", spiel, "mannschaft", "m-aaaa", "gegner", "m-bbbb", "einzel", liste("a1", "a2"), "doppel", liste(), "wechsel", Json.obj("4", "a2"))))), bl, q("turnier", et), false);
        pruefe(a.s == 200 && a.l("angenommen").size() == 1, "Wechsel der Endrunde nach Start der Vorrunde: Server lässt ihn zu");
    }

}
