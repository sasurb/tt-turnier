package de.saschaurban.ttturnier.kern;

import java.io.BufferedReader;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Ablage der Zentrale in einem Ordner – ohne Datenbank, damit derselbe Code auf Android und
 * im JDK läuft und robust bleibt, wenn der Akku leer ist:
 * <pre>
 *   zentrale.json            Einstellungen der Zentrale
 *   sitzungen.json           Anmeldungen (nur Hash der Tokens)
 *   pool.json                Spielerpool
 *   warteschlange.json       noch nicht versendete Sicherungen
 *   turniere/&lt;id&gt;/turnier.json     Kopfdaten
 *   turniere/&lt;id&gt;/codes.json       Spieler-/Helfer-Codes
 *   turniere/&lt;id&gt;/ereignisse.jsonl Ereignisse, eine Zeile je Ereignis, nur angehängt
 * </pre>
 * Dateien werden über eine temporäre Datei ersetzt; Ereignisse werden angehängt und sofort
 * auf den Datenträger geschrieben.
 */
public final class Speicher {
    private final Path ordner;

    public Speicher(Path ordner) {
        this.ordner = ordner;
        try {
            Files.createDirectories(ordner.resolve("turniere"));
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
    }

    public Path ordner() {
        return ordner;
    }

    /** Ein Turnier im Arbeitsspeicher. */
    public static final class Turnier {
        public final String id;
        /** Kopfdaten (name, datum, angelegt, sicherungAn, …) */
        public final Map<String, Object> kopf;
        public final List<Map<String, Object>> ereignisse = new ArrayList<>();
        public final Map<String, Integer> index = new HashMap<>();
        public final List<Map<String, Object>> codes = new ArrayList<>();
        /** Posteingang je Kennung (ab 0.18): { id, rolle, bezug, art, titel, text, von, zeit, gelesen } */
        public final List<Map<String, Object>> nachrichten = new ArrayList<>();

        public Turnier(String id, Map<String, Object> kopf) {
            this.id = id;
            this.kopf = kopf;
        }

        public long hoechsteSeq() {
            return ereignisse.isEmpty() ? 0 : ((Number) ereignisse.get(ereignisse.size() - 1).get("seq")).longValue();
        }

        public void aufnehmen(Map<String, Object> e) {
            index.put((String) e.get("id"), ereignisse.size());
            ereignisse.add(e);
        }
    }

    /* ---------------- Dateien ---------------- */

    private static void schreibenAtomar(Path ziel, String inhalt) {
        try {
            Path tmp = ziel.resolveSibling(ziel.getFileName() + ".tmp");
            try (FileOutputStream f = new FileOutputStream(tmp.toFile())) {
                f.write(inhalt.getBytes(StandardCharsets.UTF_8));
                f.getFD().sync();
            }
            try {
                Files.move(tmp, ziel, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException x) {
                Files.move(tmp, ziel, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
    }

    private static Object lesenJson(Path p) {
        if (!Files.isRegularFile(p)) return null;
        try {
            return Json.lesen(new String(Files.readAllBytes(p), StandardCharsets.UTF_8));
        } catch (IOException | Json.Fehler x) {
            return null;
        }
    }

    public Map<String, Object> ladeObjekt(String name) {
        Map<String, Object> m = Json.alsObjekt(lesenJson(ordner.resolve(name)));
        return m == null ? new LinkedHashMap<>() : m;
    }

    public void speichereObjekt(String name, Object inhalt) {
        schreibenAtomar(ordner.resolve(name), Json.schreiben(inhalt));
    }

    private Path turnierOrdner(String id) {
        return ordner.resolve("turniere").resolve(id);
    }

    /** Alle Turniere einlesen (beim Start). Beschädigte Zeilen am Ende des Journals werden übersprungen. */
    public Map<String, Turnier> ladeTurniere() {
        Map<String, Turnier> alle = new LinkedHashMap<>();
        try (DirectoryStream<Path> d = Files.newDirectoryStream(ordner.resolve("turniere"))) {
            for (Path p : d) {
                if (!Files.isDirectory(p)) continue;
                String id = p.getFileName().toString();
                Map<String, Object> kopf = Json.alsObjekt(lesenJson(p.resolve("turnier.json")));
                if (kopf == null) continue;
                Turnier t = new Turnier(id, kopf);
                List<Object> codes = Json.alsListe(lesenJson(p.resolve("codes.json")));
                if (codes != null) for (Object c : codes) {
                    Map<String, Object> m = Json.alsObjekt(c);
                    if (m != null) t.codes.add(m);
                }
                List<Object> nachrichten = Files.isRegularFile(p.resolve("nachrichten.json")) ? Json.alsListe(lesenJson(p.resolve("nachrichten.json"))) : null;
                if (nachrichten != null) for (Object n : nachrichten) {
                    Map<String, Object> m = Json.alsObjekt(n);
                    if (m != null) t.nachrichten.add(m);
                }
                Path j = p.resolve("ereignisse.jsonl");
                if (Files.isRegularFile(j)) {
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(Files.newInputStream(j), StandardCharsets.UTF_8))) {
                        String z;
                        while ((z = r.readLine()) != null) {
                            if (z.trim().isEmpty()) continue;
                            try {
                                Map<String, Object> e = Json.objekt(z);
                                if (e.get("id") instanceof String && e.get("seq") instanceof Long && !t.index.containsKey(e.get("id"))) {
                                    t.aufnehmen(e);
                                }
                            } catch (Json.Fehler x) {
                                // halb geschriebene Zeile (z. B. Akku leer) – überspringen
                            }
                        }
                    }
                }
                alle.put(id, t);
            }
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
        return alle;
    }

    public void turnierAnlegen(Turnier t) {
        try {
            Files.createDirectories(turnierOrdner(t.id));
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
        kopfSpeichern(t);
        codesSpeichern(t);
    }

    public void kopfSpeichern(Turnier t) {
        schreibenAtomar(turnierOrdner(t.id).resolve("turnier.json"), Json.schreiben(t.kopf));
    }

    public void nachrichtenSpeichern(Turnier t) {
        schreibenAtomar(turnierOrdner(t.id).resolve("nachrichten.json"), Json.schreiben(t.nachrichten));
    }

    public void codesSpeichern(Turnier t) {
        schreibenAtomar(turnierOrdner(t.id).resolve("codes.json"), Json.schreiben(t.codes));
    }

    public void ereignisseAnhaengen(Turnier t, List<Map<String, Object>> neu) {
        if (neu.isEmpty()) return;
        StringBuilder b = new StringBuilder();
        for (Map<String, Object> e : neu) b.append(Json.schreiben(e)).append('\n');
        try (FileOutputStream f = new FileOutputStream(turnierOrdner(t.id).resolve("ereignisse.jsonl").toFile(), true)) {
            f.write(b.toString().getBytes(StandardCharsets.UTF_8));
            f.getFD().sync();
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
    }

    /** Journal komplett neu schreiben (z. B. nach der Rückgabe, wenn Markierungen sich ändern). */
    public void ereignisseNeuSchreiben(Turnier t) {
        StringBuilder b = new StringBuilder();
        for (Map<String, Object> e : t.ereignisse) b.append(Json.schreiben(e)).append('\n');
        schreibenAtomar(turnierOrdner(t.id).resolve("ereignisse.jsonl"), b.toString());
    }

    public void turnierLoeschen(String id) {
        Path p = turnierOrdner(id);
        try {
            if (!Files.isDirectory(p)) return;
            try (DirectoryStream<Path> d = Files.newDirectoryStream(p)) {
                for (Path f : d) Files.deleteIfExists(f);
            }
            Files.deleteIfExists(p);
        } catch (IOException x) {
            throw new UncheckedIOException(x);
        }
    }
}
