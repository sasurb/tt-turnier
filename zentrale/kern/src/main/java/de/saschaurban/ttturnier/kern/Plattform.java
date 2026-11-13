package de.saschaurban.ttturnier.kern;

import java.util.List;
import java.util.Map;

/**
 * Was die Zentrale vom Gerät braucht. Android setzt das mit echten Systemfunktionen um,
 * die Tests im JDK mit einfachen Ersatzteilen ({@link PlattformJvm}).
 */
public interface Plattform {
    /** Datei der App (z. B. "index.html", "assets/x.js") oder null. */
    byte[] datei(String pfad);

    /** IPv4-Adressen dieses Geräts im WLAN, die beste zuerst (Hotspot vor WLAN). */
    List<String> adressen();

    /** Hat das Gerät gerade Internet? (Schätzung; der eigentliche Versuch entscheidet.) */
    boolean internet();

    /** Lokalen Hotspot ein-/ausschalten. Liefert {aktiv, ssid, passwort, meldung}. */
    Map<String, Object> hotspot(boolean an);

    /** Aktueller Zustand des lokalen Hotspots {aktiv, ssid, passwort, moeglich}. */
    Map<String, Object> hotspotStatus();

    /** Systemeinstellungen öffnen: "hotspot", "akku", "wlan". true = geöffnet. */
    boolean oeffnen(String ziel);

    /** Ist die Zentrale von der Akku-Optimierung ausgenommen (läuft auch bei ausgeschaltetem Bildschirm)? */
    boolean akkuAusnahme();

    /** Anzahl der Geräte, die in den letzten Minuten zugegriffen haben (für die Benachrichtigung). */
    void geraeteGeaendert(int anzahl);

    void protokoll(String text);
}
