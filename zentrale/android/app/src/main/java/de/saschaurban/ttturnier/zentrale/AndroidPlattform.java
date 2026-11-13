package de.saschaurban.ttturnier.zentrale;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.SoftApConfiguration;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import de.saschaurban.ttturnier.kern.Json;
import de.saschaurban.ttturnier.kern.Plattform;
import de.saschaurban.ttturnier.kern.PlattformJvm;

/** Systemfunktionen von Android für die Zentrale. */
final class AndroidPlattform implements Plattform {
    private static final String TAG = "tt-zentrale";
    private final Context ctx;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    private final ZentraleDienst dienst;

    private volatile WifiManager.LocalOnlyHotspotReservation reservierung;
    private volatile String hotspotSsid;
    private volatile String hotspotPasswort;

    AndroidPlattform(ZentraleDienst dienst) {
        this.dienst = dienst;
        this.ctx = dienst.getApplicationContext();
    }

    @Override
    public byte[] datei(String pfad) {
        try (InputStream in = ctx.getAssets().open("www/" + pfad)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] puffer = new byte[16384];
            int n;
            while ((n = in.read(puffer)) > 0) b.write(puffer, 0, n);
            return b.toByteArray();
        } catch (IOException x) {
            return null;
        }
    }

    @Override
    public List<String> adressen() {
        return PlattformJvm.adressenAusSchnittstellen();
    }

    @Override
    public boolean internet() {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network n = cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private boolean hotspotBerechtigung() {
        String recht = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
        return ctx.checkSelfPermission(recht) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public Map<String, Object> hotspot(boolean an) {
        if (!an) {
            WifiManager.LocalOnlyHotspotReservation r = reservierung;
            if (r != null) r.close();
            reservierung = null;
            hotspotSsid = hotspotPasswort = null;
            return hotspotStatus();
        }
        if (reservierung != null) return hotspotStatus();
        if (!hotspotBerechtigung()) {
            HauptActivity.berechtigungAnfragen();
            return meldung("Bitte die Berechtigung „Geräte in der Nähe“ erlauben und dann erneut tippen.");
        }
        WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
        if (wm == null) return meldung("WLAN ist auf diesem Gerät nicht verfügbar.");
        final CountDownLatch fertig = new CountDownLatch(1);
        final String[] fehler = {null};
        haupt.post(() -> {
            try {
                startenMitBerechtigung(wm, fertig, fehler);
            } catch (SecurityException | IllegalStateException x) {
                fehler[0] = "Android erlaubt den Hotspot gerade nicht (" + x.getMessage() + ").";
                fertig.countDown();
            }
        });
        try {
            if (!fertig.await(15, TimeUnit.SECONDS)) return meldung("Der Hotspot hat nicht rechtzeitig reagiert.");
        } catch (InterruptedException x) {
            Thread.currentThread().interrupt();
        }
        return fehler[0] != null ? meldung(fehler[0]) : hotspotStatus();
    }

    @SuppressLint("MissingPermission")
    private void startenMitBerechtigung(WifiManager wm, CountDownLatch fertig, String[] fehler) {
        wm.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
            @Override
            public void onStarted(WifiManager.LocalOnlyHotspotReservation r) {
                reservierung = r;
                lesen(r);
                fertig.countDown();
            }

            @Override
            public void onStopped() {
                reservierung = null;
                hotspotSsid = hotspotPasswort = null;
            }

            @Override
            public void onFailed(int grund) {
                fehler[0] = grund == ERROR_TETHERING_DISALLOWED
                    ? "Der Hotspot ist auf diesem Gerät gesperrt."
                    : grund == ERROR_INCOMPATIBLE_MODE
                        ? "Bitte zuerst den normalen Hotspot ausschalten – beide gleichzeitig gehen nicht."
                        : "Der Hotspot konnte nicht gestartet werden (Grund " + grund + ").";
                fertig.countDown();
            }
        }, haupt);
    }

    @SuppressWarnings("deprecation")
    private void lesen(WifiManager.LocalOnlyHotspotReservation r) {
        if (Build.VERSION.SDK_INT >= 30) {
            SoftApConfiguration c = r.getSoftApConfiguration();
            hotspotSsid = c.getSsid();
            hotspotPasswort = c.getPassphrase();
        } else {
            WifiConfiguration c = r.getWifiConfiguration();
            hotspotSsid = c == null ? null : c.SSID;
            hotspotPasswort = c == null ? null : c.preSharedKey;
        }
        if (hotspotSsid != null && hotspotSsid.startsWith("\"") && hotspotSsid.endsWith("\"") && hotspotSsid.length() > 1) {
            hotspotSsid = hotspotSsid.substring(1, hotspotSsid.length() - 1);
        }
    }

    private Map<String, Object> meldung(String text) {
        Map<String, Object> m = hotspotStatus();
        m.put("meldung", text);
        return m;
    }

    @Override
    public Map<String, Object> hotspotStatus() {
        return Json.obj("aktiv", reservierung != null, "ssid", hotspotSsid, "passwort", hotspotPasswort, "moeglich", true);
    }

    @Override
    public boolean oeffnen(String ziel) {
        Intent i;
        switch (ziel) {
            case "hotspot":
                i = new Intent().setComponent(new ComponentName("com.android.settings", "com.android.settings.TetherSettings"));
                if (!starten(i)) return starten(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                return true;
            case "akku":
                @SuppressLint("BatteryLife")
                Intent a = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
                if (!starten(a)) return starten(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                return true;
            case "wlan":
                return starten(new Intent(Settings.ACTION_WIFI_SETTINGS));
            default:
                return false;
        }
    }

    private boolean starten(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException x) {
            return false;
        }
    }

    @Override
    public boolean akkuAusnahme() {
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
    }

    @Override
    public void geraeteGeaendert(int anzahl) {
        haupt.post(() -> dienst.benachrichtigen(anzahl));
    }

    @Override
    public void protokoll(String text) {
        Log.i(TAG, text);
    }
}
