import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { request } from './parity-client.mjs';
import {
  sides,
  securityDevice,
  strangerDevice,
  strangerUser,
  control,
  desktop,
  mobile,
  signedToken,
  nextBoth,
  sendBoth,
  closeBoth,
  compareClosed,
  compareFrames,
  passed,
} from './chat-parity-support.mjs';

export async function capabilitiesAndCommands(pair) {
  let devices = await control(pair, { capabilities: [] });
  for (const [path, body] of [
    ['restart-codex', undefined],
    ['provider', { providerId: 'missing' }],
    ['provider-group', { group: 'missing' }],
  ]) {
    const result = await pair.step(
      `missing ${path} capability rejected`,
      'POST',
      `/devices/${securityDevice}/${path}`,
      { body },
    );
    assert.equal(result.legacy.status, 409);
  }
  await pair.step('other owner cannot control device', 'POST', `/devices/${securityDevice}/restart-codex`, {
    auth: [signedToken({ sub: strangerUser }), signedToken({ sub: strangerUser })],
  });
  const replaced = await control(pair, { localProxyRunning: false });
  await compareClosed(pair, 'new device connection replaces previous socket', devices, {
    code: 4000,
    reason: 'Replaced by a newer connection',
  });
  devices = replaced;
  const stopped = await pair.step(
    'provider switch requires running proxy',
    'POST',
    `/devices/${securityDevice}/provider`,
    { body: { providerId: 'missing' } },
  );
  assert.equal(stopped.legacy.status, 409);
  await truthyAcknowledgement(pair, devices);
  await commandOwnership(pair, devices);
  await commandTimeout(pair, devices);
  await commandDisconnect(pair, devices);
}

async function truthyAcknowledgement(pair, devices) {
  const responses = {};
  for (const side of sides) {
    const pending = request(pair.urls[side], 'POST', `/devices/${securityDevice}/restart-codex`, {
      token: pair.tokens[side],
    });
    const command = await devices[side].next('restart-codex');
    await devices[side].send({ type: 'switch-result', commandId: command.body.commandId, success: 1 });
    responses[side] = await pending;
  }
  pair.check('legacy truthy command success acknowledgement', responses);
  assert.equal(responses.legacy.status, 201);
}

async function commandOwnership(pair, devices) {
  const stranger = await control(pair, { deviceId: strangerDevice, accessToken: signedToken({ sub: strangerUser }) });
  const responses = {};
  for (const side of sides) {
    let completed = false;
    const pending = request(pair.urls[side], 'POST', `/devices/${securityDevice}/restart-codex`, {
      token: pair.tokens[side],
    }).then((response) => {
      completed = true;
      return response;
    });
    const command = await devices[side].next('restart-codex');
    await stranger[side].send({ type: 'switch-result', commandId: command.body.commandId, success: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(completed, false, 'another owner cannot acknowledge a command');
    await devices[side].send({ type: 'switch-result', commandId: command.body.commandId, success: true });
    responses[side] = await pending;
  }
  pair.check('command acknowledgements are isolated by owner and device', responses);
  await closeBoth(stranger);
}

async function commandTimeout(pair, devices) {
  const pending = Object.fromEntries(
    sides.map((side) => [
      side,
      request(pair.urls[side], 'POST', `/devices/${securityDevice}/restart-codex`, { token: pair.tokens[side] }),
    ]),
  );
  await nextBoth(devices, 'restart-codex');
  const responses = Object.fromEntries(await Promise.all(sides.map(async (side) => [side, await pending[side]])));
  pair.check('unacknowledged command times out after25seconds', responses);
  assert.equal(responses.legacy.status, 409);
  assert.equal(responses.legacy.body.message, 'Timed out while waiting for the device command');
}

async function commandDisconnect(pair, devices) {
  const pending = Object.fromEntries(
    sides.map((side) => [
      side,
      request(pair.urls[side], 'POST', `/devices/${securityDevice}/restart-codex`, { token: pair.tokens[side] }),
    ]),
  );
  await nextBoth(devices, 'restart-codex');
  const replacement = await control(pair);
  await compareClosed(pair, 'replacement closes command-owning device socket', devices, {
    code: 4000,
    reason: 'Replaced by a newer connection',
  });
  const responses = Object.fromEntries(await Promise.all(sides.map(async (side) => [side, await pending[side]])));
  pair.check('replacement rejects pending command', responses);
  assert.equal(responses.legacy.status, 409);
  assert.equal(responses.legacy.body.message, 'Device disconnected before the command completed');
  await closeBoth(replacement);
  const offline = await pair.step(
    'offline device commands rejected',
    'POST',
    `/devices/${securityDevice}/restart-codex`,
  );
  assert.equal(offline.legacy.status, 409);
}

export async function trafficAndSTUN(pair) {
  const admin = await pair.login('admin');
  const pc = await desktop(pair);
  const peer = await mobile(pair, pc);
  for (const [index, side] of sides.entries()) {
    const total = async () => {
      const result = await request(pair.urls[side], 'GET', '/admin/api/dashboard/overview?days=7', {
        token: admin[index],
      });
      assert.equal(result.status, 200);
      return result.body.chatTraffic.totalBytes;
    };
    const before = await total();
    await peer.sockets[side].send({
      type: 'signal',
      sessionId: peer.paired[side].body.sessionId,
      payload: { kind: 'key', key: 'de'.repeat(32) },
    });
    await pc[side].next('signal');
    await peer.sockets[side].send({
      type: 'relay',
      sessionId: peer.paired[side].body.sessionId,
      payload: 'ab'.repeat(27),
    });
    const first = await pc[side].next('relay');
    await pc[side].send({ type: 'relay', sessionId: peer.paired[side].body.sessionId, payload: 'cd'.repeat(31) });
    const second = await peer.sockets[side].next('relay');
    let after = await total();
    for (let retry = 0; retry < 5 && after - before < first.bytes + second.bytes; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      after = await total();
    }
    assert.equal(
      after - before,
      first.bytes + second.bytes,
      `${side}: count exact successfully written relay JSON bytes`,
    );
    peer.sockets[side].close();
    await peer.sockets[side].waitClosed();
    await pc[side].next('peer-offline');
    await pc[side].send({ type: 'relay', sessionId: peer.paired[side].body.sessionId, payload: 'ee' });
    assert.equal(await total(), after, `${side}: offline recipient must not increase traffic`);
  }
  passed(pair, 'traffic counts successful relay bytes exactly and excludes signals/offline frames');
  await closeBoth(pc);
  await closeBoth(peer.sockets);
  await udpSTUN(pair);
}

async function udpSTUN(pair) {
  const datagram = Buffer.alloc(20);
  datagram.writeUInt16BE(1);
  datagram.writeUInt32BE(0x2112a442, 4);
  Buffer.from('fixture-stun').copy(datagram, 8);
  const results = {};
  for (const [side, port] of [
    ['legacy', 13479],
    ['modern', 13478],
  ]) {
    const socket = dgram.createSocket('udp4');
    await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
    try {
      const response = await udpRequest(socket, port, datagram, 2500);
      assert.equal(response.length, 32);
      assert.equal(response.readUInt16BE(), 0x0101);
      assert.equal(response.readUInt16BE(2), 12);
      assert.equal(response.readUInt32BE(4), 0x2112a442);
      assert.deepEqual(response.subarray(8, 20), datagram.subarray(8, 20));
      assert.equal(response.readUInt16BE(20), 0x20);
      assert.equal(response[25], 1);
      const mappedPort = response.readUInt16BE(26) ^ 0x2112;
      assert.ok(mappedPort > 0 && mappedPort <= 65535);
      results[side] = { status: 200, body: response.subarray(0, 26) };
      const invalid = Buffer.from(datagram);
      invalid[0] = 0xff;
      await assert.rejects(udpRequest(socket, port, invalid, 180), /UDP response timeout/);
    } finally {
      socket.close();
    }
  }
  pair.check('real UDP STUN binding response and malformed packet rejection', results);
}

function udpRequest(socket, port, packet, timeout) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', receive);
      socket.off('error', fail);
    };
    const receive = (response) => {
      cleanup();
      resolve(response);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('UDP response timeout')), timeout);
    socket.once('message', receive);
    socket.once('error', fail);
    socket.send(packet, port, '127.0.0.1', (error) => {
      if (error) fail(error);
    });
  });
}
