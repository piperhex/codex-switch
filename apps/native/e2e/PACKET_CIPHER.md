# Android packet cipher check

This isolated release/Hermes app checks Android/Noble interoperability, Unicode and NULs,
authentication failures, session isolation, nonce reflection, replay windows and disposal.
It compares JavaScript and native packet throughput. These numbers are **not file transfer speeds**.

From `apps/native`, prepare Android with `node scripts/expo.cjs prebuild --platform android --no-install`.
Then, in PowerShell from `apps/native/android`:

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path ../node_modules).Path
.\gradlew.bat assembleRelease --no-daemon --max-workers=2 -I ../e2e/packet-cipher.init.gradle
adb -s SERIAL install -r app/build/outputs/apk/release/app-release.apk
adb -s SERIAL shell am start -n com.codexswitch.mobile.transferbench/com.codexswitch.mobile.MainActivity
adb -s SERIAL logcat -d -s ReactNativeJS:I
```

Use a connected test device's serial in place of `SERIAL`. The separate package preserves the main app's data.
Results appear on screen and in `TRANSFER_BENCHMARK` logs; any failed assertion reports `TRANSFER_BENCHMARK_ERROR`.
After testing, uninstall only `com.codexswitch.mobile.transferbench`.

The output APK above is the benchmark. Rebuild without the init script before distributing the main app.
