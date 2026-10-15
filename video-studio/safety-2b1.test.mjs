// 2B.1 regression tests for the P0 / P1 fixes (REVIEW-2B.md R2B-01…06, 09). Mock provider only; temporary state only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, ACK, key, FAKE_STEPS } from './test-support.mjs';
import { confirmReceipt } from './paid-voice.mjs';
import { fileEvidence, jsonHash } from './hashing.mjs';

const rewrite = (file, bytes) => { fs.chmodSync(file, 0o666); fs.writeFileSync(file, bytes); };
const acks = r => ({ seams: Object.fromEntries(r.seams.map(s => [s.id, true])), visual: Object.fromEntries(r.visualChecklist.map(s => [s.id, true])), warnings: Object.fromEntries(r.warnings.map(s => [s.id, true])) });
const issue = (s, p, k) => { const db = s.service.coordinator, run = db.run2B(p.run.runId), env = s.service.candidate(run).readJson(run.inputs.envelopes[0]); return confirmReceipt(db, { run, envelope: env, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: k, acknowledgements: ACK, expectedBudget: env.budget }); };

test('P0-1: a fully self-consistent edit of the copied code AND its snapshot manifest still BLOCKs (0 requests, also after restart)', async () => {
  const s = setup();
  try {
    const p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    const file = path.join(c.dir, 'engine/scripts/video/voice/elevenlabs.mjs');
    rewrite(file, fs.readFileSync(file, 'utf8') + '\n// altered request client\n');
    const manifestFile = path.join(c.dir, 'inputs/engine-manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    Object.assign(manifest.files.find(f => f.path === 'scripts/video/voice/elevenlabs.mjs'), fileEvidence(file));
    manifest.hash = jsonHash(manifest.files); // the snapshot is internally consistent – it must still not be the authority
    rewrite(manifestFile, JSON.stringify(manifest));
    await assert.rejects(s.confirm(p), e => e.status === 409);
    s.service.close(); s.service = s.open(); // restore re-verifies against the trusted record outside the snapshot
    const v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.ok(v.run.reason.some(r => r.code === 'PIPELINE_COPY_CHANGED'));
    assert.throws(() => s.service.candidate(run).attemptRoot('anything', '00000000-0000-0000-0000-00000000000a'), /Pipeline 副本被修改/);
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('P0-1: an extra file in the copied closure, or a changed voices.json copy, BLOCKs before execution', async () => {
  const s = setup();
  try {
    let p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    fs.writeFileSync(path.join(c.dir, 'engine/scripts/video/extra-tool.mjs'), 'process.exit(0)');
    await assert.rejects(s.confirm(p), e => e.status === 409);
    assert.match(JSON.stringify(s.service.view(s.id).run.reason), /檔案集合/);
    p = await s.preview(); run = s.service.coordinator.run2B(p.run.runId); c = s.service.candidate(run);
    const voices = path.join(c.dir, 'engine/scripts/video/voices.json');
    rewrite(voices, fs.readFileSync(voices, 'utf8').replace('"stability": 0', '"stability": 1'));
    assert.throws(() => s.service.voiceConfig(run), /Pipeline 副本被修改/);
    await assert.rejects(s.confirm(p, key(2)), e => e.status === 409);
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('P0-1: the closure is re-verified before every downstream local step (no step runs on an altered copy)', async () => {
  let ran = 0;
  const s = setup({ autoChain: false, localSteps: { ...FAKE_STEPS, assembleStep: async (...x) => { ran++; return FAKE_STEPS.assembleStep(...x); } } });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    const file = path.join(c.dir, 'engine/scripts/video/render-episode.mjs'); rewrite(file, fs.readFileSync(file, 'utf8') + '\n// altered\n');
    assert.throws(() => s.service.resume(s.id, run.run_id), e => e.status === 409);
    assert.equal(ran, 0); assert.equal(s.service.coordinator.all("SELECT * FROM steps WHERE step = 'assemble'").length, 0);
  } finally { s.close(); }
});

test('P0-2: a nested alignment / MP3 change invalidates approval, readiness, media and promotion – also after restart', async () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-2b1-fake-repo-'));
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS, promotion: { enabled: true, root: fake } });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    v = s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(10) });
    assert.equal(v.readiness.productionReady, true);
    const run = s.service.coordinator.run2B(v.run.runId), c = s.service.candidate(run), b = c.readJson(s.service.chain(run).voice.result.outputs[0]);
    const mp3 = path.join(c.dir, b.pairs[1].audio.path); rewrite(mp3, Buffer.concat([fs.readFileSync(mp3), Buffer.from([1])]));
    s.service.close(); s.service = s.open();
    v = s.service.view(s.id);
    assert.equal(v.readiness.productionReady, false); assert.notEqual(v.run.milestone, 'approved'); assert.equal(v.run.state, 'stale');
    assert.ok(v.run.reason.some(r => r.code === 'VOICE_EVIDENCE_CHANGED'));
    assert.equal(s.service.coordinator.get("SELECT COUNT(*) n FROM reviews WHERE status = 'accepted'").n, 0);
    assert.throws(() => s.service.media(s.id, 'final'), e => e.status === 404);
    assert.throws(() => s.service.promotionPreview(s.id), e => e.status === 409);
  } finally { s.close(); fs.rmSync(fake, { recursive: true, force: true }); }
});

test('R2B-06: any change of included evidence produces a new bundle and a new open review; the old acceptance never returns', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    v = s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(11) });
    const old = v.review.bundleHash, run = s.service.coordinator.run2B(v.run.runId), plan = s.service.chain(run).assemble.result.outputs.find(o => o.role === 'assembly');
    rewrite(path.join(s.service.candidate(run).dir, plan.path), '{"changed":"assembly evidence"}');
    v = s.service.view(s.id);
    assert.equal(v.readiness.productionReady, false); assert.equal(v.run.state, 'failed'); assert.ok(v.run.reason.some(r => r.code === 'APPROVAL_INVALIDATED'));
    s.service.resume(s.id, run.run_id); await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'awaiting_human_review'); assert.notEqual(v.review.bundleHash, old); assert.equal(v.review.status, 'open');
    assert.throws(() => s.service.decideReview(s.id, { runId: run.run_id, bundleHash: old, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(12) }), e => e.status === 409);
  } finally { s.close(); }
});

test('R2B-04/05: tampered or expired receipts are refused at restore, resume and replay – 0 requests; recovery is an explicit new confirmation', async () => {
  const realNow = Date.now;
  const s = setup();
  try {
    let p = await s.preview();
    const issued = issue(s, p, key(20));
    s.service.close();
    Date.now = () => realNow() + 60 * 60 * 1000; // restart an hour later: the issued receipt has expired
    s.service = s.open();
    let v = s.service.view(s.id);
    assert.equal(v.executions[0].status, 'expired'); assert.equal(v.executions[0].receiptStatus, 'expired');
    assert.throws(() => s.service.resumeVoice(s.id, v.run.runId), e => e.status === 409);
    assert.equal(s.provider.calls.length, 0);
    const r = await s.preview({ recoveryRunId: v.run.runId });
    assert.equal(r.envelope.recovery.warning, null); // nothing ever reached the provider: no double-charge warning, but a NEW confirmation
    await s.confirm(r, key(21)); await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_generated'); assert.equal(s.provider.calls.length, 4); assert.equal(v.executions.length, 2);
    assert.notEqual(v.executions[1].executionId, issued.execution.execution_id);
  } finally { Date.now = realNow; s.close(); }
  const t = setup();
  try {
    const p = await t.preview(), issued = issue(t, p, key(22)), db = t.service.coordinator;
    const content = JSON.parse(db.get('SELECT receipt FROM receipts WHERE receipt_id = ?', issued.receipt.receipt_id).receipt);
    db.run('UPDATE receipts SET receipt = ? WHERE receipt_id = ?', JSON.stringify({ ...content, estimatedUniqueTextChars: 1 }), issued.receipt.receipt_id);
    await assert.rejects(t.confirm(p, key(22)), e => e.code === 'RECEIPT_TAMPERED'); // idempotent replay re-verifies
    t.service.close(); t.service = t.open();
    assert.equal(t.service.view(t.id).executions[0].status, 'blocked');
    assert.throws(() => t.service.resumeVoice(t.id, p.run.runId), e => e.status === 409);
    assert.equal(t.provider.calls.length, 0);
  } finally { t.close(); }
});

test('R2B-09: an issued (never claimed) execution survives restart; resume uses the SAME receipt once, never a second execution', async () => {
  const s = setup();
  try {
    const p = await s.preview(), issued = issue(s, p, key(30));
    s.service.close(); s.service = s.open();
    let v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_confirmed'); assert.equal(v.executions[0].status, 'issued');
    s.service.resumeVoice(s.id, v.run.runId); s.service.resumeVoice(s.id, v.run.runId); // a double click
    await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(s.provider.calls.length, 4); assert.equal(v.executions.length, 1); assert.equal(v.executions[0].executionId, issued.execution.execution_id);
    assert.equal(v.run.milestone, 'voice_generated');
    assert.throws(() => s.service.resumeVoice(s.id, v.run.runId), e => e.status === 409); // completed: nothing to resume, nothing re-sent
    assert.equal(s.provider.calls.length, 4);
  } finally { s.close(); }
});

test('R2B-03: a confirmed pinned hit changing mid-execution stops the next request (it never becomes a paid miss)', async () => {
  let s, target;
  s = setup({ behavior: () => { if (target) { const f = target; target = null; rewrite(f, Buffer.concat([fs.readFileSync(f), Buffer.from([0])])); } return null; } });
  try {
    let p = await s.preview(); await s.confirm(p); await s.service.idle();
    const d = s.store.get(s.id); d.decisions.hook.text = 'The class starts right now.'; d.decisions.meaningSpeech = { allocate: '分配，這個詞的意思。' }; d.revision++; s.store.persist(d); s.wf.run(s.id, { revision: d.revision });
    p = await s.preview();
    const run = s.service.coordinator.run2B(p.run.runId), env = s.service.candidate(run).readJson(run.inputs.envelopes.at(-1));
    target = path.join(s.service.candidate(run).dir, env.pinned[0].alignment.path);
    const before = s.provider.calls.length;
    await s.confirm(p, key(40)); await s.service.idle();
    assert.equal(s.provider.calls.length - before, 1);
    const v = s.service.view(s.id);
    assert.notEqual(v.run.milestone, 'voice_generated'); assert.ok(['stale', 'blocked', 'failed'].includes(v.run.state));
  } finally { s.close(); }
});
