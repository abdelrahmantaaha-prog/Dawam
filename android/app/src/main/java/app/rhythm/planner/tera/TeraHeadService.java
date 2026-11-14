package app.rhythm.planner.tera;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import app.rhythm.planner.MainActivity;
import app.rhythm.planner.R;
import app.rhythm.planner.RhythmWidget;

/* The floating Tera: a round face that appears over whatever app is open,
   with what she has to say in a card beside it and a row of answers.

   It is a foreground service because a window drawn over other apps belongs
   to a process, and only a foreground service keeps that process alive while
   the face is on screen. The ongoing notification it needs is quiet (minimum
   importance) and says why it is there.

   Answers that change the plan (a task ticked off, an appointment pushed back)
   are queued for the planner and applied to Tera's own copy at once — see
   TeraStore. Answers that only concern Tera (snooze, dismiss) stay here.

   Drag the face to move it; drop it on the ✕ that appears at the bottom to
   send her away. Tap it to hide or show the card. */
public class TeraHeadService extends Service {

    static final String EXTRA_KIND = "kind";   // nag | appt | test
    static final String EXTRA_KEY = "key";     // appointment key
    static final String EXTRA_TEXT = "text";   // a line to show as it is
    private static final String CH_HEAD = "tera_head";
    private static final int NOTIF_ID = 7302;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager wm;
    private FrameLayout head;
    private View ring;
    private ObjectAnimator ringPulse;
    private LinearLayout card;
    private TextView message;
    private LinearLayout actions;
    private FrameLayout trash;
    private WindowManager.LayoutParams headLp, cardLp, trashLp;
    private boolean cardShown = false;
    private String kind = "nag", key = null;
    private int showId = 0;

    public static boolean canDraw(Context c) {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c);
    }

    /* Start (or update) the face. False when Android would not let it start,
       so the caller can post an ordinary notification instead. */
    public static boolean show(Context c, String kind, String key, String text) {
        if (!canDraw(c)) return false;
        Intent i = new Intent(c, TeraHeadService.class)
            .putExtra(EXTRA_KIND, kind).putExtra(EXTRA_KEY, key).putExtra(EXTRA_TEXT, text);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
            return true;
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException on Android 12+ when no
            // exemption applies; the notification path still works.
            return false;
        }
    }

    public static void hide(Context c) {
        c.stopService(new Intent(c, TeraHeadService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private boolean arabic() { return "ar".equals(TeraStore.talkLang(this)); }

    private String L(String k, String en, String ar) { return TeraStore.label(this, k, arabic() ? ar : en); }

    private void goForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CH_HEAD) == null) {
            NotificationChannel ch = new NotificationChannel(CH_HEAD, "Tera on screen", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Shown while Tera's face is over other apps.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent stop = new Intent(this, TeraReceiver.class).setAction(TeraReceiver.ACTION_HIDE);
        PendingIntent pStop = PendingIntent.getBroadcast(this, 7303, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_HEAD) : new Notification.Builder(this);
        Notification n = b.setSmallIcon(R.drawable.ic_tera)
            .setContentTitle(L("onScreen", "Tera is on screen", "تيرا على الشاشة"))
            .setContentText(L("onScreenHint", "Tap to send her away", "اضغط عشان تمشيها"))
            .setContentIntent(pStop)
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIF_ID, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground();
        if (!canDraw(this)) { stopSelf(); return START_NOT_STICKY; }
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        // A new pop-up while she was on her way out brings her back instead.
        if (head == null) buildViews();
        else if (leaving) head.animate().cancel();
        if (leaving) { head.setScaleX(1f); head.setScaleY(1f); }
        leaving = false;
        kind = intent != null && intent.getStringExtra(EXTRA_KIND) != null ? intent.getStringExtra(EXTRA_KIND) : "nag";
        key = intent != null ? intent.getStringExtra(EXTRA_KEY) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        present(text);
        return START_NOT_STICKY;
    }

    /* ------------------------------------------------------------------ */
    /*  Views                                                               */
    /* ------------------------------------------------------------------ */

    private static final int INK = Color.parseColor("#F1F5F2");
    private static final int CARD = Color.parseColor("#1B2420");
    private static final int CHIP = Color.parseColor("#2A3832");
    private static final int ACCENT = Color.parseColor("#3E8A6C");
    private static final int ROSE = Color.parseColor("#E07A5F");

    private void buildViews() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int size = dp(64);

        head = new FrameLayout(this);
        ring = new View(this);
        GradientDrawable rd = new GradientDrawable();
        rd.setShape(GradientDrawable.OVAL);
        rd.setStroke(dp(3), ACCENT);
        ring.setBackground(rd);
        ring.setAlpha(0f);
        head.addView(ring, new FrameLayout.LayoutParams(size + dp(10), size + dp(10), Gravity.CENTER));

        ImageView face = new ImageView(this);
        face.setImageResource(R.drawable.tera_avatar);
        face.setScaleType(ImageView.ScaleType.CENTER_CROP);
        face.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View v, Outline o) { o.setOval(0, 0, v.getWidth(), v.getHeight()); }
        });
        face.setClipToOutline(true);
        face.setElevation(dp(6));
        GradientDrawable faceBg = new GradientDrawable();
        faceBg.setShape(GradientDrawable.OVAL);
        faceBg.setColor(CARD);
        face.setBackground(faceBg);
        head.addView(face, new FrameLayout.LayoutParams(size, size, Gravity.CENTER));

        headLp = new WindowManager.LayoutParams(size + dp(10), size + dp(10), overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        headLp.gravity = Gravity.TOP | Gravity.START;
        headLp.x = dm.widthPixels - size - dp(14);
        headLp.y = (int) (dm.heightPixels * 0.22f);

        // The card.
        card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(16), dp(14), dp(16), dp(12));
        GradientDrawable cd = new GradientDrawable();
        cd.setColor(CARD);
        cd.setCornerRadius(dp(20));
        card.setBackground(cd);
        card.setElevation(dp(8));

        TextView name = new TextView(this);
        name.setText(L("name", "Tera", "تيرا"));
        name.setTextColor(ACCENT);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setTextSize(13);
        name.setTextDirection(View.TEXT_DIRECTION_LOCALE);
        card.addView(name);

        message = new TextView(this);
        message.setTextColor(INK);
        message.setTextSize(17);
        message.setLineSpacing(dp(2), 1f);
        message.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG);
        message.setPadding(0, dp(4), 0, dp(10));
        ScrollView sv = new ScrollView(this);
        sv.addView(message);
        card.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        // Long replies scroll instead of pushing the buttons off screen.
        sv.getLayoutParams().height = LinearLayout.LayoutParams.WRAP_CONTENT;
        message.setMaxHeight((int) (dm.heightPixels * 0.30f));

        actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        card.addView(actions);

        cardLp = new WindowManager.LayoutParams(dm.widthPixels - dp(24), WindowManager.LayoutParams.WRAP_CONTENT, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT);
        cardLp.gravity = Gravity.TOP | Gravity.START;
        cardLp.x = dp(12);

        // The drop target for sending her away.
        trash = new FrameLayout(this);
        TextView x = new TextView(this);
        x.setText("✕");
        x.setTextColor(Color.WHITE);
        x.setTextSize(24);
        x.setGravity(Gravity.CENTER);
        GradientDrawable td = new GradientDrawable();
        td.setShape(GradientDrawable.OVAL);
        td.setColor(Color.parseColor("#CC3B2A26"));
        td.setStroke(dp(2), ROSE);
        x.setBackground(td);
        trash.addView(x, new FrameLayout.LayoutParams(dp(60), dp(60), Gravity.CENTER));
        trashLp = new WindowManager.LayoutParams(dp(72), dp(72), overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSLUCENT);
        trashLp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        trashLp.y = dp(56);

        head.setOnTouchListener(new DragTouch());
        wm.addView(head, headLp);
        head.setScaleX(0f); head.setScaleY(0f);
        head.animate().scaleX(1f).scaleY(1f).setDuration(380).setInterpolator(new OvershootInterpolator(2.2f)).start();
    }

    private void placeCard() {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int headBottom = headLp.y + headLp.height;
        if (headLp.y < dm.heightPixels / 2) {
            cardLp.gravity = Gravity.TOP | Gravity.START;
            cardLp.y = headBottom + dp(4);
        } else {
            cardLp.gravity = Gravity.BOTTOM | Gravity.START;
            cardLp.y = dm.heightPixels - headLp.y + dp(4);
        }
    }

    private void showCard() {
        placeCard();
        if (!cardShown) {
            wm.addView(card, cardLp);
            cardShown = true;
            card.setAlpha(0f);
            card.setTranslationY(-dp(8));
            card.animate().alpha(1f).translationY(0).setDuration(200).start();
        } else {
            wm.updateViewLayout(card, cardLp);
        }
    }

    private void hideCard() {
        if (cardShown) { try { wm.removeView(card); } catch (Exception ignored) {} cardShown = false; }
    }

    private void speaking(boolean on) {
        if (on) {
            if (ringPulse == null) {
                ringPulse = ObjectAnimator.ofFloat(ring, View.ALPHA, 0.25f, 1f);
                ringPulse.setDuration(520);
                ringPulse.setRepeatMode(ValueAnimator.REVERSE);
                ringPulse.setRepeatCount(ValueAnimator.INFINITE);
            }
            ringPulse.start();
        } else {
            if (ringPulse != null) ringPulse.cancel();
            ring.setAlpha(0f);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  What she says, and the answers                                      */
    /* ------------------------------------------------------------------ */

    private void present(String preset) {
        final int id = ++showId;
        actions.removeAllViews();
        message.setText("…");
        showCard();
        if (preset != null && !preset.isEmpty()) { deliver(id, preset); return; }
        final Context c = getApplicationContext();
        final String k = kind, ky = key;
        new Thread(() -> {
            String line = TeraBrain.compose(c, k, ky);
            main.post(() -> deliver(id, line));
        }, "tera-line").start();
    }

    private void deliver(int id, String line) {
        if (id != showId) return;
        message.setText(line);
        buildActions();
        showCard();
        boolean voice = TeraStore.brief(this).optBoolean("speakPopups", true);
        if (voice && TeraSpeaker.mayInterrupt(this)) {
            speaking(true);
            TeraSpeaker.speak(this, line, TeraStore.talkLang(this), (engine, err) -> main.post(() -> speaking(false)));
        }
    }

    private TextView chip(String text, boolean primary, View.OnClickListener on) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextColor(primary ? Color.WHITE : INK);
        b.setTextSize(14);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(14), dp(9), dp(14), dp(9));
        GradientDrawable g = new GradientDrawable();
        g.setColor(primary ? ACCENT : CHIP);
        g.setCornerRadius(dp(18));
        b.setBackground(g);
        b.setOnClickListener(on);
        return b;
    }

    /* Chips in rows of three, mirrored for Arabic. */
    private void addRow(List<TextView> chips) {
        LinearLayout row = null;
        for (int i = 0; i < chips.size(); i++) {
            if (i % 3 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                row.setLayoutDirection(arabic() ? View.LAYOUT_DIRECTION_RTL : View.LAYOUT_DIRECTION_LTR);
                LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                rl.topMargin = dp(6);
                actions.addView(row, rl);
            }
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            lp.setMarginStart(i % 3 == 0 ? 0 : dp(6));
            row.addView(chips.get(i), lp);
        }
    }

    private void buildActions() {
        actions.removeAllViews();
        List<TextView> chips = new ArrayList<>();
        if ("appt".equals(kind)) {
            TeraStore.Item it = key == null ? null : TeraStore.findAppointment(this, key);
            boolean task = it != null && "task".equals(it.kind);
            chips.add(chip(L("ok", "On it", "تمام"), true, v -> dismiss()));
            chips.add(chip(L("push15", "+15 min", "+١٥ د"), false, v -> push(15)));
            chips.add(chip(L("push60", "+1 hour", "+ساعة"), false, v -> push(60)));
            if (task) chips.add(chip(L("tomorrow", "Tomorrow", "بكرة"), false, v -> push(24 * 60)));
            if (task) chips.add(chip(L("doneIt", "Done ✓", "خلصتها ✓"), false, v -> tickAppt()));
        } else {
            chips.add(chip(L("did", "Tick something off ✓", "علّمي على حاجة ✓"), true, v -> showDoneList()));
            chips.add(chip(L("snooze", "1 more hour", "ساعة كمان"), false, v -> {
                TeraStore.snooze(this, System.currentTimeMillis() + 60 * TeraScheduler.MIN);
                TeraScheduler.reschedule(this);
                dismiss();
            }));
        }
        chips.add(chip(L("talk", "Talk 🎙", "كلّميني 🎙"), false, v -> openTalk()));
        chips.add(chip(L("close", "✕", "✕"), false, v -> dismiss()));
        addRow(chips);
    }

    private void showDoneList() {
        actions.removeAllViews();
        List<TeraStore.Item> open = TeraStore.openTasks(this);
        if (open.isEmpty()) {
            message.setText(L("nothingOpen", "Nothing open on today's list. Tell me in the app instead.", "مفيش حاجة مفتوحة النهارده. قوليلي جوه الأبلكيشن."));
        }
        int n = 0;
        for (TeraStore.Item it : open) {
            if (n++ >= 6) break;
            TextView row = chip("○  " + it.title, false, v -> tick(it.id, it.title));
            row.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
            row.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(6);
            actions.addView(row, lp);
        }
        List<TextView> chips = new ArrayList<>();
        chips.add(chip(L("other", "Something else 🎙", "حاجة تانية 🎙"), false, v -> openTalk()));
        chips.add(chip(L("back", "Back", "رجوع"), false, v -> buildActions()));
        addRow(chips);
    }

    private void tick(String id, String title) {
        try { TeraStore.addCommand(this, new JSONObject().put("type", "done").put("id", id)); } catch (Exception ignored) {}
        TeraStore.markDoneLocally(this, id);
        TeraStore.reportDone(this, System.currentTimeMillis());
        TeraScheduler.reschedule(this);
        acknowledge(title);
    }

    private void tickAppt() {
        TeraStore.Item it = key == null ? null : TeraStore.findAppointment(this, key);
        if (it == null) { dismiss(); return; }
        tick(it.id, it.title);
    }

    private void acknowledge(String title) {
        List<String> bank = TeraStore.bank(this, "ack");
        String line = bank.isEmpty() ? L("ackFallback", "Logged.", "تمام، اتسجلت.") : bank.get((int) (Math.random() * bank.size()));
        line = line.replace("{title}", title);
        actions.removeAllViews();
        message.setText(line);
        if (TeraStore.brief(this).optBoolean("speakPopups", true) && TeraSpeaker.mayInterrupt(this)) {
            speaking(true);
            TeraSpeaker.speak(this, line, TeraStore.talkLang(this), (e, err) -> main.post(() -> { speaking(false); dismiss(); }));
            // A voice that never reports back (no audio route, a stuck engine)
            // must not leave her on screen for good.
            main.postDelayed(this::dismiss, 12000);
        } else {
            main.postDelayed(this::dismiss, 2600);
        }
    }

    private void push(int minutes) {
        TeraStore.Item it = key == null ? null : TeraStore.findAppointment(this, key);
        if (it == null) { dismiss(); return; }
        long newAt = it.at + minutes * TeraScheduler.MIN;
        if ("task".equals(it.kind)) {
            try {
                TeraStore.addCommand(this, new JSONObject().put("type", "push").put("id", it.id).put("minutes", minutes));
            } catch (Exception ignored) {}
            TeraStore.pushLocally(this, it.key, newAt);
        } else {
            // A calendar event is not Dawam's to move (it only reads calendars),
            // so pushing one back means being reminded again later instead.
            TeraStore.remindAgain(this, it.key, System.currentTimeMillis() + minutes * TeraScheduler.MIN);
        }
        TeraScheduler.reschedule(this);
        dismiss();
    }

    private void openTalk() {
        Intent i = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(RhythmWidget.K_ACTION, "tera-talk");
        try { startActivity(i); } catch (Exception ignored) {}
        dismiss();
    }

    /* Several things can ask her to leave at once — the ✕, the end of her
       "well done", stopping her voice (which reports back) — so only the first
       one counts. */
    private boolean leaving = false;

    private void dismiss() {
        if (leaving) return;
        leaving = true;
        TeraSpeaker.stop(this);
        hideCard();
        if (head == null) { stopSelf(); return; }
        head.animate().scaleX(0f).scaleY(0f).setDuration(160).withEndAction(this::stopSelf).start();
    }

    @Override
    public void onDestroy() {
        speaking(false);
        hideCard();
        try { if (head != null) wm.removeView(head); } catch (Exception ignored) {}
        try { if (trash.getParent() != null) wm.removeView(trash); } catch (Exception ignored) {}
        head = null;
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */
    /*  Dragging                                                            */
    /* ------------------------------------------------------------------ */

    private final class DragTouch implements View.OnTouchListener {
        private float downX, downY;
        private int startX, startY;
        private boolean dragging;
        private final int slop = ViewConfiguration.get(TeraHeadService.this).getScaledTouchSlop();

        private boolean overTrash() {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            int cx = headLp.x + headLp.width / 2, cy = headLp.y + headLp.height / 2;
            int tx = dm.widthPixels / 2, ty = dm.heightPixels - trashLp.y - trashLp.height / 2;
            return Math.hypot(cx - tx, cy - ty) < dp(80);
        }

        @Override public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX(); downY = e.getRawY();
                    startX = headLp.x; startY = headLp.y;
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (!dragging && Math.hypot(dx, dy) > slop) {
                        dragging = true;
                        hideCard();
                        try { wm.addView(trash, trashLp); } catch (Exception ignored) {}
                    }
                    if (dragging) {
                        headLp.x = startX + (int) dx;
                        headLp.y = Math.max(0, startY + (int) dy);
                        wm.updateViewLayout(head, headLp);
                        float s = overTrash() ? 1.25f : 1f;
                        trash.setScaleX(s); trash.setScaleY(s);
                    }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    if (!dragging) {
                        if (cardShown) hideCard(); else showCard();
                        return true;
                    }
                    try { wm.removeView(trash); } catch (Exception ignored) {}
                    if (overTrash()) { dismiss(); return true; }
                    // Settle against the nearer edge, like every chat head does.
                    DisplayMetrics dm = getResources().getDisplayMetrics();
                    int target = headLp.x + headLp.width / 2 < dm.widthPixels / 2 ? dp(4) : dm.widthPixels - headLp.width - dp(4);
                    ValueAnimator va = ValueAnimator.ofInt(headLp.x, target);
                    va.setDuration(220);
                    va.addUpdateListener(a -> {
                        if (head == null) return;
                        headLp.x = (int) a.getAnimatedValue();
                        try { wm.updateViewLayout(head, headLp); } catch (Exception ignored) {}
                    });
                    va.start();
                    return true;
            }
            return false;
        }
    }
}
