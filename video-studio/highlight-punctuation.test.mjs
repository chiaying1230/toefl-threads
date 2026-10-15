import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {fixture} from './fixtures.mjs';import {compileDraft} from './compiler.mjs';import {validateProduction} from './production-validation.mjs';import {loadVoiceConfig} from '../scripts/video/voice/config.mjs';import {loadCatalog,candidates} from './catalog.mjs';import {confirmedQuiz} from './quiz.mjs';
const root=new URL('../',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),seriesConfig=JSON.parse(fs.readFileSync(new URL('../scripts/video/series.json',import.meta.url)));
test('exact marked single-word punctuation aliases satisfy unchanged cue and validators without changing speech',()=>{
 for(const punctuation of [':',';','!','?','"']){
  const f=fixture();f.record.post.text=`We [[allocate]]${punctuation} and the class starts.`;
  const r=compileDraft(f.draft,f.record,{seriesConfig});assert.deepEqual(r.blocked,[]);const v=r.artifacts.episode.vocabulary[0];assert.ok(v.forms.includes('allocate'+punctuation));
  assert.equal(validateProduction(r.artifacts,loadVoiceConfig(),r).verdict,'PASS');assert.equal(r.artifacts.narration.segments.filter(s=>s.id.startsWith('story')).map(s=>s.text).join(' '),`We allocate${punctuation} and the class starts.`);
 }
});
test('source suffix changes are not mistaken for punctuation aliases',()=>{
 const f=fixture();f.record.post.text='We [[allocate]]x, and the class starts.';const r=compileDraft(f.draft,f.record,{seriesConfig});assert.ok(r.blocked.some(b=>b.code==='SOURCE_HIGHLIGHT_UNSUPPORTED'));
});
test('toeic-015 chosen source case: is highlighted using exact display alias',()=>{
 const catalog=loadCatalog(root),record=catalog.records.get('toeic-015'),f=fixture();f.draft.contentId=record.post.id;f.draft.sourceHash=record.sourceHash;f.draft.decisions.vocabulary=['case','sparkle','highly'];f.draft.decisions.hook.text='Detective mode ON.';f.draft.decisions.quiz=confirmedQuiz(candidates(record,catalog.vocab).quizzes.find(q=>q.key==='sparkle'),1);
 const r=compileDraft(f.draft,record,{seriesConfig});assert.deepEqual(r.blocked,[]);assert.equal(validateProduction(r.artifacts,loadVoiceConfig(),r).verdict,'PASS');const v=r.artifacts.episode.vocabulary.find(v=>v.word==='case');assert.ok(v.forms.includes('case:'));
});
