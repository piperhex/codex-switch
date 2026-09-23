import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixtureDatabase, seedParity } from "./seed-parity.mjs";
import { request, fixtureUsers, fixturePassword } from "./parity-client.mjs";

// Fixed local fixture service only; this script must never write production data.
const base = "http://127.0.0.1:28081";
const endpoint = "/admin/api/token-cost-presets";
const database = await fixtureDatabase("admin_go");
try {
  await database.query(await readFile(new URL("../sql/20260923-token-cost-presets.sql", import.meta.url), "utf8"));
  await database.query("DELETE FROM token_cost_preset_settings WHERE id = $1", ["current"]);
} finally { await database.end(); }
await seedParity();
const login = async (role) => {
  const response = await request(base, "POST", "/auth/login", {
    body: { email: fixtureUsers[role].email, password: fixturePassword },
  });
  assert.equal(response.status, 201);
  if (role === "admin") {
    assert.ok(response.body.user.permissions.includes("admin.token-pricing.read"));
    assert.ok(response.body.user.permissions.includes("admin.token-pricing.manage"));
  }
  return response.body.accessToken;
};
const token = await login("admin");
const restricted = await login("restricted");
const initial = await request(base, "GET", endpoint, { token });
assert.equal(initial.status, 200);
assert.equal(initial.body.models.length, 10);
assert.equal(initial.body.models.find((model) => model.model === "gpt-5.6-cyber").fastModeMultiplier, null);
assert.equal((await request(base, "GET", endpoint)).status, 401);
assert.equal((await request(base, "PATCH", endpoint, { token: restricted, body: initial.body })).status, 403);
try {
  const added = { model: "fixture-new-model", aliases: ["fixture-new-alias"], input: 1.2, cachedInput: 0.12,
    output: 6, fastModeMultiplier: 3.2, longContextPricing: true, sourceUrl: "" };
  const document = { ...initial.body, models: [...initial.body.models, added] };
  assert.equal((await request(base, "PATCH", endpoint, { token, body: document })).status, 200);
  const published = await request(base, "GET", "/token-cost-presets");
  assert.equal(published.status, 200);
  assert.deepEqual(published.body.models.at(-1), added);
  assert.match(published.headers["cache-control"], /no-store/);
  for (const model of [{ ...added, input: -1 }, { ...added, fastModeMultiplier: 0 },
    { ...added, input: null }, { ...added, aliases: [initial.body.models[0].model] }]) {
    assert.equal((await request(base, "PATCH", endpoint, {
      token, body: { ...initial.body, models: [...initial.body.models, model] },
    })).status, 400);
  }
  const after = await request(base, "GET", "/token-cost-presets");
  assert.deepEqual(after.body, published.body);
  console.log("PASS pricing API: public defaults, admin save/add, permissions, validation and persisted readback");
} finally {
  assert.equal((await request(base, "PATCH", endpoint, { token, body: initial.body })).status, 200);
}