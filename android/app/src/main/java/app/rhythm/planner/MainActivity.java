package app.rhythm.planner;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins living in the app project are not auto-discovered the way
        // node_modules plugins are; they have to be registered before super,
        // or the bridge comes up without them and every call rejects with
        // "not implemented".
        registerPlugin(RhythmWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
