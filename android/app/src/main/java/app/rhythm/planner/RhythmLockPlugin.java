package app.rhythm.planner;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* Holding the phone on the Now page.

   The Now lock covers the app, and on a laptop that is the whole story because
   the desktop shell owns every display. A phone is different: the app can draw
   whatever it likes and Home still leaves. So the honest version of "lock my
   phone into the Now page" on Android is LOCK TASK MODE — the platform's own
   kiosk primitive, which is the only thing that can take Home, Recents and the
   notification shade away from an app that asks for it.

   WHAT THIS CANNOT DO, and why the app does not pretend otherwise:

   An app cannot block the system Settings app, and it cannot single out the
   Accessibility screen inside it. The technique that used to do that — an
   accessibility service watching for the screen and dismissing it, or an
   overlay drawn on top of it — is exactly what Android hardened against:
   Settings hides overlays while it is in the foreground (Android 12+), and
   Play policy restricts accessibility services to accessibility use. Building
   it would be a feature that breaks on the next Android release and cannot be
   published.

   Lock task mode is strictly stronger for this purpose anyway. It does not
   block one screen of Settings; it blocks LEAVING RHYTHM AT ALL, Settings
   included, which is what "lock my phone into the Now page" actually meant.

   Two modes, and the difference is not cosmetic:

     PINNED    the ordinary case. startLockTask() shows Android's own
               confirmation and the person can leave by holding Back and
               Overview together. A speed bump with a name, not a cage.

     LOCKED    Rhythm is the device owner. Nothing leaves, including Settings,
               and only stopLockTask() releases it. Provisioned once, by hand,
               from a computer, on a device with no accounts on it yet:

                 adb shell dpm set-device-owner \
                   app.rhythm.planner/.RhythmDeviceAdmin

               That is a deliberate cliff. Device ownership is the real thing
               and it should take a cable and a wiped phone to get, not a
               toggle somebody flips while annoyed.

   status() reports which of the two the phone actually granted, so the app can
   say so instead of claiming a cage it does not have. */
@CapacitorPlugin(name = "RhythmLock")
public class RhythmLockPlugin extends Plugin {

    private String modeName() {
        Activity a = getActivity();
        if (a == null) return "none";
        ActivityManager am = (ActivityManager) a.getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return "none";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            switch (am.getLockTaskModeState()) {
                case ActivityManager.LOCK_TASK_MODE_LOCKED: return "locked";
                case ActivityManager.LOCK_TASK_MODE_PINNED: return "pinned";
                default: return "none";
            }
        }
        // Below M there is only "is it on", with no way to tell the two apart.
        return am.isInLockTaskMode() ? "pinned" : "none";
    }

    private JSObject state() {
        JSObject o = new JSObject();
        String m = modeName();
        o.put("mode", m);
        o.put("held", !"none".equals(m));
        // Only the device-owner case is a lock somebody cannot simply leave.
        o.put("escapable", !"locked".equals(m));
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void start(PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.resolve(state()); return; }
        a.runOnUiThread(() -> {
            try {
                // Asking twice is not an error worth surfacing — it is what
                // happens when the lock re-renders while already held.
                if ("none".equals(modeName())) a.startLockTask();
            } catch (Exception e) {
                // Some OEM builds refuse outright. The app is still covered by
                // its own overlay; only the platform half is missing, and
                // saying so beats crashing the page that was meant to help.
            }
            call.resolve(state());
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final Activity a = getActivity();
        if (a == null) { call.resolve(state()); return; }
        a.runOnUiThread(() -> {
            try {
                if (!"none".equals(modeName())) a.stopLockTask();
            } catch (Exception e) { /* already out, or never in */ }
            call.resolve(state());
        });
    }
}
