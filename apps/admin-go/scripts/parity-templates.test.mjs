import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeDefaultTemplate } from './parity-templates.mjs';

const definition = JSON.parse(readFileSync(new URL('../internal/identity/templates.json', import.meta.url)))[0];
const modern = { code: definition.code, customized: false, body: definition.defaultBody };
const legacy = { ...modern, body: modern.body.replace('登录 Remote AI', '登录 Codex Switch') };

test('compares the known default brand change without hiding other content differences', () => {
  assert.deepEqual(normalizeDefaultTemplate([legacy], 'legacy'), normalizeDefaultTemplate([modern], 'modern'));
  for (const [side, value] of [['legacy', legacy], ['modern', modern]]) {
    assert.throws(() => normalizeDefaultTemplate({ ...value, body: value.body + 'unexpected' }, side));
    assert.throws(() => normalizeDefaultTemplate({ ...value, body: value.body.replace('{{userEmail}}', '') }, side));
  }
});

test('preserves saved template text and unrelated fields verbatim', () => {
  const saved = { ...legacy, customized: true, subject: 'Custom Codex Switch notice', mailServiceId: 'sender' };
  assert.equal(normalizeDefaultTemplate(saved, 'modern'), saved);
  assert.equal(normalizeDefaultTemplate({ ...legacy, subject: 'custom' }, 'legacy').subject, 'custom');
});
