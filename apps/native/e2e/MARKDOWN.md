# Markdown rendering regression

The fixture reproduces a Chinese candy question with a table, HTML space entities,
inline formulas, a boxed answer, and a formula-only user message. It uses the real
native message components with an isolated Android package and no account.

```powershell
npm test -w @codex-switch/native
npx playwright test --config apps/web/playwright.markdown.config.ts

$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path apps/native/node_modules).Path
Push-Location apps/native/android
.\gradlew.bat assembleRelease -I ../e2e/markdown.init.gradle -PreactNativeArchitectures=arm64-v8a
Pop-Location
adb install -r apps/native/android/app/build/outputs/apk/release/markdown-fixture.apk
adb shell am start -n com.codexswitch.mobile.markdowntest/com.codexswitch.mobile.MainActivity
```

Check that the table scrolls horizontally without excess vertical space, formulas
have no exposed delimiters, `29 个` has a visible box, and the last user bubble
fits its formula. Use `x86_64` instead of `arm64-v8a` for an x86 Android emulator.

The browser suite covers narrow Chromium, narrow WebKit, and desktop views. It
also renders the exact native formula document with all network requests blocked,
checks bundled fonts and height reporting, and verifies horizontal overflow.
WebKit on Windows does not replace a final iOS device check.

KaTeX fonts are bundled in `assets/math-css.json`. After changing the KaTeX version,
run `node apps/native/scripts/build-math-css.cjs` from the repository root.
`npm run check -w @codex-switch/native` checks that these generated assets match.
