// Real app-server coverage for composer references and persistent goals, using only the local model fixture.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function installFixture(client, root) {
  const repository = join(root, "composer-marketplace");
  const plugin = join(repository, "plugins", "fixture");
  await mkdir(join(repository, ".agents", "plugins"), { recursive: true });
  await mkdir(join(plugin, ".codex-plugin"), { recursive: true });
  await mkdir(join(plugin, "skills", "composer-fixture"), { recursive: true });
  await writeFile(join(repository, ".agents", "plugins", "marketplace.json"), JSON.stringify({
    name: "composer-fixtures", plugins: [{ name: "fixture", source: { source: "local", path: "./plugins/fixture" },
      policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Tools" }],
  }));
  await writeFile(join(plugin, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "fixture", version: "1.0.0", description: "Composer plugin fixture", skills: "./skills",
  }));
  await writeFile(join(plugin, "skills", "composer-fixture", "SKILL.md"),
    "---\nname: composer-fixture\ndescription: PLUGIN_COMPOSER_MARKER\n---\nUse the attached reference.\n");
  await client.rpc("config/value/write", { keyPath: "marketplaces.composer-fixtures",
    value: { source_type: "local", source: repository }, mergeStrategy: "replace" });
  const catalog = await client.rpc("plugin/list", { marketplaceKinds: ["local"] });
  const market = catalog.marketplaces.find((entry) => entry.name === "composer-fixtures");
  assert.ok(market);
  await client.rpc("plugin/install", { marketplacePath: market.path, pluginName: "fixture" });
  const installed = await client.rpc("plugin/installed", {});
  assert.ok(installed.marketplaces.flatMap((entry) => entry.plugins)
    .some((plugin) => plugin.id === "fixture@composer-fixtures" && plugin.installed && plugin.enabled));
}

async function verifyReferences({ client, threadId, project, requestBodies }) {
  const file = join(project, "composer-reference.txt");
  await writeFile(file, "Reference fixture");
  const { turn } = await client.rpc("turn/start", { threadId, input: [
    { type: "text", text: `文件：${file}\n文件夹：${project}`, text_elements: [] },
    { type: "text", text: "[Fixture](plugin://fixture@composer-fixtures)", text_elements: [] },
    { type: "mention", name: "Fixture", path: "plugin://fixture@composer-fixtures" },
  ] });
  await client.waitFor("turn/completed", (params) => params.turn.id === turn.id);
  assert.ok(requestBodies.some((body) => JSON.stringify(body.input).includes("composer-reference.txt")));
  assert.ok(requestBodies.some((body) => JSON.stringify(body.input).includes("PLUGIN_COMPOSER_MARKER")));
}

async function verifyGoals(client, threadId) {
  const objective = "Complete GUI_GOAL_MARKER using the reference";
  const { goal } = await client.rpc("thread/goal/set", { threadId, objective, status: "active" });
  assert.equal(goal.objective, objective);
  assert.equal(goal.tokenBudget, null);
  const first = await client.waitFor("turn/started", (params) => params.threadId === threadId);
  await client.waitFor("turn/started", (params) => params.threadId === threadId && params.turn.id !== first.params.turn.id);
  const paused = await client.rpc("thread/goal/set", { threadId, status: "paused" });
  assert.equal(paused.goal.status, "paused");
  const stored = await client.rpc("thread/goal/get", { threadId });
  assert.equal(stored.goal.objective, objective);
  const before = client.notifications.filter((event) => event.method === "turn/started").length;
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(client.notifications.filter((event) => event.method === "turn/started").length, before,
    "Pausing the goal prevents automatic continuation");
  await client.rpc("thread/goal/set", { threadId, status: "active" });
  await client.waitFor("thread/goal/updated", (params) => params.threadId === threadId && params.goal.status === "active");
  await client.rpc("thread/goal/set", { threadId, status: "paused" });
  await client.rpc("thread/goal/clear", { threadId });
  assert.equal((await client.rpc("thread/goal/get", { threadId })).goal, null);
}

export async function verifyComposerAdditions({ client, project, root, requestBodies }) {
  await installFixture(client, root);
  const { thread } = await client.rpc("thread/start", { cwd: project, sandbox: "read-only", approvalPolicy: "on-request" });
  await verifyReferences({ client, threadId: thread.id, project, requestBodies });
  const { thread: goalThread } = await client.rpc("thread/start",
    { cwd: project, sandbox: "read-only", approvalPolicy: "on-request" });
  await verifyGoals(client, goalThread.id);
  assert.ok(requestBodies.some((body) => JSON.stringify(body.input).includes("GUI_GOAL_MARKER")));
  console.log("PASS: installed plugin selection, file/folder references, native goal continuation, pause, resume and clear");
}
