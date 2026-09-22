import { createRequire } from 'node:module';
import { fixtureDatabase } from './seed-parity.mjs';
import { fixtureUsers } from './parity-client.mjs';

const require = createRequire(new URL('../testdata/tools/package.json', import.meta.url));
const Redis = require('ioredis');

// Only the two named account scenario owners are reset; device owner 011 and other domains remain intact.
export async function resetAccountFixtures() {
  const owners = [fixtureUsers.admin.id, fixtureUsers.user.id];
  for (const database of ['legacy', 'admin_go']) {
    const client = await fixtureDatabase(database);
    try {
      await client.query('DELETE FROM synced_accounts WHERE "ownerId" = ANY($1::uuid[])', [owners]);
      await client.query('DELETE FROM synced_providers WHERE "ownerId" = $1', [owners[0]]);
      await client.query('DELETE FROM synced_totp_vaults WHERE "ownerId" = $1', [owners[0]]);
      await client.query(`DELETE FROM system_accounts WHERE "addedByUserId" = $1
        OR email = 'pool-own-scope@example.test'`, [owners[0]]);
    } finally {
      await client.end();
    }
  }
  for (const port of [16379, 16380]) {
    const redis = new Redis({ host: '127.0.0.1', port, maxRetriesPerRequest: 1 });
    try {
      await redis.del(...owners.map((id) => `sync:accounts:${id}`), `sync:providers:${owners[0]}`);
    } finally {
      await redis.quit();
    }
  }
}
