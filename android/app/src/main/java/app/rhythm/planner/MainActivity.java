package app.rhythm.planner;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /* What the launch intent asked for, waiting to be collected.

       Static because the two ends run on different clocks: the intent arrives
       when Android decides to deliver it, and the web layer asks for it when
       the WebView has finished booting — which on a cold start is a second
       later and on a warm one is immediate. A field on the activity would be
       read before it was written on exactly one of those paths.

       Read once and cleared, so coming back to the app later does not reopen
       a sheet that was already dealt with. */
    private static String pendingAction = null;

    static String takePendingAction() {
        String a = pendingAction;
        pendingAction = null;
        return a;
    }

    private static void remember(Intent i) {
        if (i == null) return;
        String a = i.getStringExtra(RhythmWidget.K_ACTION);
        if (a != null) pendingAction = a;
        // Consumed here so a configuration change — a rotation, a theme flip —
        // cannot replay the same launch intent and reopen the sheet.
        if (a != null) i.removeExtra(RhythmWidget.K_ACTION);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // singleTask: an already-running Dawam gets the widget's tap here
        // rather than through onCreate, which is the common case by far.
        remember(intent);
        setIntent(intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        remember(getIntent());
        // Plugins living in the app project are not auto-discovered the way
        // node_modules plugins are; they have to be registered before super,
        // or the bridge comes up without them and every call rejects with
        // "not implemented".
        registerPlugin(RhythmWidgetPlugin.class);
        registerPlugin(RhythmLockPlugin.class);
        registerPlugin(app.rhythm.planner.tera.TeraPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
