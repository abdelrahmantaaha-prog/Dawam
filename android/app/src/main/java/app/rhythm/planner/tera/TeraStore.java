package app.rhythm.planner.tera;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/* Everything Tera knows while the planner is closed.

   The planner's data lives in the WebView's localStorage, which nothing
   native can read. So the web layer hands over a BRIEF — today's open tasks,
   the appointments of the next day and a half, the settings, the model keys,
   the wording — every time any of it changes, and Tera works from that copy.

   What Tera does on her own while the app is closed (a task ticked from the
   floating head, an appointment pushed back) cannot reach the planner either.
   It goes into a COMMAND queue the web layer drains the next time it runs, and
   until then Tera applies it to her own copy, so she does not nag about a
   task you just told her is done. */
public final class TeraStore {
    private TeraStore() {}

    static final String PREFS = "tera";
    private static final String K_BRIEF = "brief";
    private static final String K_LAST_DONE = "lastDoneAt";
    private static final String K_LAST_NAG = "lastNagAt";
    private static final String K_NAG_COUNT = "nagCount";
    private static final String K_SNOOZE = "snoozeUntil";
    private static final String K_COMMANDS = "commands";
    private static final String K_DONE_IDS = "doneIds";
    private static final String K_PUSHED = "pushed";
    private static final String K_REMINDED = "reminded";
    private static final String K_NEXT_AT = "nextAt";
    private static final String K_LAST_LINE = "lastLine";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    public static JSONObject brief(Context c) {
        try { return new JSONObject(prefs(c).getString(K_BRIEF, "{}")); } catch (JSONException e) { return new JSONObject(); }
    }

    /* A new brief means the planner ran and is authoritative again: the local
       overrides that existed only to cover for its absence go — unless commands
       are still waiting, in which case the planner has not seen them yet and
       the overrides still describe the truth. */
    public static synchronized void setBrief(Context c, JSONObject b) {
        SharedPreferences.Editor e = prefs(c).edit().putString(K_BRIEF, b.toString());
        if (commandsRaw(c).length() == 0) e.remove(K_DONE_IDS).remove(K_PUSHED);
        e.apply();
    }

    public static boolean enabled(Context c) { return brief(c).optBoolean("enabled", false); }

    public static long lastDoneAt(Context c) {
        long v = prefs(c).getLong(K_LAST_DONE, 0);
        if (v == 0) { v = System.currentTimeMillis(); prefs(c).edit().putLong(K_LAST_DONE, v).apply(); }
        return v;
    }

    public static synchronized void reportDone(Context c, long at) {
        if (at <= lastDoneAt(c)) return;
        prefs(c).edit().putLong(K_LAST_DONE, at).putInt(K_NAG_COUNT, 0).remove(K_SNOOZE).apply();
    }

    public static long lastNagAt(Context c) { return prefs(c).getLong(K_LAST_NAG, 0); }
    public static int nagCount(Context c) { return prefs(c).getInt(K_NAG_COUNT, 0); }

    public static void markNagged(Context c, long at) {
        prefs(c).edit().putLong(K_LAST_NAG, at).putInt(K_NAG_COUNT, nagCount(c) + 1).apply();
    }

    public static long snoozeUntil(Context c) { return prefs(c).getLong(K_SNOOZE, 0); }
    public static void snooze(Context c, long until) { prefs(c).edit().putLong(K_SNOOZE, until).apply(); }

    public static void setNextAt(Context c, long at) { prefs(c).edit().putLong(K_NEXT_AT, at).apply(); }
    public static long nextAt(Context c) { return prefs(c).getLong(K_NEXT_AT, 0); }

    public static void setLastLine(Context c, String s) { prefs(c).edit().putString(K_LAST_LINE, s).apply(); }
    public static String lastLine(Context c) { return prefs(c).getString(K_LAST_LINE, ""); }

    /* ---- commands for the planner ---- */

    private static JSONArray commandsRaw(Context c) {
        try { return new JSONArray(prefs(c).getString(K_COMMANDS, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    public static synchronized void addCommand(Context c, JSONObject cmd) {
        JSONArray a = commandsRaw(c);
        try { cmd.put("at", System.currentTimeMillis()); } catch (JSONException ignored) {}
        a.put(cmd);
        prefs(c).edit().putString(K_COMMANDS, a.toString()).apply();
        TeraPlugin.announce(cmd);
    }

    public static synchronized JSONArray takeCommands(Context c) {
        JSONArray a = commandsRaw(c);
        prefs(c).edit().remove(K_COMMANDS).apply();
        return a;
    }

    /* ---- local overrides ---- */

    public static synchronized void markDoneLocally(Context c, String id) {
        try {
            JSONArray a = new JSONArray(prefs(c).getString(K_DONE_IDS, "[]"));
            a.put(id);
            prefs(c).edit().putString(K_DONE_IDS, a.toString()).apply();
        } catch (JSONException ignored) {}
    }

    static boolean doneLocally(Context c, String id) {
        try {
            JSONArray a = new JSONArray(prefs(c).getString(K_DONE_IDS, "[]"));
            for (int i = 0; i < a.length(); i++) if (id.equals(a.optString(i))) return true;
        } catch (JSONException ignored) {}
        return false;
    }

    public static synchronized void pushLocally(Context c, String key, long newAt) {
        try {
            JSONObject o = new JSONObject(prefs(c).getString(K_PUSHED, "{}"));
            o.put(key, newAt);
            prefs(c).edit().putString(K_PUSHED, o.toString()).apply();
        } catch (JSONException ignored) {}
    }

    private static long pushedAt(Context c, String key) {
        try { return new JSONObject(prefs(c).getString(K_PUSHED, "{}")).optLong(key, 0); } catch (JSONException e) { return 0; }
    }

    /* "Remind me again in fifteen minutes" about something Tera cannot move —
       a calendar event. Its own time stays; this is just another moment to
       bring it up. */
    private static final String K_AGAIN = "again";

    public static synchronized void remindAgain(Context c, String key, long at) {
        try {
            JSONObject o = new JSONObject(prefs(c).getString(K_AGAIN, "{}"));
            o.put(key, at);
            prefs(c).edit().putString(K_AGAIN, o.toString()).apply();
        } catch (JSONException ignored) {}
    }

    static long againAt(Context c, String key) {
        try { return new JSONObject(prefs(c).getString(K_AGAIN, "{}")).optLong(key, 0); } catch (JSONException e) { return 0; }
    }

    static boolean reminded(Context c, String token) {
        try {
            JSONArray a = new JSONArray(prefs(c).getString(K_REMINDED, "[]"));
            for (int i = 0; i < a.length(); i++) if (token.equals(a.optString(i))) return true;
        } catch (JSONException ignored) {}
        return false;
    }

    static synchronized void markReminded(Context c, String token) {
        try {
            JSONArray a = new JSONArray(prefs(c).getString(K_REMINDED, "[]"));
            a.put(token);
            // Only the recent past matters; a day's worth is plenty.
            while (a.length() > 80) a.remove(0);
            prefs(c).edit().putString(K_REMINDED, a.toString()).apply();
        } catch (JSONException ignored) {}
    }

    /* ---- reading the brief, with the overrides applied ---- */

    public static final class Item {
        public String id, key, kind, title, start, end;
        public long at, endAt;
    }

    public static List<Item> openTasks(Context c) {
        List<Item> out = new ArrayList<>();
        JSONObject b = brief(c);
        // Yesterday's list, from a planner nobody opened today, is not a
        // reason to nag.
        long until = b.optLong("openUntil", 0);
        if (until > 0 && System.currentTimeMillis() > until) return out;
        JSONArray a = b.optJSONArray("open");
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            Item it = new Item();
            it.id = o.optString("id");
            it.title = o.optString("title");
            it.start = o.optString("start", "");
            it.end = o.optString("end", "");
            if (it.id.isEmpty() || doneLocally(c, it.id)) continue;
            out.add(it);
        }
        return out;
    }

    public static List<Item> appointments(Context c) {
        List<Item> out = new ArrayList<>();
        JSONArray a = brief(c).optJSONArray("appts");
        if (a == null) return out;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            Item it = new Item();
            it.id = o.optString("id");
            it.key = o.optString("key", it.id);
            it.kind = o.optString("kind", "task");
            it.title = o.optString("title");
            it.at = o.optLong("at", 0);
            it.endAt = o.optLong("end", 0);
            long p = pushedAt(c, it.key);
            if (p > 0) { if (it.endAt > 0) it.endAt += p - it.at; it.at = p; }
            if (it.at <= 0 || ("task".equals(it.kind) && doneLocally(c, it.id))) continue;
            out.add(it);
        }
        return out;
    }

    public static Item findAppointment(Context c, String key) {
        for (Item it : appointments(c)) if (it.key.equals(key)) return it;
        return null;
    }

    /* Calendar time the person is committed elsewhere; no nagging inside it. */
    public static long busyUntil(Context c, long t) {
        JSONArray a = brief(c).optJSONArray("busy");
        if (a == null) return 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            long from = o.optLong("from"), to = o.optLong("to");
            if (from <= t && t < to) return to;
        }
        return 0;
    }

    public static String label(Context c, String k, String fallback) {
        JSONObject l = brief(c).optJSONObject("labels");
        return l == null ? fallback : l.optString(k, fallback);
    }

    /* The language Tera is speaking in at the moment — the one the person last
       spoke to her in, which the web layer tracks. */
    public static String talkLang(Context c) { return brief(c).optString("talkLang", "ar"); }

    static List<String> bank(Context c, String kind) {
        List<String> out = new ArrayList<>();
        JSONObject b = brief(c).optJSONObject("bank");
        JSONObject k = b == null ? null : b.optJSONObject(kind);
        JSONArray a = k == null ? null : k.optJSONArray(talkLang(c));
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        return out;
    }
}
