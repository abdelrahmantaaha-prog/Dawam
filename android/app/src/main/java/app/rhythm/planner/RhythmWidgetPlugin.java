package app.rhythm.planner;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* The web layer's only way to reach the home-screen widget.

   `update` stores the summary and re-renders immediately, so checking
   something off in the app is reflected on the home screen at once rather than
   waiting for Android's own widget schedule (which has a 30-minute floor). */
@CapacitorPlugin(name = "RhythmWidget")
public class RhythmWidgetPlugin extends Plugin {

    /* What the launch asked for, once. The widget's + sets it; the web layer
       collects it on launch and on every resume, because a warm start delivers
       the intent to an app that is already running and there is no other
       moment to notice. Answers null on an ordinary open. */
    @PluginMethod
    public void takeAction(PluginCall call) {
        JSObject o = new JSObject();
        o.put("action", MainActivity.takePendingAction());
        call.resolve(o);
    }

    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor e = ctx.getSharedPreferences(RhythmWidget.PREFS, Context.MODE_PRIVATE).edit();
        e.putString(RhythmWidget.K_TITLE, call.getString("title", ""));
        e.putString(RhythmWidget.K_BODY, call.getString("body", ""));
        e.putString(RhythmWidget.K_UPCOMING, call.getString("upcoming", ""));
        e.putLong(RhythmWidget.K_UPDATED, System.currentTimeMillis());
        e.apply();
        RhythmWidget.renderAll(ctx);
        call.resolve();
    }
}
