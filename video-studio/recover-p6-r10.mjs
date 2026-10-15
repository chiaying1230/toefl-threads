// Owner-authorized FREE recovery only. Original paid ledger/candidate preserved; new immutable engine/candidate, 11 validated hits.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { ProductionService } from './production.mjs';
import { Candidate } from './candidate.mjs';
import { validatePair } from './voice-envelope.mjs';
import { bufferHash } from './hashing.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { decodeAudio, rms, SAMPLE_RATE as SR } from '../scripts/video/voice/audio.mjs';
import { root } from './server.mjs';
const id = '20ee16ed-e72f-4b06-9b4c-0387fc82b0f8', oldRunId = 'be8e6a15-8d6b-48bb-b0d9-6bb1bd575182';
const draftsDir = path.join(root,'video-studio/state/drafts'), productionDir = path.join(draftsDir,'production');
let service, providerRequests = 0, keyReads = 0;
const oldRead = fs.readFileSync;
fs.readFileSync = function(file,...args) { assert.notEqual(path.basename(String(file)),'.env'); return oldRead.call(this,file,...args); };
globalThis.fetch = () => { throw Error('Network forbidden: free recovery'); };
try {
  const revision = JSON.parse(fs.readFileSync(path.join(root,'docs/video/revisions/r10-final-waveform-trim.json')));
  assert.equal(revision.status,'validated'); assert.equal(revision.tests.offline.pass,96);
  assert.ok(revision.references.every(r=>r.audioIdentical && r.planIdentical && r.framesPass && r.verifyPass));
  const catalog = loadCatalog(root), store = new DraftStore(draftsDir,catalog), workflow = new ProductionWorkflow(store,root);
  const originalDecisions = structuredClone(store.get(id).decisions);
  service = new ProductionService({ draftsDir,productionDir,repoRoot:root,catalogLoader:loadCatalog,loadedEngineHash:workflow.loadedEngineHash,
    fetchImpl:()=>{providerRequests++;throw Error('Provider forbidden: free recovery');},apiKey:()=>{keyReads++;throw Error('Key forbidden: free recovery');},promotion:{enabled:false},autoChain:false });
  const c = service.coordinator;
  const ledger = () => ({receipts:c.get('SELECT COUNT(*) n FROM receipts').n,executions:c.get('SELECT COUNT(*) n FROM executions').n,
    attempts:c.get('SELECT COUNT(*) n FROM attempts').n,requests:c.get('SELECT COALESCE(SUM(network_attempted),0) n FROM attempts').n,
    characters:c.get('SELECT COALESCE(SUM(reserved_chars),0) n FROM attempts WHERE network_attempted=1').n});
  const before = ledger(); assert.equal(before.requests,11); assert.equal(before.attempts,11);
  const oldRun = c.run2B(oldRunId), oldCandidate = new Candidate(productionDir,oldRun.candidate_id,oldRun.inputs.bindings.engine);
  oldCandidate.verifyEngine();
  const oldVoice = c.steps(oldRunId).find(s=>s.step==='voice'&&s.status==='succeeded').result.outputs.find(r=>r.role==='voiceBundle');
  oldCandidate.verifyDeep(oldVoice);
  const bundle = oldCandidate.readJson(oldVoice), narration = oldCandidate.readJson(oldRun.inputs.inputRefs.narration), cfg = JSON.parse(oldCandidate.engineFile('scripts/video/voices.json'));
  const prepared = prepareNarration(narration,cfg,{requireApiKey:false,env:{}});
  for (const pair of bundle.pairs) {
    const a = c.all('SELECT a.* FROM attempts a JOIN executions e ON a.execution_id=e.execution_id WHERE e.run_id=? AND a.segment_hash=?',oldRunId,pair.hash)[0];
    assert.equal(a.status,'succeeded'); assert.equal(bufferHash(fs.readFileSync(oldCandidate.verify(pair.audio))),a.audio_hash);
    assert.equal(bufferHash(fs.readFileSync(oldCandidate.verify(pair.alignment))),a.alignment_hash);
    const cache = service.voiceStore.paths(pair.hash);
    assert.equal(bufferHash(fs.readFileSync(cache.audio)),a.audio_hash); assert.equal(bufferHash(fs.readFileSync(cache.alignment)),a.alignment_hash);
    validatePair(prepared.segments.find(s=>s.hash===pair.hash),prepared.outputFormat,cache.audio,fs.readFileSync(cache.alignment,'utf8'));
  }
  assert.equal(bundle.pairs.length,11);
  const draft = workflow.run(id,{revision:store.get(id).revision}); assert.equal(draft.status,'voice_planned');
  assert.equal(draft.revision,4); assert.deepEqual(draft.decisions,originalDecisions);
  const p = await service.preview(id,{revision:4});
  assert.equal(p.envelope.counts.hit,11); assert.equal(p.envelope.counts.miss,0); assert.equal(p.envelope.counts.silent,2);
  assert.equal(p.envelope.requests.length,0); assert.equal(p.envelope.estimatedUniqueTextChars,0); assert.equal(p.challenge,undefined);
  assert.equal(p.run.milestone,'voice_generated'); console.log('FREE recovery: 11 verified cache hits, zero misses/requests/chars; new candidate '+p.run.candidateId);
  service.resume(id,p.run.runId); await service.idle();
  const v = service.view(id), run = c.run2B(p.run.runId), out = service.chain(run), candidate = service.candidate(run);
  assert.equal(v.run.milestone,'awaiting_human_review',JSON.stringify(v.run.reason)); assert.equal(v.run.state,'awaiting_review');
  for(const step of ['voice','assemble','camera','audit','render','mix','verify','review']) assert.equal(out[step].status,'succeeded',step);
  const plan = candidate.readJson(out.assemble.result.outputs.find(r=>r.role==='plan')), wav = decodeAudio(candidate.verify(out.assemble.result.outputs.find(r=>r.role==='wav')));
  const episode = candidate.readJson(out.camera.result.outputs.find(r=>r.role==='episode'));
  assert.equal(episode.hook.zh,null); assert.ok(episode.story.at(-1).parts.some(p=>p.type==='translation'&&p.text==='週末你們都去哪了'));
  const proof = candidate.readJson(out.verify.result.outputs.find(r=>r.role==='verification'));
  const acoustic = proof.checks.find(x=>x.name.includes('voiced span')); assert.equal(acoustic.ok,true); assert.equal(acoustic.detail.lines,11);
  const l = plan.lines.find(l=>l.id==='story002'), i = plan.lines.indexOf(l), next = plan.lines[i+1], w=Math.round(.01*SR);
  let first=null,last=null;
  for(let j=Math.round((l.start-.03)*SR);j<Math.min(wav.length,Math.round(Math.min(l.end+.06,next.start-.01)*SR));j+=w)if(rms(wav,j,j+w)>.004){first??=j/SR;last=(j+w)/SR;}
  const timing={start:l.start,end:l.end,voicedStart:first,voicedEnd:last,onsetSlackMs:(first-l.start)*1000,endSlackMs:(l.end-last)*1000};
  assert.ok(timing.endSlackMs<=60);
  assert.deepEqual(ledger(),before,'No new receipt/execution/paid attempt/characters'); assert.equal(providerRequests,0);assert.equal(keyReads,0);
  assert.equal(v.readiness.productionReady,false);assert.equal(v.readiness.canReview,true);assert.equal(v.readiness.canPromote,false);
  const finalRef=out.mix.result.outputs.find(r=>r.role==='final');
  const report={revision:'r10-final-waveform-trim',draftId:id,draftRevision:4,runId:run.run_id,candidateId:run.candidate_id,state:v.run.state,milestone:v.run.milestone,
    cacheCounts:p.envelope.counts,story002:timing,verifyChecks:proof.checks.map(x=>({name:x.name,ok:x.ok})),acousticRows:acoustic.detail.rows,
    steps:Object.fromEntries(Object.entries(out).map(([step,s])=>[step,{status:s.status,attemptId:s.attempt_id,outputs:s.result.outputs,report:s.result.report,warnings:s.result.warnings}])),
    ledgerBefore:before,ledgerAfter:ledger(),additionalProviderRequests:0,additionalPaidCharacters:0,keyReads:0,promotionEnabled:false,productionReady:false,
    finalMP4:candidate.verify(finalRef),finalHash:finalRef.bytesHash,mediaUrl:`http://127.0.0.1:8140/api/drafts/${id}/production/media/final`};
  fs.writeFileSync(path.join(root,'video-studio/state/qa/p6-r10-recovery.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({state:report.state,milestone:report.milestone,story002:timing,verifyPass:proof.checks.every(c=>c.ok),checks:proof.checks.length,additionalProviderRequests:0,additionalPaidCharacters:0,finalMP4:report.finalMP4},null,2));
}finally{service?.close();fs.readFileSync=oldRead;}
