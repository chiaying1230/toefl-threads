// 2B production chain: gating, restart, human review, approval invalidation (fake local steps, no browser),
// then ONE complete run over HTTP with the real assemble / camera / audit / render / mix / verify on a fixture (mock voice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setup, ACK, key, FAKE_STEPS, fakeStep } from './test-support.mjs';
import { StepFailure, evaluateVerification, evaluateMix, requiredVerifyChecks } from './production-steps.mjs';
import { fixture } from './fixtures.mjs';
import { DraftStore } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { createStudio, root } from './server.mjs';
import { mockProvider } from './mock-provider.mjs';
import { jsonHash } from './hashing.mjs';

const fail = (code, blocked = false) => async () => { throw new StepFailure(code, `${code} (test)`, { blocked }); };
async function toVoice(s) { const p = await s.preview(); await s.confirm(p); await s.service.idle(); return p; }
const allAcks = review => ({ seams: Object.fromEntries(review.seams.map(x => [x.id, true])), visual: Object.fromEntries(review.visualChecklist.map(x => [x.id, true])), warnings: Object.fromEntries(review.warnings.map(x => [x.id, true])) });

test('audit FAIL stops the chain before render; verify FAIL never opens human review; camera BLOCK is blocked', async () => {
  let rendered = false;
  const a = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, auditStep: fail('EXTENDED_AUDIT_FAILED'), renderStep: async (...x) => { rendered = true; return FAKE_STEPS.renderStep(...x); } } });
  try {
    await toVoice(a);
    const v = a.service.view(a.id);
    assert.equal(v.run.milestone, 'camera_fitted'); assert.equal(v.run.state, 'failed'); assert.equal(rendered, false);
    assert.equal(v.steps.some(s => s.step === 'render'), false); assert.equal(v.readiness.canReview, false); assert.equal(v.readiness.productionReady, false);
    assert.throws(() => a.service.media(a.id, 'final'), e => e.status === 404);
  } finally { a.close(); }
  const b = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, verifyStep: fail('VERIFY_FAILED') } });
  try {
    await toVoice(b);
    const v = b.service.view(b.id);
    assert.equal(v.run.milestone, 'mixed'); assert.equal(v.review, null); assert.equal(v.readiness.canReview, false);
    assert.throws(() => b.service.decideReview(b.id, { runId: v.run.runId, bundleHash: 'sha256:x', decision: 'accept', idempotencyKey: key(1) }), e => e.status === 409);
  } finally { b.close(); }
  const c = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, cameraStep: fail('CAMERA_UNSATISFIABLE', true) } });
  try { await toVoice(c); const v = c.service.view(c.id); assert.equal(v.run.state, 'blocked'); assert.equal(v.run.milestone, 'assembled'); } finally { c.close(); }
});

test('verify / mix reports: empty, partial, failing or non-zero exit never pass', () => {
  const f = fixture('multiple', '課堂準備開始了。', { production: true }), episode = { vocabulary: [{ word: 'allocate' }, { word: 'arbitrary' }], music: {}, soundEffects: [{}] };
  const names = requiredVerifyChecks(episode).map(n => (n instanceof RegExp ? n.source.replace('^', '') + ' x' : n));
  const full = { checks: names.map(name => ({ name, ok: true })) };
  assert.equal(evaluateVerification(full, episode, 0).ok, true);
  assert.equal(evaluateVerification({ checks: [] }, episode, 0).ok, false);
  assert.equal(evaluateVerification(full, episode, 1).ok, false);
  assert.equal(evaluateVerification({ checks: full.checks.slice(1) }, episode, 0).ok, false);
  assert.equal(evaluateVerification({ checks: full.checks.map((c, i) => ({ ...c, ok: i !== 2 })) }, episode, 0).ok, false);
  const six = { ok: true, checks: Array.from({ length: 6 }, (_, i) => ({ name: `c${i}`, ok: true })) };
  assert.equal(evaluateMix(six, episode, 0).ok, true);
  assert.equal(evaluateMix({ ...six, checks: six.checks.slice(1) }, episode, 0).ok, false);
  assert.equal(evaluateMix({ ...six, ok: false }, episode, 0).ok, false);
  assert.equal(f.draft.decisions.production.version, 1);
});

test('restart: an interrupted local step is never presumed successful; resume re-runs it as a new attempt', async () => {
  let hang = true;
  const s = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, cameraStep: async (...x) => (hang ? new Promise(() => {}) : FAKE_STEPS.cameraStep(...x)) } });
  try {
    const p = await s.preview(); await s.confirm(p);
    while (!s.service.coordinator.get("SELECT 1 FROM steps WHERE step = 'camera' AND status = 'running'")) await new Promise(r => setTimeout(r, 50));
    s.service.close(); // the process "dies" with the step in flight
    hang = false; s.service = s.open();
    let v = s.service.view(s.id);
    assert.equal(v.run.state, 'interrupted'); assert.equal(v.run.milestone, 'assembled');
    assert.equal(v.steps.find(x => x.step === 'camera').status, 'interrupted');
    s.service.resume(s.id, v.run.runId); await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'awaiting_human_review');
    assert.equal(v.steps.filter(x => x.step === 'camera').length, 2);
  } finally { s.close(); }
});

test('human review: acknowledgements required, exact bundle only, approval invalidated by any decision edit; needs-changes is terminal', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    await toVoice(s);
    let v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'awaiting_human_review'); assert.equal(v.readiness.canReview, true); assert.equal(v.readiness.productionReady, false);
    const r = v.review, runId = v.run.runId;
    assert.ok(r.warnings.some(w => w.code === 'HOOK_CHOREOGRAPHY_REVIEW')); assert.equal(r.visualChecklist.length, 5);
    assert.throws(() => s.service.decideReview(s.id, { runId, bundleHash: r.bundleHash, decision: 'accept', acknowledgements: {}, idempotencyKey: key(1) }), /尚不能接受/);
    const partial = allAcks(r); delete partial.visual.outro;
    assert.throws(() => s.service.decideReview(s.id, { runId, bundleHash: r.bundleHash, decision: 'accept', acknowledgements: partial, idempotencyKey: key(2) }), /Outro/);
    assert.throws(() => s.service.decideReview(s.id, { runId, bundleHash: 'sha256:old-page', decision: 'accept', acknowledgements: allAcks(r), idempotencyKey: key(3) }), e => e.status === 409);
    v = s.service.decideReview(s.id, { runId, bundleHash: r.bundleHash, decision: 'accept', acknowledgements: allAcks(r), comment: 'ok', idempotencyKey: key(4) });
    assert.equal(v.run.milestone, 'approved'); assert.equal(v.readiness.productionReady, true); assert.equal(v.readiness.canPromote, false); // promotion not enabled
    assert.throws(() => s.service.promotionPreview(s.id), e => e.status === 403);
    assert.equal(fs.existsSync(path.join(root, 'docs', `${s.f.draft.contentId}-auto`)), false); // no promotion / freeze side effect
    // any upstream decision edit revokes the approval
    s.service.beginMutation(s.id, s.store.get(s.id).revision, jsonHash(s.store.get(s.id).decisions));
    v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.equal(v.readiness.productionReady, false);
    assert.throws(() => s.service.decideReview(s.id, { runId, bundleHash: r.bundleHash, decision: 'accept', acknowledgements: allAcks(r), idempotencyKey: key(5) }), e => e.status === 409);
  } finally { s.close(); }
  const c = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    await toVoice(c);
    const v = c.service.view(c.id);
    assert.throws(() => c.service.decideReview(c.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'changes', notes: [], idempotencyKey: key(6) }), /問題/);
    const after = c.service.decideReview(c.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'changes', notes: [{ category: 'seam', t: 2.1, text: '接縫太急' }], idempotencyKey: key(7) });
    assert.equal(after.run.state, 'changes_requested'); assert.equal(after.readiness.productionReady, false);
    assert.throws(() => c.service.resume(c.id, v.run.runId), e => e.status === 409);
  } finally { c.close(); }
});

test('stale candidate: a sealed output changed on disk is not reused; a decision edit during a step quarantines its result', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    await toVoice(s);
    let v = s.service.view(s.id);
    const run = s.service.coordinator.run2B(v.run.runId), plan = s.service.chain(run).assemble.result.outputs.find(o => o.role === 'plan');
    const file = path.join(s.service.candidate(run).dir, plan.path); fs.chmodSync(file, 0o666); fs.writeFileSync(file, '{"lines":[],"tampered":true}');
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_generated'); // everything after the changed artifact is no longer current
    assert.ok(v.steps.some(x => x.step === 'assemble' && x.status === 'invalidated'));
  } finally { s.close(); }
  let t;
  t = setup({ autoChain: true, localSteps: { ...FAKE_STEPS, cameraStep: async (...x) => { t.service.beginMutation(t.id, 1, jsonHash(t.store.get(t.id).decisions)); return FAKE_STEPS.cameraStep(...x); } } });
  try {
    await toVoice(t);
    const v = t.service.view(t.id);
    assert.equal(v.run.state, 'stale');
    const cam = t.service.coordinator.all("SELECT * FROM steps WHERE step = 'camera'")[0];
    assert.equal(cam.status, 'blocked'); assert.match(cam.result, /SUPERSEDED_DURING_STEP/);
  } finally { t.close(); }
});

test('end to end over HTTP on a fixture: mock voice → real assemble / camera / audit / render / mix / verify → review → approved', { timeout: 15 * 60 * 1000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-2b-http-')), f = fixture('single', '課堂準備開始了。', { production: true });
  const store = new DraftStore(dir, f.catalog); store.persist(f.draft);
  assert.equal(new ProductionWorkflow(store, root).run(f.draft.id, { revision: 1 }).status, 'voice_planned');
  const provider = mockProvider();
  const server = createStudio({ stateDir: dir, catalogLoader: () => f.catalog, fetchImpl: provider.fetchImpl, apiKey: () => 'test-key-not-real' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`, api = `${base}/api/drafts/${f.draft.id}/production`;
  const realFetch = (await import('node:http')).request;
  const call = (url, method = 'GET', body, headers = {}) => new Promise((resolve, reject) => {
    const req = realFetch(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw); } catch { /* binary */ } resolve({ status: res.statusCode, headers: res.headers, json, raw }); }); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
  try {
    const { csrf } = (await call(`${base}/api/session`)).json;
    assert.equal((await call(`${api}/preview`, 'POST', { revision: 1 })).status, 403); // no page token
    const p = (await call(`${api}/preview`, 'POST', { revision: 1 }, { 'x-studio-csrf': csrf })).json;
    assert.equal(p.envelope.requests.length, 4); assert.ok(p.challenge);
    const body = { runId: p.run.runId, challenge: p.challenge.challenge, idempotencyKey: key(42), budget: p.envelope.budget, acknowledgements: ACK };
    const [c1, c2] = await Promise.all([call(`${api}/confirm`, 'POST', body, { 'x-studio-csrf': csrf }), call(`${api}/confirm`, 'POST', body, { 'x-studio-csrf': csrf })]);
    assert.equal(c1.json.executionId, c2.json.executionId);
    let v;
    for (let i = 0; i < 600; i++) { v = (await call(api)).json; if (!v.run.running && v.run.state !== 'running' && ['awaiting_review', 'failed', 'blocked', 'stale'].includes(v.run.state)) break; await new Promise(r => setTimeout(r, 1000)); }
    assert.equal(v.run.milestone, 'awaiting_human_review', JSON.stringify(v.run.reason) + JSON.stringify(v.steps.filter(x => x.status !== 'succeeded').map(x => x.errors)));
    assert.equal(provider.calls.length, 4);
    const steps = Object.fromEntries(v.steps.filter(x => x.current).map(x => [x.step, x]));
    assert.equal(steps.verify.report.checks.every(c => c.ok), true); assert.equal(steps.mix.report.checks.length, 6);
    assert.equal(steps.audit.report.sharedIssues, 0); assert.equal(steps.audit.report.frames, steps.render.report.frames);
    assert.equal(v.review.seams.length, 1); assert.equal(v.review.seams[0].clips.clips.length, 3);
    const range = await call(`${api}/media/final`, 'GET', null, { range: 'bytes=0-99' });
    assert.equal(range.status, 206); assert.equal(range.raw.length, 100); assert.match(range.headers['content-range'], /^bytes 0-99\//);
    assert.equal((await call(`${api}/media/seam-1-resume`)).status, 200);
    assert.ok([400, 404, 405].includes((await call(`${api}/media/..%2f..%2fcoordinator.db`)).status)); // rejected, never served
    const accept = await call(`${api}/review`, 'POST', { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: allAcks(v.review), idempotencyKey: key(43) }, { 'x-studio-csrf': csrf });
    assert.equal(accept.status, 200, JSON.stringify(accept.json)); assert.equal(accept.json.run.milestone, 'approved'); assert.equal(accept.json.readiness.productionReady, true);
    assert.equal(fs.existsSync(path.join(root, 'docs', `${f.draft.contentId}-auto`)), false); assert.equal(fs.existsSync(path.join(root, 'scripts/video/episodes', `${f.draft.contentId}-auto.json`)), false);
  } finally { await new Promise(r => { server.close(r); server.closeAllConnections(); }); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});

test('service promotion (enabled only for this test, into a TEMPORARY fake repo): fresh approval + one-time challenge + acknowledgements; never a freeze', async () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fake-repo-'));
  for (const d of ['scripts/video/episodes', 'scripts/video/narration/alignment', 'docs', 'outputs']) fs.mkdirSync(path.join(fake, d), { recursive: true });
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS, promotion: { enabled: true, root: fake } });
  try {
    await toVoice(s);
    let v = s.service.view(s.id);
    assert.throws(() => s.service.promotionPreview(s.id), e => e.status === 409); // not approved yet
    v = s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: allAcks(v.review), idempotencyKey: key(60) });
    assert.equal(v.readiness.canPromote, true);
    const p = s.service.promotionPreview(s.id);
    assert.equal(p.preview.ok, true, JSON.stringify(p.preview.problems)); assert.ok(p.preview.targets.every(t => t.action === 'create'));
    assert.throws(() => s.service.promote(s.id, { bundleHash: p.bundleHash, challenge: p.challenge.challenge, acknowledgements: { notAtomic: true } }), /原子/);
    const r = s.service.promote(s.id, { bundleHash: p.bundleHash, challenge: p.challenge.challenge, acknowledgements: { notAtomic: true, notFreeze: true } });
    assert.equal(r.state, 'COMMITTED');
    assert.ok(fs.existsSync(path.join(fake, 'docs', `${s.f.draft.contentId}-auto`, 'studio-publication.json')));
    assert.equal(fs.existsSync(path.join(fake, 'docs', `${s.f.draft.contentId}-auto`, 'FROZEN.json')), false);
    assert.throws(() => s.service.promote(s.id, { bundleHash: p.bundleHash, challenge: p.challenge.challenge, acknowledgements: { notAtomic: true, notFreeze: true } }), e => e.status === 409); // challenge is single-use
    assert.equal(fs.existsSync(path.join(root, 'docs', `${s.f.draft.contentId}-auto`)), false); // the real repository is untouched
  } finally { s.close(); fs.rmSync(fake, { recursive: true, force: true }); }
});
