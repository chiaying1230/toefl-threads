// Free compiler/planner only. No credentials, provider generation or canonical writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fixture } from './fixtures.mjs';
import { candidates, digest, loadCatalog } from './catalog.mjs';
import { confirmedQuiz } from './quiz.mjs';
import { compileDraft, sourceSentences } from './compiler.mjs';
import { sourceDisplayCandidates, validateSourceDisplayOnly } from './source-display.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { createStudio, root } from './server.mjs';
import { validateProduction } from './production-validation.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
const cfg = loadVoiceConfig(), seriesConfig = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/series.json')));
const compile = f => compileDraft(f.draft, f.record, { seriesConfig });
const CTA = '週末你們都去哪了';
function append(f, text = `${CTA} 😭`) {
  f.record.post.text += `\n\n${text}`;
  f.record.sourceHash = digest({ ...f.record, sourceHash: undefined }); f.draft.sourceHash = f.record.sourceHash;
  f.draft.decisions.quiz = confirmedQuiz(candidates(f.record, f.catalog.vocab).quizzes[0], f.draft.revision);
  return sourceDisplayCandidates(f.record).at(-1);
}
function real() {
  const catalog = loadCatalog(root), record = catalog.records.get('elem-02');
  const original = JSON.parse(fs.readFileSync(path.join(root, 'video-studio/state/drafts/20ee16ed-e72f-4b06-9b4c-0387fc82b0f8.json')));
  const draft = { ...original, decisions: structuredClone(original.decisions), status: 'configured', steps: [], artifacts: {}, approvals: {} };
  delete draft.workflow; delete draft.workflowHistory;
  return { catalog, record, draft };
}
function select(f) {
  f.draft.decisions.sourceDisplayOnly = [sourceDisplayCandidates(f.record).at(-1)];
  if (f.draft.decisions.production?.translations.mode === 'per-sentence') {
    const ids = new Set(sourceSentences(f.record, f.draft.decisions.sourceDisplayOnly).map(s => s.id));
    f.draft.decisions.production.translations.items = Object.fromEntries(Object.entries(f.draft.decisions.production.translations.items).filter(([id]) => ids.has(id)));
  }
}
function workspace(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-display-only-'));
  const store = new DraftStore(dir, f.catalog); store.persist(f.draft);
  return { dir, store, workflow: new ProductionWorkflow(store, root), close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('elem-02 explicit CTA snapshot → compiler → validation → free voice plan; raw article/live draft unchanged', t => {
  if (!fs.existsSync(path.join(root, 'video-studio/state/drafts/20ee16ed-e72f-4b06-9b4c-0387fc82b0f8.json'))) return t.skip('local isolated draft optional; general adapter tests always run');
  const f = real(), before = JSON.stringify(f.record), liveFile = path.join(root, 'video-studio/state/drafts', `${f.draft.id}.json`), original = fs.readFileSync(liveFile);
  // Explicitly test the unconfirmed control even after the owner has saved the real range decision.
  f.draft.decisions.sourceDisplayOnly = [];
  assert.ok(compile(f).blocked.some(b => b.code === 'MIXED_STORY_LANGUAGE')); // never auto-classify
  select(f); const w = workspace(f);
  try {
    const saved = w.store.update(f.draft.id, { revision: f.draft.revision, decisions: f.draft.decisions });
    const job = w.workflow.run(saved.id, { revision: saved.revision });
    assert.equal(job.status, 'voice_planned', JSON.stringify(job.steps));
    assert.equal(job.productionReady, false);
    const episode = w.workflow.read(job, 'episode'), narration = w.workflow.read(job, 'narration'), plan = w.workflow.read(job, 'voicePlan');
    assert.equal(episode.hook.zh, null);
    assert.ok(episode.story.at(-1).parts.some(p => p.type === 'translation' && p.text === CTA));
    assert.ok(narration.segments.every(s => !s.text.includes(CTA)));
    assert.ok(plan.segments.every(s => !s.text.includes(CTA)));
    assert.equal(w.workflow.read(job, 'validation').verdict, 'PASS');
    assert.ok(w.workflow.read(job, 'compileReport').blocked.every(b => b.code !== 'MIXED_STORY_LANGUAGE'));
    assert.equal(plan.networkRequests, 0); assert.equal(plan.generatedThisRun, 0);
    const restored = new ProductionWorkflow(new DraftStore(w.dir, f.catalog), root).reconcile(saved.id);
    assert.equal(restored.status, 'voice_planned'); assert.deepEqual(restored.decisions.sourceDisplayOnly, f.draft.decisions.sourceDisplayOnly);
    console.log('elem-02 free plan:', JSON.stringify({ count: plan.segmentCount, counts: plan.counts, characters: plan.charsToGenerate, spoken: plan.segments.filter(s => !s.silent).map(s => ({ id: s.id, speaker: s.speaker, text: s.text, parts: s.partIds })) }));
  } finally { w.close(); }
  assert.equal(JSON.stringify(f.record), before); assert.deepEqual(fs.readFileSync(liveFile), original);
});

for (const kind of ['single', 'phrase', 'multiple']) test(`${kind}: explicit CTA preserves complete sentence TTS + parts/forms/handoff`, () => {
  const f = fixture(kind, null), original = compile(f).artifacts.narration;
  const snapshot = append(f); f.draft.decisions.sourceDisplayOnly = [snapshot];
  const result = compile(f);
  assert.deepEqual(result.artifacts.narration, original);
  assert.equal(validateProduction(result.artifacts, cfg, result).verdict, 'PASS');
  assert.ok(result.artifacts.narration.segments.find(s => s.id === 'story001').parts.length >= 2);
});

for (const field of ['sourceHash', 'text', 'textHash', 'from', 'to', 'contentId', 'version']) test(`snapshot ${field} mismatch is rejected by store/compiler and invalidates GET/restart plan`, () => {
  const f = fixture(), snapshot = append(f); f.draft.decisions.sourceDisplayOnly = [snapshot]; const w = workspace(f);
  try {
    const good = w.workflow.run(f.draft.id, { revision: 1 }); assert.equal(good.status, 'voice_planned');
    const bad = structuredClone(good.decisions);
    bad.sourceDisplayOnly[0][field] = typeof snapshot[field] === 'number' ? snapshot[field] + 1 : `${snapshot[field]}-tampered`;
    assert.throws(() => w.store.update(good.id, { revision: good.revision, decisions: bad }), /Display-only/);
    const tampered = { ...good, decisions: bad }; assert.equal(compileDraft(tampered, f.record, { seriesConfig }).status, 'failed');
    w.store.persist(tampered);
    const restored = new ProductionWorkflow(new DraftStore(w.dir, f.catalog), root).reconcile(good.id);
    assert.equal(restored.sourceDisplayReview.status, 'needs_confirmation'); assert.equal(restored.productionReady, false);
    assert.equal(restored.workflow.invalidation.reason.code, 'DISPLAY_ONLY_SOURCE_STALE'); assert.ok(!restored.artifacts.voicePlan);
    assert.notEqual(restored.status, 'voice_planned');
    assert.throws(() => w.workflow.read(restored, 'voicePlan'), /unavailable/);
  } finally { w.close(); }
});

test('actual source text/range drift with unchanged claimed hash still BLOCKs; no guessed relocation', () => {
  const f = fixture(); f.draft.decisions.sourceDisplayOnly = [append(f)]; const w = workspace(f);
  try {
    assert.equal(w.workflow.run(f.draft.id, { revision: 1 }).status, 'voice_planned');
    f.record.post.text = f.record.post.text.replace(CTA, `新的內容 ${CTA}`);
    const restored = new ProductionWorkflow(new DraftStore(w.dir, f.catalog), root).reconcile(f.draft.id);
    assert.equal(restored.sourceDisplayReview.status, 'needs_confirmation'); assert.ok(!restored.artifacts.voicePlan);
    assert.equal(compile(f).status, 'failed'); assert.equal(restored.productionReady, false);
  } finally { w.close(); }
});

test('cancelling explicit CTA decision invalidates plan and restores MIXED_STORY_LANGUAGE BLOCK', () => {
  const f = fixture(); f.draft.decisions.sourceDisplayOnly = [append(f)]; const w = workspace(f);
  try {
    const good = w.workflow.run(f.draft.id, { revision: 1 }); assert.equal(good.status, 'voice_planned');
    const decisions = { ...good.decisions, sourceDisplayOnly: [] };
    const saved = w.store.update(good.id, { revision: good.revision, decisions }); assert.ok(!saved.artifacts.voicePlan);
    const blocked = w.workflow.run(good.id, { revision: saved.revision });
    assert.equal(blocked.workflow.failedStep, 'validation'); assert.ok(!blocked.artifacts.voicePlan);
    assert.ok(blocked.steps.find(s => s.name === 'validation').result.errors.some(e => e.code === 'MIXED_STORY_LANGUAGE'));
  } finally { w.close(); }
});

test('whole paragraphs: CRLF/multiline evidence, leading/middle order, English requires explicit exclusion', () => {
  const f = fixture('single', null);
  f.record.post.text = `Display heading.\r\n\r\n${f.record.post.text}\r\n\r\nMiddle display.\r\nSecond display line.\r\n\r\nFinal spoken sentence.`;
  f.record.sourceHash = digest(f.record.post.text); f.draft.sourceHash = f.record.sourceHash;
  const ranges = sourceDisplayCandidates(f.record); assert.equal(ranges.length, 4);
  assert.equal(ranges[2].text, 'Middle display.\r\nSecond display line.');
  assert.ok(compile(f).artifacts.narration.segments.some(s => s.text === 'Display heading.'));
  f.draft.decisions.sourceDisplayOnly = [ranges[0], ranges[2]];
  const result = compile(f); assert.deepEqual(result.blocked, []);
  assert.equal(validateProduction(result.artifacts, cfg, result).verdict, 'PASS');
  assert.equal(result.artifacts.episode.story[0].parts[0].text, 'Display heading.');
  assert.equal(result.artifacts.episode.story[0].parts.at(-1).text, ranges[2].text);
  assert.ok(result.artifacts.narration.segments.every(s => !s.text.includes('display')));
  assert.ok(result.artifacts.narration.segments.some(s => s.text === 'Final spoken sentence.'));
  assert.throws(() => validateSourceDisplayOnly(f.record, [ranges[1]]), /marked vocabulary/);
});

test('fresh request-local API rejects stale display evidence and free plan never invokes provider/key', async () => {
  const f = fixture('multiple', null); f.catalog.frozen = new Set(); append(f); const w = workspace(f); let requests = 0, keys = 0;
  const server = createStudio({ stateDir: w.dir, catalogLoader: () => f.catalog, fetchImpl: () => { requests++; throw Error('No provider'); }, apiKey: () => { keys++; throw Error('No secret'); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const detail = await (await fetch(`${url}/api/contents/${f.draft.contentId}`)).json();
    const decisions = { ...f.draft.decisions, sourceDisplayOnly: [detail.displayOnlyCandidates.at(-1)] };
    const put = () => fetch(`${url}/api/drafts/${f.draft.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: f.draft.revision, decisions }) });
    assert.equal((await put()).status, 200);
    const saved = w.store.get(f.draft.id);
    const res = await fetch(`${url}/api/drafts/${saved.id}/workflow`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, action: 'run' }) });
    assert.equal((await res.json()).status, 'voice_planned');
    f.record.post.text += 'Changed source.';
    const view = await (await fetch(`${url}/api/drafts/${saved.id}`)).json(); assert.equal(view.sourceDisplayReview.status, 'needs_confirmation'); assert.ok(!view.artifacts.voicePlan);
    const stalePut = await fetch(`${url}/api/drafts/${saved.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: saved.revision, decisions }) });
    assert.equal(stalePut.status, 409); assert.match((await stalePut.json()).error.message, /Display-only/);
    assert.equal(requests, 0); assert.equal(keys, 0);
  } finally { await new Promise(resolve => server.close(resolve)); w.close(); }
});
