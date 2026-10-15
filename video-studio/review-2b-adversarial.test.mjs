// REVIEW ONLY: independent safety expectations. Failing assertions document findings;
// do not change production code to make this review pass. All providers are mocks,
// all state/candidate changes are temporary, and local media steps are fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setup, ACK, key, FAKE_STEPS } from './test-support.mjs';
import { confirmReceipt, executeVoice, recoverLedger } from './paid-voice.mjs';
import { fileEvidence, jsonHash } from './hashing.mjs';
import os from 'node:os';
import { Coordinator } from './coordinator.mjs';
import { promote, recoverPublications, publicationGateOpen } from './promotion.mjs';
import { auditFrames } from './camera-solver.mjs';
import { VISUAL_POLICY } from './production-decisions.mjs';

const rewrite = (file, bytes) => { fs.chmodSync(file, 0o666); fs.writeFileSync(file, bytes); };
const acks = r => ({ seams: Object.fromEntries(r.seams.map(s => [s.id, true])), visual: Object.fromEntries(r.visualChecklist.map(s => [s.id, true])), warnings: Object.fromEntries(r.warnings.map(s => [s.id, true])) });

test('REVIEW safety: copied engine manifest cannot authorize modified pipeline code', async () => {
  const s = setup();
  try {
    const p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    const file = path.join(c.dir, 'engine/scripts/video/assemble.mjs');
    rewrite(file, fs.readFileSync(file, 'utf8') + '\n// review-only altered pipeline copy\n');
    // 2B.1: c.engine() now returns the trusted record from the run row, so tamper the snapshot's own manifest FILE directly.
    const manifestFile = path.join(c.dir, 'inputs/engine-manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    Object.assign(manifest.files.find(f => f.path === 'scripts/video/assemble.mjs'), fileEvidence(file));
    // Retain the original root hash: it must be independently recomputed/verified, not trusted.
    rewrite(manifestFile, JSON.stringify(manifest));
    let rejected = false;
    try { await s.confirm(p); await s.service.idle(); } catch { rejected = true; }
    // 2B.1 (inverted from the review's bug evidence): the altered copy can no longer be materialized for execution at all.
    assert.throws(() => c.attemptRoot('review-only', randomUUID()), /Pipeline 副本被修改/);
    assert.equal(s.provider.calls.length, 0, 'modified execution closure must block BEFORE paid requests');
    assert.ok(rejected || s.service.view(s.id).run.state === 'stale');
  } finally { s.close(); }
});

test('REVIEW safety: pinned cache drift in flight stops the NEXT paid request', async () => {
  let s, tamper;
  s = setup({ behavior: call => { if (tamper) { const f = tamper; tamper = null; rewrite(f, Buffer.concat([fs.readFileSync(f), Buffer.from([0])])); } return null; } });
  try {
    let p = await s.preview(); await s.confirm(p); await s.service.idle();
    const d = s.store.get(s.id);
    d.decisions.hook.text = 'The class starts right now.';
    d.decisions.meaningSpeech = { allocate: '分配，這個詞的中文意思。' };
    d.revision++; s.store.persist(d); s.wf.run(s.id, { revision: d.revision });
    p = await s.preview();
    assert.equal(p.envelope.requests.length, 2); assert.ok(p.envelope.pinned.length);
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    const env = c.readJson(run.inputs.envelopes.at(-1)); tamper = path.join(c.dir, env.pinned[0].audio.path);
    const before = s.provider.calls.length;
    await s.confirm(p, key(101)); await s.service.idle();
    assert.equal(s.provider.calls.length - before, 1, 'after the first response changes a confirmed hit, no second request may be dispatched');
  } finally { s.close(); }
});

test('REVIEW safety: receipt content checksum is enforced before dispatch', async () => {
  const s = setup();
  try {
    const p = await s.preview(), db = s.service.coordinator, run = db.run2B(p.run.runId), c = s.service.candidate(run), envelope = c.readJson(run.inputs.envelopes[0]);
    const issued = confirmReceipt(db, { run, envelope, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: key(102), acknowledgements: ACK, expectedBudget: envelope.budget });
    const changed = { ...issued.receipt.receipt, budget: { ...envelope.budget, maxRequests: 99 } };
    db.run('UPDATE receipts SET receipt = ? WHERE receipt_id = ?', JSON.stringify(changed), issued.receipt.receipt_id);
    try { await executeVoice({ coordinator: db, candidate: c, voiceStore: s.service.voiceStore, executionId: issued.execution.execution_id, freshness: () => s.service.assertFresh(run.run_id), fetchImpl: s.provider.fetchImpl, apiKey: () => 'mock-only', voiceConfig: s.service.voiceConfig(run), narration: c.readJson(run.inputs.inputRefs.narration), envelope }); } catch { /* expected fail closed */ }
    assert.equal(s.provider.calls.length, 0, 'receiptHash must protect the confirmed receipt content');
  } finally { s.close(); }
});

test('REVIEW safety: regenerated audit invalidates an old accepted bundle even when downstream media hashes match', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    v = s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(103) });
    const oldBundle = v.review.bundleHash, run = s.service.coordinator.run2B(v.run.runId), audit = s.service.chain(run).audit.result.outputs.find(o => o.role === 'layoutAudit');
    rewrite(path.join(s.service.candidate(run).dir, audit.path), 'review-only corrupted old audit');
    v = s.service.view(s.id); assert.equal(v.readiness.productionReady, false);
    s.service.resume(s.id, run.run_id); await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'awaiting_human_review', 'old approval must not be resurrected as the effective milestone');
    assert.notEqual(v.review.bundleHash, oldBundle, 'the current bundle must contain the new audit artifact/evidence');
    assert.equal(v.review.status, 'open');
  } finally { s.close(); }
});

test('REVIEW safety: orphan durable response before ledger attachment becomes unknown, never retried', async () => {
  const s = setup();
  try {
    const p = await s.preview(), db = s.service.coordinator, run = db.run2B(p.run.runId), c = s.service.candidate(run), env = c.readJson(run.inputs.envelopes[0]);
    const { execution } = confirmReceipt(db, { run, envelope: env, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: key(104), acknowledgements: ACK, expectedBudget: env.budget });
    const r = env.requests[0];
    db.run('INSERT INTO attempts (execution_id,segment_hash,attempt_no,status,reserved_chars,body_hash,intent_at,network_attempted,response_ref) VALUES (?,?,1,?,?,?,?,1,?)', execution.execution_id, r.segmentHash, 'dispatch_intent', r.chars, r.requestBodyHash, new Date().toISOString(), JSON.stringify({ attemptId: 'orphan-response' }));
    fs.mkdirSync(path.join(c.dir, 'voice/responses'), { recursive: true }); fs.writeFileSync(path.join(c.dir, 'voice/responses/orphan-response.json'), '{"status":200,"raw":"response received before DB attachment"}');
    recoverLedger(db, () => c.dir);
    assert.equal(db.attempts(execution.execution_id)[0].status, 'unknown');
    assert.throws(() => s.service.resumeVoice(s.id, run.run_id));
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('REVIEW safety: receipt expiry is checked again before each request', async () => {
  let realNow = Date.now, expireAfterFirst = false;
  const s = setup({ behavior: () => { if (expireAfterFirst) { expireAfterFirst = false; Date.now = () => realNow() + 60 * 60 * 1000; } return null; } });
  try {
    const p = await s.preview(); expireAfterFirst = true;
    await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 1, 'an expired receipt must not submit the remaining requests');
  } finally { Date.now = realNow; s.close(); }
});

test('REVIEW safety: changing a nested voice artifact invalidates current human approval', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    v = s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(105) });
    const run = s.service.coordinator.run2B(v.run.runId), c = s.service.candidate(run), voice = s.service.chain(run).voice;
    const b = c.readJson(voice.result.outputs.find(o => o.role === 'voiceBundle'));
    rewrite(path.join(c.dir, b.pairs[0].alignment.path), '{"review-only":"changed nested alignment"}');
    v = s.service.view(s.id);
    assert.equal(v.readiness.productionReady, false, 'voice bundle integrity must include its nested MP3/alignment refs');
    assert.notEqual(v.run.milestone, 'approved');
  } finally { s.close(); }
});

test('REVIEW safety: concurrent review decisions and substituted final MP4 are refused', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const v = s.service.view(s.id), body = { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review) };
    s.service.decideReview(s.id, { ...body, idempotencyKey: key(106) });
    assert.throws(() => s.service.decideReview(s.id, { ...body, idempotencyKey: key(107) }), e => e.status === 409);
    assert.equal(s.service.coordinator.get("SELECT COUNT(*) n FROM reviews WHERE status='accepted'").n, 1);
    const media = s.service.media(s.id, 'final'); rewrite(media.file, 'review-only substituted final MP4');
    assert.equal(s.service.view(s.id).readiness.productionReady, false);
    assert.throws(() => s.service.media(s.id, 'final'), e => e.status === 404);
  } finally { s.close(); }
});

test('REVIEW post-P6 safety: incomplete commit marker cannot roll a missing publication forward', { todo: 'R2B-07 is P2 (post-P6 publication blocker); deferred by 2B.1 scope – promotion stays disabled. Assertion unchanged.' }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-review-publication-')), repo = path.join(base, 'fake-repo'), state = path.join(base, 'state');
  fs.mkdirSync(path.join(repo, 'docs/demo-auto'), { recursive: true }); fs.mkdirSync(state);
  const db = new Coordinator(state);
  try {
    const source = path.join(base, 'source.json'); fs.writeFileSync(source, '{"review-only":true}');
    const manifest = { candidateId: randomUUID(), contentId: 'demo', artifacts: [{ canonical: 'docs/demo-auto/verification.json', path: source, ...fileEvidence(source) }] };
    assert.throws(() => promote({ coordinator: db, root: repo, stagingRoot: path.join(state, 'promotion'), lockDir: path.join(state, 'locks'), manifest, approval: { receiptHash: 'review-only' }, source: a => a.path, fresh: () => {}, faults: { at: 'committed-before-db' } }), /fault injected/);
    const markerFile = path.join(repo, 'docs/demo-auto/studio-publication.json'), marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    marker.files = []; fs.writeFileSync(markerFile, JSON.stringify(marker)); fs.unlinkSync(path.join(repo, 'docs/demo-auto/verification.json'));
    const result = recoverPublications({ coordinator: db, root: repo, lockDir: path.join(state, 'locks') });
    assert.equal(result[0].state, 'BROKEN', 'recovery must compare the marker with the complete journal target set');
    assert.equal(publicationGateOpen(db).open, false);
  } finally { db.close(); fs.rmSync(base, { recursive: true, force: true }); }
});

test('REVIEW visual policy: backward motion after a stationary frame is still detected', { todo: 'R2B-08 is P2 (visual gate coverage, P6 calibration); deferred by 2B.1 scope – human visual gate stays required. Assertion unchanged.' }, () => {
  const episode = { hook: { id: 'hook', reveal: { line: 'h', word: 'starts' } }, scrollDuration: 0.35, story: [{ id: 's', parts: [{ type: 'reading', line: 'l' }] }], vocabulary: [], quiz: { id: 'quiz', questionLine: 'q', answerLine: 'a' } };
  const plan = { duration: 3, lines: [{ id: 'h', start: 0, end: 0.5, words: [{ text: 'starts', at: 0 }] }, { id: 'l', start: 0.5, end: 2, words: [{ text: 'story', at: 0 }] }, { id: 'q', start: 2.1, end: 2.5, silent: true, words: [] }, { id: 'a', start: 2.7, end: 3, silent: true, words: [] }] };
  const samples = Array.from({ length: 90 }, (_, i) => ({ i, t: i / 30, T: i < 20 ? 100 : i < 26 ? 100 - (i - 19) * 10 : 40, view: [0, 1024], sec: { hook: 0, s: 200, quiz: 300 }, opacity: { quiz: i >= 63 ? 1 : 0 }, active: [], keys: [], lines: {}, notes: {}, hook: [], quiz: { question: [350, 400], options: [450, 550], feedback: [600, 650], feedbackOpacity: i >= 81 ? 1 : 0 }, contentBottom: 900, mascot: null, issues: [] }));
  const report = auditFrames({ episode, plan, policy: VISUAL_POLICY, geometry: { env: { duration: 3, start: Infinity }, refs: [], frames: 90, samples, coverageHash: 'review-only', parity: [{ frame: 0, same: true }] } });
  assert.ok(report.hard.some(h => h.code === 'CAMERA_REVERSAL'), 'stationary → sustained backwards motion must not pass the no-reversal gate');
});

test('REVIEW recovery: issued receipt survives restart with a safe way to start the SAME execution', async () => {
  const s = setup();
  try {
    const p = await s.preview(), db = s.service.coordinator, run = db.run2B(p.run.runId), c = s.service.candidate(run), env = c.readJson(run.inputs.envelopes[0]);
    const issued = confirmReceipt(db, { run, envelope: env, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: key(108), acknowledgements: ACK, expectedBudget: env.budget });
    // Simulate crash immediately after durable confirmation, before startVoice/claim.
    s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).executions[0].status, 'issued');
    const replay = await s.confirm(p, key(108)); assert.equal(replay.executionId, issued.execution.execution_id);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 0, 'replayed confirmation currently does not schedule the issued execution');
    assert.doesNotThrow(() => s.service.resumeVoice(s.id, run.run_id), 'an issued-but-never-dispatched execution must be resumable without a new receipt');
    await s.service.idle(); assert.equal(s.provider.calls.length, 4);
    assert.equal(s.service.view(s.id).executions.length, 1);
  } finally { await s.service.idle(); s.close(); }
});
