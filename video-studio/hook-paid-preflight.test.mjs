// Studio-only Hook policy regression. Preview only: never confirm, create a receipt, or synthesize.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { ProductionService } from './production.mjs';
import { root } from './server.mjs';
function workspace(zh) {
  const f = fixture('single', zh, { production: true }), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-hook-paid-preview-'));
  const store = new DraftStore(dir, f.catalog); store.persist(f.draft);
  const workflow = new ProductionWorkflow(store, root);
  let providerRequests = 0, keyReads = 0;
  const open = () => new ProductionService({ draftsDir: dir, productionDir: path.join(dir, 'production'), repoRoot: root, catalogLoader: () => f.catalog, loadedEngineHash: workflow.loadedEngineHash, promotion: { enabled: false }, autoChain: false,
    fetchImpl: () => { providerRequests++; throw Error('Provider forbidden in preflight'); }, apiKey: () => { keyReads++; throw Error('Secret forbidden in preflight'); } });
  return { f, dir, store, workflow, open, counts: () => ({ providerRequests, keyReads }), close: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}
for (const zh of [null, '課堂準備開始了。']) test(`paid preflight accepts ${zh === null ? 'explicit null' : 'unchanged Chinese'} Hook with the full production geometry/cache/envelope path and zero receipts`, async () => {
  const w = workspace(zh); let service;
  try {
    const draft = w.workflow.run(w.f.draft.id, { revision: 1 }); assert.equal(draft.status, 'voice_planned');
    service = w.open(); const p = await service.preview(draft.id, { revision: draft.revision });
    assert.equal(p.run.state, 'awaiting_confirmation', JSON.stringify(p.run.reason)); assert.ok(p.challenge);
    assert.equal(p.preflight.parity.ok, true); assert.equal(p.preflight.cards.ok, true);
    const run = service.coordinator.run2B(p.run.runId), candidate = service.candidate(run);
    assert.equal(candidate.readJson(run.inputs.inputRefs.episode).hook.zh, zh);
    assert.equal(service.coordinator.all('SELECT * FROM receipts').length, 0);
    assert.equal(service.coordinator.all('SELECT * FROM executions').length, 0);
    assert.equal(service.coordinator.all('SELECT * FROM attempts').length, 0);
    assert.equal(service.coordinator.all('SELECT * FROM challenges WHERE consumed_at IS NOT NULL').length, 0);
    assert.deepEqual(w.counts(), { providerRequests: 0, keyReads: 0 });
    assert.equal(p.readiness.productionReady, false); assert.equal(p.readiness.canPromote, false);
    service.close(); service = w.open();
    assert.equal(service.view(draft.id).run.state, 'awaiting_confirmation');
    assert.deepEqual(w.counts(), { providerRequests: 0, keyReads: 0 });
  } finally { service?.close(); w.close(); }
});

test('null Hook does not bypass other paid decision/freshness/collision guards', () => {
  const w = workspace(null); let service;
  try {
    const d = w.workflow.run(w.f.draft.id, { revision: 1 }); service = w.open();
    const check = (change, code) => {
      const edited = structuredClone(d); change(edited);
      assert.ok(service.preflightProblems(edited, service.context()).some(p => p.code === code), code);
    };
    check(d => d.status = 'configured', 'VOICE_PLAN_REQUIRED');
    check(d => d.quizReview.status = 'needs_confirmation', 'QUIZ_NOT_CONFIRMED');
    check(d => delete d.decisions.production, 'PRODUCTION_DECISIONS_REQUIRED');
    check(d => d.decisions.seriesEpisode = 1, 'SERIES_EPISODE_COLLISION');
    check(d => d.contentId = 'p2', 'CANONICAL_DESTINATION_EXISTS');
    const file = w.workflow.safeFile(d.artifacts.episode.path); fs.appendFileSync(file, ' ');
    // Parsed JSON hashing does not treat formatting as drift, so change the actual contract value.
    const artifact = JSON.parse(fs.readFileSync(file)); artifact.hook.zh = false; fs.writeFileSync(file, JSON.stringify(artifact));
    assert.notEqual(service.context().workflow.reconcile(d.id).status, 'voice_planned');
    assert.equal(service.coordinator.all('SELECT * FROM receipts').length, 0);
    assert.deepEqual(w.counts(), { providerRequests: 0, keyReads: 0 });
  } finally { service?.close(); w.close(); }
});

for (const value of [undefined, false, 12, {}]) test(`invalid/missing Hook zh (${String(value)}) stays validation FAIL and paid preflight BLOCK`, async () => {
  const w = workspace(null); let service;
  try {
    const d = w.store.get(w.f.draft.id); d.decisions.hook.zh = value; w.store.persist(d);
    const job = w.workflow.run(d.id, { revision: 1 }); assert.equal(job.workflow.failedStep, 'validation'); assert.ok(!job.artifacts.voicePlan);
    service = w.open(); await assert.rejects(service.preview(d.id, { revision: 1 }), e => e.status === 409 && e.problems.some(p => p.code === 'VOICE_PLAN_REQUIRED'));
    assert.equal(service.coordinator.all('SELECT * FROM receipts').length, 0);
    assert.deepEqual(w.counts(), { providerRequests: 0, keyReads: 0 });
  } finally { service?.close(); w.close(); }
});
