import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setup,FAKE_STEPS,key} from './test-support.mjs';
import {StepFailure,refineCameraAnchors} from './production-steps.mjs';
test('one pass repairs all independent transitions, deduplicates frames and keeps bounded delay choices',()=>{
 const anchors=Array.from({length:9},(_,i)=>({id:`a${i}`,delayOption:0}));
 const report=anchors.map((a,i)=>({anchor:a.id,members:[a.id],start:i*2,settle:i*2+0.35,end:i*2+2}));
 const hard=report.flatMap(r=>[{t:r.start+0.1},{t:r.start+0.2}]),boost={};
 assert.equal(refineCameraAnchors(anchors,report,hard,boost),true);
 assert.deepEqual(anchors.map(a=>a.delayOption),Array(9).fill(1));
 assert.equal(refineCameraAnchors(anchors,report,hard,boost),true);
 assert.deepEqual(anchors.map(a=>a.delayOption),Array(9).fill(2));
 assert.equal(refineCameraAnchors(anchors,report,hard,boost),false);assert.deepEqual(boost,{});
});

test('shared assembler update alone enables verified free rebuild even when the Studio helper hash is unchanged',async()=>{
 const s=setup({autoChain:true,localSteps:{...FAKE_STEPS,verifyStep:async()=>{throw new StepFailure('VERIFY_FAILED','voiced span');}}});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-recovery-'));
 try{
  const p=await s.preview();await s.confirm(p,key(992));await s.service.idle();const base=s.service.coordinator.run2B(p.run.runId),before=s.provider.calls.length;
  for(const file of base.inputs.bindings.engine.files){const target=path.join(root,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(s.service.repoRoot,file.path),target);}
  fs.appendFileSync(path.join(root,'scripts/video/voice/assemble.mjs'),'\n// isolated next shared revision\n');
  fs.mkdirSync(path.join(root,'scripts/video/episodes'),{recursive:true});
  s.service.repoRoot=root;s.service.steps.verifyStep=FAKE_STEPS.verifyStep;
  assert.equal(s.service.context().workflow.engineHash(),s.service.loadedEngineHash);
  assert.equal(s.service.view(s.id).recovery.canRebuildAfterUpdate,true);
  const rebuilt=await s.service.rebuildAfterUpdate(s.id,{runId:base.run_id,revision:base.revision});await s.service.idle();
  assert.equal(rebuilt.envelope.requests.length,0);assert.equal(s.provider.calls.length,before);assert.equal(s.service.coordinator.get('SELECT COUNT(*) n FROM receipts').n,1);assert.equal(s.service.view(s.id).run.state,'awaiting_review');
  await assert.rejects(s.service.rebuildAfterUpdate(s.id,{runId:rebuilt.run.runId,revision:base.revision}),/相同失敗內容/);
 }finally{s.close();assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
test('new engine rebuild reuses sealed audio without a new receipt; unchanged engine cannot loop',async()=>{
 const s=setup({autoChain:true,localSteps:{...FAKE_STEPS,cameraStep:async()=>{throw new StepFailure('CAMERA_AUDIT_UNRESOLVED','fixture',{blocked:true});}}});
 try{
  const p=await s.preview();await s.confirm(p,key(991));await s.service.idle();const base=s.service.coordinator.run2B(p.run.runId);assert.equal(base.state,'blocked');
  await assert.rejects(s.service.rebuildAfterUpdate(s.id,{runId:base.run_id,revision:base.revision}),/相同失敗內容/);
  // Model a trusted snapshot written by a previous Studio version; do not modify live code during a test.
  s.service.coordinator.updateRun(base.run_id,base.epoch,{inputs:{...base.inputs,bindings:{...base.inputs.bindings,studioEngineHash:'previous-engine'}}});
  s.service.steps.cameraStep=FAKE_STEPS.cameraStep;
  assert.equal(s.service.view(s.id).recovery.canRebuildAfterUpdate,true);
  const rebuilt=await s.service.rebuildAfterUpdate(s.id,{runId:base.run_id,revision:base.revision});await s.service.idle();
  assert.equal(rebuilt.envelope.requests.length,0);assert.equal(s.provider.calls.length,4);
  assert.equal(s.service.coordinator.get('SELECT COUNT(*) n FROM receipts').n,1);
  assert.equal(s.service.view(s.id).run.state,'awaiting_review');
  await assert.rejects(s.service.rebuildAfterUpdate(s.id,{runId:rebuilt.run.runId,revision:base.revision}),/相同失敗內容/);
 }finally{s.close();}
});
