import test from 'node:test';
import assert from 'node:assert/strict';
import { readHistory } from '../skills/dsh-assistant/scripts/history.mjs';
import { DshClient } from '../skills/dsh-assistant/scripts/dsh.mjs';
const event = seq => ({ type:'event', event:{ type:'assistant/message', seq, data:{} } });
test('actual RPC request forwards verified exclusive beforeSeq and inclusive throughSeq', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /\/api\/session\/page$/);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.payload.args, {request:{address:{kind:'session',sessionId:'s'},maxMessages:2,beforeSeq:7,throughSeq:10}});
    return {ok:true,text:async()=>JSON.stringify({result:{ok:true,value:{records:[],hasMore:false}}})};
  };
  try { await new DshClient({base:'http://127.0.0.1',cookie:{header:'test'}}).readSessionPage('s',{maxMessages:2,beforeSeq:7,throughSeq:10}); }
  finally { globalThis.fetch = oldFetch; }
});
test('backfills, pins log cut, deduplicates and sorts actual event records', async () => {
  const calls=[];
  const pages=[{records:[event(5),event(4)],hasMore:true},{records:[event(2),event(3),event(4)],hasMore:true}];
  const result=await readHistory({readSessionPage:async(s,o)=>{calls.push(o);return pages.shift();}},'s',{afterSeq:2,maxMessages:2});
  assert.deepEqual(result.records.map(r=>r.event.seq),[3,4,5]);
  assert.equal(result.pages,2);
  assert.deepEqual(calls[1],{maxMessages:2,beforeSeq:4,throughSeq:5});
});
test('full history reads until explicitly exhausted',async()=>{
  const pages=[{records:[event(2)],hasMore:true},{records:[event(0),event(1)],hasMore:false}];
  const result=await readHistory({readSessionPage:async()=>pages.shift()},'s');
  assert.deepEqual(result.records.map(r=>r.event.seq),[0,1,2]);
});
test('fail closed on missing protocol, nonprogress, empty more, bad events and page cap',async()=>{
  for(const page of [{records:[]},{records:[],hasMore:true},{records:[{seq:2}],hasMore:false}]) {
    await assert.rejects(readHistory({readSessionPage:async()=>page},'s'));
  }
  await assert.rejects(readHistory({readSessionPage:async()=>({records:[event(5)],hasMore:true})},'s'),/no progress/);
  await assert.rejects(readHistory({readSessionPage:async()=>({records:[event(5)],hasMore:true})},'s',{maxPages:1}),/maxPages/);
});
test('rejects sequence gaps and conflicting overlapping records',async()=>{
  await assert.rejects(readHistory({readSessionPage:async()=>({records:[event(0),event(2)],hasMore:false})},'s'),/sequence gap/);
  const pages=[{records:[event(2)],hasMore:true},{records:[event(0),{...event(2),changed:true}],hasMore:false}];
  await assert.rejects(readHistory({readSessionPage:async()=>pages.shift()},'s'),/Conflicting/);
});
