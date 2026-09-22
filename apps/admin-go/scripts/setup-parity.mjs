import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const { Client } = require('pg');
const compose = ['compose', '-f', 'apps/admin-go/compose.test.yml'];
execFileSync('docker', [...compose, 'up', '-d', '--build', 'legacy', 'redis-go', 'oauth'], { stdio: 'inherit' });
let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try { ready = (await fetch('http://127.0.0.1:28080/auth/me')).status === 401; } catch { /* Startup. */ }
  if (ready) break;
  await delay(500);
}
assert.ok(ready, 'legacy fixture server did not initialize');
const db = new Client({ host: '127.0.0.1', port: 15432, user: 'parity',
  password: 'local-parity-only', database: 'legacy' });
await db.connect();
try {
  const exists = await db.query("SELECT 1 FROM pg_database WHERE datname='admin_go'");
  if (exists.rowCount === 0) {
    await db.query('CREATE DATABASE admin_go');
    const schema = execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'pg_dump',
      '-U', 'parity', '-d', 'legacy', '--schema-only', '--no-owner', '--no-privileges']);
    execFileSync('docker', [...compose, 'exec', '-T', 'postgres', 'psql',
      '-v', 'ON_ERROR_STOP=1', '-U', 'parity', '-d', 'admin_go'], { input: schema, stdio: ['pipe', 'inherit', 'inherit'] });
    console.log('Initialized the isolated Go fixture database from the legacy schema');
  } else console.log('Existing isolated Go fixture database retained');
} finally { await db.end(); }
console.log('Fixture dependencies ready. Build/start admin-go, then run scripts/parity.mjs.');
