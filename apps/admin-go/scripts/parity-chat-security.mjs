import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPair, request } from './parity-client.mjs';
import { capabilitiesAndCommands, trafficAndSTUN } from './parity-chat-transport.mjs';
import {
  sides,
  securityDevice,
  strangerUser,
  connections,
  nextBoth,
  closeBoth,
  compareFrames,
  compareClosed,
  sendBoth,
  control,
  chat,
  desktop,
  mobile,
  claims,
  passed,
  signedToken,
  prepareSecurity,
  releaseConnections,
} from './chat-parity-support.mjs';

export async function runChatSecurity(pair = undefined) {
  pair ??= await createPair();
  const adminToken = pair.tokens.modern;
  const endpoint = '/admin/api/chat-settings';
  const initial = await request(pair.urls.modern, 'GET', endpoint, { token: adminToken });
  assert.equal(initial.status, 200);
  try {
    // Match the frozen Nest limit only for compatibility tests; the configurable default has its own smoke test.
    const configured = await request(pair.urls.modern, 'PATCH', endpoint, {
      token: adminToken, body: { ...initial.body, chatSessionLimit: 4 },
    });
    assert.equal(configured.status, 200);
    await prepareSecurity(pair);
    const registration = await control(pair);
    await closeBoth(registration);
    await rejectedAuthentication(pair);
    await capabilitiesAndCommands(pair);
    await malformedFrames(pair);
    await hotSessionBoundaries(pair);
    await reconstruction(pair);
    await legacyRelayGuards(pair);
    await sessionExpiration(pair);
    await trafficAndSTUN(pair);
    await authenticationTimeout(pair);
    return pair.results;
  } finally {
    releaseConnections();
    const restored = await request(pair.urls.modern, 'PATCH', endpoint, { token: adminToken, body: initial.body });
    assert.equal(restored.status, 200);
  }
}

async function rejectedAuthentication(pair) {
  const cases = [
    ['chat invalid token', { accessToken: 'invalid' }],
    ['chat expired token', { accessToken: signedToken({ exp: Math.floor(Date.now() / 1000) - 1 }) }],
    ['chat missing token expiry', { accessToken: signedToken({ exp: undefined }) }],
    ['chat unavailable user', { accessToken: signedToken({ sub: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }) }],
    ['chat different owner device', { accessToken: signedToken({ sub: strangerUser }) }],
    ['chat invalid role', { role: 'observer' }],
    ['chat invalid device identifier', { deviceId: '../../device' }],
    ['chat null desktop session descriptors', { sessions: null }],
    [
      'chat duplicate desktop descriptors',
      {
        sessions: [
          { sessionId: 'duplicate', resumeToken: 'aa'.repeat(32) },
          { sessionId: 'duplicate', resumeToken: 'aa'.repeat(32) },
        ],
      },
    ],
  ];
  for (const [label, patch] of cases) {
    const sockets = connections(pair);
    await sendBoth(sockets, (side) => ({
      type: 'authenticate',
      accessToken: pair.tokens[side],
      deviceId: securityDevice,
      role: 'desktop',
      transportVersion: 2,
      ...patch,
    }));
    await compareClosed(pair, label, sockets, { code: 4001, reason: 'Chat connection rejected' });
  }
  for (const patch of [{ accessToken: 'invalid' }, { deviceId: 'invalid-id' }, { appVersion: 23 }]) {
    const sockets = connections(pair, '/device-switch');
    await sendBoth(sockets, (side) => ({
      type: 'authenticate',
      accessToken: pair.tokens[side],
      deviceId: securityDevice,
      name: 'PC',
      platform: 'windows',
      ...patch,
    }));
    await compareClosed(pair, `control rejects malformed authentication ${Object.keys(patch)[0]}`, sockets, {
      code: 4001,
      reason: 'Invalid message',
    });
  }
}

async function malformedFrames(pair) {
  for (const raw of ['[]', 'null', '{invalid', Buffer.from('binary')]) {
    const sockets = connections(pair);
    await Promise.all(Object.values(sockets).map((socket) => socket.open));
    for (const socket of Object.values(sockets)) socket.ws.send(raw);
    await compareClosed(pair, `chat rejects ${Buffer.isBuffer(raw) ? 'binary frame' : raw}`, sockets, {
      code: 4001,
      reason: 'Chat connection rejected',
    });
  }
  const oversized = connections(pair);
  await Promise.all(Object.values(oversized).map((socket) => socket.open));
  for (const socket of Object.values(oversized)) socket.ws.send('x'.repeat(49153));
  await compareClosed(pair, 'chat 48KiB frame maximum', oversized, { code: 1009, reason: '' });
  const signalCases = [
    { kind: 'key', key: 'AA'.repeat(32) },
    { kind: 'key', key: 'aa'.repeat(32), generation: -1 },
    { kind: 'sdp', type: 'offer', sdp: 'x'.repeat(24001) },
    { kind: 'ice', candidate: 'x'.repeat(2049), sdpMid: null, sdpMLineIndex: null },
    { kind: 'ice', candidate: '', sdpMLineIndex: null },
  ];
  for (const payload of signalCases) {
    const pc = await desktop(pair);
    const peer = await mobile(pair, pc);
    await sendBoth(peer.sockets, (side) => ({ type: 'signal', sessionId: peer.paired[side].body.sessionId, payload }));
    await compareClosed(pair, `chat rejects malformed ${payload.kind} signal`, peer.sockets, {
      code: 4001,
      reason: 'Chat connection rejected',
    });
    compareFrames(pair, 'rejected peer revokes hot session', await nextBoth(pc, 'peer-close'));
    const retried = await chat(pair, 'mobile', (side) => ({ resume: claims(peer.paired, side) }));
    await compareClosed(pair, 'revoked hot session cannot resume', retried, {
      code: 4001,
      reason: 'Chat connection rejected',
    });
    await closeBoth(pc);
  }
  const pc = await desktop(pair, { transportVersion: '2' });
  const peer = await mobile(pair, pc);
  for (const side of sides) assert.equal(peer.paired[side].body.transportVersion, 2);
  passed(pair, 'desktop string transport version uses legacy Number coercion');
  for (const payload of [
    { kind: 'sdp', type: 'offer', sdp: '中'.repeat(10000) },
    { kind: 'ice', candidate: '😀'.repeat(1024), sdpMid: null, sdpMLineIndex: null },
  ]) {
    await sendBoth(peer.sockets, (side) => ({ type: 'signal', sessionId: peer.paired[side].body.sessionId, payload }));
    compareFrames(pair, 'Unicode signal length counts UTF16 code units', await nextBoth(pc, 'signal'));
  }
  await closeBoth(peer.sockets);
  await closeBoth(pc);
}

async function hotSessionBoundaries(pair) {
  const pc = await desktop(pair);
  const peers = [];
  for (let index = 0; index < 4; index++) peers.push(await mobile(pair, pc));
  const excess = await chat(pair, 'mobile');
  await compareClosed(pair, 'fifth hot session rejected', excess, { code: 4008, reason: 'Too many chat connections' });
  await closeBoth(peers[0].sockets);
  await nextBoth(pc, 'peer-offline');
  const stillFull = await chat(pair, 'mobile');
  await compareClosed(pair, 'offline resumable session retains slot', stillFull, {
    code: 4008,
    reason: 'Too many chat connections',
  });
  const wrong = await chat(pair, 'mobile', (side) => ({
    resume: { ...claims(peers[0].paired, side), resumeToken: '00'.repeat(32) },
  }));
  await compareClosed(pair, 'wrong resume proof rejected', wrong, { code: 4001, reason: 'Chat connection rejected' });
  const resumed = await chat(pair, 'mobile', (side) => ({ resume: claims(peers[0].paired, side) }));
  compareFrames(pair, 'resume allowed while all slots occupied', await nextBoth(resumed, 'resumed'), (body) => ({
    ...body,
    expiresAt: '<expiry>',
  }));
  await nextBoth(pc, 'resumed');
  const replacement = await chat(pair, 'mobile', (side) => ({ resume: claims(peers[0].paired, side) }));
  await nextBoth(replacement, 'resumed');
  await nextBoth(pc, 'resumed');
  await compareClosed(pair, 'new resumed socket replaces old mobile', resumed, {
    code: 4000,
    reason: 'Connection resumed',
  });
  await sendBoth(replacement, (side) => ({ type: 'peer-close', sessionId: peers[0].paired[side].body.sessionId }));
  await nextBoth(pc, 'peer-close');
  await nextBoth(replacement, 'peer-close');
  await sendBoth(replacement, (side) => ({
    type: 'relay',
    sessionId: peers[0].paired[side].body.sessionId,
    payload: 'aa',
  }));
  const renewed = await mobile(pair, pc);
  passed(pair, 'closed session frees slot and absorbs late frames');
  await closeBoth(renewed.sockets);
  await closeBoth(replacement);
  for (const peer of peers) await closeBoth(peer.sockets);
  await closeBoth(pc);
}

async function reconstruction(pair) {
  const id = `reconstructed-${Date.now()}`;
  const proof = 'ca'.repeat(32);
  const oldDesktop = await desktop(pair);
  const missing = await chat(pair, 'mobile', { resume: { sessionId: id, resumeToken: proof } });
  await compareClosed(pair, 'resume waits for desktop reconstruction', missing, {
    code: 4004,
    reason: 'Waiting for PC session',
  });
  const replacement = await desktop(pair, { sessions: [{ sessionId: id, resumeToken: proof }] });
  await compareClosed(pair, 'new desktop replaces previous coordinator connection', oldDesktop, {
    code: 4000,
    reason: 'Replaced by a newer connection',
  });
  const resumed = await chat(pair, 'mobile', { resume: { sessionId: id, resumeToken: proof } });
  compareFrames(
    pair,
    'desktop descriptors reconstruct absent coordinator session',
    await nextBoth(resumed, 'resumed'),
    (body) => ({ ...body, expiresAt: '<expiry>' }),
  );
  await nextBoth(replacement, 'resumed');
  await sendBoth(resumed, { type: 'relay', sessionId: id, payload: 'cafe' });
  compareFrames(pair, 'reconstructed session relays encrypted frames', await nextBoth(replacement, 'relay'));
  const reset = await desktop(pair);
  compareFrames(pair, 'desktop omitting descriptor revokes retained session', await nextBoth(resumed, 'peer-close'));
  await closeBoth(resumed);
  await closeBoth(reset);
  await closeBoth(replacement);
}

async function legacyRelayGuards(pair) {
  for (const message of [
    { type: 'relay-request', reason: 'timeout' },
    { type: 'relay', payload: 'abcd' },
  ]) {
    const pc = await desktop(pair, { transportVersion: 1 });
    const peer = await mobile(pair, pc, { transportVersion: 1 });
    await sendBoth(peer.sockets, (side) => ({ ...message, sessionId: peer.paired[side].body.sessionId }));
    await compareClosed(pair, 'legacy relay requires negotiated fallback', peer.sockets, {
      code: 4001,
      reason: 'Chat connection rejected',
    });
    await nextBoth(pc, 'peer-close');
    await closeBoth(pc);
  }
  const pc = await desktop(pair, { transportVersion: 1 });
  const resuming = await chat(pair, 'mobile', { resume: { sessionId: 'missing', resumeToken: 'ca'.repeat(32) } });
  await compareClosed(pair, 'legacy desktop cannot resume v2 session', resuming, {
    code: 4004,
    reason: 'Session unavailable',
  });
  await closeBoth(pc);
}

async function sessionExpiration(pair) {
  const token = signedToken({ exp: Math.floor(Date.now() / 1000) + 3 });
  const pc = await desktop(pair, { accessToken: token });
  const peer = await mobile(pair, pc);
  await compareClosed(pair, 'chat token expiry closes desktop', pc, { code: 4001, reason: 'Session expired' });
  compareFrames(pair, 'expired endpoint revokes session', await nextBoth(peer.sockets, 'peer-close'));
  await closeBoth(peer.sockets);
}

async function authenticationTimeout(pair) {
  const sockets = connections(pair);
  const devices = connections(pair, '/device-switch');
  await Promise.all([...Object.values(sockets), ...Object.values(devices)].map((socket) => socket.open));
  await Promise.all([
    compareClosed(
      pair,
      'chat authentication timeout',
      sockets,
      { code: 4001, reason: 'Authentication timed out' },
      12000,
    ),
    compareClosed(
      pair,
      'control authentication timeout',
      devices,
      { code: 4001, reason: 'Authentication timed out' },
      12000,
    ),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runChatSecurity();
  console.log(`Chat security parity passed: ${results.length} checks`);
}
