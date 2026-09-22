// Generate validation fixtures from the original NestJS DTO classes, without starting a server.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
process.env.TS_NODE_PROJECT = path.join(root, 'apps/admin/tsconfig.json');
process.env.TS_NODE_TRANSPILE_ONLY = 'true';
require('ts-node/register/transpile-only');
require('tsconfig-paths').register({ baseUrl: path.join(root, 'apps/admin'), paths: { '@/*': ['src/*'] } });
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, '../internal/platform/legacy-contract.json'), 'utf8'));
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? files(resolved) : entry.name.endsWith('.dto.ts') ? [resolved] : [];
  });
}
const classes = {};
for (const file of files(path.join(root, 'apps/admin/src/modules'))) {
  Object.assign(classes, require(file));
}

function fields(name) {
  const schema = contract.schemas[name];
  return [...schema.fields, ...(schema.extends ? fields(schema.extends).filter((field) =>
    !schema.fields.some((own) => own.name === field.name)) : [])];
}
function choices(field) {
  const samples = [null, true, false, 0, 1, -1, 1.5, '', ' ', 'ordinary', 'é😀', [], {}, [null], ['valid', 'valid']];
  for (const rule of field.rules) {
    if (['Min', 'Max', 'ArrayMaxSize', 'MinLength', 'MaxLength', 'Length'].includes(rule.name)) {
      for (const limit of rule.args.filter((value) => typeof value === 'number')) {
        samples.push(limit, limit - 1, limit + 1);
        if (rule.name.includes('Length')) samples.push('a'.repeat(Math.min(limit, 60000)));
      }
    }
    if (rule.name === 'IsIn') samples.push(...rule.args[0]);
    if (rule.name === 'IsUUID') samples.push(
      '00000000-0000-4000-8000-000000000001', '00000000-0000-1000-8000-000000000001',
      '00000000-0000-4000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
    );
    if (rule.name === 'IsEmail') samples.push('person@example.test', 'a@localhost', 'a@b.c', 'a..b@example.com',
      'Person <person@example.com>', 'a+b@example.com', '用户@example.com', 'a@-example.com', 'a@example.123');
    if (rule.name === 'IsUrl') samples.push('https://example.test', 'http://localhost:123/path', 'ftp://example.com',
      '//example.com', 'example.com', 'https://user:password@example.com', 'http://127.0.0.1', 'http://[::1]',
      'https://example.com/a b', 'https://a', 'https://-example.com', 'https://example.com:99999');
    if (rule.name === 'IsISO8601') samples.push('2026-09-23', '2026-09-23T12:30:45.123Z', '2026-09-23T12:30:45+08:00',
      '2026-02-30', '2026-09-23T25:00:00Z', '2026-09-23 12:00:00', '2026-W39-3', '2026-266');
    if (rule.name === 'Matches') samples.push('#abcdef', 'valid-name', 'valid_name', 'abc', 'ABC');
  }
  if (field.transform === 'Number') samples.push('1e1', '0x10', '0b11', '0o11', 'Infinity', 'NaN', [], [2], ['2'], [1, 2]);
  return [...new Map(samples.map((value) => [JSON.stringify(value), value])).values()];
}

async function main() {
  const fixtures = [];
  for (const name of Object.keys(contract.schemas).sort()) {
    if (typeof classes[name] !== 'function') throw new Error(`Missing DTO class ${name}`);
    const cases = [{ label: 'empty', body: {} }, { label: 'unknown', body: { unexpected: true } },
      { label: 'unknown-order', body: { zzz: true, aaa: true, 9: true, 2: true } },
      { label: 'prototype-keys', body: JSON.parse('{"__proto__":{},"constructor":true,"prototype":"x"}') }];
    for (const field of fields(name)) {
      for (const [index, value] of choices(field).entries()) cases.push({ label: `${field.name}:${index}`, body: { [field.name]: value } });
    }
    const baseline = await validBody(name);
    cases.push({ label: 'valid-fields', body: baseline });
    for (const field of fields(name).filter((item) => item.transform && item.transform !== 'Number')) {
      const nested = await validBody(field.transform);
      const array = field.rules.some((rule) => rule.name === 'IsArray');
      const bad = { ...nested, zzz: true, aaa: true };
      cases.push({ label: `${field.name}:nested-valid`, body: { ...baseline, [field.name]: array ? [nested] : nested } });
      cases.push({ label: `${field.name}:nested-unknown`, body: { ...baseline, [field.name]: array ? [bad] : bad } });
    }
    for (const test of cases) {
      const body = structuredClone(test.body);
      let messages = [], transformed;
      try { transformed = await pipe.transform(body, { type: 'body', metatype: classes[name] }); }
      catch (error) {
        const response = error.getResponse?.();
        if (!Array.isArray(response?.message)) throw error;
        messages = response.message;
      }
      fixtures.push({ schema: name, label: test.label, input: test.body, messages,
        ...(transformed === undefined ? {} : { transformed }) });
    }
  }
  const destination = path.join(__dirname, '../testdata/validation-oracle.json');
  fs.writeFileSync(destination, JSON.stringify(fixtures));
  console.log(`${fixtures.length} NestJS validation fixtures written to ${destination}`);
}
async function validBody(name) {
  const body = {};
  for (const field of fields(name)) {
    let candidates = choices(field).filter((value) => value !== null);
    if (field.transform && field.transform !== 'Number') candidates = [await validBody(field.transform), []];
    candidates.unshift('JBSWY3DPEHPK3PXP', 'example', '2026-09-23T12:00:00.000Z');
    for (const value of candidates) {
      let messages = [];
      try { await pipe.transform({ [field.name]: value }, { type: 'body', metatype: classes[name] }); }
      catch (error) { messages = error.getResponse().message; }
      const invalid = messages.some((message) => message.startsWith(`${field.name} `)
        || message.startsWith(`${field.name}.`) || message.includes(`in ${field.name} `)
        || message.includes(`All ${field.name}'s`) || message.includes(`property ${field.name} `));
      if (!invalid) { body[field.name] = value; break; }
    }
  }
  return body;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
