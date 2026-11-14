package app.rhythm.planner.tera;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Random;

/* What Tera says when she pops up on her own.

   Since 2026-11-14 the phone calls no model at all. Tera's brain is Claude,
   reached with the owner's own key, and that key stays in the planner — it is
   never copied into the phone's native storage. Instead, while the planner is
   open, Claude writes a batch of lines about the actual tasks and upcoming
   appointments (src/tera.js → POPUP_BATCH_SYSTEM), and they arrive here in
   the brief as "fresh". This picks one:

     nag    by how many times she has already checked in (level 0, 1, 2+)
     appt   by the appointment's key

   and falls back to the written bank when there is nothing fresh (no key,
   offline, or an appointment added after the batch was written). Placeholders
   {hours} {min} {title} {time} are filled in here, at the moment she speaks. */
public final class TeraBrain {
    private TeraBrain() {}

    private static final Random RNG = new Random();

    static String fill(String s, JSONObject vars) {
        String out = s;
        for (java.util.Iterator<String> it = vars.keys(); it.hasNext(); ) {
            String k = it.next();
            out = out.replace("{" + k + "}", vars.optString(k));
        }
        return out;
    }

    private static String hhmm(long t) { return new SimpleDateFormat("HH:mm", Locale.US).format(new Date(t)); }

    private static String pick(JSONArray a) {
        if (a == null || a.length() == 0) return null;
        String s = a.optString(RNG.nextInt(a.length()), "");
        return s.isEmpty() ? null : s;
    }

    /** The pop-up line for a nag, or for the appointment `key`. Never null. */
    public static String compose(Context c, String kind, String key) {
        long now = System.currentTimeMillis();
        boolean appt = "appt".equals(kind);
        JSONObject vars = new JSONObject();
        JSONObject fresh = TeraStore.brief(c).optJSONObject("fresh");
        String line = null;
        try {
            if (appt && key != null) {
                TeraStore.Item it = TeraStore.findAppointment(c, key);
                if (it != null) {
                    long in = Math.round((it.at - now) / 60000.0);
                    vars.put("title", it.title).put("min", Math.max(0, in)).put("time", hhmm(it.at));
                }
                JSONObject a = fresh == null ? null : fresh.optJSONObject("appt");
                if (a != null && key != null) line = a.optString(key, null);
            } else {
                double hours = (now - TeraStore.lastDoneAt(c)) / 3600000.0;
                List<TeraStore.Item> open = TeraStore.openTasks(c);
                vars.put("hours", (int) Math.max(1, Math.round(hours))).put("title", open.isEmpty() ? "" : open.get(0).title);
                JSONArray levels = fresh == null ? null : fresh.optJSONArray("nag");
                if (levels != null && levels.length() > 0) {
                    int lv = Math.min(levels.length() - 1, Math.max(0, TeraStore.nagCount(c) - 1));
                    line = pick(levels.optJSONArray(lv));
                    // A fresh line that names a task already ticked off since
                    // it was written would be wrong; the bank is safer then.
                    if (line != null && mentionsClosed(c, line, open)) line = null;
                }
            }
        } catch (Exception ignored) {}
        if (line == null) {
            List<String> bank = new ArrayList<>(TeraStore.bank(c, appt ? "appt" : "nag"));
            // A line that names a task needs a task to name; «» is worse than a plainer line.
            if (vars.optString("title", "").isEmpty()) {
                List<String> plain = new ArrayList<>();
                for (String b : bank) if (!b.contains("{title}")) plain.add(b);
                if (!plain.isEmpty()) bank = plain;
            }
            line = bank.isEmpty() ? vars.optString("title", "") : bank.get(RNG.nextInt(bank.size()));
        }
        line = fill(line, vars);
        TeraStore.setLastLine(c, line);
        return line;
    }

    private static boolean mentionsClosed(Context c, String line, List<TeraStore.Item> open) {
        JSONArray all = TeraStore.brief(c).optJSONArray("open");
        if (all == null) return false;
        List<String> stillOpen = new ArrayList<>();
        for (TeraStore.Item it : open) stillOpen.add(it.title);
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            String t = o == null ? "" : o.optString("title", "");
            if (t.length() >= 3 && line.contains(t) && !stillOpen.contains(t)) return true;
        }
        return false;
    }
}
