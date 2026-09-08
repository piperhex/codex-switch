import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { validate, website } from '../apps/desktop/src-tauri/resources/chrome-extension/validation.js';

let storage;
let permissionModule;
let closedWindows;
beforeEach(async () => {
  storage = {local:{},session:{}};
  closedWindows = [];
  const area = name => ({get: async key => ({[key]:storage[name][key]}),
    set: async value => Object.assign(storage[name],value)});
  globalThis.chrome = {
    storage:{local:area('local'),session:area('session')},
    runtime:{getURL:path=>'chrome-extension://test/'+path},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    windows:{create:async()=>({id:1}),remove:async id=>{closedWindows.push(id);}},
  };
  permissionModule=await import('../apps/desktop/src-tauri/resources/chrome-extension/permissions.js?test='+crypto.randomUUID());
  await permissionModule.initializePermissions();
});

test('rejects browser internals, credential-bearing URLs, invalid tabs and forged operations',()=>{
  for(const url of ['file:///C:/secret','chrome://settings','javascript:alert(1)','https://user:pass@example.com']) {
    assert.throws(()=>website(url));
  }
  assert.equal(website('https://example.com/a').origin,'https://example.com');
  assert.throws(()=>validate({operation:'execute_script',args:{}}));
  assert.throws(()=>validate({operation:'click',args:{tabId:-1,x:1,y:1}}));
  assert.throws(()=>validate({operation:'click',args:{tabId:1,x:Infinity,y:1}}));
  assert.throws(()=>validate({operation:'fill',args:{tabId:1,ref:'ref',text:'a'.repeat(20001)}}));
  assert.throws(()=>validate({operation:'scroll',args:{tabId:1,deltaY:10001}}));
});

test('website access remains pending until the user decides and denial grants nothing',async()=>{
  const pending=permissionModule.authorize('https://example.com/a','first');
  await new Promise(resolve=>setImmediate(resolve));
  const state=await permissionModule.status();
  assert.equal(state.pending.length,1);
  const denied=assert.rejects(pending,/许可/);
  await permissionModule.decideAccess(state.pending[0].id,'deny');
  await denied;
  assert.deepEqual(storage.local,{});
  assert.deepEqual(storage.session,{});
});

test('session grants are scoped to the selected home and permanent grants can be revoked',async()=>{
  const first=permissionModule.authorize('https://example.com/a','first');
  await new Promise(resolve=>setImmediate(resolve));
  let state=await permissionModule.status();
  await permissionModule.decideAccess(state.pending[0].id,'session');await first;
  await permissionModule.authorize('https://example.com/b','first');
  const second=permissionModule.authorize('https://example.com/a','second');
  await new Promise(resolve=>setImmediate(resolve));
  state=await permissionModule.status();assert.equal(state.pending.length,1);
  await permissionModule.decideAccess(state.pending[0].id,'always');await second;
  await permissionModule.revoke('https://example.com');
  assert.deepEqual(storage.local.siteGrants,[]);assert.deepEqual(storage.session.sessionGrants,[]);
});

test('pause cancels pending permission and blocks already allowed sites',async()=>{
  storage.local.siteGrants=[{origin:'https://allowed.example',clientId:'first'}];
  const pending=permissionModule.authorize('https://pending.example','first');
  const rejected=assert.rejects(pending,/许可/);
  await new Promise(resolve=>setImmediate(resolve));
  await permissionModule.setPaused(true);await rejected;
  await assert.rejects(permissionModule.authorize('https://allowed.example','first'),/暂停/);
  await permissionModule.setPaused(false);
  await permissionModule.authorize('https://allowed.example','first');
});

test('permanent grants do not grant another home access and session sites appear in the popup',async()=>{
  storage.local.siteGrants=[{origin:'https://example.com',clientId:'first'}];
  await permissionModule.authorize('https://example.com','first');
  const controller=new AbortController();
  const second=permissionModule.authorize('https://example.com','second',controller.signal);
  const denied=assert.rejects(second,/许可/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await permissionModule.status()).pending.length,1);
  controller.abort();await denied;
  storage.session.sessionGrants=[{origin:'https://session.example',clientId:'first'}];
  assert.deepEqual((await permissionModule.status()).allowedOrigins,['https://example.com','https://session.example']);
});

test('closing the permission window denies promptly and concurrent grants are preserved',async()=>{
  const pending=permissionModule.authorize('https://closed.example','first');
  const denied=assert.rejects(pending,/许可/);
  await new Promise(resolve=>setImmediate(resolve));
  permissionModule.windowClosed(1);await denied;
  const first=permissionModule.authorize('https://one.example','first');
  const second=permissionModule.authorize('https://two.example','second');
  await new Promise(resolve=>setImmediate(resolve));
  await Promise.all((await permissionModule.status()).pending.map(item=>permissionModule.decideAccess(item.id,'always')));
  await Promise.all([first,second]);
  assert.equal(storage.local.siteGrants.length,2);
});

test('abort cancels a pending request without persisting authorization',async()=>{
  const controller=new AbortController();
  const pending=permissionModule.authorize('https://pending.example','first',controller.signal);
  const rejected=assert.rejects(pending,/许可/);
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await rejected;
  assert.equal((await permissionModule.status()).pending.length,0);
  assert.deepEqual(storage.local,{});
  assert.deepEqual(closedWindows,[1]);
});
