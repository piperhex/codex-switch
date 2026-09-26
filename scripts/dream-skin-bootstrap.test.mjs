import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const template = readFileSync(new URL(
  "../apps/desktop/src-tauri/src/dream_skin_native/early_injection.js", import.meta.url,
), "utf8");
const source = template.replace("__DREAM_SKIN_GENERATION_JSON__", '"revision"')
  .replace("__DREAM_SKIN_SOURCE__", "window.injections++");

function renderer() {
  const observers = new Set();
  const timers = new Set();
  const state = { ready: false, injections: 0 };
  const context = {
    window: state,
    location: { protocol: "app:" },
    document: { documentElement: {}, body: {}, querySelector: () => state.ready ? {} : null },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    setTimeout(callback) { timers.add(callback); return callback; },
    clearTimeout(callback) { timers.delete(callback); },
  };
  return { context, state, observers, timers };
}

test("repeated pending injection retains only one observer and installs once when ready", () => {
  const { context, state, observers, timers } = renderer();
  for (let attempt = 0; attempt < 4; attempt++) runInNewContext(source, context);
  assert.equal(state.injections, 0);
  assert.equal(observers.size, 1);
  assert.equal(timers.size, 1);
  state.ready = true;
  for (const observer of [...observers]) observer.callback();
  assert.equal(state.injections, 1);
  assert.equal(state.__CODEX_DREAM_SKIN_EARLY_APPLIED__, "revision");
  assert.equal(observers.size, 0);
  assert.equal(timers.size, 0);
});

test("canceling or timing out a pending injection prevents a later skin resurrection", () => {
  for (const cancel of [
    (state) => state.__CODEX_DREAM_SKIN_EARLY_STOP__(),
    (_state, timers) => [...timers][0](),
  ]) {
    const { context, state, observers, timers } = renderer();
    runInNewContext(source, context);
    cancel(state, timers);
    state.ready = true;
    assert.equal(observers.size, 0);
    assert.equal(timers.size, 0);
    assert.equal(state.injections, 0);
    assert.equal(state.__CODEX_DREAM_SKIN_EARLY_STOP__, undefined);
  }
});

test("non-app pages do not receive the theme even with matching shell markers", () => {
  const { context, state } = renderer();
  context.location.protocol = "https:";
  state.ready = true;
  runInNewContext(source, context);
  assert.equal(state.injections, 0);
});
