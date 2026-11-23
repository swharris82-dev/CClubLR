package org.cclr.clubhouseiq;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Shows plant alarms and work order alerts sent through Firebase, and refreshes the widget. */
public class PushService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        // The page picks this up on next launch (push.register); nothing to store here.
        getSharedPreferences(NativeFeatures.PREFS, MODE_PRIVATE).edit().putString("push_token", token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        RemoteMessage.Notification n = msg.getNotification();
        String title = n != null && n.getTitle() != null ? n.getTitle() : d.get("title");
        String body = n != null && n.getBody() != null ? n.getBody() : d.get("body");
        String path = d.get("url") == null ? "/" : d.get("url");
        String kind = d.get("kind") == null ? "" : d.get("kind");
        boolean urgent = "plant".equals(kind) || "emergency".equals(kind);
        show(title == null ? "Clubhouse IQ" : title, body == null ? "" : body, path, urgent, msg.getMessageId());
        StatusWidget.refreshAll(this);
    }

    private void show(String title, String body, String path, boolean urgent, String id) {
        NativeFeatures.makeChannels(this);
        Uri link = Uri.parse(BuildConfig.APP_URL).buildUpon().encodedPath("/").build();
        try { link = Uri.parse(BuildConfig.APP_URL.replaceAll("/$", "") + path); } catch (Exception ignored) { }
        Intent open = new Intent(Intent.ACTION_VIEW, link, this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, urgent ? "alarms" : "work")
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(Color.parseColor("#1F3A63"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setCategory(urgent ? Notification.CATEGORY_ALARM : Notification.CATEGORY_MESSAGE);
        getSystemService(NotificationManager.class).notify(id == null ? (int) System.currentTimeMillis() : id.hashCode(), b.build());
    }
}
