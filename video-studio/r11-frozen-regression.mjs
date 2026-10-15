// Read-only references. No provider/key. Reassembly and verify outputs go exclusively to TEMP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { assembleNarration } from '../scripts/video/voice/assemble.mjs';
import { writeWav } from '../scripts/video/voice/audio.mjs';
import { createCache } from '../scripts/video/voice/cache.mjs';
import { bufferHash, fileEvidence } from './hashing.mjs';
import { engineManifest } from './candidate.mjs';
const root = process.cwd(), read = fs.readFileSync;
fs.readFileSync = function(f,...a) { assert.notEqual(path.basename(String(f)),'.env'); return read.call(this,f,...a); };
globalThis.fetch = () => { throw Error('Network forbidden'); };
const production = path.join(root,'video-studio/state/drafts/production'), db = new DatabaseSync(path.join(production,'coordinator.db'), {readOnly:true});
const original = db.prepare("SELECT * FROM runs WHERE run_id='be8e6a15-8d6b-48bb-b0d9-6bb1bd575182'").get(); db.close();
const {prepareNarration:beforePrepare} = await import(pathToFileURL(path.join(production,'candidates',original.candidate_id,'engine/scripts/video/voice/segments.mjs')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'r11-reference-')), cache = createCache(), cfg = JSON.parse(fs.readFileSync('scripts/video/voices.json'));
const parent = JSON.parse(fs.readFileSync('docs/video/revisions/r10-final-waveform-trim.json'));
const changed = ['scripts/video/voice/segments.mjs','scripts/video/voice/generate.mjs'];
for (const [f,h] of Object.entries(parent.templateAndPipeline)) if (!changed.includes(f)) assert.equal(fileEvidence(f).bytesHash.slice(7),h,`Unexpected shared drift ${f}`);
const rows=[], missing=[];
for (const [id,video] of [['p2','outputs/p2-auto-pipeline-music.mp4'],['p348','outputs/p348-first-render.mp4'],['toeic-079','outputs/toeic-079-third-render.mp4'],['ielts-068','outputs/ielts-068-first-render.mp4']]) {
  const frozenFile=`docs/${id}-auto/FROZEN.json`, frozen=JSON.parse(fs.readFileSync(frozenFile));
  const missingReferencePaths=[];
  for(const [group,files] of Object.entries(frozen.hashes)) if(group!=='templateAndPipeline') for(const [f,h] of Object.entries(files)) {
    if(!fs.existsSync(f)) { missingReferencePaths.push(f);missing.push(f);continue; }
    assert.equal(fileEvidence(f).bytesHash.slice(7),h,`Frozen drift ${f}`);
  }
  const n=JSON.parse(fs.readFileSync(`scripts/video/narration/${id}.json`));
  const before=beforePrepare(n,cfg,{requireApiKey:false,env:{}}),prepared=prepareNarration(n,cfg,{requireApiKey:false,env:{}});
  assert.deepEqual(prepared,before,`${id} legacy prepared/hash contract changed`);
  const {plan,samples}=assembleNarration(prepared,cache);
  assert.deepEqual(plan,JSON.parse(fs.readFileSync(`docs/${id}-auto/${id}-auto.plan.json`)),`${id} plan changed`);
  const wav=path.join(tmp,`${id}.wav`); writeWav(wav,samples);
  assert.equal(bufferHash(fs.readFileSync(wav)),fileEvidence(`docs/${id}-auto/narration.wav`).bytesHash,`${id} waveform changed`);
  const env={...process.env};delete env.ELEVENLABS_API_KEY;
  const r=spawnSync(process.execPath,['scripts/video/verify-episode.mjs',`scripts/video/episodes/${id}-auto.json`,'--video',video,'--docs',path.join(tmp,id)],{encoding:'utf8',env,maxBuffer:1<<24});
  fs.mkdirSync('video-studio/state/qa',{recursive:true});fs.writeFileSync(`video-studio/state/qa/r11-verify-${id}.log`,r.stdout+r.stderr);
  assert.equal(r.status,0,`${id} verify FAIL: ${r.stdout} ${r.stderr}`);
  rows.push({id,frozenManifestHash:fileEvidence(frozenFile).bytesHash,preparedIdentical:true,hashesIdentical:true,planIdentical:true,wavIdentical:true,frozenAssetsIntact:missingReferencePaths.length===0,missingReferencePaths,verifyPass:true,
    frameEvidence:'Renderer unchanged; exact prepared/plan/WAV parity. Prior r10 full-frame regression retained; no frozen re-render.'});
  console.log(`${id}: hashes/plan/WAV byte parity; available frozen hashes intact; ${missingReferencePaths.length} missing historical references; verify PASS`);
}
const record={schemaVersion:1,id:'r11-explicit-language-retake',parent:parent.id,at:'2026-10-13',status:missing.length?'regression-passed-with-missing-reference-files':'validated',missingReferencePaths:missing,scope:'Opt-in explicit segment language → existing adapter languageCode; immutable take identity in audio hash/metadata. Legacy frozen narration unchanged.',frozenMetadataPreserved:true,canonicalPromotion:false,changedFiles:changed,
  templateAndPipeline:Object.fromEntries(engineManifest(root).files.map(f=>[f.path,f.bytesHash.slice(7)])),references:rows};
fs.writeFileSync('docs/video/revisions/r11-explicit-language-retake.json',JSON.stringify(record,null,2)+'\n');
fs.writeFileSync('video-studio/state/qa/r11-frozen-regression.json',JSON.stringify({temp:tmp,rows},null,2)+'\n');
