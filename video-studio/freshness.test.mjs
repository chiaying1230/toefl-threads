import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { fixture } from './fixtures.mjs';
import { loadCatalog, candidates } from './catalog.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { createStudio, root } from './server.mjs';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-freshness-'));

for (const [name, milestone] of [['narration', 'configured'], ['episode', 'configured'], ['compileReport', 'configured'], ['validation', 'compiled'], ['voicePlan', 'validated']]) test(`${name} dependency drift invalidates only its producer and downstream on restart/read`, () => {
  const directory = temp(), f = fixture();
  try {
    const store = new DraftStore(directory, f.catalog); store.persist(f.draft);
    const w = new ProductionWorkflow(store, root), d = w.run(f.draft.id, { revision: 1 });
    assert.equal(d.status, 'voice_planned');
    const file = path.join(directory, d.artifacts[name].path), value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.reviewMutation = true; fs.writeFileSync(file, JSON.stringify(value));
    const reopened = new ProductionWorkflow(new DraftStore(directory, f.catalog), root).reconcile(d.id);
    assert.equal(reopened.status, milestone); assert.equal(reopened.productionReady, false); assert.equal(reopened.workflow.productionReady, false);
    assert.equal(reopened.artifacts.voicePlan, undefined); assert.ok(reopened.workflow.invalidation.reason.code === 'ARTIFACT_DEPENDENCY_STALE');
    assert.throws(() => w.read(d, 'voicePlan')); // even the stale caller's original object is rejected
    assert.ok(reopened.workflowHistory.at(-1).artifacts.voicePlan);
    if (milestone !== 'configured') assert.ok(reopened.artifacts.compileReport);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('missing / malformed upstream artifacts cannot survive GET-like reconciliation', () => {
  for (const mutation of ['missing', 'malformed']) {
    const directory = temp(), f = fixture();
    try {
      const store = new DraftStore(directory, f.catalog); store.persist(f.draft); const w = new ProductionWorkflow(store, root), d = w.run(f.draft.id, { revision: 1 });
      const file = path.join(directory, d.artifacts.episode.path);
      if (mutation === 'missing') fs.unlinkSync(file); else fs.writeFileSync(file, '{');
      assert.equal(w.reconcile(d.id).status, 'configured'); assert.throws(() => w.read(d, 'voicePlan'));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test('Quiz dependency change preserves confirmed snapshot, invalidates production, and requires explicit fresh confirmation', () => {
  const directory = temp();
  try {
    const catalog = loadCatalog(root), store = new DraftStore(directory, catalog), w = new ProductionWorkflow(store, root), record = catalog.records.get('p1');
    let d = store.create('p1'); const candidate = candidates(record, catalog.vocab).quizzes.find(q => q.key === 'ubiquitous');
    const decisions = { series: 'TOEFL', seriesEpisode: 100, level: { min: 3, max: 3 }, vocabulary: ['ubiquitous'], hook: { candidateId: 'hook-1', text: 'The story starts.', zh: '故事開始了。' }, quiz: { ...candidate, candidateId: candidate.id } };
    d = store.update(d.id, { revision: d.revision, decisions }); d = w.run(d.id, { revision: d.revision });
    assert.equal(d.status, 'voice_planned'); const saved = structuredClone(d.decisions.quiz);
    catalog.vocab.arbitrary.zh = 'freshness-test modified distractor';
    d = w.reconcile(d.id); assert.equal(d.quizReview.status, 'needs_confirmation'); assert.equal(d.status, 'configured');
    assert.deepEqual(d.decisions.quiz, saved); assert.equal(d.artifacts.voicePlan, undefined);
    assert.throws(() => store.update(d.id, { revision: d.revision, decisions }), e => e.status === 409);
    assert.equal(w.run(d.id, { revision: d.revision }).workflow.failedStep, 'compile');
    const fresh = candidates(record, catalog.vocab).quizzes.find(q => q.key === 'ubiquitous');
    d = store.update(d.id, { revision: d.revision, decisions: { ...decisions, quiz: { ...fresh, candidateId: fresh.id } } });
    assert.equal(d.quizReview.status, 'confirmed'); assert.notEqual(d.decisions.quiz.candidateHash, saved.candidateHash);
    assert.equal(d.decisions.quiz.confirmation.revision, d.revision);
    assert.equal(w.run(d.id, { revision: d.revision }).status, 'voice_planned');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('authoritative readiness is false for initial / early failed / partial / legacy true restored state', () => {
  const directory = temp(), f = fixture();
  try {
    const store = new DraftStore(directory, f.catalog), w = new ProductionWorkflow(store, root);
    let d = store.create(f.record.post.id); assert.equal(d.productionReady, false); assert.equal(d.workflow.productionReady, false);
    d = w.run(d.id, { revision: d.revision }); assert.equal(d.workflow.productionReady, false); assert.equal(d.steps.at(-1).result.productionReady, false);
    // Simulate legacy/incomplete storage without the normal save policy.
    fs.writeFileSync(store.file(d.id), JSON.stringify({ ...d, status: 'voice_planned', steps: [], workflow: { productionReady: true } }));
    d = w.reconcile(d.id); assert.equal(d.productionReady, false); assert.equal(d.workflow.productionReady, false); assert.notEqual(d.status, 'voice_planned');
    const disk = JSON.parse(fs.readFileSync(store.file(d.id), 'utf8')); assert.equal(disk.workflow.productionReady, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('legacy Quiz snapshot is displayed as saved but cannot compile without full confirmation evidence', () => {
  const directory = temp(), f = fixture();
  try {
    delete f.draft.decisions.quiz.candidateHash; delete f.draft.decisions.quiz.confirmation;
    const original = structuredClone(f.draft.decisions.quiz), store = new DraftStore(directory, f.catalog); store.persist(f.draft);
    const w = new ProductionWorkflow(store, root), d = w.reconcile(f.draft.id);
    assert.equal(d.quizReview.status, 'needs_confirmation'); assert.deepEqual(d.decisions.quiz, original);
    assert.equal(w.run(d.id, { revision: d.revision }).workflow.failedStep, 'compile');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('public GET draft/list/plan all invalidate changed upstream, using request-local source', async () => {
  const directory = temp(), f = fixture(); let server;
  try {
    const store = new DraftStore(directory, f.catalog); store.persist(f.draft); const w = new ProductionWorkflow(store, root), d = w.run(f.draft.id, { revision: 1 });
    server = createStudio({ stateDir: directory, catalogLoader: () => f.catalog }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`, file = path.join(directory, d.artifacts.episode.path);
    fs.writeFileSync(file, '{}');
    assert.equal((await fetch(`${url}/api/drafts/${d.id}/artifacts/voicePlan`)).status, 409);
    const get = await (await fetch(`${url}/api/drafts/${d.id}`)).json(); assert.equal(get.status, 'configured'); assert.equal(get.workflow.productionReady, false);
    const list = await (await fetch(`${url}/api/drafts`)).json(); assert.equal(list.drafts[0].artifacts.voicePlan, undefined);
  } finally { if (server?.listening) await new Promise(r => { server.close(r); server.closeAllConnections(); }); fs.rmSync(directory, { recursive: true, force: true }); }
});
