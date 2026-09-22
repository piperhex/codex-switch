import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fixtureUsers, fixturePassword } from './parity-client.mjs';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// The fixture helper intentionally cannot target deployment databases.
export async function fixtureDatabase(database) {
  if (!['legacy', 'admin_go'].includes(database)) throw new Error('Unrecognized local fixture database');
  const client = new Client({ host: '127.0.0.1', port: 15432, user: 'parity', password: 'local-parity-only', database });
  await client.connect();
  return client;
}

export async function seedParity() {
  const passwordHash = await bcrypt.hash(fixturePassword, 12);
  for (const database of ['legacy', 'admin_go']) {
    const client = await fixtureDatabase(database);
    try {
      await client.query(`INSERT INTO rbac_roles (code,name,description,system) VALUES
        ('fixture_restricted','Fixture restricted','Local parity fixture',false) ON CONFLICT (code) DO NOTHING`);
      for (const [name, fixture] of Object.entries(fixtureUsers)) {
        const role = ['admin', 'reviewer'].includes(name) ? 'admin' : name === 'restricted' ? 'fixture_restricted' : 'user';
        await client.query(`INSERT INTO users (id,email,"passwordHash",role,disabled,"createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
          ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,"passwordHash"=EXCLUDED."passwordHash",
          role=EXCLUDED.role,disabled=EXCLUDED.disabled`, [fixture.id, fixture.email, passwordHash, role, name === 'disabled']);
      }
      console.log(`Seeded ${database}: ${Object.keys(fixtureUsers).length} synthetic users`);
    } finally { await client.end(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await seedParity();
