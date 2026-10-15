// Shared TEST helpers for the 2B suites: a temporary Studio state with a fixture draft at voice_planned and a mock provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixture } from './fixtures.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { ProductionService } from './production.mjs';
import { mockProvider } from './mock-provider.mjs';
import { root } from './server.mjs';

export const ACK = { noAutomaticRetry: true, estimateIsNotBilling: true };
export const key = n => `test-idempotency-${String(n).padStart(6, '0')}`;
export function setup({ kind = 'single', behavior, autoChain = false, localSteps = {}, dir, promotion, apiKey = () => 'test-key-not-real' } = {}) {
  dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'studio-2b-'));
  const f = fixture(kind, '課堂準備開始了。', { production: true });
  const store = new DraftStore(dir, f.catalog);
  if (!fs.existsSync(path.join(dir, `${f.draft.id}.json`))) store.persist(f.draft);
  const wf = new ProductionWorkflow(store, root);
  if (store.get(f.draft.id).status !== 'voice_planned') assert.equal(wf.run(f.draft.id, { revision: store.get(f.draft.id).revision }).status, 'voice_planned');
  const provider = mockProvider(behavior);
  const open = () => new ProductionService({ draftsDir: dir, productionDir: path.join(dir, 'production'), repoRoot: root, catalogLoader: () => f.catalog, loadedEngineHash: wf.loadedEngineHash, fetchImpl: provider.fetchImpl, apiKey, autoChain, localSteps, ...(promotion ? { promotion } : {}) });
  const s = { dir, f, store, wf, provider, open, id: f.draft.id };
  s.service = open();
  // cleanup must never hide the real assertion (Windows may still hold a killed process's handles for a moment)
  s.close = () => { try { s.service.close(); } catch { /* closed */ } try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { console.error(`cleanup: ${e.message}`); } };
  s.preview = (extra = {}) => s.service.preview(s.id, { revision: s.store.get(s.id).revision, ...extra });
  s.confirm = (p, k = key(1), extra = {}) => s.service.confirm(s.id, { runId: p.run.runId, challenge: p.challenge?.challenge, idempotencyKey: k, budget: p.envelope.budget, acknowledgements: ACK, ...extra });
  return s;
}
/** A fake free local step that seals real (small) files; used to test chain gating without a browser. */
export const fakeStep = (step, roles, report = {}) => async ({ candidate, attemptId }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fake-step-'));
  try {
    const files = roles.map(([role, as, content]) => { const f = path.join(dir, role); fs.writeFileSync(f, content ?? JSON.stringify({ step, role, attemptId })); return { role, from: f, as }; });
    return { outputs: candidate.seal(step, attemptId, files), report };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
export const FAKE_STEPS = {
  assembleStep: fakeStep('assemble', [['plan', 'docs/x-auto/x-auto.plan.json', '{"lines":[]}'], ['wav', 'docs/x-auto/narration.wav'], ['assembly', 'docs/x-auto/assembly.json'], ['manifest', 'scripts/video/narration/x.manifest.json']], { seams: [] }),
  cameraStep: fakeStep('camera', [['episode', 'scripts/video/episodes/x-auto.json']]),
  auditStep: fakeStep('audit', [['renderSpec', 'docs/x-auto/render.json', '{"frames":30,"duration":1}'], ['layoutAudit', 'docs/x-auto/layout-audit.json']]),
  renderStep: fakeStep('render', [['narrationOnly', 'outputs/x.narration-only.mp4']]),
  mixStep: fakeStep('mix', [['final', 'outputs/x.mp4']], { mixed: false }),
  verifyStep: fakeStep('verify', [['verification', 'docs/x-auto/verification.json']], { checks: [] }),
};
// Tests may talk to their own loopback Studio, never to an external host (and there is no API key anywhere).
const loopbackFetch = globalThis.fetch;
globalThis.fetch = (input, ...rest) => {
  const host = new URL(String(input?.url ?? input)).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw Error(`external network is forbidden in tests: ${host}`);
  return loopbackFetch(input, ...rest);
};
