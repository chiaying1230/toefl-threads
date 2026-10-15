// READ-ONLY speech provenance diagnosis; never confirm/retry/synthesize or rewrite cache/state.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Candidate } from './candidate.mjs';
import { bufferHash } from './hashing.mjs';
import { validatePair } from './voice-envelope.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { assembleNarration } from '../scripts/video/voice/assemble.mjs';
import { buildRequest } from '../scripts/video/voice/elevenlabs.mjs';
import { decodeAudio, voicedBounds, fade, writeWav, SAMPLE_RATE as SR } from '../scripts/video/voice/audio.mjs';
globalThis.fetch=()=>{throw Error('Network forbidden in diagnosis');};
const read=fs.readFileSync;
fs.readFileSync=function(f,...args){assert.notEqual(path.basename(String(f)),'.env');return read.call(this,f,...args);};
const base=path.resolve('video-studio/state/drafts/production'),db=new DatabaseSync(path.join(base,'coordinator.db'),{readOnly:true});
try{
 const ledger=()=>db.prepare('SELECT COUNT(*) attempts,COALESCE(SUM(network_attempted),0) requests,COALESCE(SUM(reserved_chars),0) reservedChars FROM attempts').get();
 const before=ledger(),draftId='20ee16ed-e72f-4b06-9b4c-0387fc82b0f8',draftFile=path.join(base,'..',`${draftId}.json`),draftBytes=fs.readFileSync(draftFile),draft=JSON.parse(draftBytes);
 const old=db.prepare("SELECT * FROM runs WHERE run_id='be8e6a15-8d6b-48bb-b0d9-6bb1bd575182'").get(),oldInputs=JSON.parse(old.inputs),original=new Candidate(base,old.candidate_id,oldInputs.bindings.engine);
 original.verifyEngine();const cfg=JSON.parse(original.engineFile('scripts/video/voices.json')),prepared=prepareNarration(original.readJson(oldInputs.inputRefs.narration),cfg,{requireApiKey:false,env:{}}),env=original.readJson(oldInputs.envelopes[0]);
 const rows=[];
 for(const id of ['v1Meaning','v2Meaning','v3Meaning']){
  const s=prepared.segments.find(s=>s.id===id),r=env.requests.find(r=>r.segmentHash===s.hash),a=db.prepare('SELECT * FROM attempts WHERE segment_hash=?').get(s.hash),ref=JSON.parse(a.response_ref),response=original.readJson(ref),body=JSON.parse(response.raw);
  const request=buildRequest({voice:s.voice,text:s.speak,previousText:s.previousText,nextText:s.nextText,outputFormat:prepared.outputFormat,apiBase:prepared.apiBase});
  assert.equal(bufferHash(Buffer.from(JSON.stringify(request.body))),r.requestBodyHash);assert.equal(a.body_hash,r.requestBodyHash);
  const mp3=original.abs(`voice/sealed/${s.hash}.mp3`),alignFile=original.abs(`voice/sealed/${s.hash}.json`),alignment=JSON.parse(fs.readFileSync(alignFile));
  assert.equal(bufferHash(fs.readFileSync(mp3)),a.audio_hash);assert.equal(bufferHash(Buffer.from(body.audio_base64,'base64')),a.audio_hash);
  assert.equal(bufferHash(fs.readFileSync(alignFile)),a.alignment_hash);assert.deepEqual(alignment.alignment,body.alignment);
  validatePair(s,prepared.outputFormat,mp3,fs.readFileSync(alignFile,'utf8'));
  const settings={speaker:r.speaker,voiceId:r.voiceId,model:r.model,language:r.language,languageCode:request.body.language_code??null,
   voiceSettings:r.settings,previousText:r.previousText,nextText:r.nextText,outputFormat:r.outputFormat,url:request.url};
  rows.push({id,text:r.text,chars:r.chars,segmentHash:r.segmentHash,requestBodyHash:r.requestBodyHash,requestEnvelopeHash:oldInputs.envelopes[0].bytesHash,settings,body:request.body,
   response:{status:response.status,providerRequestId:a.provider_request_id,reportedCharacterCost:response.headers['character-cost']??null,qualityCheck:body.quality_check??null,
    responseHash:ref.bytesHash,audioHash:a.audio_hash,alignmentHash:a.alignment_hash,audioExactlyMatchesResponse:true,alignmentExactlyMatchesResponse:true},
   alignment:body.alignment,normalizedAlignment:body.normalized_alignment,rawMP3:mp3,decodedSeconds:decodeAudio(mp3).length/SR});
 }
 assert.deepEqual(rows[0].settings,rows[1].settings);assert.deepEqual(rows[0].settings,rows[2].settings);
 const latest=db.prepare('SELECT * FROM runs WHERE draft_id=? ORDER BY created_at DESC LIMIT 1').get(draftId),inputs=JSON.parse(latest.inputs),candidate=new Candidate(base,latest.candidate_id,inputs.bindings.engine);
 candidate.verifyEngine();const steps=db.prepare("SELECT * FROM steps WHERE run_id=? AND status='succeeded' ORDER BY started_at").all(latest.run_id).map(s=>({...s,result:JSON.parse(s.result)}));
 const out=(step,role)=>steps.findLast(s=>s.step===step).result.outputs.find(r=>r.role===role);
 const voiceRef=out('voice','voiceBundle');candidate.verifyDeep(voiceRef);const bundle=candidate.readJson(voiceRef);
 const plan=candidate.readJson(out('assemble','plan')),wavFile=candidate.verify(out('assemble','wav')),wav=decodeAudio(wavFile);
 for(const row of rows){
  const pair=bundle.pairs.find(p=>p.hash===row.segmentHash);assert.equal(pair.audio.bytesHash,row.response.audioHash);assert.equal(pair.alignment.bytesHash,row.response.alignmentHash);
  const raw=decodeAudio(candidate.verify(pair.audio)),bounds=voicedBounds(raw),from=Math.max(0,bounds.first-Math.round(.035*SR)),to=Math.min(raw.length,bounds.last+Math.round(.05*SR));
  const x=fade(raw.subarray(from,to),Math.round(.006*SR),Math.round(.006*SR)),l=plan.lines.find(l=>l.id===row.id);
  assert.equal(l.duration,x.length/SR,'Meaning clip needs no r10 corrective recrop; ordinary trim/fade applies');
  let maxError=0;
  for(let i=0;i<x.length;i++){
   const pcm=Math.max(-32768,Math.min(32767,Math.round(x[i]*32767)))/32768;
   maxError=Math.max(maxError,Math.abs(pcm-wav[Math.round(l.start*SR)+i]));
  }
  assert.equal(maxError,0,'Assembled PCM is exactly the original take, with only documented trim/fade/PCM16 conversion');
  row.latest={revision:latest.revision,runId:latest.run_id,state:latest.state,mp3ExactlyMatchesOriginal:true,start:l.start,end:l.end,rawTrimFrom:from/SR,rawTrimTo:to/SR,assembledPCMMaxError:0,
   statement:'No replacement voice/phonemes, time stretching, resampling rate change or segment swap; only trim/fade/PCM16 conversion.'};
 }
 // Whole WAV/plan reconstructed from current sealed pairs; no production writes, one disposable TEMP WAV only.
 const currentPrepared=prepareNarration(candidate.readJson(inputs.inputRefs.narration),JSON.parse(candidate.engineFile('scripts/video/voices.json')),{requireApiKey:false,env:{}});
 const cache={has:h=>bundle.pairs.some(p=>p.hash===h),audioPath:h=>candidate.verify(bundle.pairs.find(p=>p.hash===h).audio),readAlignment:h=>candidate.readJson(bundle.pairs.find(p=>p.hash===h).alignment)};
 const assembled=assembleNarration(currentPrepared,cache);assert.deepEqual(assembled.plan,plan);
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p6-meaning-readonly-'));
 try{const file=path.join(tmp,'narration.wav');writeWav(file,assembled.samples);assert.equal(bufferHash(fs.readFileSync(file)),out('assemble','wav').bytesHash);}
 finally{assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(tmp,{recursive:true,force:true});}
 assert.deepEqual(ledger(),before);assert.deepEqual(fs.readFileSync(draftFile),draftBytes);
 const result={checkedAt:new Date().toISOString(),draftId,currentRevision:draft.revision,currentRunId:latest.run_id,currentState:latest.state,
  requestSettingsIdentical:true,uniqueSettingsDifference:null,rows,wholeAssembledPlanAndWavIdentical:true,additionalRequests:0,ledgerBefore:before,ledgerAfter:ledger(),
  acousticAssessment:'No audio-listening/ASR tool is available in this environment; accent is the owner’s human-review observation. Byte/PCM evidence locates any observed pronunciation in the original provider take, not post-production.',
  providerInternalCause:'Undetermined. All three omit language_code; automatic language interpretation / model variation is a hypothesis, not returned evidence. quality_check is null for all three.',
  targetedRegeneration:{text:'家庭作業',utf16RequestCharacters:4,maxRequests:1,currentlySupported:false,reason:'Successful hash is already immutable/cache-hit. Existing recovery handles failed/unknown residuals, not human-rejected successful takes; a take-aware explicit single-segment receipt/selection path is required. Never delete cache or overwrite prior evidence.'}};
 const output='video-studio/state/qa/p6-meaning-diagnosis.json';fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({report:output,revision:draft.revision,requestSettingsIdentical:true,languageCode:null,rows:rows.map(r=>({id:r.id,text:r.text,chars:r.chars,settings:r.settings,response:r.response,latest:r.latest})),wholeAssembledPlanAndWavIdentical:true,additionalRequests:0,targetedRegeneration:result.targetedRegeneration},null,2));
}finally{db.close();fs.readFileSync=read;}
