# Git tool regression

The isolated fixture uses `com.codexswitch.mobile.gittest` and in-memory Git data.
It never modifies a real repository or replaces the installed Codex Switch app.

From `apps/native/android`, with Java and the Android SDK configured:

```powershell
$env:NODE_ENV = 'production'
$env:NODE_PATH = (Resolve-Path ../node_modules).Path
.\gradlew.bat assembleRelease -I ../e2e/git.init.gradle -PreactNativeArchitectures=x86_64
node ../e2e/git-tools.mjs
```

The script requires `emulator-5580` (or set `ANDROID_SERIAL` to another emulator).
It checks the tools menu, selecting files, diff navigation, committing, and merge
history. Screenshots, including the open keyboard, are saved in
`.codex-tmp/git-tools-android/`. Inspect them for clipping and readable graph edges.

The shared hook tests cover stale project requests, conflict/offline states,
failed commits and graph continuity. Rust tests use temporary repositories to
verify selected commits, unrelated staging, hooks, renames, deletions and history.
Web coverage is `apps/web/e2e/chat-git.pw.ts` at phone and desktop widths.
