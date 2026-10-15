import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './fixtures.mjs';
import {compileDraft} from './compiler.mjs';
import {validateProduction} from './production-validation.mjs';
import {loadVoiceConfig} from '../scripts/video/voice/config.mjs';
import {prepareNarration} from '../scripts/video/voice/segments.mjs';
import {bindPartEndHandoffs,resolveRef,linesFromPlanForRefs} from './camera-solver.mjs';
const seriesConfig=JSON.parse(fs.readFileSync(new URL('../scripts/video/series.json',import.meta.url)));
for(const middle of [false,true])test(`same-boundary teaching retains both words in source order; middle=${middle}`,()=>{
 const f=fixture('multiple');f.record.post.text='We [[allocate]] [[arbitrary]] supplies'+(middle?', and lessons begin.':'.');
 f.draft.decisions.vocabulary.reverse(); // selection order must not change source order
 const r=compileDraft(f.draft,f.record,{seriesConfig});assert.deepEqual(r.blocked,[]);
 assert.equal(validateProduction(r.artifacts,loadVoiceConfig(),r).verdict,'PASS');
 assert.deepEqual(r.mapping.map(m=>m.key),['allocate','arbitrary']);
 const [first,second]=r.artifacts.episode.vocabulary;
 assert.equal(first.close.line,'v1Transition');assert.equal(second.openAfterTransition.line,first.close.line);
 const narration=r.artifacts.narration,story=narration.segments.find(s=>s.id==='story001');
 assert.equal(narration.segments.filter(s=>s.id==='story001').length,1);
 if(middle){assert.equal(story.parts.length,2);assert.equal(story.parts[1].resumeAfter,second.close.line);}
 const p=prepareNarration(narration,loadVoiceConfig(),{requireApiKey:false,env:{}});
 assert.equal(p.segments.filter(s=>s.kind==='meaning'&&!s.silent).length,2);
 const episode=structuredClone(r.artifacts.episode),plan={lines:[{id:first.open.line,start:2,end:4,words:[{text:first.open.word,at:1}]},{id:first.close.line,start:8,end:8.6,silent:true,words:[]}]};
 bindPartEndHandoffs(episode,plan);assert.equal(resolveRef(linesFromPlanForRefs(plan),episode.vocabulary[1].open).time,8.32);
});
test('three distinct punctuation interruptions keep the whole source and all vocabulary',()=>{
 const f=fixture('multiple'),third={...f.record.vocabulary[0],key:'teach',word:'teach',ex:'We teach students.'};f.record.vocabulary.push(third);f.draft.decisions.vocabulary.push('teach');
 f.record.post.text='We [[allocate]] supplies, review [[arbitrary]] rules, [[teach]] students, and go home.';
 const r=compileDraft(f.draft,f.record,{seriesConfig});assert.deepEqual(r.blocked,[]);assert.equal(r.mapping.length,3);assert.equal(r.artifacts.narration.segments.find(s=>s.id==='story001').parts.length,4);
 assert.equal(validateProduction(r.artifacts,loadVoiceConfig(),r).verdict,'PASS');
});
