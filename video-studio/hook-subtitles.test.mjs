import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {fixture} from './fixtures.mjs';import {compileDraft,englishHookText} from './compiler.mjs';import {loadCatalog} from './catalog.mjs';import {validateProduction} from './production-validation.mjs';import {loadVoiceConfig} from '../scripts/video/voice/config.mjs';import {DraftStore} from './store.mjs';import {ProductionWorkflow} from './workflow.mjs';
const root=path.resolve(import.meta.dirname,'..'),seriesConfig=JSON.parse(fs.readFileSync(path.join(root,'scripts/video/series.json'))),cfg=loadVoiceConfig();
test('mixed Hook retains complete chosen display, pauses without request, then speaks only English with valid reveal',()=>{
 const f=fixture('single',null);f.draft.decisions.storyChinese={mode:'subtitle',seconds:2};f.draft.decisions.hook.text='我的 vision is not good now, so I thought it was a white handbag.';
 const r=compileDraft(f.draft,f.record,{seriesConfig});assert.deepEqual(r.blocked,[]);assert.equal(r.artifacts.episode.hook.setup[0],f.draft.decisions.hook.text);
 assert.equal(r.artifacts.narration.segments[0].id,'hookReadingPause');assert.equal(r.artifacts.narration.segments[0].silent,true);assert.equal(r.artifacts.narration.segments[0].duration,2);
 assert.equal(r.artifacts.narration.segments[1].text,'vision is not good now, so I thought it was a white handbag.');assert.equal(r.artifacts.narration.segments[1].language,'en');assert.equal(validateProduction(r.artifacts,cfg,r).verdict,'PASS');
 assert.equal(englishHookText('one中文two'),'one two');
});
test('no opt-in keeps mixed Hook blocked; pure Chinese Hook has actionable block; ordinary English artifact parity',()=>{
 const f=fixture('single',null),before=compileDraft(f.draft,f.record,{seriesConfig}).artifacts;
 f.draft.decisions.storyChinese={mode:'subtitle',seconds:2};assert.deepEqual(compileDraft(f.draft,f.record,{seriesConfig}).artifacts,before);
 f.draft.decisions.hook.text='只有中文';assert.ok(compileDraft(f.draft,f.record,{seriesConfig}).blocked.some(b=>b.code==='HOOK_ENGLISH_REQUIRED'));
 delete f.draft.decisions.storyChinese;assert.ok(compileDraft(f.draft,f.record,{seriesConfig}).blocked.some(b=>b.code==='MIXED_HOOK_LANGUAGE'));
});
test('actual toeic-016 decision copy now reaches free plan, preserving Hook/Quiz/metadata and zero provider requests',()=>{
 const file=path.join(root,'video-studio/state/drafts/a744c61f-0293-422f-b601-07a8fdedc3c1.json');if(!fs.existsSync(file))return;
 const bytes=fs.readFileSync(file),d=JSON.parse(bytes),catalog=loadCatalog(root),dir=fs.mkdtempSync(path.join(os.tmpdir(),'hook-subtitle-'));
 d.workflow={};d.steps=[];d.artifacts={};
 try{const store=new DraftStore(dir,catalog);store.persist(d);const wf=new ProductionWorkflow(store,root),done=wf.run(d.id,{revision:d.revision});assert.equal(done.status,'voice_planned',JSON.stringify(done.steps));assert.deepEqual(done.decisions,d.decisions);const plan=wf.read(done,'voicePlan');assert.equal(plan.networkRequests,0);assert.equal(plan.segments.find(s=>s.id==='hookReadingPause').silent,true);assert.ok(!/\p{Script=Han}/u.test(plan.segments.find(s=>s.id==='hookLine').text));assert.deepEqual(fs.readFileSync(file),bytes);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
