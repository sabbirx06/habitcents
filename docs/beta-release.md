# Android beta channel

The beta channel uses GitHub prereleases tagged `v1.0.0-beta.1`, `v1.0.0-beta.2`, etc. Testers install the signed APK from the release assets. It uses the live HabitCents server and Supabase accounts: beta activity affects real data.

Repository: https://github.com/sabbirx06/habitcents

The `release/beta` branch records the beta source snapshot. GitHub prerelease tags identify exact published versions; the branch alone is not an installable update.

Current beta:

- Version: `1.0.0-beta.2`, Android version code `3`.
- Package: `com.habitcents.app.beta`.
- Launcher name: HabitCents Beta.
- Server: `https://habitcents.duckdns.org`.
- Android 11 or newer.
- Release signing, debugging disabled, HTTP disabled.
- Adaptive launcher icon uses the existing HabitCents brand mark, including a themed monochrome variant.

Beta installs alongside the existing debug app and signs in separately. A later beta APK updates the beta installation when signed with the same key and a higher version code. Stable uses the separate `com.habitcents.app` package.

## Signing

The signing key and password file live under ignored `android/signing/`. Back up that entire directory securely outside this checkout before deleting or moving it. Losing the key prevents updating existing beta installations. Never commit it or attach it to a GitHub release.

`android/keystore.properties.example` documents the expected settings. Copy it to `android/signing/keystore.properties` only when setting up another trusted build machine, and restore the original key and passwords from your backup. Do not generate a replacement key for an existing beta channel.

## Publish the next beta

1. Increase `versionCode` and update the beta suffix in `android/app/build.gradle`.
2. Commit the intended source snapshot; update the release notes and website download links for the new version.
3. From `android`, run `gradlew.bat :app:assembleBeta` (or `./gradlew :app:assembleBeta` on Linux/macOS). From the repository root, run `node scripts/prepare-beta-release.cjs "A short user-facing summary"` to create the release APK, checksum and update manifest under `.cache/releases/vVERSION/`, plus `public/updates/android-beta.json`.
4. Verify the APK signing certificate with Android SDK `apksigner verify --verbose --print-certs` and compare it with the previous release's certificate.
5. Publish a GitHub prerelease targeting the intended source commit, tagged with the beta version. Attach the signed APK, SHA-256 checksum and `android-beta.json`. Keep it marked prerelease rather than latest stable.
6. Only after the GitHub APK is publicly downloadable, deploy `public/updates/android-beta.json` to `/opt/habitcents/public/updates/android-beta.json`. This file announces the update to installed betas; no server restart is needed for a static feed update. Never announce an APK before it is published.

## In-app updates

Beta 2 checks the public HTTPS update feed on launch and when returning to the foreground, at most once every 15 minutes per activity instance. It prompts only for a higher Android version code in the same beta package. Close/Not now snoozes the prompt for 24 hours. Network failures do not interrupt normal app use.

Update now downloads the APK in the app, checks its size and SHA-256, verifies its package/version and compares its signing certificate with the installed app. Downloads stay in private app storage. Only the final verified APK is shared read-only with Android's installer.

Android may ask once to allow installations from HabitCents Beta, then asks for installation confirmation. Normal apps cannot guarantee silent installation. The beta-only manifest declares the installer permission; a Google Play build must use its store-managed update mechanism instead.

Beta 1 has no updater and needs one manual installation of Beta 2. After that, newer beta releases use the in-app flow. Web UI changes still reach the installed beta through the server without another APK. This is a direct APK channel, not a Google Play testing track.

The user manually checked signup/login, desktop/mobile layouts and Android on mobile data before this beta. Automated application tests and a security audit were deferred at the user's request. Building and checking the release artifact does not establish that every app flow has been tested.
