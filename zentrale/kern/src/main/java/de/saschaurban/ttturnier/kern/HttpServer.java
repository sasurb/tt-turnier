package de.saschaurban.ttturnier.kern;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Sehr kleiner HTTP/1.1-Server auf einem ServerSocket (im JDK und auf Android gleich).
 * Je Verbindung eine Anfrage, danach wird geschlossen – im lokalen WLAN schnell genug
 * und robust gegen hängende Verbindungen.
 */
public final class HttpServer {
    public static final int MAX_RUMPF = 8 * 1024 * 1024;
    private static final int MAX_KOPF = 32 * 1024;

    public interface Bearbeiter {
        Antwort bearbeiten(Anfrage a);
    }

    public static final class Anfrage {
        public final String methode;
        public final String pfad;
        public final Map<String, String> query;
        /** Kopfzeilen mit kleingeschriebenen Namen */
        public final Map<String, String> kopf;
        public final byte[] rumpf;
        public final String ip;
        public final boolean vomGeraetSelbst;

        public Anfrage(String methode, String pfad, Map<String, String> query, Map<String, String> kopf, byte[] rumpf, String ip, boolean vomGeraetSelbst) {
            this.methode = methode;
            this.pfad = pfad;
            this.query = query;
            this.kopf = kopf;
            this.rumpf = rumpf;
            this.ip = ip;
            this.vomGeraetSelbst = vomGeraetSelbst;
        }
    }

    public static final class Antwort {
        public final int status;
        public final String typ;
        public final byte[] inhalt;
        public final Map<String, String> kopf = new LinkedHashMap<>();

        public Antwort(int status, String typ, byte[] inhalt) {
            this.status = status;
            this.typ = typ;
            this.inhalt = inhalt;
        }

        public static Antwort json(int status, Object daten) {
            Antwort a = new Antwort(status, "application/json; charset=utf-8", Json.schreiben(daten).getBytes(StandardCharsets.UTF_8));
            a.kopf.put("Cache-Control", "no-store");
            return a;
        }
    }

    private final Bearbeiter bearbeiter;
    private final ExecutorService pool = Executors.newFixedThreadPool(24);
    private ServerSocket socket;
    private Thread annehmer;
    private volatile boolean laeuft;

    public HttpServer(Bearbeiter bearbeiter) {
        this.bearbeiter = bearbeiter;
    }

    /** Startet auf dem ersten freien Port ab {@code port} (höchstens 10 Versuche). Liefert den Port. */
    public synchronized int starten(String bindAdresse, int port) throws IOException {
        IOException letzter = null;
        for (int p = port; p < port + 10; p++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(bindAdresse == null ? new InetSocketAddress(p) : new InetSocketAddress(InetAddress.getByName(bindAdresse), p), 64);
                socket = s;
                break;
            } catch (IOException x) {
                letzter = x;
            }
        }
        if (socket == null) throw letzter != null ? letzter : new IOException("kein freier Port");
        laeuft = true;
        annehmer = new Thread(this::annehmen, "tt-http");
        annehmer.setDaemon(true);
        annehmer.start();
        return socket.getLocalPort();
    }

    public int port() {
        return socket == null ? -1 : socket.getLocalPort();
    }

    public synchronized void stoppen() {
        laeuft = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignoriert) {
            // egal
        }
        pool.shutdownNow();
        try {
            pool.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException ignoriert) {
            Thread.currentThread().interrupt();
        }
    }

    private void annehmen() {
        while (laeuft) {
            try {
                Socket s = socket.accept();
                s.setSoTimeout(15_000);
                pool.execute(() -> verbindung(s));
            } catch (SocketException x) {
                if (!laeuft) return;
            } catch (IOException x) {
                // weiter annehmen
            } catch (RuntimeException x) {
                // Pool beendet
                if (!laeuft) return;
            }
        }
    }

    private void verbindung(Socket s) {
        try (Socket sock = s) {
            InputStream ein = new BufferedInputStream(sock.getInputStream());
            OutputStream aus = sock.getOutputStream();
            Antwort antwort;
            Anfrage anfrage = null;
            try {
                anfrage = lesen(ein, sock);
                antwort = anfrage == null ? null : bearbeiter.bearbeiten(anfrage);
            } catch (ZuGross x) {
                antwort = Antwort.json(413, Json.obj("fehler", "ungueltig", "meldung", "Anfrage zu groß."));
            } catch (IOException x) {
                return;
            } catch (RuntimeException x) {
                antwort = Antwort.json(500, Json.obj("fehler", "serverfehler", "meldung", "Interner Fehler auf der Zentrale."));
            }
            if (antwort == null) return;
            schreiben(aus, antwort, anfrage != null && "HEAD".equals(anfrage.methode));
        } catch (IOException ignoriert) {
            // Gerät hat die Verbindung getrennt
        }
    }

    private static final class ZuGross extends IOException {}

    private static String zeile(InputStream ein, int[] gelesen) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = ein.read()) != -1) {
            if (++gelesen[0] > MAX_KOPF) throw new ZuGross();
            if (c == '\n') break;
            if (c != '\r') b.write(c);
        }
        if (c == -1 && b.size() == 0) return null;
        return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
    }

    private static Anfrage lesen(InputStream ein, Socket sock) throws IOException {
        int[] gelesen = {0};
        String erste = zeile(ein, gelesen);
        if (erste == null || erste.isEmpty()) return null;
        String[] teile = erste.split(" ");
        if (teile.length < 2) return null;
        String methode = teile[0].toUpperCase(Locale.ROOT);
        String ziel = teile[1];
        Map<String, String> kopf = new LinkedHashMap<>();
        String z;
        while ((z = zeile(ein, gelesen)) != null && !z.isEmpty()) {
            int p = z.indexOf(':');
            if (p > 0) kopf.put(z.substring(0, p).trim().toLowerCase(Locale.ROOT), z.substring(p + 1).trim());
        }
        int laenge = 0;
        String cl = kopf.get("content-length");
        if (cl != null) {
            try {
                laenge = Integer.parseInt(cl.trim());
            } catch (NumberFormatException x) {
                laenge = 0;
            }
        }
        if (laenge < 0 || laenge > MAX_RUMPF) throw new ZuGross();
        byte[] rumpf = new byte[laenge];
        int n = 0;
        while (n < laenge) {
            int r = ein.read(rumpf, n, laenge - n);
            if (r < 0) throw new IOException("Verbindung beendet");
            n += r;
        }
        String pfad = ziel;
        String qs = "";
        int q = ziel.indexOf('?');
        if (q >= 0) {
            pfad = ziel.substring(0, q);
            qs = ziel.substring(q + 1);
        }
        Map<String, String> query = new LinkedHashMap<>();
        for (String paar : qs.split("&")) {
            if (paar.isEmpty()) continue;
            int g = paar.indexOf('=');
            String k = g < 0 ? paar : paar.substring(0, g);
            String v = g < 0 ? "" : paar.substring(g + 1);
            try {
                query.put(URLDecoder.decode(k, "UTF-8"), URLDecoder.decode(v, "UTF-8"));
            } catch (IllegalArgumentException x) {
                // fehlerhafte Kodierung überspringen
            }
        }
        try {
            pfad = URLDecoder.decode(pfad.replace("+", "%2B"), "UTF-8");
        } catch (IllegalArgumentException x) {
            return null;
        }
        InetAddress gegen = sock.getInetAddress();
        boolean selbst = gegen != null && gegen.isLoopbackAddress();
        String ip = gegen == null ? "?" : gegen.getHostAddress();
        return new Anfrage(methode, pfad, query, kopf, rumpf, ip, selbst);
    }

    private static String statusText(int s) {
        switch (s) {
            case 200: return "OK";
            case 204: return "No Content";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 413: return "Payload Too Large";
            case 429: return "Too Many Requests";
            case 503: return "Service Unavailable";
            default: return s >= 500 ? "Server Error" : "OK";
        }
    }

    private static void schreiben(OutputStream aus, Antwort a, boolean nurKopf) throws IOException {
        StringBuilder k = new StringBuilder();
        k.append("HTTP/1.1 ").append(a.status).append(' ').append(statusText(a.status)).append("\r\n");
        k.append("Content-Type: ").append(a.typ).append("\r\n");
        k.append("Content-Length: ").append(a.inhalt.length).append("\r\n");
        k.append("Connection: close\r\n");
        k.append("X-Content-Type-Options: nosniff\r\n");
        for (Map.Entry<String, String> e : a.kopf.entrySet()) k.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        k.append("\r\n");
        aus.write(k.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (!nurKopf) aus.write(a.inhalt);
        aus.flush();
    }
}
