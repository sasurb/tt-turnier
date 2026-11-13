package de.saschaurban.ttturnier.kern;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Kleiner JSON-Leser und -Schreiber ohne Fremdbibliotheken (läuft gleich auf Android und im JDK).
 * Objekte werden zu {@code LinkedHashMap<String,Object>}, Listen zu {@code ArrayList<Object>},
 * ganze Zahlen zu {@code Long}, Kommazahlen zu {@code Double}.
 */
public final class Json {
    private Json() {}

    public static final class Fehler extends RuntimeException {
        public Fehler(String m) { super(m); }
    }

    /* ---------------- Lesen ---------------- */

    public static Object lesen(String text) {
        Leser l = new Leser(text);
        l.leer();
        Object w = l.wert(0);
        l.leer();
        if (l.i != text.length()) throw new Fehler("Zeichen nach dem Ende");
        return w;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> objekt(String text) {
        Object o = lesen(text);
        if (!(o instanceof Map)) throw new Fehler("kein Objekt");
        return (Map<String, Object>) o;
    }

    private static final class Leser {
        final String s;
        int i;
        Leser(String s) { this.s = s; }

        void leer() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\n' || c == '\r' || c == '\t') i++;
                else break;
            }
        }

        Object wert(int tiefe) {
            if (tiefe > 64) throw new Fehler("zu tief verschachtelt");
            if (i >= s.length()) throw new Fehler("unerwartetes Ende");
            char c = s.charAt(i);
            switch (c) {
                case '{': return objekt(tiefe);
                case '[': return liste(tiefe);
                case '"': return text();
                case 't': wort("true"); return Boolean.TRUE;
                case 'f': wort("false"); return Boolean.FALSE;
                case 'n': wort("null"); return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return zahl();
                    throw new Fehler("unerwartetes Zeichen");
            }
        }

        void wort(String w) {
            if (!s.startsWith(w, i)) throw new Fehler("ungültiges Wort");
            i += w.length();
        }

        Map<String, Object> objekt(int tiefe) {
            Map<String, Object> m = new LinkedHashMap<>();
            i++;
            leer();
            if (i < s.length() && s.charAt(i) == '}') { i++; return m; }
            while (true) {
                leer();
                if (i >= s.length() || s.charAt(i) != '"') throw new Fehler("Schlüssel erwartet");
                String k = text();
                leer();
                if (i >= s.length() || s.charAt(i) != ':') throw new Fehler("':' erwartet");
                i++;
                leer();
                m.put(k, wert(tiefe + 1));
                leer();
                if (i >= s.length()) throw new Fehler("unerwartetes Ende");
                char c = s.charAt(i++);
                if (c == '}') return m;
                if (c != ',') throw new Fehler("',' erwartet");
            }
        }

        List<Object> liste(int tiefe) {
            List<Object> l = new ArrayList<>();
            i++;
            leer();
            if (i < s.length() && s.charAt(i) == ']') { i++; return l; }
            while (true) {
                leer();
                l.add(wert(tiefe + 1));
                leer();
                if (i >= s.length()) throw new Fehler("unerwartetes Ende");
                char c = s.charAt(i++);
                if (c == ']') return l;
                if (c != ',') throw new Fehler("',' erwartet");
            }
        }

        String text() {
            i++; // "
            StringBuilder b = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw new Fehler("Text nicht beendet");
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c < 0x20) throw new Fehler("Steuerzeichen im Text");
                if (c != '\\') { b.append(c); continue; }
                if (i >= s.length()) throw new Fehler("Text nicht beendet");
                char e = s.charAt(i++);
                switch (e) {
                    case '"': b.append('"'); break;
                    case '\\': b.append('\\'); break;
                    case '/': b.append('/'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'n': b.append('\n'); break;
                    case 'r': b.append('\r'); break;
                    case 't': b.append('\t'); break;
                    case 'u':
                        if (i + 4 > s.length()) throw new Fehler("ungültiges \\u");
                        try {
                            b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                        } catch (NumberFormatException x) {
                            throw new Fehler("ungültiges \\u");
                        }
                        i += 4;
                        break;
                    default: throw new Fehler("ungültiges Escape");
                }
            }
        }

        Object zahl() {
            int start = i;
            boolean komma = false;
            if (s.charAt(i) == '-') i++;
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c >= '0' && c <= '9') i++;
                else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') { komma = true; i++; }
                else break;
            }
            String t = s.substring(start, i);
            try {
                if (!komma) {
                    try {
                        return Long.parseLong(t);
                    } catch (NumberFormatException gross) {
                        return Double.parseDouble(t);
                    }
                }
                double d = Double.parseDouble(t);
                if (Double.isInfinite(d) || Double.isNaN(d)) throw new Fehler("ungültige Zahl");
                return d;
            } catch (NumberFormatException x) {
                throw new Fehler("ungültige Zahl");
            }
        }
    }

    /* ---------------- Schreiben ---------------- */

    public static String schreiben(Object o) {
        StringBuilder b = new StringBuilder();
        schreiben(b, o);
        return b.toString();
    }

    @SuppressWarnings("unchecked")
    private static void schreiben(StringBuilder b, Object o) {
        if (o == null) {
            b.append("null");
        } else if (o instanceof String) {
            text(b, (String) o);
        } else if (o instanceof Boolean) {
            b.append(((Boolean) o) ? "true" : "false");
        } else if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) b.append("null");
            else if (d == Math.rint(d) && Math.abs(d) < 1e15) b.append((long) d);
            else b.append(d);
        } else if (o instanceof Number) {
            b.append(((Number) o).longValue());
        } else if (o instanceof Map) {
            b.append('{');
            boolean erst = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) o).entrySet()) {
                if (!erst) b.append(',');
                erst = false;
                text(b, e.getKey());
                b.append(':');
                schreiben(b, e.getValue());
            }
            b.append('}');
        } else if (o instanceof List) {
            b.append('[');
            boolean erst = true;
            for (Object x : (List<Object>) o) {
                if (!erst) b.append(',');
                erst = false;
                schreiben(b, x);
            }
            b.append(']');
        } else {
            text(b, o.toString());
        }
    }

    private static void text(StringBuilder b, String s) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                case '\b': b.append("\\b"); break;
                case '\f': b.append("\\f"); break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ') b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
    }

    /* ---------------- Hilfen für Maps ---------------- */

    /** Kurzform für ein geordnetes Objekt: obj("a", 1, "b", "x") */
    public static Map<String, Object> obj(Object... paare) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < paare.length; i += 2) m.put((String) paare[i], paare[i + 1]);
        return m;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> alsObjekt(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> alsListe(Object o) {
        return o instanceof List ? (List<Object>) o : null;
    }

    public static String alsText(Object o) {
        return o instanceof String ? (String) o : null;
    }

    /** Ganze Zahl (Long) oder null; Kommazahlen zählen nicht. */
    public static Long alsGanzzahl(Object o) {
        return o instanceof Long ? (Long) o : (o instanceof Integer ? Long.valueOf((Integer) o) : null);
    }
}
