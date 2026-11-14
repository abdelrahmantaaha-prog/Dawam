package app.rhythm.planner.tera;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

/* The planner's side of Tera: it hands her the brief, tells her when
   something was done, has her speak in the chat, and collects what she did on
   her own while it was closed. See src/teranative.js for the other end. */
@CapacitorPlugin(name = "Tera")
public class TeraPlugin extends Plugin {

    private static WeakReference<TeraPlugin> live = new WeakReference<>(null);

    @Override
    public void load() { live = new WeakReference<>(this); }

    /* A command queued from the face while the planner is running in the
       background is applied at once instead of on the next resume. */
    static void announce(JSONObject cmd) {
        TeraPlugin p = live.get();
        if (p == null) return;
        try { p.notifyListeners("command", JSObject.fromJSONObject(cmd)); } catch (Exception ignored) {}
    }

    private JSObject status() {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("overlay", TeraHeadService.canDraw(c));
        o.put("exactAlarm", TeraScheduler.canExact(c));
        o.put("nextAt", TeraStore.nextAt(c));
        o.put("lastDoneAt", TeraStore.lastDoneAt(c));
        o.put("nagCount", TeraStore.nagCount(c));
        o.put("snoozeUntil", TeraStore.snoozeUntil(c));
        o.put("lastLine", TeraStore.lastLine(c));
        o.put("sdk", Build.VERSION.SDK_INT);
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject b = call.getObject("brief");
        if (b == null) { call.reject("no brief"); return; }
        Context c = getContext();
        TeraStore.setBrief(c, b);
        if (!TeraStore.enabled(c)) TeraHeadService.hide(c);
        TeraScheduler.reschedule(c);
        call.resolve(status());
    }

    @PluginMethod
    public void reportDone(PluginCall call) {
        Context c = getContext();
        Long at = call.getLong("at");
        TeraStore.reportDone(c, at == null ? System.currentTimeMillis() : at);
        TeraScheduler.reschedule(c);
        call.resolve(status());
    }

    @PluginMethod
    public void takeCommands(PluginCall call) {
        JSONArray a = TeraStore.takeCommands(getContext());
        JSObject o = new JSObject();
        try { o.put("commands", new JSArray(a.toString())); } catch (Exception e) { o.put("commands", new JSArray()); }
        call.resolve(o);
    }

    /* Resolves when she has FINISHED speaking, so the chat can start listening
       again at the right moment rather than over her own voice. */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) { call.resolve(); return; }
        call.setKeepAlive(true);
        TeraSpeaker.speak(getContext(), text, call.getString("lang", ""), (engine, err) -> {
            JSObject o = new JSObject();
            o.put("engine", engine);
            if (err != null) o.put("error", err);
            call.resolve(o);
            call.setKeepAlive(false);
            getBridge().releaseCall(call);
        });
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        TeraSpeaker.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void testPopup(PluginCall call) {
        Context c = getContext();
        String kind = call.getString("kind", "nag");
        String text = call.getString("text", null);
        String key = null;
        if ("appt".equals(kind)) {
            for (TeraStore.Item it : TeraStore.appointments(c)) { key = it.key; break; }
            if (key == null) kind = "nag";
        }
        if (!TeraHeadService.show(c, kind, key, text)) {
            final String k = kind, ky = key;
            new Thread(() -> TeraReceiver.notifyFallback(c, k, ky, text != null ? text : TeraBrain.compose(c, k, ky))).start();
        }
        call.resolve(status());
    }

    @PluginMethod
    public void hideHead(PluginCall call) {
        TeraHeadService.hide(getContext());
        call.resolve();
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Context c = getContext();
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + c.getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); } catch (Exception e) { call.reject("cannot open"); return; }
        call.resolve();
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context c = getContext();
        if (Build.VERSION.SDK_INT < 31) { call.resolve(); return; }
        Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + c.getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); } catch (Exception e) { call.reject("cannot open"); return; }
        call.resolve();
    }
}
