# HabitCents Android

The Android app displays the existing mobile web views in an Android WebView.
The Express server and database run on your computer or a host, not on the phone.
Android 11 or newer is supported. The local APK is for testing, not store distribution.

## Run locally on a phone

1. Install dependencies with `npm ci` if needed.
2. Run `node scripts/android-local.cjs` from the repository root. This uses a separate persistent local PostgreSQL-compatible database in `.cache/android-local-db`, applies migrations only there, and never loads `.env`. Create a test account in the app. Do not use real credentials in this HTTP development environment.
3. Connect wireless debugging and run `adb reverse tcp:3000 tcp:3000`. Repeat after reconnecting the phone.
4. Set `JAVA_HOME` to your JDK (Android Studio's `jbr` works) and `ANDROID_HOME` to your Android SDK.
5. From `android`, run `./gradlew :app:assembleDebug :app:lintDebug -PappUrl=http://127.0.0.1:3000` (`gradlew.bat` on Windows). Without this override the app connects to the hosted website.
6. Run `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` from the repository root, then open HabitCents.

The server must stay running and wireless debugging connected. If disconnected, the app offers Try again. Login cookies and local test accounts persist across restarts. Exports save through Android's Download Manager into Downloads. External links open in the browser. Back follows page history, then closes the activity.

## Hosted builds

The default build now connects to `https://habitcents.duckdns.org`, configured in `android/gradle.properties`. It does not need the local server or ADB reverse connection. See [VPS deployment](vps.md).

Build with `-PappUrl=https://YOUR_HOST` when hosting is available. The URL must be an origin without a subpath, credentials, query or fragment. Release tasks reject HTTP; only debug builds permit it. TLS errors are never bypassed. Database credentials and `.env` are never packaged.

The [beta release channel](beta-release.md) distributes a signed APK with a separate Beta app identity. `:app:assembleBeta` builds the beta; `:app:assembleRelease` builds the stable variant. Both require the local signing configuration and HTTPS. Do not distribute the local debug APK as a hosted release. Final adaptive launcher artwork and store publication remain separate work.

## Verified 2026-10-29

- Debug APK assembled and Android lint passed using SDK 36, Gradle 8.14.3 and Android Gradle Plugin 8.13.0.
- Release dry-run without a hosted URL failed with the expected HTTPS configuration error.
- Installed and tested on the connected Nothing A001 running Android 16 (API 36).
- Created a local test account, logged in, and confirmed login survived force-stop/relaunch.
- Dashboard, Habits, Expenses, Savings and Profile loaded at the phone's 411 CSS pixel width with no horizontal page overflow, failed HTTP resources or runtime exceptions during the automated smoke pass.
- Created and checked off a daily habit (1/1, 100%); saved a Tk 1,000 budget and a Tk 12.50 expense (Tk 987.50 remaining); created a Tk 500 savings goal and contributed Tk 25.
- JSON export saved into the phone's Downloads; Android Back returned from Profile to Savings; removing the ADB reverse connection showed the native retry screen, and restoring it plus Try again recovered Profile.
- `node --test --test-concurrency=2`: 181 tests passed. An earlier unconstrained run failed one test worker; the affected 14 tests also passed when run separately.

Device smoke runner: forward port 9348 to `localabstract:webview_devtools_remote_<app PID>`, sign into a local test account, then run `node scripts/verify-android.cjs`. It visits the five screens and downloads that test account's JSON export. Evidence is stored under ignored `.cache/android-review/`.

Hosted HTTPS operation, signed distribution, tablet layouts, other Android versions and TalkBack have not been verified. The local development server must remain running for this APK to work.
