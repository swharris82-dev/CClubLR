package org.cclr.clubhouseiq;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * Clubhouse IQ for Android. A full-screen WebView around the hosted app, with
 * the pieces a plain browser tab would miss on a phone: camera for data plates
 * and work order photos, tap-to-call and email links, report printing to PDF,
 * the back button, and an offline screen when there is no signal.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 41;
    private static final int REQ_CAMERA_PERM = 42;
    private static final String HOST = Uri.parse(BuildConfig.APP_URL).getHost();
    private static final int NAVY = Color.parseColor("#1F3A63");

    private WebView web;
    private ProgressBar bar;
    private View offlineView;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private WebChromeClient.FileChooserParams pendingParams;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.setStatusBarColor(NAVY);
        w.setNavigationBarColor(NAVY);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F3EFE5"));

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#B79B5B")));
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        bp.gravity = Gravity.TOP;
        root.addView(bar, bp);

        offlineView = buildOfflineView();
        offlineView.setVisibility(View.GONE);
        root.addView(offlineView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        setupWebView();

        if (saved != null) {
            web.restoreState(saved);
        } else {
            Uri data = getIntent() != null ? getIntent().getData() : null;
            web.loadUrl(data != null && HOST.equals(data.getHost()) ? data.toString() : BuildConfig.APP_URL);
        }
    }

    private void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " ClubhouseIQ-Android/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return handleExternal(req.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                bar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bar.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // Only the main page failing matters. The app's own service
                // worker serves cached data when single requests fail.
                if (req.isForMainFrame() && !isOnline()) showOffline(true);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                pendingParams = params;
                if (wantsImage(params) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
                } else {
                    openChooser(params);
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Camera or microphone for live diagnosis, only for our own site.
                if (request.getOrigin() != null && HOST.equals(request.getOrigin().getHost())) {
                    request.grant(request.getResources());
                } else {
                    request.deny();
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message resultMsg) {
                // Reports open in a new window. Show them full screen with a
                // Print / Save PDF button, since window.print() does nothing in
                // an Android WebView.
                showReportWindow(resultMsg);
                return true;
            }
        });
    }

    /* ---------------- links that leave the app ---------------- */

    private boolean handleExternal(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if (("https".equals(scheme) || "http".equals(scheme)) && HOST.equals(uri.getHost())) return false;
        Intent i;
        switch (scheme) {
            case "tel":
                i = new Intent(Intent.ACTION_DIAL, uri);
                break;
            case "mailto":
                i = new Intent(Intent.ACTION_SENDTO, uri);
                break;
            case "sms":
            case "smsto":
                i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + uri.getSchemeSpecificPart()));
                String body = uri.getQueryParameter("body");
                if (body == null && uri.toString().contains("body=")) {
                    body = Uri.decode(uri.toString().substring(uri.toString().indexOf("body=") + 5));
                }
                if (body != null) i.putExtra("sms_body", body);
                break;
            case "intent":
                try {
                    i = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                } catch (Exception e) {
                    return true;
                }
                break;
            default:
                i = new Intent(Intent.ACTION_VIEW, uri);
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            // Nothing on the phone handles it. Stay put.
        }
        return true;
    }

    /* ---------------- camera and photo picker ---------------- */

    private boolean wantsImage(WebChromeClient.FileChooserParams p) {
        if (p == null) return false;
        String[] types = p.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String t : types) if (t == null || t.isEmpty() || t.startsWith("image")) return true;
        return false;
    }

    private void openChooser(WebChromeClient.FileChooserParams params) {
        List<Intent> extra = new ArrayList<>();
        cameraUri = null;
        if (wantsImage(params) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, "ciq_" + System.currentTimeMillis() + ".jpg");
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                if (Build.VERSION.SDK_INT >= 29) v.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Clubhouse IQ");
                cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                extra.add(cam);
            } catch (Exception ignored) {
                cameraUri = null;
            }
        }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(wantsImage(params) ? "image/*" : "*/*");
        Intent chooser = Intent.createChooser(pick, "Add a photo");
        if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
        try {
            startActivityForResult(chooser, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            finishChooser(null);
        }
    }

    private void finishChooser(Uri[] result) {
        if (fileCallback != null) fileCallback.onReceiveValue(result);
        fileCallback = null;
        pendingParams = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (data != null && data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                result = new Uri[]{data.getClipData().getItemAt(0).getUri()};
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        } else if (cameraUri != null) {
            try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) { }
        }
        cameraUri = null;
        finishChooser(result);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] perms, int[] results) {
        if (requestCode == REQ_CAMERA_PERM) {
            if (pendingParams != null || fileCallback != null) openChooser(pendingParams);
            return;
        }
        super.onRequestPermissionsResult(requestCode, perms, results);
    }

    /* ---------------- report windows and printing ---------------- */

    private void showReportWindow(Message resultMsg) {
        Dialog d = new Dialog(this, android.R.style.Theme_Material_Light_NoActionBar);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);

        LinearLayout top = new LinearLayout(this);
        top.setBackgroundColor(NAVY);
        top.setPadding(dp(8), dp(8), dp(8), dp(8));
        top.setGravity(Gravity.CENTER_VERTICAL);
        Button close = pillButton("Close", false);
        Button print = pillButton("Print or save PDF", true);
        View spacer = new View(this);
        top.addView(close);
        top.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));
        top.addView(print);
        col.addView(top);

        WebView child = new WebView(this);
        WebSettings cs = child.getSettings();
        cs.setJavaScriptEnabled(true);
        cs.setDomStorageEnabled(true);
        child.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) { d.dismiss(); web.loadUrl(u.toString()); return true; }
                return handleExternal(u);
            }
        });
        child.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onCloseWindow(WebView window) { d.dismiss(); }
        });
        col.addView(child, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        close.setOnClickListener(v -> d.dismiss());
        print.setOnClickListener(v -> printWebView(child));
        d.setContentView(col);
        d.setOnDismissListener(x -> child.destroy());
        if (d.getWindow() != null) {
            d.getWindow().setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
            d.getWindow().setStatusBarColor(NAVY);
        }
        d.show();

        WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
        t.setWebView(child);
        resultMsg.sendToTarget();
    }

    private void printWebView(WebView v) {
        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        String title = v.getTitle() == null || v.getTitle().isEmpty() ? "Clubhouse IQ report" : v.getTitle();
        PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(title);
        pm.print(title, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.NA_LETTER).build());
    }

    private Button pillButton(String text, boolean primary) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(primary ? NAVY : Color.WHITE);
        b.setBackgroundColor(primary ? Color.parseColor("#D8BE7C") : Color.TRANSPARENT);
        b.setPadding(dp(14), 0, dp(14), 0);
        return b;
    }

    /* ---------------- offline screen ---------------- */

    private View buildOfflineView() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.parseColor("#F3EFE5"));
        l.setPadding(dp(32), dp(32), dp(32), dp(32));
        TextView h = new TextView(this);
        h.setText("No signal");
        h.setTextSize(24);
        h.setTextColor(NAVY);
        h.setGravity(Gravity.CENTER);
        TextView m = new TextView(this);
        m.setText("Clubhouse IQ could not reach the server and has not been opened on this phone before. Open it once with a connection and it will work offline after that.");
        m.setTextSize(15);
        m.setTextColor(Color.parseColor("#4A5466"));
        m.setGravity(Gravity.CENTER);
        m.setPadding(0, dp(12), 0, dp(20));
        Button retry = pillButton("Try again", true);
        retry.setOnClickListener(v -> { showOffline(false); web.reload(); });
        l.addView(h);
        l.addView(m);
        l.addView(retry);
        return l;
    }

    private void showOffline(boolean on) {
        offlineView.setVisibility(on ? View.VISIBLE : View.GONE);
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return true;
        NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /* ---------------- lifecycle ---------------- */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && HOST.equals(data.getHost())) web.loadUrl(data.toString());
    }

    @Override
    public void onBackPressed() {
        if (offlineView.getVisibility() == View.VISIBLE) { super.onBackPressed(); return; }
        // Let the app close an open sheet first, then go back in history.
        web.evaluateJavascript("(function(){var s=document.getElementById('sheetBg');if(s){closeSheet();return 'closed';}" +
                "var p=document.querySelector('.photo-view');if(p){p.remove();return 'closed';}return 'none';})()", r -> {
            if (r != null && r.contains("closed")) return;
            if (web.canGoBack()) web.goBack();
            else MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
