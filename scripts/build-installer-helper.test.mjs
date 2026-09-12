import assert from "node:assert/strict";
import test from "node:test";
import { helperEnvironment, helperRoot } from "./build-installer-helper.mjs";
import { join } from "node:path";

const target = "x86_64-pc-windows-msvc";
const staticFlags = "-C target-feature=+crt-static";

test("helper keeps its output separate from application builds", () => {
  const env = helperEnvironment(target, { CARGO_TARGET_DIR: "application-target", KEEP: "value" });
  assert.equal(env.CARGO_TARGET_DIR, join(helperRoot, "target"));
  assert.equal(env.KEEP, "value");
  assert.equal(env.RUSTFLAGS, undefined);
});

test("inherited Rust flags cannot switch the helper back to dynamic CRT", () => {
  const env = helperEnvironment(target, { RUSTFLAGS: "-C debuginfo=1 -C target-feature=-crt-static" });
  assert.equal(env.RUSTFLAGS, `-C debuginfo=1 -C target-feature=-crt-static ${staticFlags}`);
});

test("encoded Rust flags preserve arguments with spaces and take precedence", () => {
  const encoded = "-C\x1flink-arg=/LIBPATH:C:\\Native Libraries\x1f-C\x1ftarget-feature=-crt-static";
  const env = helperEnvironment(target, { CARGO_ENCODED_RUSTFLAGS: encoded, RUSTFLAGS: "ignored" });
  assert.equal(env.CARGO_ENCODED_RUSTFLAGS, `${encoded}\x1f-C\x1ftarget-feature=+crt-static`);
  assert.equal(env.RUSTFLAGS, "ignored");
});

test("empty flag overrides still enforce static CRT", () => {
  assert.equal(helperEnvironment(target, { RUSTFLAGS: "" }).RUSTFLAGS, staticFlags);
  assert.equal(helperEnvironment(target, { CARGO_ENCODED_RUSTFLAGS: "" }).CARGO_ENCODED_RUSTFLAGS,
    "-C\x1ftarget-feature=+crt-static");
});

test("target-specific flags are preserved when overriding Cargo configuration", () => {
  const key = "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS";
  assert.equal(helperEnvironment(target, { [key]: "-C target-feature=-crt-static" })[key],
    `-C target-feature=-crt-static ${staticFlags}`);
});
