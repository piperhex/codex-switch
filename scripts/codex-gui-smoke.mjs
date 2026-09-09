// Runs the official CLI against a local Responses fixture, without using an account or model credits.
// Usage: node scripts/codex-gui-smoke.mjs <path-to-release-bin/codex.exe>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const executable = process.argv[2];
assert.ok(executable, "Pass the downloaded official Codex executable path");
const root = await mkdtemp(join(tmpdir(), "codex-gui-protocol-"));
const home = join(root, "dev.codex.switch", ".codex");
const project = join(root, "project");
const projectless = join(root, "dev.codex.switch", "codex-gui-workspaces", "projectless-test");
await Promise.all([mkdir(home, { recursive: true }), mkdir(project), mkdir(projectless, { recursive: true })]);
const skillDirectory = join(home, "skills", "gui-fixture");
const skillPath = join(skillDirectory, "SKILL.md");
await mkdir(skillDirectory, { recursive: true });
await writeFile(skillPath, "---\nname: gui-fixture\ndescription: GUI skill smoke test\n---\n"
  + "The selected skill marker is GUI_SKILL_SELECTED.\n");
let delayed = false;
let responseCount = 0;
const imageUrl = "data:image/png;base64,"
  + (await readFile(new URL("../apps/desktop/src-tauri/icons/32x32.png", import.meta.url))).toString("base64");
const requestBodies = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => requestBodies.push(JSON.parse(body)));
  if (!request.url?.includes("/responses")) { response.writeHead(404); response.end(); return; }
  responseCount += 1;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const event = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const id = `response-${responseCount}`;
  const item = { id: `message-${responseCount}`, type: "message", role: "assistant", content: [] };
  event({ type: "response.created", response: { id } });
  event({ type: "response.output_item.added", item });
  event({ type: "response.output_text.delta", delta: "GUI " });
  const timer = setTimeout(() => {
    event({ type: "response.output_text.delta", delta: "smoke passed" });
    event({ type: "response.output_item.done", item: { ...item,
      content: [{ type: "output_text", text: "GUI smoke passed" }] } });
    event({ type: "response.completed", response: { id,
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
    response.end();
  }, delayed ? 15000 : 400);
  response.on("close", () => clearTimeout(timer));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await writeFile(join(home, "config.toml"), `model = "gui-fixture"
model_provider = "gui_fixture"
approval_policy = "on-request"
cli_auth_credentials_store = "file"
[model_providers.gui_fixture]
name = "Local GUI test"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
`);

function launch() {
  const child = spawn(resolve(executable), ["app-server", "-c", `sqlite_home=${JSON.stringify(home)}`,
    "-c", `log_dir=${JSON.stringify(join(home, "log"))}`], {
    env: { ...process.env, CODEX_HOME: home }, cwd: project, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  const notifications = [];
  let sequence = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.method) notifications.push(value);
    else if (pending.has(value.id)) {
      const { resolve, reject, timer } = pending.get(value.id);
      clearTimeout(timer); pending.delete(value.id);
      if (value.error) reject(new Error(JSON.stringify(value.error)));
      else resolve(value.result);
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}\n${stderr}`)); }, 25000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  const waitFor = async (method, predicate = () => true) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const event = notifications.find((event) => event.method === method && predicate(event.params));
      if (event) return event;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Missing notification: ${method}\n${stderr}\n${JSON.stringify(notifications.slice(-4))}`);
  };
  return { child, rpc, notifications, waitFor, stop: async () => {
    lines.close();
    for (const { timer } of pending.values()) clearTimeout(timer);
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  } };
}

async function initialize(client) {
  const response = await client.rpc("initialize", { clientInfo: { name: "codex_switch_gui", version: "1.0.0" },
    capabilities: { experimentalApi: true } });
  assert.equal(resolve(response.codexHome).replace(/^\\\\\?\\/, ""), resolve(home));
  client.child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
}

let client = launch();
try {
  await initialize(client);
  const models = await client.rpc("model/list", { limit: 50 });
  assert.ok(Array.isArray(models.data));
  const catalog = await client.rpc("skills/list", { cwds: [project], forceReload: true });
  const skill = catalog.data.flatMap((entry) => entry.skills).find((entry) => entry.name === "gui-fixture");
  assert.ok(skill?.enabled, "Installed skills are discoverable in the GUI home");
  const { thread } = await client.rpc("thread/start", { cwd: project, sandbox: "read-only", approvalPolicy: "on-request" });
  const { turn } = await client.rpc("turn/start", { threadId: thread.id,
    input: [{ type: "image", url: imageUrl }, { type: "text", text: "$gui-fixture", text_elements: [] },
      { type: "skill", name: skill.name, path: skill.path }] });
  await client.waitFor("item/agentMessage/delta");
  const during = await client.rpc("thread/list", { limit: 50, archived: false, modelProviders: [], sortKey: "updated_at" });
  assert.ok(Array.isArray(during.data));
  const done = await client.waitFor("turn/completed", (params) => params.turn.id === turn.id);
  assert.equal(done.params.turn.status, "completed");
  assert.ok(requestBodies.some((body) => body.input?.some((item) => item.content?.some((part) =>
    part.type === "input_image" && /^data:image\/(png|jpeg);base64,/.test(part.image_url)))),
  "Pasted image reaches the model request");
  assert.ok(requestBodies.some((body) => JSON.stringify(body.input).includes("GUI_SKILL_SELECTED")),
    "The selected skill's instructions reach the model request");
  const read = await client.rpc("thread/read", { threadId: thread.id, includeTurns: true });
  const listed = await client.rpc("thread/list", { archived: false, modelProviders: [] });
  assert.ok(listed.data.some((entry) => entry.id === thread.id));
  assert.ok(read.thread.turns.flatMap((turn) => turn.items).some((item) => item.text === "GUI smoke passed"));
  await client.rpc("thread/name/set", { threadId: thread.id, name: "GUI smoke conversation" });
  await client.stop(); client = launch(); await initialize(client);
  const resumed = await client.rpc("thread/resume", { threadId: thread.id, sandbox: "read-only", approvalPolicy: "on-request" });
  assert.equal(resumed.thread.name, "GUI smoke conversation");
  assert.ok(resumed.thread.turns.length > 0);
  const movedTurn = await client.rpc("turn/start", { threadId: thread.id, cwd: projectless,
    input: [{ type: "text", text: "Continue without a project" }] });
  await client.waitFor("turn/completed", (params) => params.turn.id === movedTurn.turn.id);
  const moved = await client.rpc("thread/read", { threadId: thread.id, includeTurns: true });
  assert.equal(resolve(moved.thread.cwd).replace(/^\\\\\?\\/, ""), resolve(projectless));
  const standalone = await client.rpc("thread/start", { cwd: projectless,
    sandbox: "workspace-write", approvalPolicy: "on-request" });
  const standaloneTurn = await client.rpc("turn/start", { threadId: standalone.thread.id,
    input: [{ type: "text", text: "Start a chat without a project" }] });
  await client.waitFor("turn/completed", (params) => params.turn.id === standaloneTurn.turn.id);
  await client.stop(); client = launch(); await initialize(client);
  const standaloneRead = await client.rpc("thread/read", { threadId: standalone.thread.id, includeTurns: true });
  assert.equal(resolve(standaloneRead.thread.cwd).replace(/^\\\\\?\\/, ""), resolve(projectless));
  assert.ok(standaloneRead.thread.turns.length > 0);
  await client.rpc("thread/archive", { threadId: thread.id });
  const archived = await client.rpc("thread/list", { archived: true, modelProviders: [] });
  assert.ok(archived.data.some((entry) => entry.id === thread.id));
  await client.rpc("thread/unarchive", { threadId: thread.id });
  await client.rpc("thread/resume", { threadId: thread.id, sandbox: "read-only", approvalPolicy: "on-request" });
  const queued = await client.rpc("turn/start", { threadId: thread.id, input: [
    { type: "text", text: "QUEUE_FIRST_MESSAGE", text_elements: [] },
    { type: "text", text: "QUEUE_SECOND_MESSAGE", text_elements: [] },
  ] });
  await client.waitFor("turn/completed", (params) => params.turn.id === queued.turn.id);
  assert.ok(requestBodies.some((body) => {
    const input = JSON.stringify(body.input);
    return input.includes("QUEUE_FIRST_MESSAGE") && input.includes("QUEUE_SECOND_MESSAGE");
  }), "All queued messages reach the next model request together");
  const beforeCompaction = client.notifications.length;
  assert.deepEqual(await client.rpc("thread/compact/start", { threadId: thread.id }), {});
  const compaction = await client.waitFor("item/started", (params) =>
    params.threadId === thread.id && params.item.type === "contextCompaction");
  const duringCompaction = await client.rpc("thread/list", { archived: false, modelProviders: [] });
  assert.ok(Array.isArray(duringCompaction.data), "Conversation listing responds during compaction");
  await client.waitFor("item/completed", (params) => params.item.id === compaction.params.item.id);
  const compacted = await client.waitFor("turn/completed", (params) => params.turn.id === compaction.params.turnId);
  assert.equal(compacted.params.turn.status, "completed");
  assert.ok(client.notifications.slice(beforeCompaction).some((event) =>
    event.method === "thread/tokenUsage/updated" && event.params.threadId === thread.id),
  "Compaction refreshes context usage");
  delayed = true;
  const next = await client.rpc("turn/start", { threadId: thread.id, input: [{ type: "text", text: "Continue" }] });
  await client.waitFor("item/agentMessage/delta", (params) => params.turnId === next.turn.id);
  await assert.rejects(client.rpc("turn/steer", { threadId: thread.id, expectedTurnId: "stale-turn",
    input: [{ type: "text", text: "Must not redirect another turn" }] }));
  const steered = await client.rpc("turn/steer", { threadId: thread.id, expectedTurnId: next.turn.id,
    input: [{ type: "text", text: "Apply the new direction" }] });
  assert.equal(steered.turnId, next.turn.id);
  await client.rpc("turn/interrupt", { threadId: thread.id, turnId: next.turn.id });
  const interrupted = await client.waitFor("turn/completed", (params) => params.turn.id === next.turn.id);
  assert.equal(interrupted.params.turn.status, "interrupted");
  const detached = await client.rpc("thread/unsubscribe", { threadId: thread.id });
  assert.equal(detached.status, "unsubscribed");
  const detachedRead = await client.rpc("thread/read", { threadId: thread.id, includeTurns: true });
  const rolloutPath = detachedRead.thread.path;
  assert.ok(rolloutPath, "Unsubscribed conversations remain readable from disk");
  await rename(rolloutPath, `${rolloutPath}.trash`);
  await rename(`${rolloutPath}.trash`, rolloutPath);
  const unarchived = await client.rpc("thread/list", { archived: false, modelProviders: [] });
  assert.ok(unarchived.data.some((entry) => entry.id === thread.id), "Unsubscribe preserves archive status");
  const entries = await readdir(home);
  assert.ok(entries.includes("sessions"));
  assert.ok(entries.some((entry) => /^state_.*\.sqlite$/.test(entry)));
  assert.equal((await readFile(join(home, "config.toml"), "utf8")).includes("gui_fixture"), true);
  console.log("PASS: official CLI handshake, skill discovery/input, images, streaming, history, "
    + "projectless start/continue, restart/resume, archive/restore, queued inputs, compaction, steer, interrupt, "
    + "unsubscribe/file release, isolated storage");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.stop();
  server.closeAllConnections(); server.close();
  assert.ok(root.startsWith(join(tmpdir(), "codex-gui-protocol-")));
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
