// REVIEW ONLY. Temporary candidates and mock provider; never modifies production behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ACK, key, FAKE_STEPS } from './test-support.mjs';
import { jsonHash, fileEvidence } from './hashing.mjs';
import { confirmReceipt } from './paid-voice.mjs';
const rewrite = (f, b) => { fs.chmodSync(f, 0o666); fs.writeFileSync(f, b); };
const acks = r => ({ seams: Object.fromEntries(r.seams.map(s => [s.id, true])), visual: Object.fromEntries(r.visualChecklist.map(s => [s.id, true])), warnings: Object.fromEntries(r.warnings.map(s => [s.id, true])) });

test('REVIEW P0-1: tamper after receipt commit but before first dispatch blocks with zero requests', async () => {
  const s = setup();
  try {
    const p = await s.preview(), db = s.service.coordinator, run = db.run2B(p.run.runId), c = s.service.candidate(run), env = c.readJson(run.inputs.envelopes[0]);
    confirmReceipt(db, { run, envelope: env, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: key(202), acknowledgements: ACK, expectedBudget: env.budget });
    const f = path.join(c.dir, 'engine/scripts/video/voice/elevenlabs.mjs'); rewrite(f, fs.readFileSync(f, 'utf8') + '\n// after confirmation, before dispatch\n');
    assert.throws(() => s.service.resumeVoice(s.id, run.run_id), e => e.status === 409);
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('REVIEW P0-1: missing closure file and self-consistent snapshot substitution cannot change the DB trust root', async () => {
  for (const mode of ['missing', 'substitution']) {
    const s = setup();
    try {
      const p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), trusted = jsonHash(run.inputs.bindings.engine);
      const f = path.join(c.dir, 'engine/scripts/video/assemble.mjs');
      const snapshotFile = path.join(c.dir, 'inputs/engine-manifest.json'), snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
      if (mode === 'missing') { fs.chmodSync(f, 0o666); fs.unlinkSync(f); snapshot.files = snapshot.files.filter(x => x.path !== 'scripts/video/assemble.mjs'); }
      else { rewrite(f, fs.readFileSync(f, 'utf8') + '\n// independently altered\n'); Object.assign(snapshot.files.find(x => x.path === 'scripts/video/assemble.mjs'), fileEvidence(f)); }
      snapshot.hash = jsonHash(snapshot.files); rewrite(snapshotFile, JSON.stringify(snapshot));
      s.service.close(); s.service = s.open();
      assert.equal(jsonHash(s.service.coordinator.run2B(run.run_id).inputs.bindings.engine), trusted);
      await assert.rejects(s.confirm(p), e => e.status === 409); assert.equal(s.provider.calls.length, 0);
    } finally { s.close(); }
  }
});

for (const role of ['narration', 'manifest', 'session', 'bundle']) test(`REVIEW restore state: changed ${role} revokes approval and returns structured readiness after restart`, async () => {
    const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
    try {
      const p = await s.preview(); await s.confirm(p); await s.service.idle();
      let v = s.service.view(s.id); s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(201) });
      const run = s.service.coordinator.run2B(v.run.runId), out = s.service.chain(run), c = s.service.candidate(run);
      const ref = role === 'narration' ? run.inputs.inputRefs.narration : role === 'manifest' ? out.assemble.result.outputs.find(x => x.role === role) : out.review.result.outputs.find(x => x.role === role);
      rewrite(path.join(c.dir, ref.path), fs.readFileSync(path.join(c.dir, ref.path), 'utf8') + ' ');
      s.service.close(); s.service = s.open(); v = s.service.view(s.id);
      assert.equal(v.readiness.productionReady, false, role); assert.equal(v.readiness.canPromote, false); assert.notEqual(v.run.milestone, 'approved');
      assert.equal(s.service.coordinator.get("SELECT COUNT(*) n FROM reviews WHERE status = 'accepted'").n, 0);
      if (['narration', 'manifest'].includes(role)) assert.throws(() => s.service.media(s.id, 'final'), e => e.status === 404);
    } finally { s.close(); }
});

for (const kind of ['audio', 'alignment']) test(`REVIEW safety: partial-success ${kind} is hash-checked before resume dispatch, even before voiceBundle exists`, async () => {
    const s = setup({ behavior: call => call.n === 2 ? { status: 500 } : null });
    try {
      const p = await s.preview(); await s.confirm(p); await s.service.idle();
      const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), execution = s.service.view(s.id).executions[0];
      const success = execution.attempts.find(a => a.status === 'succeeded'); assert.ok(success); assert.equal(s.service.chain(run).voice, undefined);
      const f = path.join(c.dir, 'voice/sealed', success.segmentHash + (kind === 'audio' ? '.mp3' : '.json'));
      rewrite(f, kind === 'audio' ? Buffer.concat([fs.readFileSync(f), Buffer.from([0])]) : JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), reviewOnlyChanged: true }));
      const before = s.provider.calls.length; s.service.close(); s.service = s.open();
      try { s.service.resumeVoice(s.id, run.run_id); await s.service.idle(); } catch { /* desired fail closed */ }
      const v = s.service.view(s.id);
      assert.equal(s.provider.calls.length - before, 0, `${kind}: partial pair drift must stop remaining requests; actual milestone=${v.run.milestone}`);
      assert.notEqual(v.run.milestone, 'voice_generated');
    } finally { s.close(); }
});

test('REVIEW secret boundary: provider error echo must not persist the dummy credential in artifacts/ledger', async () => {
  const dummy = 'test-key-not-real';
  const s = setup({ behavior: () => ({ status: 500, body: JSON.stringify({ detail: { message: `echo ${dummy}` } }) }) });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 1);
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), dir = path.join(c.dir, 'voice/responses');
    const rawArtifacts = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(!JSON.stringify(s.service.view(s.id)).includes(dummy), 'ledger/UI must be scrubbed');
    assert.ok(rawArtifacts.every(raw => !raw.includes(dummy)), 'saved provider response must also be scrubbed');
  } finally { s.close(); }
});
