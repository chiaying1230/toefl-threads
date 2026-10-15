// Owner-authorized ZERO-PAID preparation only. Never creates/consumes a receipt or selects/generates a take.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ProductionService } from './production.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { loadCatalog } from './catalog.mjs';
import { fileEvidence } from './hashing.mjs';
import { root } from './server.mjs';
const id='20ee16ed-e72f-4b06-9b4c-0387fc82b0f8', baseRunId='a3a48e7d-8cb4-4671-bdc2-b6f121ae585a';
const draftsDir=path.join(root,'video-studio/state/drafts'),productionDir=path.join(draftsDir,'production');
const read=fs.readFileSync;let service,requests=0,keyReads=0;
fs.readFileSync=function(f,...a){assert.notEqual(path.basename(String(f)),'.env');return read.call(this,f,...a);};
globalThis.fetch=()=>{throw Error('Network forbidden in zero-paid retake preparation');};
try {
 const store=new DraftStore(draftsDir,loadCatalog(root)),wf=new ProductionWorkflow(store,root),draft=store.get(id),decisions=structuredClone(draft.decisions);
 service=new ProductionService({draftsDir,productionDir,repoRoot:root,catalogLoader:loadCatalog,loadedEngineHash:wf.loadedEngineHash,promotion:{enabled:false},autoChain:false,
  fetchImpl:()=>{requests++;throw Error('Provider forbidden');},apiKey:()=>{keyReads++;throw Error('Credential forbidden');}});
 const c=service.coordinator;
 const ledger=()=>Object.fromEntries(['receipts','executions','attempts'].map(t=>[t,c.all(`SELECT * FROM ${t} ORDER BY rowid`)]));
 const before=ledger();assert.equal(before.attempts.length,11);assert.ok(before.attempts.every(a=>a.status==='succeeded'));assert.equal(before.receipts.length,1);
 const original=c.run2B('be8e6a15-8d6b-48bb-b0d9-6bb1bd575182'),originalCandidate=service.candidate(original);
 const evidence=before.attempts.flatMap(a=>[JSON.parse(a.response_ref),{path:`voice/sealed/${a.segment_hash}.mp3`,bytesHash:a.audio_hash,size:fileEvidence(originalCandidate.abs(`voice/sealed/${a.segment_hash}.mp3`)).size},{path:`voice/sealed/${a.segment_hash}.json`,bytesHash:a.alignment_hash,size:fileEvidence(originalCandidate.abs(`voice/sealed/${a.segment_hash}.json`)).size}]);
 for(const ref of evidence)originalCandidate.verifyDeep(ref);
 const preview=await service.retake(id,{baseRunId,segmentId:'v1Meaning',revision:draft.revision,reject:true,reason:'人工已確認：原始 ElevenLabs take「家庭作業」發音錯誤；重新錄製同文字／Ling／eleven_v4，明確 zh，不自動送出。'});
 assert.equal(preview.run.state,'awaiting_confirmation',JSON.stringify(preview.run.reason));assert.equal(preview.envelope.requests.length,1);
 const request=preview.envelope.requests[0];assert.deepEqual(request.segmentIds,['v1Meaning']);assert.equal(request.text,'家庭作業');assert.equal(request.chars,4);
 assert.equal(request.speaker,'ling');assert.equal(request.model,'eleven_v4');assert.equal(request.languageCode,'zh');assert.equal(request.requestBody.language_code,'zh');
 assert.equal(preview.envelope.counts.hit,10);assert.equal(preview.envelope.counts.silent,2);assert.equal(preview.envelope.counts.miss,1);
 assert.equal(preview.envelope.budget.maxRequests,1);assert.equal(preview.envelope.budget.maxSubmittedChars,4);assert.equal(preview.envelope.retake.reuse.length,10);
 const run=c.run2B(preview.run.runId),candidate=service.candidate(run),episode=candidate.readJson(run.inputs.inputRefs.episode);
 assert.equal(episode.hook.zh,null);assert.ok(episode.story.at(-1).parts.some(p=>p.type==='translation'&&p.text==='週末你們都去哪了'));
 assert.equal(candidate.readJson(run.inputs.inputRefs.validation).verdict,'PASS');
 assert.equal(candidate.readJson(run.inputs.inputRefs.voicePlan).charsToGenerate,4);
 assert.equal(preview.readiness.productionReady,false);assert.equal(preview.readiness.canRender,false);assert.equal(preview.review,null);
 assert.deepEqual(store.get(id).decisions,decisions);assert.equal(store.get(id).revision,draft.revision);
 assert.deepEqual(ledger(),before,'Original receipt / execution / all 11 attempts stay byte-for-byte unchanged');
 for(const ref of evidence)originalCandidate.verifyDeep(ref);
 assert.equal(requests,0);assert.equal(keyReads,0);assert.equal(c.get("SELECT COUNT(*) n FROM reviews WHERE status='accepted'").n,0);
 const proof={draftId:id,revision:draft.revision,baseRunId,runId:run.run_id,candidateId:run.candidate_id,takeId:preview.envelope.retake.takeId,state:preview.run.state,
  request,counts:preview.envelope.counts,budget:preview.envelope.budget,reuse:preview.envelope.retake.reuse,validation:'PASS',retakeFreePlan:'PASS',paidPreflight:'PASS',
  originalPaidEvidenceUnchanged:true,oldTakePreserved:true,newReceiptCreated:false,newReceiptConsumed:false,additionalRequests:requests,additionalCharacters:0,keyReads,
  productionReady:false,promotionEnabled:false,activeTake:null,downstreamCurrent:[],originalLedger:{receipts:before.receipts.length,executions:before.executions.length,attempts:before.attempts.length}};
 fs.mkdirSync(path.join(root,'video-studio/state/qa'),{recursive:true});fs.writeFileSync(path.join(root,'video-studio/state/qa/p6-retake-preflight.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify(proof,null,2));
}finally{service?.close();fs.readFileSync=read;}
