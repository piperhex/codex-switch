import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const definitions = JSON.parse(readFileSync(new URL('../internal/identity/templates.json', import.meta.url), 'utf8'));
const definition = definitions.find(entry => entry.code === 'official-account.bound');
assert.ok(definition.defaultBody.includes('登录 Remote AI'));

// Only this documented default-brand change differs from the frozen Nest contract.
// Saved user templates and all other fields still require exact equality.
export function normalizeDefaultTemplate(value, side) {
  if (Array.isArray(value)) return value.map(entry => normalizeDefaultTemplate(entry, side));
  if (value?.code !== definition.code || value.customized !== false) return value;
  const expected = side === 'legacy'
    ? definition.defaultBody.replace('登录 Remote AI', '登录 Codex Switch') : definition.defaultBody;
  assert.equal(value.body, expected, `${side} default notification template`);
  return { ...value, body: definition.defaultBody };
}
