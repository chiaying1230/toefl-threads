import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fixture} from './fixtures.mjs';import {digest} from './catalog.mjs';import {createStudio} from './server.mjs';import {mockProvider} from './mock-provider.mjs';import {FAKE_STEPS} from './test-support.mjs';import {BatchProduction} from './batch-production.mjs';
import {correctSeriesEpisode} from './series-correction.mjs';

test('automatic batches teach every source vocabulary item, including three words at one boundary',async()=>{
 const f=setup();try{
  const store=f.server.production.context().store;
  for(const record of store.catalog.records.values()){
   const extra=fixture('multiple').record.vocabulary[1];
   record.vocabulary.push(extra,{...extra,key:'teach',word:'teach',zh:'教導',ex:'We teach students.',exZh:'我們教學生。'});
   for(const v of record.vocabulary)store.catalog.vocab[v.key]=v;
   record.post.text='We [[allocate]] [[arbitrary]] supplies and [[teach]] students.';
   record.sourceHash=digest({...record,sourceHash:undefined});
  }
  const b=await f.server.batches.prepare({count:1});assert.equal(b.status,'ready',JSON.stringify(b.items));assert.equal(b.policy,'auto-source-all-v2');
  const draft=f.server.production.context().store.get(b.items[0].draftId);
  assert.deepEqual(draft.decisions.vocabulary,['allocate','arbitrary','teach']);
  assert.equal(f.provider.calls.length,0);assert.equal(f.keys(),0);
 }finally{await f.close();}
});
function setup(behavior){const f=fixture(),records=new Map();for(const [id,text]of [['auto-a','We [[allocate]] supplies, and the class starts.'],['auto-b','We [[allocate]] resources, and the lesson starts.']]){const r=structuredClone(f.record);r.post.id=id;r.post.text=text;r.sourceHash=digest({...r,sourceHash:undefined});records.set(id,r);}f.catalog.records=records;f.catalog.frozen=new Set();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'batch-qa-')),provider=mockProvider(behavior);let keys=0;const server=createStudio({stateDir:dir,catalogLoader:()=>f.catalog,fetchImpl:provider.fetchImpl,apiKey:()=>{keys++;return 'test-key-not-real';}});server.production.steps={...server.production.steps,...FAKE_STEPS};return {server,provider,dir,keys:()=>keys,close:async()=>{await server.batches.job;await server.production.idle();server.production.close();fs.rmSync(dir,{recursive:true,force:true});}};}
test('batch automatically selects/configures, bounds approval, survives preview reload and serially stops at human review',async()=>{
 const f=setup();try{const b=await f.server.batches.prepare({count:2,pack:'toefl'});assert.equal(b.status,'ready');assert.equal(f.provider.calls.length,0);assert.equal(f.keys(),0);assert.equal(b.items.length,2);assert.equal(new Set(b.items.map(i=>i.contentId)).size,2);assert.equal(b.items[1].episode,b.items[0].episode+1);assert.ok(b.totals.requests>0);
 assert.throws(()=>f.server.batches.start(b.id,{approvalHash:'wrong',acknowledgements:{budgetAccepted:true}}));assert.throws(()=>f.server.batches.start(b.id,{approvalHash:b.approvalHash}));assert.equal(f.provider.calls.length,0);
 f.server.batches=new BatchProduction(f.server.production);f.server.production.coordinator.run("UPDATE challenges SET expires_at = ?",'2000-01-01T00:00:00.000Z');
 const input={approvalHash:b.approvalHash,acknowledgements:{budgetAccepted:true}};f.server.batches.start(b.id,input);assert.equal(f.server.batches.start(b.id,input).status,'running');await f.server.batches.job;
 const done=f.server.batches.view(b.id);assert.ok(done.items.every(i=>i.status==='awaiting_review'),JSON.stringify(done.items.map(i=>i.error)));assert.ok(f.provider.calls.length<=b.totals.requests);const count=f.provider.calls.length;assert.throws(()=>f.server.batches.start(b.id,input));assert.equal(f.provider.calls.length,count);for(const item of done.items){const v=f.server.production.view(item.draftId);assert.equal(v.readiness.productionReady,false);assert.equal(v.readiness.canReview,true);}
 }finally{await f.close();}
});
test('one failed paid item never retries and does not stop later films; restart never re-dispatches running batch',async()=>{
 const f=setup(c=>c.n===1?{status:429}:null);try{const b=await f.server.batches.prepare({count:2});f.server.batches.start(b.id,{approvalHash:b.approvalHash,acknowledgements:{budgetAccepted:true}});await f.server.batches.job;const done=f.server.batches.view(b.id);assert.equal(done.items[0].status,'needs_attention');assert.equal(done.items[1].status,'awaiting_review');assert.equal(f.provider.calls.filter(c=>c.body.text===f.provider.calls[0].body.text).length,1);
 done.status='running';done.items[0].status='producing';f.server.batches.save(done);const count=f.provider.calls.length;f.server.batches=new BatchProduction(f.server.production);assert.equal(f.server.batches.get(b.id).status,'interrupted');assert.equal(f.provider.calls.length,count);
 }finally{await f.close();}
});
test('changed draft or tampered budget cannot reuse an earlier batch approval',async()=>{
 const f=setup();try{const b=await f.server.batches.prepare({count:1});const tampered=structuredClone(b);tampered.items[0].budget.maxSubmittedChars++;f.server.batches.save(tampered);assert.throws(()=>f.server.batches.start(b.id,{approvalHash:b.approvalHash,acknowledgements:{budgetAccepted:true}}));f.server.batches.save(b);
 const store=f.server.production.context().store,d=store.get(b.items[0].draftId);correctSeriesEpisode(store,d.id,{revision:d.revision,episode:d.decisions.seriesEpisode+10});f.server.batches.start(b.id,{approvalHash:b.approvalHash,acknowledgements:{budgetAccepted:true}});await f.server.batches.job;assert.equal(f.provider.calls.length,0);assert.equal(f.keys(),0);assert.equal(f.server.batches.view(b.id).items[0].status,'needs_attention');}finally{await f.close();}
});
