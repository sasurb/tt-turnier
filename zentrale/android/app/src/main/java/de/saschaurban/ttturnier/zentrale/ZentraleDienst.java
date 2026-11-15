package de.saschaurban.ttturnier.zentrale;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import de.saschaurban.ttturnier.kern.HttpServer;
import de.saschaurban.ttturnier.kern.Speicher;
import de.saschaurban.ttturnier.kern.Zentrale;

/**
 * Vordergrunddienst: hält den Turnier-Server am Laufen, auch wenn der Bildschirm aus ist
 * oder die App im Hintergrund liegt. Erkennbar an der Benachrichtigung „Zentrale läuft“.
 */
public final class ZentraleDienst extends Service {
    static final String AKTION_BEENDEN = "de.saschaurban.ttturnier.zentrale.BEENDEN";
    private static final String KANAL = "zentrale";
    private static final int NR = 1;
    /** Bevorzugter Port; ist er belegt, nimmt der Server den nächsten freien. */
    private static final int PORT = 8080;

    /** Port des laufenden Servers, 0 = startet noch, -1 = Fehler */
    static volatile int port = 0;
    /** Adresse mit Geheimnis, mit der die WebView die App öffnet (nur diese App kennt sie) */
    static volatile String startAdresse = null;
    static volatile String fehler = null;

    private HttpServer server;
    private Zentrale zentrale;
    private ScheduledExecutorService takt;
    private PowerManager.WakeLock wachHalten;
    private WifiManager.WifiLock wlanHalten;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel k = new NotificationChannel(KANAL, "Zentrale", NotificationManager.IMPORTANCE_LOW);
        k.setDescription("Zeigt, dass die Zentrale läuft");
        nm.createNotificationChannel(k);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && AKTION_BEENDEN.equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = benachrichtigung(0);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NR, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NR, n);
        }
        if (server == null) starten();
        return START_STICKY;
    }

    private void starten() {
        port = 0;
        fehler = null;
        new Thread(() -> {
            try {
                AndroidPlattform plattform = new AndroidPlattform(this);
                zentrale = new Zentrale(new Speicher(new File(getFilesDir(), "zentrale").toPath()), plattform);
                server = new HttpServer(zentrale);
                int p = server.starten(null, PORT);
                zentrale.setzePort(p);
                startAdresse = zentrale.startAdresse();
                port = p;
                takt = Executors.newSingleThreadScheduledExecutor();
                takt.scheduleWithFixedDelay(() -> zentrale.takt(), 5, 15, TimeUnit.SECONDS);
                Log.i("tt-zentrale", "Server läuft auf Port " + p);
            } catch (IOException | RuntimeException x) {
                fehler = String.valueOf(x.getMessage());
                port = -1;
                Log.e("tt-zentrale", "Start fehlgeschlagen", x);
            }
        }, "tt-start").start();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wachHalten = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tt-zentrale:server");
        wachHalten.setReferenceCounted(false);
        wachHalten.acquire();
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            @SuppressWarnings("deprecation")
            int modus = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wlanHalten = wm.createWifiLock(modus, "tt-zentrale:wlan");
            wlanHalten.setReferenceCounted(false);
            wlanHalten.acquire();
        }
    }

    Notification benachrichtigung(int geraete) {
        PendingIntent oeffnen = PendingIntent.getActivity(this, 0, new Intent(this, HauptActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent beenden = PendingIntent.getService(this, 1, new Intent(this, ZentraleDienst.class).setAction(AKTION_BEENDEN),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String text = geraete == 0 ? "Wartet auf Geräte im WLAN" : geraete == 1 ? "1 Gerät verbunden" : geraete + " Geräte verbunden";
        return new Notification.Builder(this, KANAL)
            .setSmallIcon(R.drawable.ic_benachrichtigung)
            .setContentTitle("Zentrale läuft")
            .setContentText(text)
            .setContentIntent(oeffnen)
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Beenden", beenden).build())
            .build();
    }

    void benachrichtigen(int geraete) {
        if (server == null) return;
        getSystemService(NotificationManager.class).notify(NR, benachrichtigung(geraete));
    }

    @Override
    public void onDestroy() {
        if (takt != null) takt.shutdownNow();
        if (server != null) server.stoppen();
        server = null;
        port = 0;
        if (wachHalten != null && wachHalten.isHeld()) wachHalten.release();
        if (wlanHalten != null && wlanHalten.isHeld()) wlanHalten.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
