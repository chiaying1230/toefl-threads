// Independent REVIEW ONLY: fake credentials/providers, temporary candidates, no production changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setup, FAKE_STEPS, key } from './test-support.mjs';
import { createStudio } from './server.mjs';

const rewrite = (f, b) => { if (fs.existsSync(f)) fs.chmodSync(f, 0o666); fs.writeFileSync(f, b); };
const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? files(path.join(d, x.name)) : [path.join(d, x.name)]);
const acks = r => Object.fromEntries(['seams', 'visual', 'warnings'].map(k => [k, Object.fromEntries(r[k === 'visual' ? 'visualChecklist' : k].map(x => [x.id, true]))]));

for (const mode of ['audio-change', 'alignment-change', 'alignment-delete']) test(`FINAL N1: ${mode}, same-process read/resume and restored bytes after restart never heal partial evidence`, async () => {
  const s = setup({ behavior: c => c.n === 2 ? { status: 500 } : null });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run);
    const before = s.service.view(s.id).executions[0].attempts.find(x => x.status === 'succeeded');
    assert.ok(before); assert.equal(s.service.chain(run).voice, undefined);
    const f = path.join(c.dir, 'voice/sealed', `${before.segmentHash}.${mode.startsWith('audio') ? 'mp3' : 'json'}`), original = fs.readFileSync(f);
    if (mode.endsWith('delete')) { fs.chmodSync(f, 0o666); fs.unlinkSync(f); }
    else rewrite(f, mode.startsWith('audio') ? Buffer.concat([original, Buffer.from([7])]) : JSON.stringify({ ...JSON.parse(original), independentTamper: 1 }));
    const stale = s.service.view(s.id);
    assert.equal(stale.run.state, 'stale'); assert.equal(stale.readiness.productionReady, false);
    assert.ok(stale.run.reason.some(x => x.code === 'VOICE_EVIDENCE_CHANGED'));
    assert.throws(() => s.service.resumeVoice(s.id, run.run_id), e => e.status === 409);
    await s.service.idle(); assert.equal(s.provider.calls.length, 2);
    rewrite(f, original); // restoration before restart must not reset the durable stale state
    s.service.close(); s.service = s.open();
    const restored = s.service.view(s.id);
    assert.equal(restored.run.state, 'stale'); assert.equal(restored.readiness.productionReady, false);
    const evidence = restored.executions[0].attempts.find(x => x.segmentHash === before.segmentHash);
    assert.equal(evidence.audioHash, before.audioHash); assert.equal(evidence.alignmentHash, before.alignmentHash);
    assert.throws(() => s.service.resumeVoice(s.id, run.run_id), e => e.status === 409);
    await assert.rejects(s.preview({ recoveryRunId: run.run_id }), e => e.status === 409);
    assert.equal(s.provider.calls.length, 2);
  } finally { s.close(); }
});

test('FINAL N1: deleting partial alignment during request 2 prevents request 3 and every later dispatch', async () => {
  let s, target, original;
  s = setup({ behavior: call => {
    if (call.n === 2) {
      const r = s.service.coordinator.all('SELECT run_id FROM runs').at(-1);
      const run = s.service.coordinator.run2B(r.run_id), c = s.service.candidate(run);
      const succeeded = s.service.coordinator.all("SELECT segment_hash FROM attempts WHERE status = 'succeeded'").at(-1);
      assert.ok(succeeded);
      target = path.join(c.dir, 'voice/sealed', `${succeeded.segment_hash}.json`); original = fs.readFileSync(target);
      fs.chmodSync(target, 0o666); fs.unlinkSync(target);
    }
    return null;
  } });
  try {
    const p = await s.preview(); assert.ok(p.envelope.requests.length >= 3);
    await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 2, 'request 2 was already dispatched; request 3+ must never leave');
    const v = s.service.view(s.id); assert.equal(v.run.state, 'stale'); assert.equal(v.readiness.productionReady, false);
    assert.ok(v.run.reason.some(x => x.code === 'VOICE_EVIDENCE_CHANGED'));
    assert.equal(s.service.chain(s.service.coordinator.run2B(p.run.runId)).voice, undefined);
    rewrite(target, original); s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).run.state, 'stale');
    assert.throws(() => s.service.resumeVoice(s.id, p.run.runId), e => e.status === 409);
    assert.equal(s.provider.calls.length, 2);
  } finally { s.close(); }
});

const encoders = {
  'raw-and-base64': s => `${s} ${Buffer.from(s).toString('base64')}`,
  'json-unicode-escape': s => [...s].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  'percent-encoded-ascii': s => [...s].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
};
for (const [form, encode] of Object.entries(encoders)) test(`FINAL N2: independently generated fake credential ${form} cannot persist in body/header/state/SQLite`, async () => {
  const fake = `sk_${randomBytes(24).toString('hex')}`, encoded = encode(fake);
  // Unicode sequences are deliberately present in the *wire* JSON, not doubly escaped by JSON.stringify.
  const raw = form === 'json-unicode-escape'
    ? `{"detail":{"status":"invalid_api_key","message":"${encoded}"}}`
    : JSON.stringify({ detail: { status: 'invalid_api_key', message: encoded } });
  const s = setup({ apiKey: () => fake });
  let requests = 0;
  s.service.fetchImpl = async () => { requests++; return new Response(raw, { status: 401, headers: { 'request-id': `req-${encoded}` } }); };
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(requests, 1); assert.equal(s.service.view(s.id).readiness.productionReady, false);
    const c = s.service.candidate(s.service.coordinator.run2B(p.run.runId));
    const dir = path.join(c.dir, 'voice/responses'), record = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
    assert.equal(record.status, 401);
    assert.match(record.raw || '', /invalid_api_key|omitted/);
    // Check both live WAL and flushed database, not just the UI summary.
    const leakPaths = () => files(s.dir).filter(f => {
      const t = fs.readFileSync(f).toString('latin1').toLowerCase();
      return [fake, Buffer.from(fake).toString('base64'), encoded, JSON.stringify(encoded).slice(1, -1)].some(x => t.includes(x.toLowerCase()));
    }).map(f => path.relative(s.dir, f));
    const liveLeaks = leakPaths();
    s.service.close(); s.service = s.open();
    const view = s.service.view(s.id), persistedLeaks = leakPaths();
    assert.ok(!JSON.stringify(view).includes(fake));
    console.info(`N2 ${form}: rawRedactions=${record.sanitization.redactions}; reversibleBody=${Boolean(record.raw?.includes(encoded))}; reversibleHeader=${Boolean(record.headers['request-id']?.includes(encoded))}; reversibleUiDiagnostic=${Boolean(view.executions[0].attempts[0].providerRequestId?.includes(encoded))}; requests=${requests}`);
    assert.equal(requests, 1, 'restart/read never redispatch');
    assert.deepEqual([...new Set([...liveLeaks, ...persistedLeaks])], [], 'reversible fake credential survived persistence (paths only, credential omitted)');
  } finally { s.close(); }
});

test('FINAL N2: ordinary successful wire response is preserved byte-for-byte', async () => {
  const s = setup({ apiKey: () => `sk_${randomBytes(24).toString('hex')}` }), captured = new Map();
  const inner = s.provider.fetchImpl;
  s.service.fetchImpl = async (...args) => { const r = await inner(...args), raw = await r.text(); captured.set(r.headers.get('request-id'), raw); return new Response(raw, { status: r.status, headers: r.headers }); };
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(s.service.view(s.id).run.milestone, 'voice_generated');
    const c = s.service.candidate(s.service.coordinator.run2B(p.run.runId));
    for (const f of fs.readdirSync(path.join(c.dir, 'voice/responses'))) {
      const r = JSON.parse(fs.readFileSync(path.join(c.dir, 'voice/responses', f), 'utf8'));
      assert.equal(r.raw, captured.get(r.headers['request-id'])); assert.equal(r.sanitization.redactions, 0);
    }
  } finally { s.close(); }
});

test('FINAL N3: actual HTTP GET after two restarts is structured stale, without rebuilding or dispatching', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS }); let server;
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const v = s.service.view(s.id);
    s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(914) });
    const run = s.service.coordinator.run2B(v.run.runId), c = s.service.candidate(run), f = path.join(c.dir, run.inputs.inputRefs.narration.path);
    rewrite(f, fs.readFileSync(f, 'utf8') + '\n'); const bytes = fs.readFileSync(f), calls = s.provider.calls.length;
    const counts = db => db.get('SELECT (SELECT COUNT(*) FROM steps) steps, (SELECT COUNT(*) FROM runs) runs, (SELECT COUNT(*) FROM executions) executions, (SELECT COUNT(*) FROM receipts) receipts');
    const before = counts(s.service.coordinator); s.service.close();
    let previous;
    for (let restart = 0; restart < 2; restart++) {
      server = createStudio({ stateDir: s.dir, catalogLoader: () => s.f.catalog, fetchImpl: s.provider.fetchImpl, apiKey: () => 'independent-fake-key-only' });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/drafts/${s.id}/production`);
      assert.equal(r.status, 200); const body = await r.json();
      assert.equal(body.run.state, 'stale'); assert.equal(body.readiness.productionReady, false);
      assert.equal(body.readiness.canPromote, false); assert.equal(body.readiness.canReview, false); assert.equal(body.readiness.canGenerate, false);
      assert.equal(body.invalidation.stale, true); assert.ok(body.invalidation.requires.newFreePreview);
      assert.ok(body.invalidation.nextActions.some(a => a.code === 'NEW_FREE_PREVIEW'));
      assert.equal(body.review, null); assert.ok(body.steps.every(x => !x.current));
      if (previous) { assert.deepEqual(body.invalidation, previous.invalidation); assert.deepEqual(body.readiness, previous.readiness); }
      previous = body;
      assert.deepEqual(counts(server.production.coordinator), before); assert.equal(s.provider.calls.length, calls); assert.deepEqual(fs.readFileSync(f), bytes);
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); server = null;
    }
  } finally { if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); s.close(); }
});
