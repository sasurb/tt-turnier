package de.saschaurban.ttturnier.kern;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Startet die Zentrale im JDK (für Tests und zum Ausprobieren am PC):
 * <pre>
 *   java -cp build de.saschaurban.ttturnier.kern.Start --daten /tmp/z --app ../../app/dist --port 8080
 * </pre>
 * Optionen: --bind ADRESSE (Standard: alle), --takt MILLISEKUNDEN (Standard 15000).
 */
public final class Start {
    private Start() {}

    public static void main(String[] args) throws Exception {
        Path daten = Paths.get("zentrale-daten");
        Path app = null;
        int port = 8080;
        String bind = null;
        long takt = 15_000;
        for (int i = 0; i + 1 < args.length; i += 2) {
            switch (args[i]) {
                case "--daten": daten = Paths.get(args[i + 1]); break;
                case "--app": app = Paths.get(args[i + 1]).toAbsolutePath(); break;
                case "--port": port = Integer.parseInt(args[i + 1]); break;
                case "--bind": bind = args[i + 1]; break;
                case "--takt": takt = Long.parseLong(args[i + 1]); break;
                default: throw new IllegalArgumentException("Unbekannte Option " + args[i]);
            }
        }
        Zentrale z = new Zentrale(new Speicher(daten), new PlattformJvm(app));
        HttpServer h = new HttpServer(z);
        int p = h.starten(bind, port);
        z.setzePort(p);
        System.out.println("Zentrale läuft auf Port " + p + " · Daten: " + daten.toAbsolutePath());
        final long abstand = takt;
        Thread t = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(abstand);
                } catch (InterruptedException x) {
                    return;
                }
                z.takt();
            }
        }, "tt-takt");
        t.setDaemon(true);
        t.start();
        Thread.currentThread().join();
    }
}
