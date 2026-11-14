package app.rhythm.planner.tera;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import java.util.Calendar;

/* When Tera next has something to say, and one alarm set for it.

   Two kinds of moment:

     NAG    Nothing reported done for `nagMin` minutes (two hours by default)
            while there is still something open today. After a nag that got no
            answer she comes back every `repeatMin` instead of waiting the full
            stretch again — being ignored is not the same as being told.
            Never inside quiet hours, never inside a calendar event (you are
            in a meeting; that is doing something), never before a snooze ends.
            The count starts again when quiet hours end, so waking up is not
            met with "nothing done for nine hours".

     APPT   An appointment — a task with a clock time, or a calendar event —
            `leadMin` minutes before it starts, once per start time. Push it
            back and it gets a new start time, so it is asked about again.

   One exact alarm covers both: whichever is sooner. When it fires, the
   receiver works out what is actually due right then (the brief may have
   changed since) and sets the next one. Exact and allowed while idle, because
   a reminder that arrives twenty minutes late is not a reminder. */
public final class TeraScheduler {
    private TeraScheduler() {}

    static final String ACTION_TICK = "app.rhythm.planner.TERA_TICK";
    private static final int RC_TICK = 7301;
    static final long MIN = 60_000L;

    static int nagMin(Context c) { return Math.max(15, TeraStore.brief(c).optInt("nagMin", 120)); }
    static int repeatMin(Context c) { return Math.max(10, TeraStore.brief(c).optInt("repeatMin", 60)); }
    static int leadMin(Context c) { return Math.max(0, TeraStore.brief(c).optInt("leadMin", 15)); }

    private static int hm(String s, int fallback) {
        if (s == null || !s.matches("\\d{1,2}:\\d{2}")) return fallback;
        String[] p = s.split(":");
        return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
    }

    private static long atMinuteOfDay(long day, int minute) {
        Calendar k = Calendar.getInstance();
        k.setTimeInMillis(day);
        k.set(Calendar.HOUR_OF_DAY, 0); k.set(Calendar.MINUTE, 0); k.set(Calendar.SECOND, 0); k.set(Calendar.MILLISECOND, 0);
        return k.getTimeInMillis() + minute * MIN;
    }

    /* If `t` is inside quiet hours, the moment they end; otherwise 0. Handles a
       window that crosses midnight (23:30 → 08:00), which is the usual one. */
    static long quietEnd(Context c, long t) {
        JSONObject b = TeraStore.brief(c);
        int from = hm(b.optString("quietFrom", "00:00"), 0);
        int to = hm(b.optString("quietTo", "09:00"), 540);
        if (from == to) return 0;
        Calendar k = Calendar.getInstance();
        k.setTimeInMillis(t);
        int m = k.get(Calendar.HOUR_OF_DAY) * 60 + k.get(Calendar.MINUTE);
        if (from < to) return (m >= from && m < to) ? atMinuteOfDay(t, to) : 0;
        if (m >= from) return atMinuteOfDay(t, to) + 24 * 60 * MIN; // tomorrow morning
        if (m < to) return atMinuteOfDay(t, to);
        return 0;
    }

    /* The most recent end of quiet hours at or before `t`. */
    static long lastQuietEnd(Context c, long t) {
        JSONObject b = TeraStore.brief(c);
        int to = hm(b.optString("quietTo", "09:00"), 540);
        long today = atMinuteOfDay(t, to);
        return today <= t ? today : today - 24 * 60 * MIN;
    }

    /** When the next nag is due, or 0 when there is nothing to nag about. */
    static long nextNag(Context c, long now) {
        if (!TeraStore.enabled(c) || !TeraStore.brief(c).optBoolean("nag", true)) return 0;
        long done = Math.max(TeraStore.lastDoneAt(c), lastQuietEnd(c, now));
        long nag = TeraStore.lastNagAt(c);
        long due = nag > done ? nag + repeatMin(c) * MIN : done + nagMin(c) * MIN;
        due = Math.max(due, TeraStore.snoozeUntil(c));
        // Walk forward past quiet hours and meetings; a few steps is always enough.
        for (int i = 0; i < 6; i++) {
            long q = quietEnd(c, due);
            if (q > 0) { due = q + nagMin(c) * MIN; continue; }
            long busy = TeraStore.busyUntil(c, due);
            if (busy > 0) { due = busy + 10 * MIN; continue; }
            break;
        }
        return due;
    }

    /** One reminder still to be given: which appointment, when, and the token
        that marks it given (so each start time is asked about once). */
    static final class Due {
        TeraStore.Item item;
        long when;
        String token;
    }

    /** The soonest appointment reminder not given yet, or null. */
    static Due nextAppt(Context c, long now) {
        if (!TeraStore.enabled(c) || !TeraStore.brief(c).optBoolean("apptsOn", true)) return null;
        Due best = null;
        long lead = leadMin(c) * MIN;
        for (TeraStore.Item it : TeraStore.appointments(c)) {
            // Already well under way when we heard of it: no use announcing it.
            if (it.at < now - 10 * MIN && (it.endAt <= 0 || it.endAt < now)) continue;
            String first = it.key + "@" + it.at;
            if (!TeraStore.reminded(c, first) && it.at >= now - 10 * MIN) {
                Due d = new Due(); d.item = it; d.when = it.at - lead; d.token = first;
                if (best == null || d.when < best.when) best = d;
            }
            long again = TeraStore.againAt(c, it.key);
            String token = it.key + "@again@" + again;
            if (again > 0 && !TeraStore.reminded(c, token)) {
                Due d = new Due(); d.item = it; d.when = again; d.token = token;
                if (best == null || d.when < best.when) best = d;
            }
        }
        return best;
    }

    public static void reschedule(Context c) {
        long now = System.currentTimeMillis();
        long nag = nextNag(c, now);
        Due appt = nextAppt(c, now);
        long apptAt = appt == null ? 0 : Math.max(now + 5_000, appt.when);
        long next = nag == 0 ? apptAt : apptAt == 0 ? nag : Math.min(nag, apptAt);
        // Nothing due today still gets a look in an hour: the brief may have
        // grown a task, and a planner that has not been opened cannot say so.
        if (next == 0 && TeraStore.enabled(c)) next = now + 60 * MIN;
        set(c, next);
    }

    private static PendingIntent tickIntent(Context c) {
        Intent i = new Intent(c, TeraReceiver.class).setAction(ACTION_TICK);
        return PendingIntent.getBroadcast(c, RC_TICK, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    static void set(Context c, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = tickIntent(c);
        if (at <= 0) { am.cancel(pi); TeraStore.setNextAt(c, 0); return; }
        TeraStore.setNextAt(c, at);
        try {
            if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }
}
