# Android beta channel

The beta channel uses GitHub prereleases tagged `v1.0.0-beta.1`, `v1.0.0-beta.2`, etc. Testers install the signed APK from the release assets. It uses the live HabitCents server and Supabase accounts: beta activity affects real data.

Repository: https://github.com/sabbirx06/habitcents

The `release/beta` branch records the beta source snapshot. GitHub prerelease tags identify exact published versions; the branch alone is not an installable update.

First beta:

- Version: `1.0.0-beta.1`, Android version code `2`.
- Package: `com.habitcents.app.beta`.
- Launcher name: HabitCents Beta.
- Server: `https://habitcents.duckdns.org`.
- Android 11 or newer.
- Release signing, debugging disabled, HTTP disabled.

Beta installs alongside the existing debug app and signs in separately. A later beta APK updates the beta installation when signed with the same key and a higher version code. Stable uses the separate `com.habitcents.app` package.

## Signing

The signing key and password file live under ignored `android/signing/`. Back up that entire directory securely outside this checkout before deleting or moving it. Losing the key prevents updating existing beta installations. Never commit it or attach it to a GitHub release.

`android/keystore.properties.example` documents the expected settings. Copy it to `android/signing/keystore.properties` only when setting up another trusted build machine, and restore the original key and passwords from your backup. Do not generate a replacement key for an existing beta channel.

## Publish the next beta

1. Increase `versionCode` and update the beta suffix in `android/app/build.gradle`.
2. Commit the intended source snapshot; update the release notes with actual changes and remaining limitations.
3. From `android`, run `gradlew.bat :app:assembleBeta` (or `./gradlew :app:assembleBeta` on Linux/macOS).
4. Verify the APK signing certificate with Android SDK `apksigner verify --verbose --print-certs` and compare it with the previous release's certificate.
5. Publish a GitHub prerelease targeting that commit, tagged with the beta version. Attach the signed APK and its SHA-256 checksum. Keep it marked prerelease rather than latest stable.

The first beta is a direct APK release, not a Google Play testing track. Updates are installed manually from GitHub. Web UI changes reach the installed beta through the hosted server without another APK; changes to the Android shell require a new signed beta.

The user manually checked signup/login, desktop/mobile layouts and Android on mobile data before this beta. Automated application tests and a security audit were deferred at the user's request. Building and checking the release artifact does not establish that every app flow has been tested.
