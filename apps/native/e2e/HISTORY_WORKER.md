# Android history preparation

Android uses `ChatHistoryWorker`, a single background Kotlin executor, for canonical JSON traversal,
per-field SHA-256 fingerprints and offline-record signatures. A shared weak cache lets sync and SQLite
reuse the same immutable message preparation. SQLite remains asynchronous through Expo.

The bridge receives JSON in batches of at most 16 objects, normally about 128 KiB. JS yields between
batches, with a 4 ms serialization budget. One large message can exceed that budget: its bridge
serialization still uses `JSON.stringify`. Message rendering and transport assembly also remain in JS;
these measurements do not claim that every part of synchronization runs natively.

The worker preserves JS number lexemes, UTF-16 key ordering, string lengths, control characters and
unpaired surrogates. It hashes canonical values directly into a digest stream. Native failures reject
the current operation instead of silently running the expensive fallback. Older builds and other
platforms retain the portable implementation. A connection reset prevents a prepared stale request
from being sent.

## Device checks

Build the isolated diagnostic package without accessing the normal app's accounts or chat database:

```powershell
# From apps/native; set JAVA_HOME to your JDK 17 directory.
$env:NODE_ENV = 'production'
$env:NODE_PATH = Join-Path (Get-Location) 'node_modules'
node scripts/expo.cjs prebuild --platform android --no-install
Set-Location android
.\gradlew.bat assembleRelease -I ../e2e/history-worker.init.gradle --no-daemon --max-workers=2
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.codexswitch.mobile.historybench/com.codexswitch.mobile.MainActivity
adb logcat -d -s ReactNativeJS:I
```

Look for `HISTORY_BENCHMARK` and `done: true`. Compatibility cases include Unicode, NUL, lone
surrogates, nested objects, arrays, floating-point extremes and failed-job recovery. Each workload
compares complete manifests and cache records against the JS implementation, in both execution orders.

Measured on the connected 2109119BC physical phone, Android release/Hermes, 2026-09-24:

| Workload | JS preparation | Native preparation | Largest JS heartbeat gap, before → after |
| --- | --- | --- | --- |
| 10 messages, about 1 million characters | 3541–3559 ms | 182–188 ms | 3559–3567 → 33–34 ms |
| 128 messages, about 1 million characters | 3719 ms | 263–285 ms | 3727–3736 → 26–27 ms |
| One message, about 1 million characters | 3533–3551 ms | 83–98 ms | 3550–3559 → 40–53 ms |

Warm native preparation took 0.5–11.3 ms. These times cover fingerprinting and cache-record preparation,
not network transfer, SQLite writes or rendering. Heartbeat interval: 16 ms; this is JS responsiveness,
not an Android frame-time measurement. All six comparisons produced identical results.

A separate temporary diagnostic entry point exercised the normal app connected to ZH2 over P2P,
using an existing conversation without sending messages. At 100 loaded items, preparing the same
55-row / 2,092,981-character cache suffix took 2014 ms on JS versus 343 ms with the native worker.
The subsequent cold JS manifest took another 2579 ms. The largest observed heartbeat gaps around
those operations were 2031 / 2608 ms; the native history-load window peaked at 102 ms, including
rendering. Original network assembly/parse took 22 ms (native run: 31 ms). Loading earlier history
expanded the native view to 126 items, with scrolling and cache writes continuing normally.
This is one sequential UI comparison; use the isolated alternating-order benchmark above for
repeatable preparation timings.

Remove the isolated package after testing. Rebuild **without** the init script to produce the normal APK;
never distribute the diagnostic entry point as the normal app.
