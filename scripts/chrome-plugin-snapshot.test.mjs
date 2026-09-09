import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshot, reference, invalidate } from '../apps/desktop/src-tauri/resources/chrome-extension/snapshot.js';

globalThis.chrome={permissions:{contains:async()=>true},
  storage:{local:{get:async()=>({siteGrants:[{clientId:'fixture',origin:'https://example.com'}]})},
  session:{get:async()=>({})}}};

function fixture() {
  const frame={id:'frame',url:'https://example.com',loaderId:'document-one'};
  const nodes=[
    {backendDOMNodeId:1,role:{value:'button'},name:{value:'Save\n[note]'}},
    {backendDOMNodeId:2,role:{value:'textbox'},name:{value:'Password'},value:{value:'secret-fixture'}},
    {backendDOMNodeId:3,role:{value:'textbox'},name:{value:'Name'},value:{value:'visible name'}},
  ];
  const driver={tab:{id:5},context:{clientId:'fixture'},documents:async()=>[frame],send:async(method,args)=>{
    if(method==='Page.getFrameTree') return {frameTree:{frame}};
    if(method==='Accessibility.getFullAXTree') return {nodes:structuredClone(nodes)};
    if(method==='DOM.describeNode') return {node:{attributes:['type',args.backendNodeId===2?'password':'text']}};
    throw new Error('Unexpected command');
  }};
  return {driver,frame,nodes};
}

test('references cannot cross tabs, survive navigation, or name nodes absent from the snapshot',async()=>{
  const {driver,frame}=fixture();
  const page=await snapshot(driver);
  const ref=`${page.snapshotId}:1`;
  assert.equal((await reference(driver,ref)).nodeId,1);
  await assert.rejects(reference({...driver,tab:{id:6}},ref),/失效/);
  await assert.rejects(reference(driver,`${page.snapshotId}:999`),/失效/);
  frame.loaderId='document-two';
  await assert.rejects(reference(driver,ref),/跳转/);
  invalidate(driver.tab.id);
  await assert.rejects(reference(driver,ref),/失效/);
});

test('snapshots hide password values, quote page labels, and bound large documents',async()=>{
  const {driver,nodes}=fixture();
  let page=await snapshot(driver);
  assert.ok(!page.text.includes('secret-fixture'));
  assert.ok(page.text.includes('visible name'));
  assert.ok(page.text.includes('Save\\n[note]'));
  nodes.push(...Array.from({length:750},(_,index)=>({role:{value:'StaticText'},name:{value:`row${index}`}})));
  page=await snapshot(driver);
  assert.equal(page.truncated,true);
  assert.equal(page.text.split('\n').length,700);
});
