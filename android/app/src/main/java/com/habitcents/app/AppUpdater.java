package com.habitcents.app;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AppUpdater {
    private static final int INK = Color.rgb(34, 35, 32), CANVAS = Color.rgb(222, 219, 212);
    private static final long MAX_APK = 50L * 1024 * 1024;
    private static final String APK_PREFIX = "https://github.com/sabbirx06/habitcents/releases/download/";
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Typeface textFont, displayFont;
    private Dialog dialog;
    private Button action;
    private TextView status;
    private ProgressBar progress;
    private JSONObject update;
    private boolean checking, downloading, permissionPending, destroyed;
    private long lastCheck;

    AppUpdater(Activity activity) {
        this.activity = activity;
        textFont = Typeface.createFromAsset(activity.getAssets(), "fonts/text.otf");
        displayFont = Typeface.createFromAsset(activity.getAssets(), "fonts/display.otf");
    }

    void resume() {
        if (permissionPending) {
            permissionPending = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) install();
            else if (status != null) status.setText("Allow updates from HabitCents Beta to continue.");
            return;
        }
        if (!"beta".equals(BuildConfig.BUILD_TYPE) || destroyed || checking || downloading || (dialog != null && dialog.isShowing())) return;
        if (lastCheck != 0 && SystemClock.elapsedRealtime() - lastCheck < 15 * 60 * 1000) return;
        checking = true;
        worker.execute(() -> {
            try {
                HttpURLConnection connection = connect(new URL(BuildConfig.APP_URL + "/updates/android-beta.json"), false);
                JSONObject candidate;
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (bytes.size() + count > 32768) throw new IOException("Update response too large");
                        bytes.write(buffer, 0, count);
                    }
                    candidate = new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
                } finally { connection.disconnect(); }
                validate(candidate);
                activity.runOnUiThread(() -> {
                    checking = false; lastCheck = SystemClock.elapsedRealtime();
                    if (!alive() || candidate.optLong("versionCode") <= BuildConfig.VERSION_CODE) return;
                    long snoozed = activity.getPreferences(0).getLong("update-snooze-until", 0);
                    if (System.currentTimeMillis() < snoozed) return;
                    update = candidate; show();
                });
            } catch (Exception ignored) {
                activity.runOnUiThread(() -> { checking = false; lastCheck = SystemClock.elapsedRealtime(); });
            }
        });
    }

    private void validate(JSONObject candidate) throws Exception {
        if (!BuildConfig.APPLICATION_ID.equals(candidate.getString("packageId")) || candidate.getLong("versionCode") < 1
                || candidate.getInt("minSdk") > android.os.Build.VERSION.SDK_INT
                || !candidate.getString("sha256").matches("[a-f0-9]{64}")
                || candidate.getLong("size") < 1 || candidate.getLong("size") > MAX_APK
                || candidate.getString("versionName").length() > 64 || candidate.getString("summary").length() > 2000) throw new IOException("Invalid update metadata");
        String url = candidate.getString("apkUrl");
        URL parsed = new URL(url);
        if (!url.startsWith(APK_PREFIX) || !"https".equals(parsed.getProtocol()) || !"github.com".equals(parsed.getHost())
                || parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getRef() != null || !parsed.getPath().endsWith(".apk")) throw new IOException("Untrusted update URL");
    }

    private HttpURLConnection connect(URL url, boolean apk) throws IOException {
        for (int redirects = 0; redirects < 6; redirects++) {
            String host = url.getHost();
            boolean trusted = apk ? host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com")
                    : host.equals(Uri.parse(BuildConfig.APP_URL).getHost());
            if (!"https".equals(url.getProtocol()) || !trusted || url.getUserInfo() != null) throw new IOException("Untrusted update connection");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "HabitCentsAndroid/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Cache-Control", "no-cache");
            int code = connection.getResponseCode();
            if (code == 200) return connection;
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String location = connection.getHeaderField("Location"); connection.disconnect();
                if (location == null) throw new IOException("Missing update redirect");
                url = new URL(url, location);
            } else { connection.disconnect(); throw new IOException("Update server unavailable"); }
        }
        throw new IOException("Too many update redirects");
    }

    private boolean alive() { return !destroyed && !activity.isFinishing() && !activity.isDestroyed(); }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, Typeface font) {
        TextView view = new TextView(activity); view.setText(value); view.setTextSize(size); view.setTextColor(INK); view.setTypeface(font); return view;
    }
    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable background = new GradientDrawable(); background.setColor(color); background.setCornerRadius(dp(radius)); return background;
    }
    private void show() {
        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        ScrollView scroll = new ScrollView(activity); scroll.setFillViewport(true); scroll.setBackgroundColor(CANVAS);
        LinearLayout content = new LinearLayout(activity); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(dp(24), dp(20), dp(24), dp(24));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -1));
        progress = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100); progress.setProgress(100); progress.setProgressTintList(ColorStateList.valueOf(INK));
        content.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        LinearLayout top = new LinearLayout(activity); top.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = text("Update available", 16, textFont); label.setTextColor(Color.rgb(91, 93, 83));
        top.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(activity); close.setText("×"); close.setTextSize(28); close.setTextColor(INK); close.setBackgroundColor(Color.TRANSPARENT); close.setContentDescription("Close update");
        close.setPadding(0, 0, 0, 0); close.setMinWidth(0);
        close.setOnClickListener(v -> defer()); top.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout.LayoutParams topSpace = new LinearLayout.LayoutParams(-1, -2); topSpace.topMargin = dp(12); content.addView(top, topSpace);
        TextView title = text("New\nupdate.", 76, displayFont); title.setLetterSpacing(-.04f); title.setLineSpacing(0, .95f);
        title.setMaxLines(2); title.setAutoSizeTextTypeUniformWithConfiguration(40, 76, 2, android.util.TypedValue.COMPLEX_UNIT_SP);
        LinearLayout.LayoutParams titleSpace = new LinearLayout.LayoutParams(-1, -2); titleSpace.topMargin = dp(44); content.addView(title, titleSpace);
        TextView version = text(update.optString("versionName"), 18, textFont); version.setPadding(0, dp(16), 0, 0); content.addView(version);
        View space = new View(activity); content.addView(space, new LinearLayout.LayoutParams(1, dp(32), 1));
        TextView summary = text(update.optString("summary"), 24, textFont); summary.setLineSpacing(dp(3), 1); content.addView(summary);
        status = text("Your account and records stay in place.", 14, textFont); status.setTextColor(Color.rgb(91, 93, 83)); status.setPadding(0, dp(20), 0, dp(20)); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); content.addView(status);
        action = new Button(activity); action.setText("Update now"); action.setAllCaps(false); action.setTypeface(textFont); action.setTextSize(17); action.setTextColor(Color.rgb(247, 246, 240)); action.setBackground(rounded(INK, 12)); action.setOnClickListener(v -> download());
        content.addView(action, new LinearLayout.LayoutParams(-1, dp(54)));
        Button later = new Button(activity); later.setText("Not now"); later.setAllCaps(false); later.setTypeface(textFont); later.setTextColor(INK); later.setBackgroundColor(Color.TRANSPARENT); later.setOnClickListener(v -> defer());
        LinearLayout.LayoutParams laterSpace = new LinearLayout.LayoutParams(-1, dp(48)); laterSpace.topMargin = dp(4); content.addView(later, laterSpace);
        dialog.setContentView(scroll); dialog.setOnCancelListener(d -> defer());
        Window window = dialog.getWindow();
        window.setBackgroundDrawable(new ColorDrawable(CANVAS)); window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        dialog.show(); window.setLayout(-1, -1); window.setDecorFitsSystemWindows(false);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return WindowInsets.CONSUMED;
        });
        scroll.requestApplyInsets();
    }
    private void defer() {
        activity.getPreferences(0).edit().putLong("update-snooze-until", System.currentTimeMillis() + 24 * 60 * 60 * 1000).apply();
        if (dialog != null) dialog.dismiss();
    }

    private File apkFile() { return new File(activity.getFilesDir(), "updates/update.apk"); }
    private void download() {
        if (downloading) return;
        downloading = true; action.setEnabled(false); status.setText("Downloading your update…"); progress.setProgress(0);
        worker.execute(() -> {
            try {
                File file = apkFile(); Files.createDirectories(file.getParentFile().toPath());
                File partial = new File(file.getParentFile(), "update-download.apk");
                HttpURLConnection connection = connect(new URL(update.getString("apkUrl")), true);
                long size = update.getLong("size");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[16384]; int count, previous = -1; long received = 0;
                    while ((count = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted()) throw new IOException("Download interrupted");
                        received += count; if (received > size || received > MAX_APK) throw new IOException("Update is too large");
                        output.write(buffer, 0, count);
                        int percent = (int) (received * 100 / size);
                        if (percent != previous) { previous = percent; activity.runOnUiThread(() -> { if (alive()) progress.setProgress(percent); }); }
                    }
                    if (received != size) throw new IOException("Incomplete download");
                } finally { connection.disconnect(); }
                verify(partial);
                Files.move(partial.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
                activity.runOnUiThread(() -> {
                    downloading = false;
                    if (!alive() || dialog == null || !dialog.isShowing()) return;
                    action.setEnabled(true); action.setText("Install update"); action.setOnClickListener(v -> install());
                    status.setText("Verified and ready. Android will ask you to confirm."); install();
                });
            } catch (Exception ignored) {
                activity.runOnUiThread(() -> {
                    downloading = false;
                    if (alive() && dialog != null && dialog.isShowing()) { status.setText("Update could not be verified or downloaded. Check your connection and try again."); action.setEnabled(true); progress.setProgress(0); }
                });
            }
        });
    }

    private void verify(File file) throws Exception {
        if (file.length() != update.getLong("size")) throw new IOException("Incorrect APK size");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) { byte[] buffer = new byte[16384]; int count; while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count); }
        StringBuilder hex = new StringBuilder(); for (byte b : digest.digest()) hex.append(String.format(Locale.US, "%02x", b & 255));
        if (!hex.toString().equals(update.getString("sha256"))) throw new IOException("Incorrect APK checksum");
        PackageManager pm = activity.getPackageManager();
        PackageInfo archive = pm.getPackageArchiveInfo(file.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (archive == null || !installed.packageName.equals(archive.packageName) || archive.getLongVersionCode() != update.getLong("versionCode")
                || archive.getLongVersionCode() <= installed.getLongVersionCode() || archive.signingInfo == null || installed.signingInfo == null) throw new IOException("Incorrect update package");
        Signature[] candidate = archive.signingInfo.getApkContentsSigners(), current = installed.signingInfo.getApkContentsSigners();
        if (candidate.length != 1 || current.length != 1 || !Arrays.equals(candidate[0].toByteArray(), current[0].toByteArray())) throw new IOException("Incorrect update signer");
    }
    private void install() {
        if (!alive()) return;
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            permissionPending = true;
            try { activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()))); }
            catch (RuntimeException ignored) { permissionPending = false; status.setText("Open Android Settings and allow updates from HabitCents Beta, then try again."); }
            return;
        }
        action.setEnabled(false);
        worker.execute(() -> {
            try {
                verify(apkFile());
                activity.runOnUiThread(() -> {
                    if (!alive() || dialog == null || !dialog.isShowing()) return;
                    action.setEnabled(true);
                    Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/update.apk");
                    Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { activity.startActivity(intent); }
                    catch (RuntimeException ignored) { status.setText("Android could not open the installer. Try again."); }
                });
            } catch (Exception ignored) {
                activity.runOnUiThread(() -> { if (alive()) { status.setText("Update verification failed. Close this screen and try again later."); action.setEnabled(false); } });
            }
        });
    }
    void destroy() { destroyed = true; worker.shutdownNow(); if (dialog != null) dialog.dismiss(); }
}
