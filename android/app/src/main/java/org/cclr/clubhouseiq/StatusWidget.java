package org.cclr.clubhouseiq;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home screen widget: open work, emergencies, PM due today, and plant status. */
public class StatusWidget extends AppWidgetProvider {

    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, StatusWidget.class));
        if (ids.length == 0) return;
        Intent i = new Intent(c, StatusWidget.class).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        c.sendBroadcast(i);
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                RemoteViews v = build(c);
                for (int id : ids) m.updateAppWidget(id, v);
            } finally { pr.finish(); }
        }).start();
    }

    private static PendingIntent open(Context c, String path, int code) {
        Uri u = Uri.parse(BuildConfig.APP_URL.replaceAll("/$", "") + path);
        Intent i = new Intent(Intent.ACTION_VIEW, u, c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static RemoteViews build(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_status);
        v.setOnClickPendingIntent(R.id.w_root, open(c, "/", 1));
        v.setOnClickPendingIntent(R.id.w_work, open(c, "/?tab=work", 2));
        v.setOnClickPendingIntent(R.id.w_plant, open(c, "/?tab=plant", 3));
        SharedPreferences p = c.getSharedPreferences(NativeFeatures.PREFS, Context.MODE_PRIVATE);
        String token = p.getString("token", null), origin = p.getString("origin", BuildConfig.APP_URL);
        if (token == null) {
            v.setTextViewText(R.id.w_open, "–");
            v.setTextViewText(R.id.w_open_sub, "Open the app and sign in");
            v.setTextViewText(R.id.w_plant, "");
            v.setTextViewText(R.id.w_time, "");
            return v;
        }
        try {
            HttpURLConnection h = (HttpURLConnection) new URL(origin.replaceAll("/$", "") + "/api/widget").openConnection();
            h.setConnectTimeout(8000); h.setReadTimeout(8000);
            h.setRequestProperty("Authorization", "Bearer " + token);
            if (h.getResponseCode() != 200) throw new Exception("HTTP " + h.getResponseCode());
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream()))) { String l; while ((l = r.readLine()) != null) sb.append(l); }
            JSONObject d = new JSONObject(sb.toString());
            p.edit().putString("widget_cache", d.toString()).apply();
            fill(v, d, false);
        } catch (Exception e) {
            String cached = p.getString("widget_cache", null);
            try { if (cached != null) { fill(v, new JSONObject(cached), true); return v; } } catch (Exception ignored) { }
            v.setTextViewText(R.id.w_open, "–");
            v.setTextViewText(R.id.w_open_sub, "No signal");
        }
        return v;
    }

    private static void fill(RemoteViews v, JSONObject d, boolean stale) {
        int open = d.optInt("open"), em = d.optInt("emergency"), hi = d.optInt("high"), pm = d.optInt("pm_due");
        v.setTextViewText(R.id.w_open, String.valueOf(open));
        String sub = open == 1 ? "open work order" : "open work orders";
        if (em > 0) sub = em + " emergency · " + sub; else if (hi > 0) sub = hi + " high · " + sub;
        v.setTextViewText(R.id.w_open_sub, sub);
        v.setTextColor(R.id.w_open, em > 0 ? Color.parseColor("#FF8A7A") : Color.WHITE);
        v.setTextViewText(R.id.w_pm, pm + " PM due today");
        JSONObject pl = d.optJSONObject("plant");
        String plant = "Plant: no live data";
        int col = Color.parseColor("#A9BDD6");
        if (pl != null && pl.optBoolean("live")) {
            plant = "Chiller " + (pl.isNull("chiller") ? "?" : pl.optString("chiller").toLowerCase(Locale.US));
            if (!pl.isNull("chws")) plant += " · CHW " + Math.round(pl.optDouble("chws") * 10) / 10.0 + "°";
            if (pl.optInt("alarms") > 0) { plant = pl.optInt("alarms") + " plant alarm" + (pl.optInt("alarms") > 1 ? "s" : "") + " · " + plant; col = Color.parseColor("#FF8A7A"); }
            else col = Color.parseColor("#7FD8A6");
        }
        v.setTextViewText(R.id.w_plant, plant);
        v.setTextColor(R.id.w_plant, col);
        v.setTextViewText(R.id.w_time, (stale ? "Saved " : "Updated ") + new SimpleDateFormat("h:mm a", Locale.US).format(new Date()));
    }
}
