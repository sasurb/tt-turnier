package de.saschaurban.ttturnier.kern;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Zugriff der Zentrale auf den Online-Server (PHP auf dem Webspace), sobald Internet da ist. */
public class Online {
    /** Fehler vom Online-Server oder keine Verbindung ({@code code = "netzwerk"}). */
    public static final class Fehler extends Exception {
        public final String code;
        public final int status;

        public Fehler(String code, String meldung, int status) {
            super(meldung);
            this.code = code;
            this.status = status;
        }

        public boolean netzwerk() {
            return "netzwerk".equals(code);
        }
    }

    private final int zeitlimitMs;

    public Online(int zeitlimitMs) {
        this.zeitlimitMs = zeitlimitMs;
    }

    /**
     * Ruft {@code basis?r=route&…} auf. {@code rumpf == null} → GET, sonst POST mit JSON.
     * Antwort ist das JSON-Objekt; bei HTTP ≥ 400 wird {@link Fehler} geworfen.
     */
    public Map<String, Object> rufe(String basis, String route, Map<String, String> query, Object rumpf, String token) throws Fehler {
        StringBuilder u = new StringBuilder(basis).append(basis.contains("?") ? '&' : '?').append("r=").append(kodieren(route));
        if (query != null) for (Map.Entry<String, String> e : query.entrySet()) {
            u.append('&').append(kodieren(e.getKey())).append('=').append(kodieren(e.getValue()));
        }
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(u.toString()).openConnection();
            c.setConnectTimeout(zeitlimitMs);
            c.setReadTimeout(zeitlimitMs * 3);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            if (token != null) c.setRequestProperty("X-TT-Token", token);
            if (rumpf != null) {
                byte[] b = Json.schreiben(rumpf).getBytes(StandardCharsets.UTF_8);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream o = c.getOutputStream()) {
                    o.write(b);
                }
            } else {
                c.setRequestMethod("GET");
            }
            int status = c.getResponseCode();
            InputStream ein = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = ein == null ? "" : lesen(ein);
            Map<String, Object> daten;
            try {
                daten = Json.objekt(text);
            } catch (Json.Fehler x) {
                throw new Fehler(status >= 400 ? "netzwerk" : "serverfehler", "Antwort des Online-Servers ist kein JSON (HTTP " + status + ").", status);
            }
            if (status >= 400) {
                String code = Json.alsText(daten.get("fehler"));
                String meldung = Json.alsText(daten.get("meldung"));
                throw new Fehler(code == null ? "serverfehler" : code, meldung == null ? "Fehler " + status : meldung, status);
            }
            return daten;
        } catch (IOException x) {
            throw new Fehler("netzwerk", "Keine Verbindung zum Online-Server.", 0);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String kodieren(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (java.io.UnsupportedEncodingException x) {
            throw new IllegalStateException(x);
        }
    }

    private static String lesen(InputStream ein) throws IOException {
        try (InputStream i = ein) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] puffer = new byte[8192];
            int n;
            while ((n = i.read(puffer)) > 0) b.write(puffer, 0, n);
            return new String(b.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
