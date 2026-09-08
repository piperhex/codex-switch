import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFrameSessions } from '../apps/desktop/src-tauri/resources/chrome-extension/frame-sessions.js';

test('combines remote frame trees, recursively attaches, and routes same-process descendants to their owning session',async()=>{
  const listeners = new Set();
  const calls=[];
  const emit=(source,method,params)=>listeners.forEach(listener=>listener(source,method,params));
  const trees={
    root:{frame:{id:'main',url:'https://main.example'},childFrames:[{frame:{id:'local',url:'https://main.example/local'}}]},
    remote:{frame:{id:'remote-root',url:'https://remote.example'},
      childFrames:[{frame:{id:'remote-local',url:'https://remote.example/local'}}]},
    nested:{frame:{id:'nested-root',url:'https://nested.example'}},
  };
  globalThis.chrome={debugger:{onEvent:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)},
    sendCommand:async(target,method,params)=>{
      calls.push({target,method,params});
      if (method==='Target.setAutoAttach') {
        const child=target.sessionId==='remote'?'nested':!target.sessionId?'remote':null;
        if (child) emit(target,'Target.attachedToTarget',{sessionId:child,targetInfo:{targetId:child+'-root',type:'iframe'}});
        return {};
      }
      if (method==='Page.getFrameTree') return {frameTree:trees[target.sessionId??'root']};
      return {};
    }}};
  const sessions=createFrameSessions({tabId:7},async()=>{});
  await sessions.initialize();
  const frames=await sessions.documents();
  assert.deepEqual(frames.map(frame=>frame.id),['main','local','remote-root','remote-local','nested-root']);
  await sessions.send('DOM.resolveNode',{backendNodeId:3},'remote-local');
  assert.equal(calls.at(-1).target.sessionId,'remote');
  await sessions.send('DOM.resolveNode',{backendNodeId:4},'nested-root');
  assert.equal(calls.at(-1).target.sessionId,'nested');
  emit({tabId:7},'Target.detachedFromTarget',{sessionId:'remote'});
  assert.throws(()=>sessions.send('DOM.resolveNode',{},'remote-local'),/框架已变化/);
  sessions.dispose();assert.equal(listeners.size,0);
});
