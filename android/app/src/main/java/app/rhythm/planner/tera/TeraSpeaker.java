package app.rhythm.planner.tera;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/* Tera's voice, from either side: the floating head and the in-app chat both
   come through here, so one is never talking over the other — a new line stops
   whatever was still playing.

   Edge's neural voice first (EdgeVoice), cached on disk by text so the same
   line is fetched once. If that fails — offline, or the service changed its
   token again — the phone's own text-to-speech says it instead: a robotic
   Tera is better than a silent one that looks broken.

   Music ducks rather than stops (transient focus, may duck), and the stream is
   tagged as an assistant, which is what it is. */
public final class TeraSpeaker {
    private TeraSpeaker() {}

    public interface Done { void run(String engine, String error); }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static TextToSpeech tts;
    private static Done pending;
    private static int generation = 0;
    private static AudioFocusRequest focusReq;

    static boolean isArabic(String s) {
        int ar = 0, lat = 0;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch >= 0x0600 && ch <= 0x06FF) ar++;
            else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) lat++;
        }
        return ar >= lat;
    }

    /* The voice settings live in the brief so the planner's settings page is
       the one place they are chosen. The script of the line decides which:
       Tera mirrors the language she is spoken to in, so her reply's own
       script is the most reliable hint there is. A line with no letters at
       all (a number, an emoji) goes by the language she is talking in. */
    static String voiceFor(Context c, String text, String langHint) {
        JSONObject b = TeraStore.brief(c);
        boolean letters = text.matches("(?s).*[\\p{L}].*");
        boolean ar = letters ? isArabic(text) : !"en".equals(langHint);
        return ar ? b.optString("voiceAr", "ar-EG-SalmaNeural") : b.optString("voiceEn", "en-US-AvaNeural");
    }

    /** True when an unprompted pop-up may speak: ringer on, no call going. */
    public static boolean mayInterrupt(Context c) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        return am.getRingerMode() == AudioManager.RINGER_MODE_NORMAL && am.getMode() == AudioManager.MODE_NORMAL;
    }

    public static synchronized void stop(Context c) {
        generation++;
        stopPlayback();
        Done d = pending;
        pending = null;
        if (d != null) d.run("stopped", null);
        abandonFocus(c);
    }

    private static void stopPlayback() {
        if (player != null) { try { player.stop(); } catch (Exception ignored) {} player.release(); player = null; }
        if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
    }

    public static void speak(final Context ctx, final String text, final String langHint, final Done done) {
        final Context c = ctx.getApplicationContext();
        final int gen;
        synchronized (TeraSpeaker.class) {
            stopPlayback();
            Done prev = pending;
            pending = done;
            gen = ++generation;
            if (prev != null) prev.run("stopped", null);
        }
        final String voice = voiceFor(c, text, langHint);
        final String rate = TeraStore.brief(c).optString("rate", "+0%");
        new Thread(() -> {
            File f = null;
            String err = null;
            try { f = cached(c, text, voice, rate); } catch (Exception e) { err = String.valueOf(e.getMessage()); }
            final File file = f;
            final String why = err;
            MAIN.post(() -> {
                if (gen != generation) return; // something newer took over
                if (file != null) play(c, file, gen);
                else fallback(c, text, voice, gen, why);
            });
        }, "tera-voice").start();
    }

    private static File cached(Context c, String text, String voice, String rate) throws Exception {
        File dir = new File(c.getCacheDir(), "tera-voice");
        if (!dir.exists()) dir.mkdirs();
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] h = md.digest((voice + "|" + rate + "|" + text).getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) sb.append(String.format(Locale.US, "%02x", h[i]));
        File f = new File(dir, sb + ".mp3");
        if (f.exists() && f.length() > 0) { f.setLastModified(System.currentTimeMillis()); return f; }
        byte[] mp3 = EdgeVoice.synth(text, voice, rate, "+0Hz");
        try (FileOutputStream out = new FileOutputStream(f)) { out.write(mp3); }
        trim(dir);
        return f;
    }

    private static void trim(File dir) {
        File[] all = dir.listFiles();
        if (all == null || all.length <= 80) return;
        Arrays.sort(all, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (int i = 0; i < all.length - 80; i++) all[i].delete();
    }

    private static AudioAttributes attrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private static void focus(Context c) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs()).build();
            am.requestAudioFocus(focusReq);
        } else {
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    private static void abandonFocus(Context c) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) { if (focusReq != null) am.abandonAudioFocusRequest(focusReq); }
        else am.abandonAudioFocus(null);
    }

    private static void finish(Context c, int gen, String engine, String err) {
        Done d;
        synchronized (TeraSpeaker.class) {
            if (gen != generation) return;
            d = pending;
            pending = null;
            if (player != null) { player.release(); player = null; }
        }
        abandonFocus(c);
        if (d != null) d.run(engine, err);
    }

    private static void play(Context c, File f, int gen) {
        try {
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(attrs());
            mp.setDataSource(f.getAbsolutePath());
            mp.setOnCompletionListener(m -> finish(c, gen, "edge", null));
            mp.setOnErrorListener((m, what, extra) -> { finish(c, gen, "edge", "playback " + what); return true; });
            mp.prepare();
            synchronized (TeraSpeaker.class) { player = mp; }
            focus(c);
            mp.start();
        } catch (Exception e) {
            f.delete();
            finish(c, gen, "edge", String.valueOf(e.getMessage()));
        }
    }

    private static void fallback(Context c, String text, String voice, int gen, String why) {
        final Locale loc = voice.startsWith("ar") ? new Locale("ar", "EG") : Locale.US;
        Runnable say = () -> {
            tts.setLanguage(loc);
            tts.setAudioAttributes(attrs());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { MAIN.post(() -> finish(c, gen, "device", why)); }
                @Override public void onError(String id) { MAIN.post(() -> finish(c, gen, "device", "tts error")); }
            });
            focus(c);
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tera-" + gen);
        };
        if (tts != null) { say.run(); return; }
        tts = new TextToSpeech(c, status -> {
            if (status != TextToSpeech.SUCCESS) { tts = null; finish(c, gen, "none", "no voice available"); return; }
            if (gen == generation) say.run();
        });
    }
}
