import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './fixtures.mjs';
import {compileDraft} from './compiler.mjs';
import {resolveRef,bindPartEndHandoffs} from './camera-solver.mjs';
import {validateProduction} from './production-validation.mjs';
import {loadVoiceConfig} from '../scripts/video/voice/config.mjs';
import {makeQuizCandidate,confirmedQuiz,quizHash,quizReview} from './quiz.mjs';
const seriesConfig=JSON.parse(fs.readFileSync(new URL('../scripts/video/series.json',import.meta.url)));
test('hyphenated handoff uses actual part end without changing spoken text',()=>{
 const f=fixture();f.record.post.text='We [[allocate]] mix-ups, and the class starts.';
 const r=compileDraft(f.draft,f.record,{seriesConfig});assert.deepEqual(r.blocked,[]);
 const note=r.artifacts.episode.vocabulary[0];assert.equal(note.openAtPartEnd,true);assert.equal(note.open.word,'allocate');
 assert.equal(validateProduction(r.artifacts,loadVoiceConfig(new URL('../scripts/video/voices.json',import.meta.url)),r).verdict,'PASS');
 const lines=[{id:note.open.line,start:1,end:2.73,words:[{text:'allocate',at:0.1},{text:'mix-ups',at:0.4}]}];
 bindPartEndHandoffs(r.artifacts.episode,{lines});assert.equal(resolveRef(new Map(lines.map(l=>[l.id,l])),note.open).time,2.73);
 bindPartEndHandoffs(r.artifacts.episode,{lines});assert.equal(resolveRef(new Map(lines.map(l=>[l.id,l])),note.open).time,2.73);
 assert.match(JSON.stringify(r.artifacts.narration),/mix-ups/);
});
test('quiz recommendations vary position reproducibly; confirmed ordering survives',()=>{
 const answers=new Set();
 for(let i=0;i<30;i++){
  const f=fixture();f.record.post.id='quiz-'+i;const target=f.record.vocabulary[0];
  const distractors=[['fixture_food',f.catalog.vocab.fixture_food],['fixture_time',f.catalog.vocab.fixture_time]];
  const q=makeQuizCandidate(f.record,target,distractors,f.catalog.vocab);answers.add(q.answer);
  assert.equal(q.options[q.answer],target.zh);assert.deepEqual(makeQuizCandidate(f.record,target,distractors,f.catalog.vocab),q);
  const legacy={...q,options:[target.zh,...distractors.map(([,v])=>v.zh)],answer:0};legacy.candidateHash=quizHash(legacy);
  f.draft.decisions.quiz=confirmedQuiz(legacy,1);assert.equal(quizReview(f.draft,[q]).status,'confirmed');
  const changed={...q,options:q.options.map(x=>x===target.zh?'新的詞義':x)};changed.candidateHash=quizHash(changed);
  assert.equal(quizReview(f.draft,[changed]).status,'needs_confirmation');
 }
 assert.deepEqual([...answers].sort(),[0,1,2]);
});
