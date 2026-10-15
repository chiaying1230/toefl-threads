// Focused review contract: all five assertions must pass as normal regression tests.
// Only temporary stores or in-memory source snapshots; no canonical assets are written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { fixture } from './fixtures.mjs';
import { loadCatalog, candidates } from './catalog.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { createStudio, root } from './server.mjs';
import { compileDraft } from './compiler.mjs';
import { validateProduction } from './production-validation.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-review-'));

test('R1: upstream artifact drift must invalidate a displayed voice plan', () => {
  const directory = temp(), f = fixture();
  try {
    const store = new DraftStore(directory, f.catalog); store.persist(f.draft);
    const workflow = new ProductionWorkflow(store, root);
    const d = workflow.run(f.draft.id, { revision: 1 });
    assert.equal(d.status, 'voice_planned');
    const file = path.join(directory, d.artifacts.episode.path);
    const episode = JSON.parse(fs.readFileSync(file, 'utf8')); episode.seriesEpisode++; fs.writeFileSync(file, JSON.stringify(episode));
    const reopened = workflow.reconcile(d.id);
    assert.notEqual(reopened.status, 'voice_planned', 'Changed episode still has an apparently current voice plan');
    assert.throws(() => workflow.read(reopened, 'voicePlan'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('R2: unchanged Quiz decision must retain human-reviewed options or demand reconfirmation', () => {
  const directory = temp();
  try {
    const catalog = loadCatalog(root), store = new DraftStore(directory, catalog), record = catalog.records.get('p1');
    const d = store.create('p1'), candidate = candidates(record, catalog.vocab).quizzes.find(q => q.key === 'ubiquitous');
    const decisions = { series: 'TOEFL', seriesEpisode: 100, level: { min: 3, max: 3 }, vocabulary: ['ubiquitous'], hook: { candidateId: 'hook-1', text: 'The story starts.', zh: '故事開始了。' }, quiz: { ...candidate, candidateId: candidate.id } };
    const first = store.update(d.id, { revision: 1, decisions });
    assert.deepEqual(first.decisions.quiz.options, candidate.options);
    // arbitrary is a distractor from a different post; p1's sourceHash stays unchanged.
    catalog.vocab.arbitrary.zh = 'review-fixture changed distractor';
    assert.equal(catalog.records.get('p1').sourceHash, d.sourceHash);
    let saved;
    try { saved = store.update(d.id, { revision: first.revision, decisions }); }
    catch (e) { assert.equal(e.status, 409); return; } // rejecting for reconfirmation is also safe
    assert.deepEqual(saved.decisions.quiz.options, candidate.options, 'An unchanged radio choice saved different options');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('R3: source must be fresh when mutation executes, after the request body is received', { timeout: 10000 }, async () => {
  const directory = temp(), f = fixture();
  let server;
  let catalog = f.catalog;
  try {
    new DraftStore(directory, catalog).persist(f.draft);
    server = createStudio({ stateDir: directory, catalogLoader: () => catalog });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    // Observe received headers, independent of when the implementation loads its authoritative source.
    const loaded = new Promise(resolve => { server.once('request', resolve); });
    let req;
    const response = new Promise((resolve, reject) => {
      req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: `/api/drafts/${f.draft.id}/workflow`, headers: { 'content-type': 'application/json' } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(JSON.parse(body)));
      });
      req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('review request timed out')));
    });
    req.write('{"revision":');
    await loaded;
    const changed = structuredClone(f.record); changed.post.text += ' Changed.'; changed.sourceHash = 'changed-source-hash';
    catalog = { ...catalog, records: new Map([[f.record.post.id, changed]]) };
    req.end('1}');
    const result = await response;
    assert.notEqual(result.status, 'voice_planned', 'Request continued with the source snapshot from before body arrival');
    assert.ok(result.workflow?.failedStep || result.error);
  } finally {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('R4: real-source abbreviation must not silently create a separate sentence TTS', () => {
  const catalog = loadCatalog(root), record = catalog.records.get('p186'), f = fixture();
  Object.assign(f.draft, { contentId: 'p186', sourceHash: record.sourceHash });
  f.draft.decisions.vocabulary = ['observation']; f.draft.decisions.quiz = candidates(record, catalog.vocab).quizzes.find(q => q.key === 'observation');
  const compiled = compileDraft(f.draft, record, { seriesConfig: JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/series.json'), 'utf8')) });
  assert.equal(validateProduction(compiled.artifacts, loadVoiceConfig(), compiled).verdict, 'PASS');
  assert.equal(compiled.artifacts.narration.segments.some(s => s.kind === 'story' && s.text === 'Mr.'), false, 'A real full sentence was split into independent Mr. and Holmes TTS segments without warning');
});

test('R5: stale workflow must explicitly retain productionReady false', () => {
  const directory = temp(), f = fixture();
  try {
    const catalog = f.catalog, store = new DraftStore(directory, catalog); store.persist(f.draft);
    const workflow = new ProductionWorkflow(store, root), d = workflow.run(f.draft.id, { revision: 1 });
    assert.equal(d.workflow.productionReady, false);
    f.record.sourceHash = 'changed';
    const stale = workflow.reconcile(d.id);
    assert.equal(stale.workflow.productionReady, false, 'A failed / stale job must be explicitly not production-ready, not undefined');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
