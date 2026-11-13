package de.saschaurban.ttturnier.zentrale;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Gibt Dateien aus cache/teilen/ an andere Apps weiter (z. B. Sicherung per Gmail),
 * nur lesend und nur mit ausdrücklicher Freigabe im Teilen-Intent.
 */
public final class TeilenProvider extends ContentProvider {
    static final String AUTORITAET = "de.saschaurban.ttturnier.zentrale.teilen";

    static Uri uri(String name) {
        return new Uri.Builder().scheme("content").authority(AUTORITAET).appendPath(name).build();
    }

    private File datei(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || !name.matches("[A-Za-z0-9._-]+") || name.startsWith(".")) throw new FileNotFoundException();
        File f = new File(new File(getContext().getCacheDir(), "teilen"), name);
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String modus) throws FileNotFoundException {
        if (!"r".equals(modus)) throw new FileNotFoundException("nur lesen");
        return ParcelFileDescriptor.open(datei(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] spalten, String auswahl, String[] args, String sortierung) {
        try {
            File f = datei(uri);
            MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
            c.addRow(new Object[] {f.getName(), f.length()});
            return c;
        } catch (FileNotFoundException x) {
            return null;
        }
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        return n != null && n.endsWith(".json") ? "application/json" : "text/plain";
    }

    @Override
    public Uri insert(Uri uri, ContentValues werte) {
        return null;
    }

    @Override
    public int delete(Uri uri, String auswahl, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues werte, String auswahl, String[] args) {
        return 0;
    }
}
