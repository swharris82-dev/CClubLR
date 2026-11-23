package org.cclr.clubhouseiq;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * The native side of the page's bridge (public/native-ui.js).
 * The page calls CIQAndroid.post({id, method, args}); answers come back
 * through CIQNativeReply(id, ok, data) and events through CIQNativeEvent(type, data).
 * Only pages from the app's own host can use it.
 */
public class NativeFeatures {
    static final String PREFS = "ciq";
    static final int REQ_SCAN = 61, REQ_NOTIF = 62;

    private final Activity act;
    private final WebView web;
    private final String host;
    private boolean pageReady = false;
    private final List<String[]> pendingEvents = new ArrayList<>();

    // NFC
    private String nfcCallId, nfcWriteUrl;
    private AlertDialog nfcDialog;
    // scanning
    private String scanCallId, scanKind;
    private Uri scanUri;
    // push permission
    private String pushCallId;
    // lock
    private View lockView;
    private boolean unlocked = false;
    private long pausedAt = 0;

    NativeFeatures(Activity act, WebView web, String host) {
        this.act = act;
        this.web = web;
        this.host = host;
        makeChannels(act);
    }

    Bridge bridge() { return new Bridge(this); }

    /** The object the page sees as window.CIQAndroid. */
    public static class Bridge {
        private final NativeFeatures n;
        Bridge(NativeFeatures n) { this.n = n; }
        @JavascriptInterface
        public void post(String json) { n.act.runOnUiThread(() -> n.onCall(json)); }
    }

    private SharedPreferences prefs() { return act.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /* ---------------- talking to the page ---------------- */

    private boolean fromOurPage() {
        try { return host.equals(Uri.parse(web.getUrl()).getHost()); } catch (Exception e) { return false; }
    }
    private void reply(String id, boolean ok, Object data) {
        if (id == null) return;
        String payload = JSONObject.quote(data == null ? "{}" : data.toString());
        web.evaluateJavascript("window.CIQNativeReply&&CIQNativeReply(" + JSONObject.quote(id) + "," + ok + "," + payload + ")", null);
    }
    private void fail(String id, String msg) {
        try { reply(id, false, new JSONObject().put("error", msg)); } catch (Exception ignored) { }
    }
    void event(String type, JSONObject data) {
        String js = "window.CIQNativeEvent&&CIQNativeEvent(" + JSONObject.quote(type) + "," + JSONObject.quote(data.toString()) + ")";
        if (pageReady) web.evaluateJavascript(js, null); else pendingEvents.add(new String[]{js});
    }
    void onPageReady() {
        pageReady = true;
        // Give the page's scripts a moment to load before replaying events.
        web.postDelayed(() -> { for (String[] e : pendingEvents) web.evaluateJavascript(e[0], null); pendingEvents.clear(); }, 1500);
    }
    void onPageStarted() { pageReady = false; }

    private void onCall(String json) {
        String id = null;
        try {
            JSONObject m = new JSONObject(json);
            id = m.optString("id");
            if (!fromOurPage()) { fail(id, "Not allowed"); return; }
            JSONObject a = m.optJSONObject("args");
            if (a == null) a = new JSONObject();
            switch (m.optString("method")) {
                case "caps": reply(id, true, caps()); break;
                case "session": session(a); reply(id, true, null); break;
                case "push.register": pushRegister(id, a.optBoolean("ask")); break;
                case "nfc.read": nfcStart(id, null); break;
                case "nfc.write": nfcStart(id, a.optString("url")); break;
                case "scan.text": scanStart(id, "text"); break;
                case "scan.barcode": scanStart(id, "barcode"); break;
                case "biometric.get": reply(id, true, new JSONObject().put("on", prefs().getBoolean("bio", false))); break;
                case "biometric.set": bioSet(id, a.optBoolean("on")); break;
                default: fail(id, "Unknown request");
            }
        } catch (Exception e) {
            fail(id, e.getMessage() == null ? "Failed" : e.getMessage());
        }
    }

    private JSONObject caps() throws Exception {
        return new JSONObject()
                .put("nfc", NfcAdapter.getDefaultAdapter(act) != null)
                .put("scan", true)
                .put("biometric", bioAvailable())
                .put("push", pushAvailable())
                .put("share", true)
                .put("widget", true)
                .put("version", BuildConfig.VERSION_NAME);
    }

    /* ---------------- session (widget uses it) ---------------- */

    private void session(JSONObject a) {
        SharedPreferences.Editor e = prefs().edit();
        if (a.isNull("token") || a.optString("token").isEmpty()) {
            e.remove("token").remove("name").remove("role").remove("bio");
        } else {
            e.putString("token", a.optString("token")).putString("origin", a.optString("origin"))
             .putString("name", a.optString("name")).putString("role", a.optString("role"));
        }
        e.apply();
        StatusWidget.refreshAll(act);
    }

    /* ---------------- push ---------------- */

    static void makeChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel al = new NotificationChannel("alarms", "Plant alarms and emergencies", NotificationManager.IMPORTANCE_HIGH);
        al.setDescription("Chiller trips, walk-in temperature, PHX-1, emergency work orders");
        al.enableVibration(true);
        al.setLightColor(Color.RED);
        nm.createNotificationChannel(al);
        NotificationChannel wk = new NotificationChannel("work", "Work orders", NotificationManager.IMPORTANCE_DEFAULT);
        wk.setDescription("New requests and work assigned to you");
        nm.createNotificationChannel(wk);
    }

    private boolean pushAvailable() {
        try { return !FirebaseApp.getApps(act).isEmpty(); } catch (Throwable t) { return false; }
    }

    private void pushRegister(String id, boolean ask) {
        if (!pushAvailable()) { fail(id, "Alerts are not set up in this build of the app yet."); return; }
        if (Build.VERSION.SDK_INT >= 33 && act.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (ask) { pushCallId = id; act.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF); return; }
        }
        fetchPushToken(id);
    }
    private void fetchPushToken(String id) {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
            if (t.isSuccessful() && t.getResult() != null) {
                try { reply(id, true, new JSONObject().put("token", t.getResult())); } catch (Exception ignored) { }
            } else fail(id, "Could not turn on alerts. Check the phone has Google Play services.");
        });
    }

    /* ---------------- NFC ---------------- */

    private void nfcStart(String id, String writeUrl) {
        NfcAdapter nfc = NfcAdapter.getDefaultAdapter(act);
        if (nfc == null) { fail(id, "This phone has no NFC."); return; }
        if (!nfc.isEnabled()) {
            fail(id, "NFC is turned off. Turn it on in Settings, then try again.");
            try { act.startActivity(new Intent(android.provider.Settings.ACTION_NFC_SETTINGS)); } catch (Exception ignored) { }
            return;
        }
        nfcStop(true);
        nfcCallId = id;
        nfcWriteUrl = writeUrl;
        int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V
                | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
        nfc.enableReaderMode(act, this::onTag, flags, null);
        nfcDialog = new AlertDialog.Builder(act)
                .setTitle(writeUrl == null ? "Ready to scan" : "Ready to write")
                .setMessage(writeUrl == null ? "Hold the back of your phone to the equipment tag." : "Hold the back of your phone to a blank NFC tag.")
                .setNegativeButton("Cancel", (d, w) -> { String c = nfcCallId; nfcStop(false); fail(c, "Cancelled"); })
                .setOnCancelListener(d -> { String c = nfcCallId; nfcStop(false); fail(c, "Cancelled"); })
                .show();
    }
    private void nfcStop(boolean cancelOld) {
        if (cancelOld && nfcCallId != null) fail(nfcCallId, "Cancelled");
        nfcCallId = null;
        try { NfcAdapter n = NfcAdapter.getDefaultAdapter(act); if (n != null) n.disableReaderMode(act); } catch (Exception ignored) { }
        if (nfcDialog != null) { try { nfcDialog.dismiss(); } catch (Exception ignored) { } nfcDialog = null; }
    }
    // Runs on an NFC thread.
    private void onTag(Tag tag) {
        final String id = nfcCallId, url = nfcWriteUrl;
        if (id == null) return;
        String err = null; JSONObject out = new JSONObject();
        try {
            if (url == null) {
                Ndef ndef = Ndef.get(tag);
                if (ndef == null) throw new Exception("That tag has nothing on it.");
                ndef.connect();
                NdefMessage msg = ndef.getNdefMessage();
                ndef.close();
                if (msg == null || msg.getRecords().length == 0) throw new Exception("That tag is blank.");
                NdefRecord r = msg.getRecords()[0];
                Uri u = r.toUri();
                if (u != null) out.put("url", u.toString());
                else out.put("text", new String(r.getPayload(), "UTF-8"));
            } else {
                NdefMessage msg = new NdefMessage(new NdefRecord[]{NdefRecord.createUri(url),
                        NdefRecord.createApplicationRecord(act.getPackageName())});
                Ndef ndef = Ndef.get(tag);
                if (ndef != null) {
                    ndef.connect();
                    if (!ndef.isWritable()) throw new Exception("That tag is locked and can't be written.");
                    if (ndef.getMaxSize() < msg.toByteArray().length) msg = new NdefMessage(new NdefRecord[]{NdefRecord.createUri(url)});
                    if (ndef.getMaxSize() < msg.toByteArray().length) throw new Exception("That tag is too small. Use NTAG213 or larger.");
                    ndef.writeNdefMessage(msg);
                    ndef.close();
                } else {
                    NdefFormatable f = NdefFormatable.get(tag);
                    if (f == null) throw new Exception("That tag type isn't supported. Use NTAG213, 215 or 216 tags.");
                    f.connect(); f.format(msg); f.close();
                }
                out.put("ok", true);
            }
        } catch (Exception e) {
            err = e.getMessage() == null ? "Could not read the tag. Hold it still and try again." : e.getMessage();
        }
        final String fe = err;
        act.runOnUiThread(() -> {
            nfcCallId = null;
            nfcStop(false);
            if (fe != null) fail(id, fe); else reply(id, true, out);
        });
    }

    /** NFC tag tapped while the app is open but not scanning, or an app link. */
    boolean handleIntent(Intent intent, boolean running) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) && intent.getType() != null && intent.getType().startsWith("image/")) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) sharePhoto((Uri) p);
            return true;
        }
        Uri data = intent.getData();
        if (NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action) && data == null) {
            Parcelable[] raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
            if (raw != null && raw.length > 0) {
                NdefRecord[] recs = ((NdefMessage) raw[0]).getRecords();
                if (recs.length > 0) data = recs[0].toUri();
            }
        }
        if (running && data != null && host.equals(data.getHost())) {
            try { event("open-url", new JSONObject().put("url", data.toString())); } catch (Exception ignored) { }
            return true;
        }
        return false;
    }

    /* ---------------- photos shared in ---------------- */

    private void sharePhoto(Uri uri) {
        new Thread(() -> {
            try (InputStream in = act.getContentResolver().openInputStream(uri)) {
                Bitmap b = BitmapFactory.decodeStream(in);
                if (b == null) return;
                String data = "data:image/jpeg;base64," + jpegBase64(b, 1600, 78);
                String name = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment();
                act.runOnUiThread(() -> {
                    try { event("shared-photo", new JSONObject().put("dataUrl", data).put("name", name)); } catch (Exception ignored) { }
                });
            } catch (Exception ignored) { }
        }).start();
    }
    private static String jpegBase64(Bitmap b, int max, int q) {
        float s = Math.min(1f, (float) max / Math.max(b.getWidth(), b.getHeight()));
        if (s < 1f) b = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * s), Math.round(b.getHeight() * s), true);
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, q, o);
        return Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
    }

    /* ---------------- on-device text and barcode reading ---------------- */

    private void scanStart(String id, String kind) {
        if (scanCallId != null) fail(scanCallId, "Cancelled");
        if (act.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            act.requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_SCAN);
        }
        scanCallId = id; scanKind = kind;
        if (act.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchScanCamera();
    }
    private void launchScanCamera() {
        try {
            File dir = new File(act.getCacheDir(), "scan");
            if (!dir.exists()) dir.mkdirs();
            File f = new File(dir, "scan.jpg");
            scanUri = FileProvider.getUriForFile(act, act.getPackageName() + ".files", f);
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, scanUri);
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            act.startActivityForResult(cam, REQ_SCAN);
        } catch (Exception e) {
            String c = scanCallId; scanCallId = null; fail(c, "Could not open the camera.");
        }
    }
    private void runRecognizer() {
        final String id = scanCallId; scanCallId = null;
        InputImage img;
        try { img = InputImage.fromFilePath(act, scanUri); } catch (Exception e) { fail(id, "Could not read that photo."); return; }
        if ("barcode".equals(scanKind)) {
            BarcodeScanning.getClient().process(img).addOnSuccessListener(list -> {
                for (Barcode b : list) {
                    if (b.getRawValue() != null) { try { reply(id, true, new JSONObject().put("value", b.getRawValue()).put("format", b.getFormat())); } catch (Exception ignored) { } return; }
                }
                fail(id, "No barcode found. Fill the frame with the code and try again.");
            }).addOnFailureListener(e -> fail(id, "Barcode reader failed: " + e.getMessage()));
        } else {
            TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS).process(img).addOnSuccessListener(t -> {
                try { reply(id, true, new JSONObject().put("text", t.getText())); } catch (Exception ignored) { }
            }).addOnFailureListener(e -> fail(id, "Text reader failed: " + e.getMessage()));
        }
    }

    /* ---------------- fingerprint / face unlock ---------------- */

    private boolean bioAvailable() {
        if (Build.VERSION.SDK_INT < 30) return false;
        BiometricManager bm = act.getSystemService(BiometricManager.class);
        return bm != null && bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL) == BiometricManager.BIOMETRIC_SUCCESS;
    }
    private void bioSet(String id, boolean on) {
        if (!on) { prefs().edit().putBoolean("bio", false).apply(); reply(id, true, null); return; }
        if (!bioAvailable()) { fail(id, "Set up a fingerprint, face unlock or screen lock on this phone first."); return; }
        authenticate(() -> { prefs().edit().putBoolean("bio", true).apply(); unlocked = true; reply(id, true, null); },
                     () -> fail(id, "Not confirmed"));
    }
    private void authenticate(Runnable ok, Runnable no) {
        if (Build.VERSION.SDK_INT < 30) { ok.run(); return; }
        Executor ex = act.getMainExecutor();
        BiometricPrompt p = new BiometricPrompt.Builder(act)
                .setTitle("Unlock Clubhouse IQ")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();
        p.authenticate(new CancellationSignal(), ex, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { ok.run(); }
            @Override public void onAuthenticationError(int code, CharSequence msg) { no.run(); }
        });
    }
    void onPause() { pausedAt = System.currentTimeMillis(); }
    /** Lock after a minute away when the person turned unlock on. */
    void onResume(FrameLayout root) {
        boolean on = prefs().getBoolean("bio", false) && bioAvailable();
        if (!on) { hideLock(root); return; }
        if (unlocked && System.currentTimeMillis() - pausedAt < 60_000) return;
        unlocked = false;
        showLock(root);
        authenticate(() -> { unlocked = true; hideLock(root); }, () -> { });
    }
    private void showLock(FrameLayout root) {
        if (lockView != null) return;
        LinearLayout l = new LinearLayout(act);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.parseColor("#1F3A63"));
        l.setClickable(true);
        TextView t = new TextView(act);
        t.setText("Clubhouse IQ is locked");
        t.setTextColor(Color.WHITE);
        t.setTextSize(20);
        t.setGravity(Gravity.CENTER);
        Button b = new Button(act);
        b.setText("Unlock");
        b.setAllCaps(false);
        b.setOnClickListener(v -> authenticate(() -> { unlocked = true; hideLock(root); }, () -> { }));
        l.addView(t);
        l.addView(b);
        lockView = l;
        root.addView(l, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }
    private void hideLock(FrameLayout root) {
        if (lockView != null) { root.removeView(lockView); lockView = null; }
    }

    /* ---------------- activity results ---------------- */

    boolean onActivityResult(int req, int res) {
        if (req != REQ_SCAN) return false;
        if (scanCallId == null) return true;
        if (res == Activity.RESULT_OK) runRecognizer();
        else { String c = scanCallId; scanCallId = null; fail(c, "Cancelled"); }
        return true;
    }
    boolean onPermission(int req, int[] results) {
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_NOTIF) {
            String id = pushCallId; pushCallId = null;
            if (granted) fetchPushToken(id); else fail(id, "Alerts are blocked. Allow notifications for Clubhouse IQ in Settings.");
            return true;
        }
        if (req == REQ_SCAN) {
            if (granted && scanCallId != null) launchScanCamera();
            else if (scanCallId != null) { String c = scanCallId; scanCallId = null; fail(c, "Camera permission is needed to read the plate."); }
            return true;
        }
        return false;
    }
}
