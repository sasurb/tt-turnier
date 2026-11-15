package de.saschaurban.ttturnier.kern;

/** Fehler mit Code nach shared/protokoll.ts (FehlerCode) und verständlicher Meldung. */
public final class ApiFehler extends RuntimeException {
    public final String code;

    public ApiFehler(String code, String meldung) {
        super(meldung);
        this.code = code;
    }

    public int status() {
        switch (code) {
            case "ungueltig": return 400;
            case "nicht_angemeldet":
            case "falsche_zugangsdaten": return 401;
            case "gesperrt":
            case "keine_berechtigung": return 403;
            case "nicht_gefunden": return 404;
            case "konflikt": return 409;
            case "zu_gross": return 413;
            case "zu_viele_versuche": return 429;
            case "nicht_eingerichtet": return 503;
            default: return 500;
        }
    }
}
