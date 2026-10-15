import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { fixture } from './fixtures.mjs';
import { compileDraft } from './compiler.mjs';
import { validateProduction } from './production-validation.mjs';
import { freeVoicePlan } from './free-voice-plan.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { DraftStore } from './store.mjs';
import { createStudio, root } from './server.mjs';
import { digest, loadCatalog, candidates } from './catalog.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
const config = loadVoiceConfig(), seriesConfig = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/series.json'), 'utf8'));
const compile = f => compileDraft(f.draft, f.record, { seriesConfig });
const workspace = (f, voicePlanner) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-production-'));
  const catalog = f.catalog;
  const store = new DraftStore(directory, catalog); store.persist(f.draft);
  return { directory, catalog, store, workflow: new ProductionWorkflow(store, root, voicePlanner ? { voicePlanner } : {}) };
};

for (const kind of ['single', 'phrase', 'multiple']) test(`${kind}: decisions → real production schema → shared validators → existing free planner`, () => {
  const f = fixture(kind), result = compile(f);
  assert.equal(result.status, 'succeeded'); assert.deepEqual(result.blocked, []);
  const validation = validateProduction(result.artifacts, config, result);
  assert.equal(validation.verdict, 'PASS', JSON.stringify(validation.errors));
  assert.equal(validation.productionReady, false);
  assert.ok(validation.unresolved.some(u => u.code === 'VISIBILITY_UNRESOLVED'));
  assert.deepEqual(result.artifacts.episode.camera, [{ at: 0, id: 'hook', offset: 0 }]);
  assert.equal(result.artifacts.episode.outro, undefined);
  assert.equal(result.artifacts.narration.id, f.draft.contentId);
  assert.equal(result.artifacts.episode.plan, `/docs/${f.draft.contentId}-auto/${f.draft.contentId}-auto.plan.json`);
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Network is forbidden in free plan'); };
  try {
    const prepared = prepareNarration(result.artifacts.narration, config, { requireApiKey: false, env: {} });
    const hash = prepared.segments.find(s => !s.silent).hash;
    const plan = freeVoicePlan(result.artifacts.narration, config, { has: h => h === hash });
    assert.equal(plan.generatedThisRun, 0); assert.equal(plan.networkRequests, 0); assert.equal(plan.counts.hit, 1); assert.equal(plan.counts.silent, 2);
    assert.equal(plan.charsToGenerate, prepared.segments.filter(s => !s.silent && s.hash !== hash).reduce((n, s) => n + s.chars, 0));
    assert.equal(plan.segments.find(s => s.kind === 'meaning').speaker, 'ling');
    assert.equal(plan.segments.find(s => s.kind === 'example').speaker, 'arthur');
    const sent = result.artifacts.narration.segments.filter(s => s.id.startsWith('story'));
    assert.equal(sent.length, 1); assert.equal(sent[0].parts.length, 2); // one whole-sentence TTS, not split synthesis
    if (kind === 'phrase') {
      assert.deepEqual(result.artifacts.episode.vocabulary[0].forms, ['was consumed with']);
      assert.match(prepared.segments.find(s => s.id === sent[0].id).parts[0].text, /was consumed with guilt,/);
    }
    if (kind === 'multiple') assert.equal(result.artifacts.episode.vocabulary.length, 2);
  } finally { globalThis.fetch = savedFetch; }
});

test('explicit no-Chinese Hook and normalized blank both validate and persist a free voice plan without workaround', () => {
  for (const zh of [null, ' ']) {
    const f = fixture('single', zh), w = workspace(f);
    try {
      const result = w.workflow.run(f.draft.id, { revision: 1 });
      assert.equal(result.status, 'voice_planned'); assert.equal(result.workflow.failedStep, null);
      const episode = w.workflow.read(result, 'episode'); assert.equal(episode.hook.zh, null);
      const validation = w.workflow.read(result, 'validation');
      assert.equal(validation.verdict, 'PASS');
      assert.deepEqual(validation.errors, []);
      assert.ok(result.steps.some(s => s.name === 'voicePlan' && s.status === 'succeeded'));
      assert.equal(w.workflow.read(result, 'voicePlan').generatedThisRun, 0);
      assert.equal(result.productionReady, false);
      assert.ok(result.steps.at(-1).finishedAt);
      const reopened = new DraftStore(w.directory, w.catalog).get(f.draft.id);
      assert.deepEqual(reopened, result);
    } finally { fs.rmSync(w.directory, { recursive: true, force: true }); }
  }
});

test('two interruptions retain one sentence TTS and correct playback references', () => {
  const f = fixture('multiple'); f.record.post.text = 'We [[allocate]] supplies, use [[arbitrary]] labels, and the class starts.';
  const result = compile(f), validation = validateProduction(result.artifacts, config, result);
  assert.equal(validation.verdict, 'PASS', JSON.stringify(validation.errors));
  const segment = result.artifacts.narration.segments.find(s => s.id === 'story001');
  assert.equal(segment.parts.length, 3);
  assert.equal(segment.parts[1].resumeAfter, 'v1Example');
  assert.equal(segment.parts[2].resumeAfter, 'v2Example');
});

test('workflow stages persist across store restart; source drift invalidates old artifacts before plan', () => {
  const f = fixture(), w = workspace(f);
  try {
    let d = w.workflow.run(f.draft.id, { revision: 1, action: 'compile' }); assert.equal(d.status, 'compiled');
    const reopened = new ProductionWorkflow(new DraftStore(w.directory, w.catalog), root);
    d = reopened.run(f.draft.id, { revision: 1, action: 'validation' }); assert.equal(d.status, 'validated');
    d = reopened.run(f.draft.id, { revision: 1, action: 'voicePlan' }); assert.equal(d.status, 'voice_planned');
    assert.equal(new DraftStore(w.directory, w.catalog).get(f.draft.id).status, 'voice_planned');
    f.record.sourceHash = 'changed';
    d = reopened.reconcile(f.draft.id);
    assert.equal(d.workflow.failedStep, 'freshness'); assert.deepEqual(d.artifacts, {});
    assert.ok(d.workflowHistory.at(-1).artifacts.voicePlan);
    d = reopened.run(f.draft.id, { revision: 1, action: 'voicePlan' });
    assert.ok(d.steps.at(-1).result.errors.some(e => e.code === 'SOURCE_STALE'));
    assert.equal(d.artifacts.voicePlan, undefined);
  } finally { fs.rmSync(w.directory, { recursive: true, force: true }); }
});

test('artifact tampering fails before planner; compiler failures and interrupted steps remain visible', () => {
  const f = fixture(), w = workspace(f, () => { throw Error('Must not reach plan'); });
  try {
    let d = w.workflow.run(f.draft.id, { revision: 1, action: 'compile' });
    const file = path.join(w.directory, d.artifacts.narration.path);
    const narration = JSON.parse(fs.readFileSync(file, 'utf8')); narration.segments[0].text = 'tampered'; fs.writeFileSync(file, JSON.stringify(narration));
    d = w.workflow.run(f.draft.id, { revision: 1, action: 'validation' });
    assert.equal(d.workflow.failedStep, 'validation'); assert.match(d.steps.at(-1).result.errors[0].message, /hash mismatch/);
    d = w.workflow.run(f.draft.id, { revision: 1, action: 'compile' }); d.steps[0].status = 'running'; w.store.persist(d);
    d = w.workflow.reconcile(f.draft.id); assert.ok(d.steps.at(-1).result.errors.some(e => e.code === 'WORKFLOW_INTERRUPTED'));
    f.draft.decisions.hook = null; w.store.persist(f.draft);
    d = w.workflow.run(f.draft.id, { revision: 1 }); assert.equal(d.workflow.failedStep, 'compile'); assert.equal(d.artifacts.narration, undefined);
  } finally { fs.rmSync(w.directory, { recursive: true, force: true }); }
});

test('plan rejects changed episode after PASS; tool reload guard and partial artifact isolation', () => {
  const f = fixture(), w = workspace(f, () => { throw Error('Must not reach planner'); });
  try {
    let d = w.workflow.run(f.draft.id, { revision: 1, action: 'compile' });
    d = w.workflow.run(f.draft.id, { revision: 1, action: 'validation' });
    const file = path.join(w.directory, d.artifacts.episode.path);
    const episode = JSON.parse(fs.readFileSync(file, 'utf8')); episode.seriesEpisode++;
    fs.writeFileSync(file, JSON.stringify(episode));
    d = w.workflow.run(f.draft.id, { revision: 1, action: 'voicePlan' });
    assert.equal(d.workflow.failedStep, 'voicePlan'); assert.match(d.steps.at(-1).result.errors[0].message, /hash mismatch/);
    w.workflow.loadedEngineHash = 'old-engine';
    d = w.workflow.run(f.draft.id, { revision: 1, action: 'compile' });
    assert.ok(d.steps.at(-1).result.errors.some(e => e.code === 'ENGINE_RESTART_REQUIRED'));
    assert.throws(() => w.workflow.safeFile('../scripts/video/episodes/p2-auto.json'), /outside/);
  } finally { fs.rmSync(w.directory, { recursive: true, force: true }); }
});

test('ambiguous handoff, mixed language and display-only meaning punctuation block instead of guessing', () => {
  const mixed = fixture(); mixed.record.post.text += ' 我先去吃飯。'; mixed.record.sourceHash = digest(mixed.record.post); mixed.draft.sourceHash = mixed.record.sourceHash;
  assert.ok(compile(mixed).blocked.some(e => e.code === 'MIXED_STORY_LANGUAGE'));
  const collision = fixture('multiple'); collision.record.post.text = 'We [[allocate]] [[arbitrary]] supplies.';
  assert.ok(!compile(collision).blocked.some(e => e.code === 'HANDOFF_COLLISION'));
  assert.equal(compile(collision).artifacts.episode.vocabulary.length, 2);
  const meaning = fixture('phrase'); meaning.record.vocabulary[0].zh = '被…吞噬';
  assert.ok(compile(meaning).blocked.some(e => e.code === 'MEANING_SPEECH_REQUIRED'));
  meaning.draft.decisions.meaningSpeech = { be_consumed_with: '被某件事吞噬。' };
  assert.equal(compile(meaning).blocked.some(e => e.code === 'MEANING_SPEECH_REQUIRED'), false);
});

test('real-source dry-run: ordinary vocabulary and phrase data compile without changing sources', () => {
  const c = loadCatalog(root);
  for (const [id, keys] of [['p1', ['ubiquitous']], ['toeic-079', ['a_game_of_cat_and_mouse']]]) {
    const record = c.records.get(id), original = JSON.stringify(record), choice = candidates(record, c.vocab).quizzes.find(q => q.key === keys[0]);
    const f = fixture(); f.record = record; Object.assign(f.draft, { contentId: id, sourceHash: record.sourceHash });
    Object.assign(f.draft.decisions, { vocabulary: keys, hook: { type: 'scene_contrast', text: 'The story starts.', zh: '故事開始了。' }, quiz: choice });
    const result = compile(f), validation = validateProduction(result.artifacts, config, result);
    assert.equal(validation.verdict, 'PASS', JSON.stringify(validation.errors));
    assert.equal(JSON.stringify(record), original);
  }
});

test('HTTP workflow / artifacts, Hook Chinese decisions, restart, edit invalidation and live source drift', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-workflow-http-'));
  let server, catalog = loadCatalog(root);
  const start = async () => { server = createStudio({ stateDir: directory, catalogLoader: () => catalog }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  const stop = () => new Promise(r => { server.close(r); server.closeAllConnections(); });
  try {
    let base = await start();
    const post = async (url, data, method = 'POST') => { const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }); return { status: res.status, data: await res.json() }; };
    let d = (await post('/api/drafts', { contentId: 'p1' })).data;
    const record = catalog.records.get('p1'), quiz = candidates(record, catalog.vocab).quizzes.find(q => q.key === 'ubiquitous');
    const decisions = { series: 'TOEFL', seriesEpisode: 99, level: { min: 3, max: 3 }, vocabulary: ['ubiquitous'], hook: { candidateId: 'hook-1', text: 'The story starts.', zh: '故事開始了。' }, quiz: { ...quiz, candidateId: quiz.id } };
    d = (await post(`/api/drafts/${d.id}`, { revision: d.revision, decisions }, 'PUT')).data;
    d = (await post(`/api/drafts/${d.id}/workflow`, { revision: d.revision })).data;
    assert.equal(d.status, 'voice_planned', JSON.stringify(d.steps));
    assert.equal((await fetch(`${base}/api/drafts/${d.id}/artifacts/narration`)).status, 200);
    await stop(); base = await start();
    assert.deepEqual(await (await fetch(`${base}/api/drafts/${d.id}`)).json(), d);
    d = (await post(`/api/drafts/${d.id}`, { revision: d.revision, decisions }, 'PUT')).data;
    assert.equal(d.status, 'voice_planned'); assert.ok(d.artifacts.voicePlan); // saving identical decisions preserves the free plan
    d = (await post(`/api/drafts/${d.id}/workflow`, { revision: d.revision })).data;
    record.post.text += ' Changed.'; record.sourceHash = digest(record.post);
    const stale = await (await fetch(`${base}/api/drafts/${d.id}`)).json();
    assert.equal(stale.workflow.failedStep, 'freshness');
    assert.equal((await fetch(`${base}/api/drafts/${d.id}/artifacts/narration`)).status, 409);
  } finally { if (server?.listening) await stop(); fs.rmSync(directory, { recursive: true, force: true }); }
});
