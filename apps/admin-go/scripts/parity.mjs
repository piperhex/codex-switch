import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createPair } from './parity-client.mjs';
import { seedParity } from './seed-parity.mjs';
import { runIdentity } from './parity-identity.mjs';
import { runAccounts } from './parity-accounts.mjs';
import { runContent } from './parity-content.mjs';
import { runDevices } from './parity-devices.mjs';
import { runChatSecurity } from './parity-chat-security.mjs';
import { runTransport } from './parity-transport.mjs';
import { runMigrations } from './parity-migrations.mjs';
import { runBodyParser } from './parity-body-parser.mjs';

const resultsDirectory = new URL('../testdata/results/', import.meta.url);
const contract = JSON.parse(await readFile(new URL('../internal/platform/legacy-contract.json', import.meta.url)));
const suites = { identity: runIdentity, accounts: runAccounts, content: runContent,
  devices: runDevices, chat: runChatSecurity, transport: runTransport, bodyParser: runBodyParser };
assert.notEqual(process.env.PARITY_COLLECT, '1', 'the complete suite requires strict assertions');
process.env.PARITY_OAUTH_MOCK = '1';
process.env.PARITY_TLS_MOCK = '1';

function coverage(results) {
  return contract.routes.map((route) => {
    const pattern = new RegExp(`^${route.path.replace(/:[^/]+/g, '[^/]+')}/?$`, 'i');
    const matches = results.filter((result) => result.method === route.method
      && pattern.test(result.path?.split('?')[0] || '') && !result.failed);
    return { method: route.method, path: route.path,
      checks: matches.map(({ suite, label, status }) => ({ suite, label, status })),
      success: matches.some(({ status }) => status >= 200 && status < 400) };
  });
}

async function writeReport(report) {
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(new URL('summary.json', resultsDirectory), JSON.stringify(report, null, 2) + '\n');
  const rows = report.routes.map((route) => `| ${route.method} | \`${route.path}\` | `
    + `${route.success ? 'yes' : 'MISSING'} | ${route.checks.length} |`);
  await writeFile(new URL('route-coverage.md', resultsDirectory),
    '# HTTP route coverage\n\n| Method | Route | Successful scenario | Checks |\n| --- | --- | --- | --- |\n'
    + rows.join('\n') + '\n');
}

const report = { startedAt: new Date().toISOString(), suites: [], results: [], routes: [] };
try {
  await seedParity();
  for (const [name, run] of Object.entries(suites)) {
    const pair = await createPair();
    try { await run(pair); }
    finally { report.results.push(...pair.results.map((result) => ({ suite: name, ...result }))); }
    report.suites.push({ name, checks: pair.results.length });
    console.log(`PASS ${name}: ${pair.results.length} checks`);
  }
  report.suites.push({ name: 'migrations', checks: (await runMigrations()).length });
  report.routes = coverage(report.results);
  const missing = report.routes.filter((route) => !route.success).map(({ method, path }) => `${method} ${path}`);
  assert.deepEqual(missing, [], 'every legacy HTTP route needs a successful scenario');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  report.routes = coverage(report.results);
  report.finishedAt = new Date().toISOString();
  await writeReport(report);
  console.log(`HTTP coverage: ${report.routes.filter((route) => route.success).length}/${report.routes.length}`);
  console.log(`Detailed evidence: ${resultsDirectory.pathname}`);
}
