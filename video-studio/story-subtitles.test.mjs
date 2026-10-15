import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { compileDraft, sourceSentences, normalizeStoryChinese } from './compiler.mjs';
import { loadCatalog, digest, candidates } from './catalog.mjs';
import { confirmedQuiz } from './quiz.mjs';
import { validateProduction } from './production-validation.mjs';
import { freeVoicePlan } from './free-voice-plan.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { buildAnchors } from './camera-solver.mjs';
const root = path.resolve(import.meta.dirname, '..'), config = loadVoiceConfig();
const seriesConfig = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/series.json')));
const compile = f => compileDraft(f.draft, f.record, { seriesConfig });
function mixed(text) {
  const f = fixture('single', null, { production: true });
  f.record.post.text = text;
  f.record.sourceHash = digest({ ...f.record, sourceHash: undefined }); f.draft.sourceHash = f.record.sourceHash;
  f.draft.decisions.quiz = confirmedQuiz(candidates(f.record, f.catalog.vocab).quizzes[0], f.draft.revision);
  f.draft.decisions.production.translations = { mode: 'none', items: {} };
  f.draft.decisions.storyChinese = { mode: 'subtitle', seconds: 2 };
  return f;
}
for (const text of [
  'We [[allocate]] supplies, and the class starts. 我們都笑了。 Then we leave.',
  'We [[allocate]] supplies，我們都笑了，and the class starts.',
  '我們都笑了。 We [[allocate]] supplies, and the class starts. 他還是說這個計畫很好 😅',
]) test(`mixed source: ${text}`, () => {
  const f = mixed(text), r = compile(f);
  assert.deepEqual(r.blocked, []); assert.equal(validateProduction(r.artifacts, config, r).verdict, 'PASS');
  const silent = r.artifacts.narration.segments.filter(s => s.kind === 'story' && s.silent);
  assert.ok(silent.length); assert.ok(silent.every(s => s.duration === 2));
  const plan = freeVoicePlan(r.artifacts.narration, config, { has: () => false });
  assert.equal(plan.networkRequests, 0);
  assert.ok(plan.segments.filter(s => s.kind === 'story' && !s.silent).every(s => !/\p{Script=Han}/u.test(s.text)));
  assert.equal(plan.segments.find(s => s.kind === 'meaning').speaker, 'ling');
  assert.ok(r.artifacts.episode.vocabulary[0].open.line);
  for (const s of silent) {
    const b = r.artifacts.episode.story.find(b => b.subtitleLine === s.id);
    assert.equal(b.parts[0].text, s.text);
    assert.ok(buildAnchors(r.artifacts.episode).some(a => a.line === s.id));
  }
  assert.ok(sourceSentences(f.record, [], f.draft.decisions.storyChinese).every(s => !/\p{Script=Han}/u.test(s.text)));
});
test('opt-in required, invalid timing rejected, existing English artifacts unchanged', () => {
  const f = fixture('single', null), before = compile(f).artifacts;
  f.draft.decisions.storyChinese = { mode: 'subtitle', seconds: 2 };
  assert.deepEqual(compile(f).artifacts, before);
  const m = mixed('We [[allocate]] supplies. 我們都笑了。'); delete m.draft.decisions.storyChinese;
  assert.ok(compile(m).blocked.some(b => b.code === 'MIXED_STORY_LANGUAGE'));
  for (const seconds of [0, 9, NaN, '2']) assert.throws(() => normalizeStoryChinese({ mode: 'subtitle', seconds }));
});
test('save/reopen, timing-only edits reuse every paid request hash and invalidate downstream', () => {
  const f = mixed('We [[allocate]] supplies. 我們都笑了。'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtitle-test-'));
  try {
    const store = new DraftStore(dir, f.catalog); store.persist(f.draft);
    let wf = new ProductionWorkflow(store, root), d = wf.run(f.draft.id, { revision: 1 });
    assert.equal(d.status, 'voice_planned', JSON.stringify(d.steps));
    const hashes = wf.read(d, 'voicePlan').segments.filter(s => !s.silent).map(s => s.hash);
    d = store.update(d.id, { revision: d.revision, decisions: { ...d.decisions, storyChinese: { mode: 'subtitle', seconds: 3 } } });
    assert.equal(d.artifacts.voicePlan, undefined);
    wf = new ProductionWorkflow(new DraftStore(dir, f.catalog), root); d = wf.run(d.id, { revision: d.revision });
    assert.equal(d.decisions.storyChinese.seconds, 3); assert.equal(d.status, 'voice_planned');
    assert.deepEqual(wf.read(d, 'voicePlan').segments.filter(s => !s.silent).map(s => s.hash), hashes);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('real elem-012 decision copy: English and teaching remain, both Chinese captions have pauses; live draft unchanged', () => {
  const file = path.join(root, 'video-studio/state/drafts/192e0e8d-bfca-4dbf-91ca-12a900e7dbf5.json');
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file), draft = JSON.parse(original);
  const record = loadCatalog(root).records.get('elem-012');
  draft.decisions.storyChinese = { mode: 'subtitle', seconds: 2 };
  // Translation choices already saved for English keep their exact identities.
  const ids = new Set(sourceSentences(record, [], draft.decisions.storyChinese).map(s => s.id));
  if (draft.decisions.production?.translations.mode === 'per-sentence') draft.decisions.production.translations.items = Object.fromEntries(Object.entries(draft.decisions.production.translations.items).filter(([id]) => ids.has(id)));
  const r = compileDraft(draft, record, { seriesConfig });
  assert.deepEqual(r.blocked, []); assert.equal(validateProduction(r.artifacts, config, r).verdict, 'PASS');
  const pauses = r.artifacts.narration.segments.filter(s => s.kind === 'story' && s.silent);
  assert.deepEqual(pauses.map(s => s.text), ['我們都笑了。', '他還是說這個計畫很好']);
  assert.equal(r.artifacts.episode.vocabulary.length, draft.decisions.vocabulary.length);
  assert.deepEqual(fs.readFileSync(file), original);
});
