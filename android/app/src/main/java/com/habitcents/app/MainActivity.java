package com.habitcents.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private WebView web;
    private LinearLayout error;
    private ProgressBar progress;
    private String retryUrl = BuildConfig.APP_URL + "/dashboard";
    private boolean failed;
    private AppUpdater updater;

    private boolean isAppUrl(String url) {
        Uri target = Uri.parse(url), origin = Uri.parse(BuildConfig.APP_URL);
        return origin.getScheme().equals(target.getScheme()) && origin.getHost().equals(target.getHost())
            && origin.getPort() == target.getPort() && target.getUserInfo() == null;
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        updater = new AppUpdater(this);
        getWindow().setDecorFitsSystemWindows(false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(222, 219, 212));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
        web = new WebView(this);
        web.setId(View.generateViewId());
        web.setBackgroundColor(Color.rgb(222, 219, 212));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        error = new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setGravity(Gravity.CENTER);
        error.setPadding(dp(28), dp(28), dp(28), dp(28));
        error.setBackgroundColor(Color.rgb(222, 219, 212));
        TextView heading = new TextView(this);
        heading.setText("Unable to connect"); heading.setTextSize(24); heading.setTextColor(Color.rgb(34, 35, 32));
        error.addView(heading);
        TextView detail = new TextView(this);
        detail.setText(BuildConfig.APP_URL.startsWith("http://127.0.0.1:") ? "Keep the HabitCents server running on your computer and reconnect wireless debugging." : "Check your connection, then try again.");
        detail.setTextSize(16); detail.setGravity(Gravity.CENTER); detail.setPadding(0, dp(16), 0, dp(24));
        error.addView(detail);
        Button retry = new Button(this); retry.setText("Try again"); retry.setMinHeight(dp(48));
        retry.setOnClickListener(v -> web.loadUrl(retryUrl)); error.addView(retry);
        error.setVisibility(View.GONE); root.addView(error, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " HabitCentsAndroid/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (isAppUrl(url)) return false;
                if (request.isForMainFrame() && request.hasGesture() && (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:"))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                    catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "No app can open this link", Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                failed = false; error.setVisibility(View.GONE);
                if (isAppUrl(url)) retryUrl = url;
            }
            @Override public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!failed) error.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError issue) {
                if (request.isForMainFrame()) showError();
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) showError();
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!isAppUrl(url)) return;
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.addRequestHeader("User-Agent", userAgent);
                request.setMimeType(mime);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime));
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Saving to Downloads", Toast.LENGTH_SHORT).show();
            } catch (RuntimeException e) { Toast.makeText(this, "Download failed. Try again.", Toast.LENGTH_LONG).show(); }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(retryUrl);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, () -> goBack());
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void showError() { failed = true; progress.setVisibility(View.GONE); error.setVisibility(View.VISIBLE); }
    private void goBack() { if (web.canGoBack()) web.goBack(); else finish(); }
    // Android 13+ uses the OnBackInvokedCallback registered above; this is the older OS fallback.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); web.saveState(state); }
    @Override protected void onPause() { CookieManager.getInstance().flush(); web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (updater != null) updater.resume(); }
    @Override protected void onDestroy() { if (updater != null) updater.destroy(); web.destroy(); super.onDestroy(); }
}
