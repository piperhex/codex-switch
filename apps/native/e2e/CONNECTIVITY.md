# Android release connection checks

The fixture retains the production React Native modules and app screens but installs as
`com.codexswitch.mobile.regressiontest`. It does not replace the installed app or clear its data.

1. Build the local peer and coordinator:
   `cargo build --locked --manifest-path crates/chat-connectivity/Cargo.toml --bin chat-rendezvous --example device_echo`.
2. From `apps/native/android`, build `assembleRelease -I ../e2e/release.init.gradle`
   with `-PreactNativeArchitectures=arm64-v8a,x86_64`, the Android SDK/NDK, Java and Rust configured.
3. Run `node apps/desktop/e2e/native-device-fixture.mjs`, then install
   `apps/native/android/app/build/outputs/apk/release/release-fixture.apk` with `adb -s SERIAL install -r`.
4. Reverse TCP ports 15049 and 11010 with ADB and launch
   `com.codexswitch.mobile.regressiontest/com.codexswitch.mobile.MainActivity`.
   Only discovery uses the reversed coordinator port; application data requires a verified direct route.
5. Read `http://127.0.0.1:15049/result` and `.codex-tmp/native-device-fixture/result-*.json`.
   Repeat on both physical ARM64 and emulator x86_64 devices. Each run checks local addresses,
   a large Unicode echo, grant renewal, close rejection, and a second echo after reopening.
6. Request `/app` on port 15049. Start the existing local `mobile-fixture.mjs` and run
   `android-connectivity-regression.mjs` with `ANDROID_CHAT_PACKAGE=com.codexswitch.mobile.regressiontest`,
   `ANDROID_CHAT_APK` pointing to the fixture, and `ANDROID_SERIAL` selecting the device.
   Reverse port 1490 as well. Reset the local fixture between devices with POST `/test/reset`.

These local checks establish Android/JNI interoperability and connection recovery. They do not
measure public Internet NAT success rates or verify Windows secure-desktop capture.
