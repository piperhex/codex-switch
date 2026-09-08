// Verify plugin operations against the GUI-managed CLI using two disposable homes.
// Usage: node scripts/official-plugins-smoke.mjs <path-to-codex>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const executable = process.argv[2];
assert.ok(executable, "Pass the GUI-managed Codex executable");
const root = await mkdtemp(join(tmpdir(), "official-plugins-smoke-"));
const repository = join(root, "marketplace");
const pluginId = "fixture@openai-bundled";
const processes = [];

async function connect(home) {
  const child = spawn(executable, ["app-server"], {
    cwd: home, env: { ...process.env, CODEX_HOME: home },
    windowsHide: true, stdio: ["pipe", "pipe", "ignore"],
  });
  processes.push(child);
  let nextId = 0;
  const pending = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    if (message.method) return;
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  const request = (method, params) => new Promise((resolveResult, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 120000);
    pending.set(id, { resolve: resolveResult, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  await request("initialize", { clientInfo: { name: "codex_switch_plugins", version: "1.0.0" },
    capabilities: { experimentalApi: true } });
  child.stdin.write('{"method":"initialized"}\n');
  return request;
}

async function home(name) {
  const directory = join(root, name);
  await mkdir(directory);
  const bundled = join(directory, ".tmp", "bundled-marketplaces", "openai-bundled");
  await cp(repository, bundled, { recursive: true });
  await writeFile(join(directory, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "fixture-not-a-real-key" }));
  await writeFile(join(directory, "config.toml"),
    `[features]\nplugins = true\n[marketplaces.openai-bundled]\nsource_type = "local"\n`
    + `source = ${JSON.stringify(bundled)}\n`);
  return directory;
}

async function fixture(request) {
  const result = await request("plugin/list", { marketplaceKinds: ["local"] });
  const market = result.marketplaces.find((entry) => entry.name === "openai-bundled");
  assert.ok(market, `CLI discovers the configured official marketplace: ${JSON.stringify(result)}`);
  return { market, plugin: market.plugins.find((entry) => entry.id === pluginId) };
}

try {
  await mkdir(join(repository, ".agents", "plugins"), { recursive: true });
  await mkdir(join(repository, "plugins", "fixture", ".codex-plugin"), { recursive: true });
  await writeFile(join(repository, ".agents", "plugins", "marketplace.json"), JSON.stringify({
    name: "openai-bundled", plugins: [{ name: "fixture",
      source: { source: "local", path: "./plugins/fixture" },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Tools" }],
  }));
  await writeFile(join(repository, "plugins", "fixture", ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", description: "Isolated plugin test" }));
  const first = await home("first");
  const second = await home("second");
  const secondConfig = await readFile(join(second, "config.toml"), "utf8");
  const request = await connect(first);
  const { market, plugin } = await fixture(request);
  assert.ok(plugin);
  assert.equal(plugin.installed, false);
  await request("plugin/install", { marketplacePath: market.path, pluginName: "fixture" });
  assert.equal((await fixture(request)).plugin.installed, true);
  await request("config/value/write", {
    keyPath: `plugins.${JSON.stringify(pluginId)}.enabled`, value: false, mergeStrategy: "replace",
  });
  assert.equal((await fixture(request)).plugin.enabled, false);
  await request("config/value/write", {
    keyPath: `plugins.${JSON.stringify(pluginId)}.enabled`, value: true, mergeStrategy: "replace",
  });
  assert.equal((await fixture(request)).plugin.enabled, true);
  const other = await connect(second);
  assert.equal((await fixture(other)).plugin.installed, false);
  assert.equal(await readFile(join(second, "config.toml"), "utf8"), secondConfig);
  await request("plugin/uninstall", { pluginId });
  assert.equal((await fixture(request)).plugin.installed, false);
  console.log("PASS: CLI list, install, disable, enable, uninstall, and home isolation");
} finally {
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }));
  assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
  assert.ok(root.split(sep).at(-1).startsWith("official-plugins-smoke-"));
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
