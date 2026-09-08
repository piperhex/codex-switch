// Exercises the compiled helper processes with a simulated extension. Does not control a real browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const executable = path.resolve(process.env.CSW_CHROME_TEST_BINARY ?? 'apps/desktop/src-tauri/target/debug/csw.exe');
const extensionId = (await fs.readFile('apps/desktop/src-tauri/resources/chrome-extension/extension-id.txt','utf8')).trim();
const initializeOnly = process.argv.includes('--initialize-only');

function frame(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header,body]);
}

function framedMessages(stream, receive) {
  let pending = Buffer.alloc(0);
  stream.on('data', bytes => {
    pending = Buffer.concat([pending,bytes]);
    while (pending.length >= 4 && pending.length >= pending.readUInt32LE(0) + 4) {
      const length = pending.readUInt32LE(0);
      const message = JSON.parse(pending.subarray(4,length+4).toString());
      pending = pending.subarray(length+4);
      receive(message);
    }
  });
}

function start(args, root) {
  const child = spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,CSW_CHROME_TEST_ROOT:root}});
  child.stderr.on('data', () => {}); // Expected invalid-request failures are deliberately quiet.
  return child;
}

function rpc(child) {
  const waiting = new Map();
  let id = 0;
  createInterface({input:child.stdout}).on('line', line => {
    const response = JSON.parse(line);
    waiting.get(response.id)?.(response);
    waiting.delete(response.id);
  });
  return (method,params={}) => new Promise((resolve,reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(`Timed out: ${method}`)); },5000);
    waiting.set(requestId,response => {clearTimeout(timer);resolve(response);});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');
  });
}

async function waitFor(condition) {
  for (let attempt=0;attempt<100;attempt++) {
    const result = await condition();
    if (result) return result;
    await delay(30);
  }
  throw new Error('Timed out waiting for helper');
}

async function endpoint(root) {
  return waitFor(async () => {
    const names = await fs.readdir(path.join(root,'endpoints')).catch(()=>[]);
    if (!names.length) return null;
    return JSON.parse(await fs.readFile(path.join(root,'endpoints',names[0]),'utf8'));
  });
}

async function client(root,name) {
  const home = path.join(root,name);
  const normalized = home.replaceAll('\\','/');
  const clientId = createHash('sha256').update(process.platform === 'win32' ? normalized.toLowerCase() : normalized).digest('hex');
  const record = {home,token:randomBytes(32).toString('hex'),enabled:true};
  const file = path.join(root,'clients',`${clientId}.json`);
  await fs.mkdir(path.dirname(file),{recursive:true});
  const save = async () => {
    const temporary = file+'.tmp';
    await fs.writeFile(temporary,JSON.stringify(record));
    await fs.rename(temporary,file);
  };
  await save();
  return {clientId,record,save};
}

function bridge(port,request) {
  return new Promise((resolve,reject) => {
    const socket = net.connect({host:'127.0.0.1',port},()=>socket.write(frame(request)));
    socket.setTimeout(3000,()=>socket.destroy(new Error('Bridge timeout')));
    socket.on('error',reject);
    framedMessages(socket,result=>{resolve(result);socket.end();});
  });
}

test('the compiled application exposes MCP over redirected standard streams',async()=>{
  const child=start([`--chrome-mcp=${'a'.repeat(64)}`],os.tmpdir());
  try {
    const call=rpc(child);
    assert.equal((await call('initialize')).result.serverInfo.name,'codex-switch-chrome');
    const names=(await call('tools/list')).result.tools.map(tool=>tool.name);
    for(const name of ['browser_list','browser_tabs','browser_snapshot','browser_click','browser_fill','browser_screenshot']) {
      assert.ok(names.includes(name));
    }
  } finally {
    const exited=once(child,'exit');child.stdin.end();await exited;
  }
});

test('compiled Native Messaging and MCP helpers authenticate, relay, revoke, and recover from disconnect',
  {skip:initializeOnly},async()=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'csw-chrome-protocol-'));
  const children = [];
  try {
    const first = await client(root,'first');
    const second = await client(root,'second');
    const host = start([`chrome-extension://${extensionId}/`],root);children.push(host);
    const incoming = [];
    framedMessages(host.stdout,message=>{
      incoming.push(message);
      if (message.type === 'cancel' || message.request.operation === 'open') return;
      const result = message.request.operation === 'status' ? {paused:false} : {tabs:[{tabId:42,title:'fixture'}]};
      host.stdin.write(frame({type:'reply',id:message.id,result,error:null}));
    });
    host.stdin.write(frame({type:'ready',name:'Protocol fixture'}));
    const live = await endpoint(root);
    const mcp = start([`--chrome-mcp=${first.clientId}`],root);children.push(mcp);
    const call = rpc(mcp);
    assert.equal((await call('initialize')).result.serverInfo.name,'codex-switch-chrome');
    const definitions = (await call('tools/list')).result.tools;
    assert.ok(definitions.some(tool=>tool.name==='browser_screenshot'));
    const list = await call('tools/call',{name:'browser_list',arguments:{}});
    assert.equal(JSON.parse(list.result.content[0].text).browsers[0].browserId,live.id);
    const tabs = await call('tools/call',{name:'browser_tabs',arguments:{browserId:live.id}});
    assert.equal(JSON.parse(tabs.result.content[0].text).tabs[0].tabId,42);
    const before = incoming.length;
    const forged = await bridge(live.port,{clientId:first.clientId,token:second.record.token,
      request:{operation:'tabs',args:{}}});
    assert.ok(forged.error);assert.equal(incoming.length,before);
    const pending = call('tools/call',{name:'browser_open',arguments:{browserId:live.id,url:'https://example.com'}});
    await waitFor(()=>incoming.some(message=>message.request?.operation==='open'));
    first.record.enabled=false;await first.save();
    assert.equal((await pending).result.isError,true);
    await waitFor(()=>incoming.some(message=>message.type==='cancel'));
    const secondReply=await bridge(live.port,{clientId:second.clientId,token:second.record.token,
      request:{operation:'tabs',args:{}}});
    assert.equal(secondReply.result.tabs[0].tabId,42);
    first.record.enabled=true;await first.save();
    const exited=once(host,'exit');host.stdin.end();await exited;
    const gone=await call('tools/call',{name:'browser_list',arguments:{}});
    assert.deepEqual(JSON.parse(gone.result.content[0].text).browsers,[]);
  } finally {
    await Promise.all(children.map(async child=>{
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited=once(child,'exit');child.kill();await exited;
    }));
    // This directory is created by this test, never supplied by a caller.
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('csw-chrome-protocol-'));
    await fs.rm(root,{recursive:true});
  }
});
