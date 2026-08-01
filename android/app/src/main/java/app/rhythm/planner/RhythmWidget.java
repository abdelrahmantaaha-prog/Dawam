package app.rhythm.planner;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/* Home-screen widget showing whatever the Now page is pointing at.

   It is a DISPLAY of a snapshot, not a live view. The planner lives in the
   WebView's localStorage, which native code cannot read, so the web layer
   pushes a small summary in through RhythmWidgetPlugin whenever Now changes
   and the widget renders whatever it was last given. That also means the
   widget cannot tick anything off — tapping opens the app, where the real
   state is. Anything else would need the planner to live natively too. */
public class RhythmWidget extends AppWidgetProvider {

    static final String PREFS = "rhythm_widget";
    static final String K_TITLE = "title";
    static final String K_BODY = "body";
    static final String K_UPCOMING = "upcoming";
    static final String K_UPDATED = "updatedAt";

    /* Re-render every placed instance. Called from onUpdate (Android's own
       schedule and on add) and from the plugin the moment Now changes. */
    static void renderAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        ComponentName me = new ComponentName(context, RhythmWidget.class);
        int[] ids = mgr.getAppWidgetIds(me);
        for (int id : ids) render(context, mgr, id);
    }

    static void render(Context context, AppWidgetManager mgr, int widgetId) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_now);

        boolean seeded = p.getLong(K_UPDATED, 0L) > 0L;
        String title = p.getString(K_TITLE, "");
        String body = p.getString(K_BODY, "");
        String upcoming = p.getString(K_UPCOMING, "");

        if (!seeded) {
            // Never written to: the app has not been opened since the widget
            // was added. Say so rather than showing a convincing blank.
            v.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title));
            v.setTextViewText(R.id.widget_body, context.getString(R.string.widget_empty_body));
            v.setViewVisibility(R.id.widget_upcoming, android.view.View.GONE);
        } else {
            v.setTextViewText(R.id.widget_title, title.isEmpty() ? context.getString(R.string.widget_clear_title) : title);
            v.setTextViewText(R.id.widget_body, body);
            v.setViewVisibility(R.id.widget_body, body.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            v.setTextViewText(R.id.widget_upcoming, upcoming);
            v.setViewVisibility(R.id.widget_upcoming, upcoming.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
        }

        // Tapping anywhere opens Rhythm. singleTask + the launch intent means an
        // already-running app comes forward rather than starting a second copy.
        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        v.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, open, flags));

        mgr.updateAppWidget(widgetId, v);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) render(context, mgr, id);
    }
}
