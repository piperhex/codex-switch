import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { createPair, request } from './parity-client.mjs';

const jsonType = 'application/json';
const formType = 'application/x-www-form-urlencoded';
const loginJSON = Buffer.from(
  JSON.stringify({
    email: 'missing-body-fixture@example.test',
    password: 'not-a-real-password',
  }),
);
const loginForm = 'email=missing-body-fixture%40example.test&password=not-a-real-password';
const utf16JSON = Buffer.from(loginJSON.toString(), 'utf16le');

function bodyCases() {
  const cases = [{ label: 'ordinary JSON remains unchanged', data: loginJSON, type: jsonType, status: 401 }];
  for (const [encoding, encode] of [
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ]) {
    cases.push({
      label: `${encoding} compressed JSON`,
      data: encode(loginJSON),
      type: jsonType,
      encoding,
      status: 401,
    });
    cases.push({
      label: `${encoding} malformed compressed JSON`,
      data: Buffer.from('invalid'),
      type: jsonType,
      encoding,
      status: 404,
    });
  }
  cases.push(
    { label: 'unsupported content encoding', data: loginJSON, type: jsonType, encoding: 'zstd', status: 404 },
    { label: 'UTF16LE JSON', data: utf16JSON, type: `${jsonType}; charset=utf-16le`, status: 401 },
    {
      label: 'UTF16BE JSON',
      data: Buffer.from(utf16JSON).swap16(),
      type: `${jsonType}; charset=utf-16be`,
      status: 401,
    },
    {
      label: 'UTF16 BOM JSON',
      data: Buffer.concat([Buffer.from([255, 254]), utf16JSON]),
      type: `${jsonType}; charset=utf-16`,
      status: 401,
    },
    {
      label: 'UTF8 BOM JSON',
      data: Buffer.concat([Buffer.from([239, 187, 191]), loginJSON]),
      type: `${jsonType}; charset=utf-8`,
      status: 401,
    },
    { label: 'unsupported JSON charset', data: loginJSON, type: `${jsonType}; charset=iso-8859-1`, status: 404 },
    { label: 'flat form', data: loginForm, type: formType, status: 401 },
    { label: 'gzip compressed form', data: gzipSync(loginForm), type: formType, encoding: 'gzip', status: 401 },
    {
      label: 'Latin1 form decodes escaped field names',
      data: '%E9=1',
      type: `${formType}; charset=iso-8859-1`,
      status: 400,
    },
    { label: 'unsupported form charset', data: loginForm, type: `${formType}; charset=utf-16le`, status: 404 },
    {
      label: 'nested form DTO validation',
      data: 'accounts[0][privateDetails][totpSecret]=!',
      type: formType,
      path: '/sync/accounts',
      status: 400,
    },
    {
      label: 'duplicate form values become arrays',
      data: `${loginForm}&email=second-fixture%40example.test`,
      type: formType,
      status: 400,
    },
    {
      label: 'form permits 1000 parameters',
      data: Array.from({ length: 1000 }, () => 'email=invalid').join('&'),
      type: formType,
      status: 400,
    },
    {
      label: 'form rejects 1001 parameters',
      data: Array.from({ length: 1001 }, () => 'email=invalid').join('&'),
      type: formType,
      status: 404,
    },
    { label: 'form permits 32 nesting levels', data: `unknown${'[x]'.repeat(32)}=1`, type: formType, status: 400 },
    { label: 'form rejects 33 nesting levels', data: `unknown${'[x]'.repeat(33)}=1`, type: formType, status: 404 },
    {
      label: 'form validation preserves unknown field order',
      data: 'zebra=1&alpha=2&email=invalid&password=x',
      type: formType,
      status: 400,
    },
    {
      label: 'nested form validation preserves unknown field order',
      data: 'accounts[0][zebra]=1&accounts[0][alpha]=2&accounts[0][privateDetails][totpSecret]=!',
      type: formType,
      path: '/sync/accounts',
      status: 400,
    },
    {
      label: 'numeric form fields use JavaScript object order',
      data: '9=last&2=first&zebra=1&alpha=2',
      type: formType,
      status: 400,
    },
  );
  return cases;
}

export async function runBodyParser(pair = undefined) {
  pair ??= await createPair();
  for (const sample of bodyCases()) {
    const path = sample.path ?? '/auth/login';
    const method = sample.path ? 'PUT' : 'POST';
    const headers = { 'Content-Type': sample.type };
    if (sample.encoding) headers['Content-Encoding'] = sample.encoding;
    const options = {
      headers,
      body: Buffer.isBuffer(sample.data) ? sample.data : Buffer.from(sample.data),
      auth: sample.path ? undefined : false,
    };
    if (process.env.BODY_PARSER_ORACLE === '1') {
      const response = await request(pair.urls.legacy, method, path, {
        ...options,
        token: sample.path ? pair.tokens.legacy : '',
      });
      console.log(JSON.stringify({ label: sample.label, ...response }));
      assert.equal(response.status, sample.status, sample.label);
      continue;
    }
    const responses = await pair.request(method, path, options);
    pair.check(sample.label, responses);
    assert.equal(responses.legacy.status, sample.status, sample.label);
  }
  return pair.results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runBodyParser();
  console.log(`Body parser parity: ${results.length} checks completed`);
}
