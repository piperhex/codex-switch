import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../apps/admin-ui/src/pages/server-bandwidth.ts", import.meta.url), "utf8");
const exports = {};
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports, Intl });
const { formatBandwidthBytes } = exports;

test("bandwidth scales at 1024-byte boundaries and keeps MB as the largest unit", () => {
  for (const language of ["zh", "en"]) {
    for (const [bytes, expected] of [
      [0, "0 B"], [512, "512 B"], [1023, "1,023 B"], [1024, "1 KB"],
      [1536, "1.5 KB"], [1024 ** 2, "1 MB"], [1.25 * 1024 ** 2, "1.25 MB"],
      [1024 ** 3, "1,024 MB"],
    ]) assert.equal(formatBandwidthBytes(bytes, language), expected);
  }
});

test("invalid byte counts never show negative rates or invalid unit names", () => {
  for (const bytes of [-1, NaN, Infinity, -Infinity]) {
    assert.equal(formatBandwidthBytes(bytes, "zh"), "0 B");
  }
});
