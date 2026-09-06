import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadModule(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  runInNewContext(source, { exports, ...globals, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function createReactHarness() {
  const slots = [];
  let cursor = 0;
  let changed = false;
  let effects = [];
  const react = {
    useRef(value) { const index = cursor++; slots[index] ??= { current: value }; return slots[index]; },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = value;
      return [slots[index], next => {
        if (!Object.is(slots[index], next)) { slots[index] = next; changed = true; }
      }];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const prior = slots[index];
      if (prior && dependencies.every((value, offset) => Object.is(value, prior.dependencies[offset]))) return;
      effects.push(() => {
        prior?.cleanup?.();
        slots[index] = { dependencies, cleanup: effect() };
      });
    },
  };
  function render(hook) {
    let result;
    do {
      changed = false; cursor = 0; effects = [];
      result = hook();
      for (const effect of effects) effect();
    } while (changed);
    return result;
  }
  return { react, render };
}

function createEditorHarness(options = {}) {
  const hooks = createReactHarness();
  const timers = new Map();
  let timerId = 0;
  let closed = 0;
  let props = {
    open: true, content: 'model = "first"', revision: "revision-1",
    onSave: async () => "revision-2", onClose: () => { closed += 1; }, ...options.props,
  };
  const { useTomlEditor } = loadModule("../apps/desktop/src/pages/codexConfig/useTomlEditor.ts", {
    react: hooks.react,
    "../../api/codexConfig": { validateCodexConfigDocument: options.validate ?? (async () => null) },
  }, { window: {
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  } });
  let current;
  const render = (next = {}) => {
    props = { ...props, ...next };
    current = hooks.render(() => useTomlEditor(props));
    return current;
  };
  render();
  return {
    render,
    edit(value) { current.edit(value); render(); },
    tick() { const callbacks = [...timers.values()]; timers.clear(); return Promise.all(callbacks.map(run => run())); },
    get current() { return current; },
    get closed() { return closed; },
    get timerCount() { return timers.size; },
  };
}

test("invalid drafts cannot save or close, and parser location is retained", async () => {
  let writes = 0;
  const editor = createEditorHarness({
    validate: async () => ({ message: "Missing quote", line: 2, column: 4 }),
    props: { onSave: async () => { writes += 1; return "revision-2"; } },
  });
  editor.edit('broken = "');
  assert.equal(await editor.current.close(), false);
  editor.render();
  assert.equal(writes, 0);
  assert.equal(editor.closed, 0);
  assert.equal(editor.current.issue.line, 2);
  assert.equal(editor.current.issue.column, 4);
  assert.equal(editor.current.draft, 'broken = "');
});

test("closing unchanged content validates before debounce and avoids rewriting valid files", async () => {
  let validations = 0;
  let writes = 0;
  const editor = createEditorHarness({
    validate: async () => ++validations === 1 ? { message: "Invalid file", line: 1, column: 1 } : null,
    props: { onSave: async () => { writes += 1; return "revision-2"; } },
  });
  assert.equal(await editor.current.close(), false);
  assert.equal(editor.closed, 0);
  editor.render();
  assert.equal(await editor.current.close(), true);
  assert.equal(editor.closed, 1);
  assert.equal(validations, 2);
  assert.equal(writes, 0);
});

test("typing while saving preserves the latest draft and advances its expected revision", async () => {
  const firstWrite = deferred();
  const started = deferred();
  const writes = [];
  const editor = createEditorHarness({ props: { onSave: async (content, revision) => {
    writes.push({ content, revision });
    started.resolve();
    return writes.length === 1 ? firstWrite.promise : "revision-3";
  } } });
  editor.edit('model = "second"');
  const saving = editor.current.save();
  await started.promise;
  editor.edit('model = "third"');
  firstWrite.resolve("revision-2");
  assert.equal(await saving, false);
  editor.render();
  assert.equal(editor.current.draft, 'model = "third"');
  assert.equal(editor.current.status, "changed");
  assert.equal(await editor.current.save(), true);
  assert.deepEqual(writes, [
    { content: 'model = "second"', revision: "revision-1" },
    { content: 'model = "third"', revision: "revision-2" },
  ]);
});

test("a newer blur waits for an older validation and ignores its stale diagnostic", async () => {
  const validation = deferred();
  let parses = 0;
  const editor = createEditorHarness({
    validate: async () => ++parses === 1 ? validation.promise : null,
  });
  editor.edit('model = "older"');
  const older = editor.current.save();
  editor.edit('model = "newer"');
  const newer = editor.current.save();
  validation.resolve({ message: "Stale error", line: 1, column: 1 });
  assert.equal(await older, false);
  assert.equal(await newer, true);
  editor.render();
  assert.equal(editor.current.issue, null);
  assert.equal(editor.current.draft, 'model = "newer"');
});

test("duplicate blur and close events share one pending write", async () => {
  const write = deferred();
  const started = deferred();
  let writes = 0;
  const editor = createEditorHarness({ props: { onSave: async () => {
    writes += 1;
    started.resolve();
    return write.promise;
  } } });
  editor.edit('model = "second"');
  const saving = editor.current.save();
  await started.promise;
  const closing = editor.current.close();
  write.resolve("revision-2");
  assert.equal(await saving, true);
  assert.equal(await closing, true);
  assert.equal(writes, 1);
  assert.equal(editor.closed, 1);
});

test("external refresh preserves a dirty draft and its original revision", async () => {
  const writes = [];
  const editor = createEditorHarness({ props: { onSave: async (content, revision) => {
    writes.push({ content, revision });
    return false;
  } } });
  editor.edit('model = "draft"');
  editor.render({ content: 'model = "external"', revision: "external-revision" });
  assert.equal(editor.current.draft, 'model = "draft"');
  assert.equal(await editor.current.save(), false);
  assert.deepEqual(writes, [{ content: 'model = "draft"', revision: "revision-1" }]);
});

test("external refresh updates a clean editor and the revision used for its next edit", async () => {
  let expectedRevision;
  const editor = createEditorHarness({ props: { onSave: async (_content, revision) => {
    expectedRevision = revision;
    return "revision-3";
  } } });
  editor.render({ content: 'model = "external"', revision: "external-revision" });
  assert.equal(editor.current.draft, 'model = "external"');
  editor.edit('model = "new"');
  assert.equal(await editor.current.save(), true);
  assert.equal(expectedRevision, "external-revision");
});

test("failed saves retain edits and show the parent's safe error inside the editor", async () => {
  const editor = createEditorHarness({ props: { onSave: async () => false } });
  editor.edit('model = "retained"');
  assert.equal(await editor.current.close(), false);
  editor.render({ saveError: "Configuration changed elsewhere. Reload before editing again." });
  assert.equal(editor.current.draft, 'model = "retained"');
  assert.equal(editor.closed, 0);
  assert.equal(editor.current.issue.message, "Configuration changed elsewhere. Reload before editing again.");
  await editor.tick();
  editor.render();
  assert.equal(editor.current.issue.message, "Configuration changed elsewhere. Reload before editing again.");
});

test("debounced validation discards stale results and clears timers when the editor closes", async () => {
  const validation = deferred();
  let parses = 0;
  const editor = createEditorHarness({ validate: async () => ++parses === 1 ? validation.promise : null });
  editor.edit('model = "older"');
  const older = editor.tick();
  editor.edit('model = "newer"');
  await editor.tick();
  validation.resolve({ message: "Stale error", line: 1, column: 1 });
  await older;
  editor.render();
  assert.equal(editor.current.issue, null);
  editor.edit('model = "last"');
  assert.equal(editor.timerCount, 1);
  editor.render({ open: false });
  assert.equal(editor.timerCount, 0);
});

test("discard closes without writing and reopening starts with the latest external document", async () => {
  let writes = 0;
  const editor = createEditorHarness({ props: { onSave: async () => { writes += 1; return "revision-2"; } } });
  editor.edit('broken = "');
  editor.render({ content: 'model = "external"', revision: "external-revision" });
  assert.equal(editor.current.discard(), true);
  assert.equal(editor.closed, 1);
  assert.equal(writes, 0);
  editor.render({ open: false });
  editor.render({ open: true });
  assert.equal(editor.current.draft, 'model = "external"');
  assert.equal(editor.current.issue, null);
  assert.equal(editor.current.status, "clean");
});

test("discard cannot race a pending write, even when further typing changes the editor status", async () => {
  const write = deferred();
  const started = deferred();
  const editor = createEditorHarness({ props: { onSave: async () => {
    started.resolve();
    return write.promise;
  } } });
  editor.edit('model = "pending"');
  const saving = editor.current.save();
  await started.promise;
  editor.edit('model = "newer"');
  assert.equal(editor.current.saving, true);
  assert.equal(editor.current.discard(), false);
  assert.equal(editor.closed, 0);
  write.resolve("revision-2");
  await saving;
  editor.render();
  assert.equal(editor.current.saving, false);
  assert.equal(editor.current.discard(), true);
  assert.equal(editor.closed, 1);
});

const { ConfigWriteQueue } = loadModule("../apps/desktop/src/pages/codexConfig/configWriteQueue.ts");

test("queued writes run one at a time and use the preceding successful revision", async () => {
  const queue = new ConfigWriteQueue();
  const first = deferred();
  const started = deferred();
  const revisions = [];
  const loading = queue.enqueue(async current => {
    assert.equal(current, null);
    started.resolve();
    return first.promise;
  });
  const second = queue.enqueue(async current => {
    revisions.push(current.revision);
    return { ...current, revision: "revision-2" };
  });
  const third = queue.enqueue(async current => {
    revisions.push(current.revision);
    return { ...current, revision: "revision-3" };
  });
  await started.promise;
  assert.deepEqual(revisions, []);
  first.resolve({ content: "", revision: "revision-1", values: {}, error: null });
  await Promise.all([loading, second, third]);
  assert.deepEqual(revisions, ["revision-1", "revision-2"]);
});

test("a rejected queued write preserves the last revision and does not block subsequent changes", async () => {
  const queue = new ConfigWriteQueue();
  await queue.enqueue(async () => ({ content: "", revision: "revision-1", values: {}, error: null }));
  const failed = queue.enqueue(async () => { throw new Error("Write failed"); });
  const next = queue.enqueue(async current => {
    assert.equal(current.revision, "revision-1");
    return { ...current, revision: "revision-2" };
  });
  await assert.rejects(failed, /Write failed/);
  assert.equal((await next).revision, "revision-2");
});
