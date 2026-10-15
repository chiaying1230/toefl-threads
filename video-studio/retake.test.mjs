import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, FAKE_STEPS, key } from './test-support.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { buildRequest } from '../scripts/video/voice/elevenlabs.mjs';
import { jsonHash, fileEvidence } from './hashing.mjs';

async function base() {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  const p = await s.preview(); await s.confirm(p); await s.service.idle();
  const v = s.service.view(s.id); assert.equal(v.run.state, 'awaiting_review');
  s.old = v; s.calls = s.provider.calls.length;
  s.retake = () => s.service.retake(s.id, { baseRunId: v.run.runId, segmentId: 'v1Meaning', revision: s.store.get(s.id).revision, reject: true, reason: 'human pronunciation rejected' });
  return s;
}

test('compiler explicit language → body/hash/evidence; missing language BLOCK; silent has no request; no text inference', async () => {
  const s = setup();
  try {
    const n = s.wf.read(s.store.get(s.id), 'narration'), cfg = JSON.parse(fs.readFileSync('scripts/video/voices.json'));
    const p = prepareNarration(n, cfg, { requireApiKey: false, env: {} });
    for (const seg of p.segments.filter(s => !s.silent)) {
      const body = buildRequest({ voice: seg.voice, text: seg.speak }).body;
      assert.equal(body.language_code, seg.kind === 'meaning' ? 'zh' : 'en');
    }
    const legacy = structuredClone(n); delete legacy.requestContract;
    for (const seg of legacy.segments) delete seg.language;
    assert.notEqual(p.segments[0].hash, prepareNarration(legacy, cfg, { requireApiKey: false, env: {} }).segments[0].hash);
    const missing = structuredClone(n); delete missing.segments[0].language;
    assert.throws(() => prepareNarration(missing, cfg, { requireApiKey: false, env: {} }), /explicit segment language/);
    const env = (await s.preview()).envelope;
    assert.equal(env.counts.silent, 2); assert.ok(env.requests.every(r => r.requestBody.language_code === r.languageCode));
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('human reject → immutable single retake → new receipt → generated but inactive → explicit selection → full new review', async () => {
  const s = await base();
  try {
    const oldRun = s.service.coordinator.run2B(s.old.run.runId), old = s.service.candidate(oldRun);
    const pairs = old.readJson(s.service.chain(oldRun).voice.result.outputs[0]).pairs;
    const before = pairs.map(p => [fileEvidence(old.verify(p.audio)), fileEvidence(old.verify(p.alignment))]);
    const r = await s.retake();
    assert.equal(r.run.state, 'awaiting_confirmation'); assert.equal(r.envelope.requests.length, 1);
    assert.equal(r.envelope.requests[0].languageCode, 'zh'); assert.equal(r.envelope.counts.hit, s.calls - 1);
    assert.equal(r.envelope.retake.rejected.status, 'human_rejected');
    assert.notEqual(r.envelope.requests[0].segmentHash, r.envelope.retake.rejected.hash);
    assert.equal(s.provider.calls.length, s.calls); assert.equal(r.readiness.productionReady, false);
    assert.equal(r.steps.length, 0); assert.equal(r.review, null);
    assert.throws(() => s.service.resume(s.id, r.run.runId), /語音尚未完成/);
    const again = await s.retake(); assert.equal(again.run.runId, r.run.runId);
    await s.confirm(r, key(222)); await s.service.idle();
    const generated = s.service.view(s.id);
    assert.equal(generated.run.state, 'awaiting_take_selection'); assert.equal(s.provider.calls.length, s.calls + 1);
    assert.equal(s.provider.calls.at(-1).body.language_code, 'zh');
    assert.equal(generated.readiness.canRender, false); assert.equal(generated.review, null);
    const row = s.service.coordinator.get('SELECT receipt FROM receipts ORDER BY created_at DESC').receipt;
    assert.equal(JSON.parse(row).requests[0].languageCode, 'zh');
    s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).run.state, 'awaiting_take_selection'); assert.equal(s.provider.calls.length, s.calls + 1);
    await s.service.selectTake(s.id, { runId: r.run.runId, takeId: r.envelope.retake.takeId }); await s.service.idle();
    const v = s.service.view(s.id);
    assert.equal(v.run.state, 'awaiting_review'); assert.notEqual(v.review.bundleHash, s.old.review.bundleHash);
    assert.equal(v.review.status, 'open'); assert.equal(v.readiness.productionReady, false);
    assert.ok(v.steps.filter(s => s.current).length === 8);
    assert.deepEqual(pairs.map(p => [fileEvidence(old.verify(p.audio)), fileEvidence(old.verify(p.alignment))]), before);
    assert.equal(s.provider.calls.length, s.calls + 1);
    await s.service.selectTake(s.id, { runId: r.run.runId, takeId: r.envelope.retake.takeId });
    assert.equal(s.provider.calls.length, s.calls + 1);
    assert.equal(s.service.coordinator.run2B(oldRun.run_id).state, 'stale');
    assert.throws(() => s.service.decideReview(s.id, { runId: oldRun.run_id, bundleHash: s.old.review.bundleHash, decision: 'accept', idempotencyKey: key(223) }), /失效/);
  } finally { s.close(); }
});

for (const mode of ['reuse-audio', 'old-alignment', 'snapshot', 'language', 'source', 'decision']) test(`retake ${mode} tamper/stale → no request / approval / automatic healing`, async () => {
  const s = await base();
  try {
    const r = await s.retake(), run = s.service.coordinator.run2B(r.run.runId);
    const candidate = s.service.candidate(run);
    if (mode === 'snapshot') s.service.coordinator.run("UPDATE retakes SET snapshot = '{}' WHERE take_id = ?", r.envelope.retake.takeId);
    else if (mode === 'source') s.f.record.sourceHash = 'changed';
    else if (mode === 'decision') { const d = s.store.get(s.id); d.decisions.hook.text += ' Changed.'; s.store.persist(d); }
    else {
      const env = candidate.readJson(run.inputs.envelopes[0]);
      const snapshot = JSON.parse(s.service.coordinator.get('SELECT snapshot FROM retakes WHERE take_id = ?', r.envelope.retake.takeId).snapshot);
      let file = mode === 'reuse-audio' ? candidate.abs(env.pinned[0].audio.path) : mode === 'language' ? candidate.abs(run.inputs.inputRefs.narration.path) : s.service.candidate(s.service.coordinator.run2B(s.old.run.runId)).abs(snapshot.reuse[0].alignment.path);
      fs.chmodSync(file, 0o666); fs.appendFileSync(file, ' ');
    }
    await assert.rejects(s.confirm(r, key(333)), /失效/);
    assert.equal(s.provider.calls.length, s.calls);
    assert.equal(s.service.view(s.id).readiness.productionReady, false);
    s.service.close(); s.service = s.open();
    assert.equal(s.provider.calls.length, s.calls); assert.equal(s.service.view(s.id).run.state, 'stale');
  } finally { s.close(); }
});

test('restart pending preview, duplicate confirmation and post-selection crash resume never buy another take', async () => {
  const s = await base();
  try {
    const r = await s.retake();
    s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).run.state, 'awaiting_confirmation');
    const preview = await s.preview(); assert.equal(preview.run.runId, r.run.runId); assert.equal(preview.envelope.budget.maxRequests, 1);
    await Promise.all([s.confirm(preview, key(444)), s.confirm(preview, key(444))]); await s.service.idle();
    assert.equal(s.provider.calls.length, s.calls + 1);
    // Simulate a crash AFTER selection commits but BEFORE local bundle execution.
    const realStep = s.service.runStep.bind(s.service);
    s.service.runStep = async () => { throw Error('test crash before free bundle'); };
    await assert.rejects(s.service.selectTake(s.id, { runId: r.run.runId, takeId: r.envelope.retake.takeId }), /test crash/);
    s.service.runStep = realStep; s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).run.state, 'awaiting_take_selection');
    assert.equal(s.provider.calls.length, s.calls + 1);
    await s.service.selectTake(s.id, { runId: r.run.runId, takeId: r.envelope.retake.takeId }); await s.service.idle();
    assert.equal(s.service.view(s.id).run.state, 'awaiting_review'); assert.equal(s.provider.calls.length, s.calls + 1);
  } finally { s.close(); }
});

test('failed retake: one mock request; GET/restart/resume never automatically resend', async () => {
  const s = await base();
  try {
    const r = await s.retake(), realFetch = s.service.fetchImpl;
    s.service.fetchImpl = async (...args) => { await realFetch(...args); return new Response('{}', { status: 500 }); };
    await s.confirm(r, key(555)); await s.service.idle(); assert.equal(s.provider.calls.length, s.calls + 1);
    assert.notEqual(s.service.view(s.id).run.state, 'awaiting_take_selection');
    s.service.close(); s.service = s.open();
    assert.equal(s.provider.calls.length, s.calls + 1);
    s.service.resumeVoice(s.id, r.run.runId); await s.service.idle();
    assert.equal(s.provider.calls.length, s.calls + 1); assert.equal(s.service.view(s.id).readiness.productionReady, false);
  } finally { s.close(); }
});
