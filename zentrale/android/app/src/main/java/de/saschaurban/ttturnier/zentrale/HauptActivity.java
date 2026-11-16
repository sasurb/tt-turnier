package de.saschaurban.ttturnier.zentrale;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Bildschirm der Zentrale: startet den Dienst und zeigt die Turnier-App (dieselbe wie im Browser)
 * von http://127.0.0.1 in einer WebView. Dort ist dieses Gerät automatisch als Zentrale angemeldet.
 */
public final class HauptActivity extends Activity {
    private static final int DATEI_WAHL = 7;
    private static final int RECHTE = 8;
    private static WeakReference<HauptActivity> aktuell = new WeakReference<>(null);

    private final Handler haupt = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView hinweis;
    private ValueCallback<Uri[]> dateiRueckruf;
    private boolean geladen;

    /** Vom Server aus: Berechtigung für den Hotspot anfragen (falls die App sichtbar ist). */
    static void berechtigungAnfragen() {
        HauptActivity a = aktuell.get();
        if (a == null) return;
        a.runOnUiThread(() -> a.rechteAnfragen(true));
    }

    @Override
    protected void onCreate(Bundle zustand) {
        super.onCreate(zustand);
        aktuell = new WeakReference<>(this);

        FrameLayout wurzel = new FrameLayout(this);
        wurzel.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        hinweis = new TextView(this);
        hinweis.setText("Zentrale startet …");
        hinweis.setTextSize(18);
        hinweis.setGravity(Gravity.CENTER);
        wurzel.addView(web, new FrameLayout.LayoutParams(-1, -1));
        wurzel.addView(hinweis, new FrameLayout.LayoutParams(-1, -1));
        web.setVisibility(View.INVISIBLE);
        // Android 15 zeichnet randlos: Statusleiste und Navigationsleiste freihalten
        wurzel.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            }
            return insets;
        });
        setContentView(wurzel);
        webEinrichten();

        rechteAnfragen(false);
        Intent dienst = new Intent(this, ZentraleDienst.class);
        startForegroundService(dienst);
        warten();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void webEinrichten() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bruecke(), "TTNativ");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())) return false;
                // Externe Links (Online-Server, mailto:, tel:) im passenden Programm öffnen
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException x) {
                    // nichts dafür installiert
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                web.setVisibility(View.VISIBLE);
                hinweis.setVisibility(View.GONE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> rueckruf, FileChooserParams p) {
                if (dateiRueckruf != null) dateiRueckruf.onReceiveValue(null);
                dateiRueckruf = rueckruf;
                try {
                    startActivityForResult(p.createIntent(), DATEI_WAHL);
                } catch (ActivityNotFoundException x) {
                    dateiRueckruf = null;
                    return false;
                }
                return true;
            }
        });
    }

    /** Wartet, bis der Server seinen Port kennt, und lädt dann die App. */
    private void warten() {
        int p = ZentraleDienst.port;
        if (p > 0) {
            if (!geladen) {
                geladen = true;
                String adresse = ZentraleDienst.startAdresse;
                web.loadUrl(adresse != null ? adresse : "http://127.0.0.1:" + p + "/");
            }
        } else if (p < 0) {
            hinweis.setText("Die Zentrale konnte nicht starten:\n" + ZentraleDienst.fehler);
        } else {
            haupt.postDelayed(this::warten, 150);
        }
    }

    private void rechteAnfragen(boolean hotspot) {
        List<String> fehlt = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            fehlt.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (hotspot) {
            String recht = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.NEARBY_WIFI_DEVICES : Manifest.permission.ACCESS_FINE_LOCATION;
            if (checkSelfPermission(recht) != PackageManager.PERMISSION_GRANTED) fehlt.add(recht);
        }
        if (!fehlt.isEmpty()) requestPermissions(fehlt.toArray(new String[0]), RECHTE);
    }

    @Override
    protected void onActivityResult(int code, int ergebnis, Intent daten) {
        if (code == DATEI_WAHL && dateiRueckruf != null) {
            dateiRueckruf.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(ergebnis, daten));
            dateiRueckruf = null;
            return;
        }
        super.onActivityResult(code, ergebnis, daten);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // Zentrale läuft weiter; beenden über die Benachrichtigung
    }

    @Override
    protected void onResume() {
        super.onResume();
        aktuell = new WeakReference<>(this);
        if (ZentraleDienst.port == 0 && geladen) {
            // Dienst wurde beendet (z. B. über die Benachrichtigung) und die App wieder geöffnet
            geladen = false;
            startForegroundService(new Intent(this, ZentraleDienst.class));
            warten();
        }
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Für die App im WebView: Teilen über Android (Blob-Downloads gibt es in der WebView nicht). */
    private final class Bruecke {
        @JavascriptInterface
        public void dateiTeilen(String name, String inhalt, String typ) {
            try {
                File ordner = new File(getCacheDir(), "teilen");
                if (!ordner.isDirectory() && !ordner.mkdirs()) return;
                String sicher = name.replaceAll("[^A-Za-z0-9._-]", "_");
                File f = new File(ordner, sicher);
                try (FileOutputStream o = new FileOutputStream(f)) {
                    o.write(inhalt.getBytes(StandardCharsets.UTF_8));
                }
                Uri uri = TeilenProvider.uri(sicher);
                Intent i = new Intent(Intent.ACTION_SEND)
                    .setType(typ)
                    .putExtra(Intent.EXTRA_STREAM, uri)
                    .putExtra(Intent.EXTRA_SUBJECT, name)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(i, "Sicherung teilen")));
            } catch (IOException x) {
                // Teilen nicht möglich
            }
        }

        @JavascriptInterface
        public void textTeilen(String titel, String text) {
            Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, titel).putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, titel)));
        }

        /** window.print() gibt es in der WebView nicht: Android-Druckdialog (auch „Als PDF speichern“) */
        @JavascriptInterface
        public void drucken(String titel) {
            String t = titel == null || titel.trim().isEmpty() ? "Turnier" : titel.trim();
            String sicher = t.length() > 80 ? t.substring(0, 80) : t;
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                if (pm == null) return;
                PrintDocumentAdapter a = web.createPrintDocumentAdapter(sicher);
                pm.print(sicher, a, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            });
        }
    }
}
