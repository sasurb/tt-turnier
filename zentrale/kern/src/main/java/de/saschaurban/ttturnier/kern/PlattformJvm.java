package de.saschaurban.ttturnier.kern;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Plattform für Tests und den Betrieb am PC: App-Dateien aus einem Ordner, kein Hotspot. */
public class PlattformJvm implements Plattform {
    private final Path appOrdner;
    public volatile boolean internet = true;
    public volatile int geraete;

    public PlattformJvm(Path appOrdner) {
        this.appOrdner = appOrdner;
    }

    @Override
    public byte[] datei(String pfad) {
        if (appOrdner == null) return null;
        Path p = appOrdner.resolve(pfad).normalize();
        if (!p.startsWith(appOrdner.normalize()) || !Files.isRegularFile(p)) return null;
        try {
            return Files.readAllBytes(p);
        } catch (IOException x) {
            return null;
        }
    }

    @Override
    public List<String> adressen() {
        return adressenAusSchnittstellen();
    }

    /** Alle IPv4-Adressen außer Loopback; Hotspot-Schnittstellen (ap, swlan) zuerst, dann WLAN. */
    public static List<String> adressenAusSchnittstellen() {
        List<String[]> gefunden = new ArrayList<>();
        try {
            for (NetworkInterface n : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!n.isUp() || n.isLoopback()) continue;
                String name = n.getName() == null ? "" : n.getName();
                for (InetAddress a : Collections.list(n.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress() && !a.isLinkLocalAddress()) {
                        gefunden.add(new String[] {rang(name), a.getHostAddress()});
                    }
                }
            }
        } catch (SocketException x) {
            // keine Netzwerkschnittstellen lesbar
        }
        gefunden.sort((x, y) -> x[0].compareTo(y[0]));
        List<String> aus = new ArrayList<>();
        for (String[] g : gefunden) if (!aus.contains(g[1])) aus.add(g[1]);
        return aus;
    }

    private static String rang(String name) {
        if (name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("softap")) return "1" + name;
        if (name.startsWith("wlan")) return "2" + name;
        if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("tun")) return "9" + name;
        return "5" + name;
    }

    @Override
    public boolean internet() {
        return internet;
    }

    @Override
    public Map<String, Object> hotspot(boolean an) {
        return Json.obj("aktiv", false, "ssid", null, "passwort", null, "meldung", "Auf diesem Gerät nicht verfügbar.");
    }

    @Override
    public Map<String, Object> hotspotStatus() {
        return Json.obj("aktiv", false, "ssid", null, "passwort", null, "moeglich", false);
    }

    @Override
    public boolean oeffnen(String ziel) {
        return false;
    }

    @Override
    public boolean akkuAusnahme() {
        return true;
    }

    @Override
    public void geraeteGeaendert(int anzahl) {
        geraete = anzahl;
    }

    @Override
    public void protokoll(String text) {
        System.err.println("[zentrale] " + text);
    }
}
