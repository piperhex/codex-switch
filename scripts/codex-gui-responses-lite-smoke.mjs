// Exercises the actual CLI against a local Provider, without credentials or model charges.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { guiContextCatalog } from "./fixtures/gui-context-catalog.mjs";
import { connectAppServer } from "./fixtures/codex-app-server-client.mjs";

assert.ok(process.argv[2], "Pass the Codex executable path");
const executable = resolve(process.argv[2]);

function createFixture() {
  const requests = [];
  let normalTurns = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const compact = request.url.endsWith("/compact")
        || body.input?.some((item) => item.type === "compaction_trigger");
      requests.push({ body, lite: request.headers["x-openai-internal-codex-responses-lite"], compact });
      const id = `fixture-${requests.length}`;
      const item = compact ? { type: "compaction", encrypted_content: "fixture-compaction" }
        : { type: "message", id: `message-${requests.length}`, role: "assistant",
          content: [{ type: "output_text", text: "OK" }] };
      const usage = { input_tokens: !compact && normalTurns++ === 0 ? 5000 : 10,
        output_tokens: 5, total_tokens: 0 };
      usage.total_tokens = usage.input_tokens + usage.output_tokens;
      if (request.url.endsWith("/compact")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ output: [item], usage })); return;
      }
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
      emit({ type: "response.created", response: { id } });
      emit({ type: "response.output_item.added", output_index: 0, item });
      emit({ type: "response.output_item.done", output_index: 0, item });
      emit({ type: "response.completed", response: { id, output: [item], usage } });
      response.end();
    } catch (error) {
      response.writeHead(500); response.end(String(error));
    }
  });
  return { server, requests };
}

async function writeConfig({ home, port, lite }) {
  const catalogPath = join(home, "user-models.json");
  const catalog = guiContextCatalog(null);
  catalog.models[0].use_responses_lite = lite;
  catalog.models[0].auto_compact_token_limit = 2000;
  catalog.models[0].supported_reasoning_levels = [{ effort: "xhigh", description: "Extended" }];
  await writeFile(catalogPath, JSON.stringify(catalog));
  await writeFile(join(home, "config.toml"), `model = "gpt-5.4"
model_provider = "codex-switch-gui"
model_reasoning_effort = "xhigh"
model_auto_compact_token_limit = 2000
model_auto_compact_token_limit_scope = "total"
model_catalog_json = ${JSON.stringify(catalogPath.replaceAll("\\", "/"))}
approval_policy = "never"
[model_providers.codex-switch-gui]
name = "Codex GUI"
base_url = "http://127.0.0.1:${port}/v1"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
http_headers = { "x-openai-actor-authorization" = "CODEX_SWITCH_LOCAL_PROXY" }
`);
}

async function turn(client, threadId) {
  const { turn } = await client.rpc("turn/start", {
    threadId, input: [{ type: "text", text: "Reply OK without using tools." }],
  });
  const completed = await client.waitFor((event) => event.method === "turn/completed"
    && event.params.turn.id === turn.id);
  assert.equal(completed.params.turn.status, "completed", JSON.stringify(completed));
}

async function exercise(lite) {
  const root = await mkdtemp(join(tmpdir(), "codex-responses-lite-"));
  const home = join(root, "home");
  await mkdir(home);
  const { server, requests } = createFixture();
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  await writeConfig({ home, port: server.address().port, lite });
  let client = connectAppServer({ executable, home, cwd: root });
  try {
    await client.initialize();
    const { thread } = await client.rpc("thread/start", { cwd: root, sandbox: "read-only" });
    await turn(client, thread.id);
    await turn(client, thread.id);
    assert.ok(client.events.some((event) => event.method === "item/completed"
      && event.params.item.type === "contextCompaction"), "Long history must trigger automatic compaction");
    assert.ok(requests.length >= 3, "Two turns and their compaction must reach the Provider");
    await client.close();
    client = connectAppServer({ executable, home, cwd: root });
    await client.initialize();
    await client.rpc("thread/resume", { threadId: thread.id, sandbox: "read-only" });
    const beforeResume = requests.length;
    await turn(client, thread.id);
    assert.ok(requests.length > beforeResume, "Resumed turn must reach the Provider");
    for (const request of requests) {
      assert.equal(request.lite, lite ? "true" : undefined);
      if (lite) assert.equal(request.body.reasoning?.context, "all_turns");
      if (!request.compact) assert.equal(request.body.reasoning?.effort, "xhigh");
    }
    console.log(`PASS Lite=${lite}: ${requests.length} requests; new turn, auto compaction, restart/resume, extra -c`);
  } finally {
    await client.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
}

await exercise(true);
await exercise(false);
