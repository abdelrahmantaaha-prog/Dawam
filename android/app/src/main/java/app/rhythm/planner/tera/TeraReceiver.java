package app.rhythm.planner.tera;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

import app.rhythm.planner.MainActivity;
import app.rhythm.planner.R;
import app.rhythm.planner.RhythmWidget;

/* Where Tera's alarm lands, and where the phone tells her it restarted.

   On a tick it decides what is ACTUALLY due now — the brief may have changed
   since the alarm was set — shows it, and sets the next alarm. An appointment
   wins over a nag when both are due: it is the more specific thing to say.

   The floating face is the way she appears. Without permission to draw over
   other apps (or if Android refuses to start the service) she falls back to a
   heads-up notification with the same answers as buttons, so a missing
   permission costs the face, not the reminder. */
public class TeraReceiver extends BroadcastReceiver {

    static final String ACTION_HIDE = "app.rhythm.planner.TERA_HIDE";
    static final String ACTION_NOTIF = "app.rhythm.planner.TERA_NOTIF";
    private static final String CH_POP = "tera_popups";
    private static final int NOTIF_POP = 7304;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final Context c = ctx.getApplicationContext();
        String a = intent.getAction();
        if (a == null) return;
        switch (a) {
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
                TeraScheduler.reschedule(c);
                return;
            case ACTION_HIDE:
                TeraHeadService.hide(c);
                return;
            case ACTION_NOTIF:
                onNotificationAnswer(c, intent);
                return;
            case TeraScheduler.ACTION_TICK:
                tick(c);
                return;
            default:
        }
    }

    static void tick(Context c) {
        if (!TeraStore.enabled(c)) { TeraScheduler.set(c, 0); return; }
        long now = System.currentTimeMillis();
        long grace = 30_000;
        TeraScheduler.Due d = TeraScheduler.nextAppt(c, now);
        if (d != null && d.when <= now + grace) {
            TeraStore.markReminded(c, d.token);
            // The appointment was the conversation; no nag straight after it.
            TeraStore.prefs(c).edit().putLong("lastNagAt", now).apply();
            popup(c, "appt", d.item.key);
        } else {
            long n = TeraScheduler.nextNag(c, now);
            if (n > 0 && n <= now + grace) {
                if (TeraStore.openTasks(c).isEmpty()) {
                    // Nothing left today: that is a rest, not a silence.
                    TeraStore.snooze(c, now + TeraScheduler.nagMin(c) * TeraScheduler.MIN);
                } else {
                    TeraStore.markNagged(c, now);
                    popup(c, "nag", null);
                }
            }
        }
        TeraScheduler.reschedule(c);
    }

    static void popup(Context c, String kind, String key) {
        if (TeraHeadService.show(c, kind, key, null)) return;
        // No face: a notification, with the line written off the main thread.
        new Thread(() -> {
            String line = TeraBrain.compose(c, kind, key);
            notifyFallback(c, kind, key, line);
        }, "tera-notify").start();
    }

    private static boolean ar(Context c) { return "ar".equals(TeraStore.talkLang(c)); }
    private static String L(Context c, String k, String en, String ar) { return TeraStore.label(c, k, ar(c) ? ar : en); }

    private static PendingIntent answer(Context c, int rc, String op, String key) {
        Intent i = new Intent(c, TeraReceiver.class).setAction(ACTION_NOTIF).putExtra("op", op).putExtra("key", key);
        return PendingIntent.getBroadcast(c, rc, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent talkIntent(Context c) {
        Intent open = new Intent(c, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(RhythmWidget.K_ACTION, "tera-talk");
        return PendingIntent.getActivity(c, 7305, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void notifyFallback(Context c, String kind, String key, String line) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH_POP) == null) {
            NotificationChannel ch = new NotificationChannel(CH_POP, "Tera", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Tera's nudges and appointment reminders when she cannot appear on screen.");
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_POP) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_tera)
            .setContentTitle(L(c, "name", "Tera", "تيرا"))
            .setContentText(line)
            .setStyle(new Notification.BigTextStyle().bigText(line))
            .setContentIntent(talkIntent(c))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH);
        if ("appt".equals(kind)) {
            TeraStore.Item it = key == null ? null : TeraStore.findAppointment(c, key);
            b.addAction(new Notification.Action.Builder(null, L(c, "push15", "+15 min", "+١٥ د"), answer(c, 7311, "push15", key)).build());
            b.addAction(new Notification.Action.Builder(null, L(c, "push60", "+1 hour", "+ساعة"), answer(c, 7312, "push60", key)).build());
            if (it != null && "task".equals(it.kind)) {
                b.addAction(new Notification.Action.Builder(null, L(c, "tomorrow", "Tomorrow", "بكرة"), answer(c, 7313, "tomorrow", key)).build());
            }
        } else {
            b.addAction(new Notification.Action.Builder(null, L(c, "snooze", "1 more hour", "ساعة كمان"), answer(c, 7314, "snooze", null)).build());
            b.addAction(new Notification.Action.Builder(null, L(c, "talk", "Talk 🎙", "كلّميني 🎙"), talkIntent(c)).build());
        }
        try { nm.notify(NOTIF_POP, b.build()); } catch (SecurityException ignored) { /* notifications denied */ }
    }

    private static void onNotificationAnswer(Context c, Intent i) {
        String op = i.getStringExtra("op");
        String key = i.getStringExtra("key");
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_POP);
        long now = System.currentTimeMillis();
        if ("snooze".equals(op)) {
            TeraStore.snooze(c, now + 60 * TeraScheduler.MIN);
        } else if (op != null && key != null) {
            int minutes = "push15".equals(op) ? 15 : "push60".equals(op) ? 60 : "tomorrow".equals(op) ? 24 * 60 : 0;
            TeraStore.Item it = TeraStore.findAppointment(c, key);
            if (it != null && minutes > 0) {
                if ("task".equals(it.kind)) {
                    try { TeraStore.addCommand(c, new JSONObject().put("type", "push").put("id", it.id).put("minutes", minutes)); } catch (Exception ignored) {}
                    TeraStore.pushLocally(c, it.key, it.at + minutes * TeraScheduler.MIN);
                } else {
                    TeraStore.remindAgain(c, it.key, now + minutes * TeraScheduler.MIN);
                }
            }
        }
        TeraScheduler.reschedule(c);
    }
}
