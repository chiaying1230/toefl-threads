// 2B paid boundary. Every provider here is the local mock (mock-provider.mjs); no request can reach ElevenLabs and no key exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Coordinator } from './coordinator.mjs';
import { setup, ACK, key } from './test-support.mjs';
import { confirmReceipt, executeVoice } from './paid-voice.mjs';
import { VoiceStore } from './candidate.mjs';
import { jsonHash } from './hashing.mjs';
import { root } from './server.mjs';

const exec = s => s.service.view(s.id).executions.at(-1);
/** TEST ONLY: rewrite a receipt's content AND its checksum consistently, to exercise the guards that sit behind the checksum. */
function rehash(c, receiptId, change) {
  const { receiptHash, ...rest } = change(JSON.parse(c.get('SELECT receipt FROM receipts WHERE receipt_id = ?', receiptId).receipt));
  const content = { ...rest, receiptHash: jsonHash(rest) };
  c.run('UPDATE receipts SET receipt = ?, receipt_hash = ? WHERE receipt_id = ?', JSON.stringify(content), content.receiptHash, receiptId);
}

test('envelope = current planner; one TTS per interrupted sentence; receipt binds evidence; voice generated without retries', async () => {
  const s = setup();
  try {
    const p = await s.preview();
    assert.equal(p.run.state, 'awaiting_confirmation'); assert.ok(p.challenge);
    const env = p.envelope;
    assert.equal(env.requests.length, 4); assert.equal(env.counts.miss, 4); assert.equal(env.counts.silent, 2);
    assert.equal(env.estimatedUniqueTextChars, env.requests.reduce((n, r) => n + r.chars, 0));
    assert.deepEqual(env.budget, { unit: 'utf16_request_text', maxSubmittedChars: env.estimatedUniqueTextChars, maxRequests: 4, maxCharsPerRequest: env.maxRequestChars });
    assert.equal(env.retryPolicy.additionalPaidAttemptsPerHash, 0);
    const sentence = env.requests.find(r => r.partIds.length);
    assert.equal(sentence.text, 'We allocate supplies, and the class starts.'); // whole sentence, once; parts only cut it later
    assert.deepEqual(sentence.partIds, ['story001Part1', 'story001Part2']);
    assert.equal(env.requests.find(r => r.kind === 'meaning').speaker, 'ling');
    assert.equal(env.requests.find(r => r.kind === 'example').speaker, 'arthur');
    assert.equal(s.provider.calls.length, 0, 'preview must not send anything');
    const c = await s.confirm(p);
    await s.service.idle();
    const v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_generated');
    assert.equal(s.provider.calls.length, 4);
    assert.deepEqual(s.provider.calls.map(x => x.body.text).sort(), env.requests.map(r => r.text).sort());
    assert.ok(s.provider.calls.every(x => x.headers['xi-api-key'] === 'test-key-not-real'));
    const e = v.executions[0];
    assert.equal(e.status, 'completed'); assert.equal(e.attempts.length, 4); assert.ok(e.attempts.every(a => a.status === 'succeeded' && a.providerBilledCharacters === null));
    const receipt = s.service.coordinator.receipt(s.service.coordinator.execution(c.executionId).receipt_id).receipt;
    const run = s.service.coordinator.run2B(p.run.runId), inputs = run.inputs.inputRefs;
    assert.equal(receipt.narrationBytesHash, inputs.narration.bytesHash); assert.equal(receipt.compiledEpisodeBytesHash, inputs.episode.bytesHash);
    assert.equal(receipt.validationHash, inputs.validation.bytesHash); assert.equal(receipt.voicePlanHash, inputs.voicePlan.bytesHash);
    assert.equal(receipt.confirmationEnvelopeHash, run.inputs.envelopes[0].bytesHash);
    assert.equal(receipt.decisionHash, jsonHash(s.store.get(s.id).decisions));
    const { receiptHash, ...content } = receipt; assert.equal(jsonHash(content), receiptHash);
    const store = new VoiceStore(path.join(s.dir, 'production'));
    for (const r of env.requests) assert.ok(store.has(r.segmentHash));
  } finally { s.close(); }
});

test('double click, HTTP retry and a second window return the same execution; a second preview never adds authorization', async () => {
  const s = setup();
  try {
    const p = await s.preview();
    const [a, b] = await Promise.all([s.confirm(p, key(7)), s.confirm(p, key(7))]);
    assert.equal(a.executionId, b.executionId);
    const other = await s.confirm(p, key(8)); // another window / key, same consumed challenge
    assert.equal(other.executionId, a.executionId); assert.equal(other.replayed, true);
    await assert.rejects(s.service.confirm(s.id, { runId: p.run.runId, challenge: p.challenge.challenge, idempotencyKey: key(7), budget: { ...p.envelope.budget, maxRequests: 99 }, acknowledgements: ACK }), e => e.status === 409);
    const again = await s.preview();
    assert.match(again.notice || '', /沿用/); assert.equal(again.challenge, undefined);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 4);
    assert.equal(s.service.coordinator.all('SELECT * FROM executions').length, 1);
  } finally { s.close(); }
});

test('stale receipts: decision edit, expired challenge, tampered sealed input and budget changes stop before any request', async () => {
  const s = setup();
  try {
    let p = await s.preview();
    s.service.beginMutation(s.id, 1, jsonHash(s.store.get(s.id).decisions));
    await assert.rejects(s.confirm(p), e => e.status === 409);
    s.service.coordinator.run("UPDATE mutations SET status = 'aborted'");
    p = await s.preview();
    s.service.coordinator.run("UPDATE challenges SET expires_at = '2000-01-01T00:00:00.000Z'");
    await assert.rejects(s.confirm(p, key(2)), /過期/);
    p = await s.preview();
    const file = path.join(s.service.candidate(s.service.coordinator.run2B(p.run.runId)).dir, 'inputs', 'narration.json');
    fs.chmodSync(file, 0o666); fs.appendFileSync(file, ' ');
    await assert.rejects(s.confirm(p, key(3)), e => e.status === 409);
    assert.equal(s.service.view(s.id).run.state, 'stale');
    p = await s.preview();
    await assert.rejects(s.service.confirm(s.id, { runId: p.run.runId, challenge: p.challenge.challenge, idempotencyKey: key(4), budget: { ...p.envelope.budget, maxSubmittedChars: p.envelope.budget.maxSubmittedChars + 1 }, acknowledgements: ACK }), /預算/);
    await assert.rejects(s.service.confirm(s.id, { runId: p.run.runId, challenge: p.challenge.challenge, idempotencyKey: key(5), budget: p.envelope.budget, acknowledgements: { noAutomaticRetry: true } }), /確認/);
    assert.equal(s.provider.calls.length, 0);
  } finally { s.close(); }
});

test('a decision edit during an in-flight request: no further request, the late response is not attached', async () => {
  let s;
  s = setup({ behavior: call => { if (call.n === 1) s.service.beginMutation(s.id, 1, jsonHash(s.store.get(s.id).decisions)); return null; } });
  try {
    const p = await s.preview();
    await s.confirm(p);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 1);
    const v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.notEqual(v.run.milestone, 'voice_generated');
    assert.equal(s.service.coordinator.all("SELECT * FROM attempts WHERE status = 'succeeded'").length, 0);
  } finally { s.close(); }
});

for (const [name, behavior] of [
  ['HTTP 500', { status: 500 }], ['HTTP 429', { status: 429 }], ['HTTP 401', { status: 401 }],
  ['network failure', { throw: new TypeError('fetch failed') }], ['timeout', { throw: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }],
  ['malformed JSON', { raw: '{not json' }], ['NO_ALIGNMENT', { noAlignment: true }],
  ['alignment that does not match the text', { alignment: a => ({ ...a, characters: a.characters.map((c, i) => (i === 1 ? 'X' : c)) }) }],
]) test(`zero automatic paid retries: ${name} → exactly one request for that segment, then stop`, async () => {
  const s = setup({ behavior: call => (call.n === 1 ? behavior : null) });
  try {
    const p = await s.preview();
    await s.confirm(p);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 1, 'no second request (no retry, and the run stops at the first failure)');
    const e = exec(s), a = e.attempts[0];
    assert.notEqual(e.status, 'completed');
    assert.ok(['failed', 'unknown'].includes(a.status));
    if (['network failure', 'timeout'].includes(name)) { assert.equal(a.status, 'unknown'); assert.equal(e.status, 'blocked'); }
    assert.notEqual(s.service.view(s.id).run.milestone, 'voice_generated');
  } finally { s.close(); }
});

test('unknown provider outcome: no resume under the old receipt; recovery needs the double-charge acknowledgement and resends only the residual', async () => {
  const s = setup({ behavior: call => (call.n === 2 ? { throw: new TypeError('socket hang up') } : null) });
  try {
    const p = await s.preview();
    await s.confirm(p);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 2);
    let v = s.service.view(s.id);
    assert.equal(v.run.state, 'blocked'); assert.deepEqual(v.executions[0].attempts.map(a => a.status).sort(), ['succeeded', 'unknown']);
    assert.throws(() => s.service.resumeVoice(s.id, p.run.runId), e => e.status === 409);
    const r = await s.preview({ recoveryRunId: p.run.runId });
    assert.ok(r.challenge); assert.equal(r.envelope.requests.length, 3); assert.match(r.envelope.recovery.warning, /可能已扣額/);
    await assert.rejects(s.confirm(r, key(9)), /可能已扣額/);
    await s.confirm(r, key(10), { acknowledgements: { ...ACK, possibleDoubleCharge: true } });
    await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_generated'); assert.equal(s.provider.calls.length, 5);
    assert.equal(v.executions.length, 2); assert.equal(v.executions[1].recoveryOf, v.executions[0].executionId);
  } finally { s.close(); }
});

test('partial generation keeps sealed audio; resume sends only never-attempted segments; the failed one needs a new receipt', async () => {
  const s = setup({ behavior: call => (call.n === 2 ? { status: 500 } : null) });
  try {
    const p = await s.preview();
    await s.confirm(p);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 2); assert.equal(exec(s).status, 'failed');
    const failedText = s.provider.calls[1].body.text;
    s.service.resumeVoice(s.id, p.run.runId);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 4);
    assert.equal(s.provider.calls.slice(2).some(c => c.body.text === failedText), false, 'the failed segment is never resent under the same receipt');
    assert.equal(exec(s).status, 'failed');
    const r = await s.preview({ recoveryRunId: p.run.runId });
    assert.deepEqual(r.envelope.requests.map(x => x.text), [failedText]);
    await s.confirm(r, key(11), { acknowledgements: { ...ACK, possibleDoubleCharge: true } });
    await s.service.idle();
    assert.equal(s.provider.calls.length, 5); assert.equal(s.service.view(s.id).run.milestone, 'voice_generated');
  } finally { s.close(); }
});

test('budget and request-body guards: an over-budget or changed request never reaches the provider', async () => {
  const s = setup();
  try {
    const p = await s.preview();
    const c = s.service.coordinator, run = c.run2B(p.run.runId), candidate = s.service.candidate(run), envelope = candidate.readJson(run.inputs.envelopes[0]);
    const { execution, receipt } = confirmReceipt(c, { run, envelope, envelopeRef: run.inputs.envelopes[0], challenge: p.challenge.challenge, idempotencyKey: key(20), acknowledgements: ACK, expectedBudget: envelope.budget });
    const args = { coordinator: c, candidate, voiceStore: new VoiceStore(path.join(s.dir, 'production')), executionId: execution.execution_id, freshness: () => {}, fetchImpl: s.provider.fetchImpl, apiKey: () => 'test-key-not-real', voiceConfig: s.service.voiceConfig(run), narration: candidate.readJson(run.inputs.inputRefs.narration), envelope };
    // 2B.1: content changed without its checksum → RECEIPT_TAMPERED before any request, execution blocked
    const original = c.get('SELECT receipt FROM receipts WHERE receipt_id = ?', receipt.receipt_id).receipt;
    c.run('UPDATE receipts SET receipt = ? WHERE receipt_id = ?', JSON.stringify({ ...receipt.receipt, budget: { ...receipt.receipt.budget, maxRequests: 99 } }), receipt.receipt_id);
    await assert.rejects(executeVoice(args), e => e.code === 'RECEIPT_TAMPERED');
    assert.equal(s.provider.calls.length, 0); assert.equal(c.execution(execution.execution_id).status, 'blocked');
    // the budget layer is independent of the checksum: a consistently re-hashed (still internally valid) receipt with a lower cap
    c.run("UPDATE executions SET status = 'issued' WHERE execution_id = ?", execution.execution_id); c.run("UPDATE receipts SET status = 'issued', receipt = ? WHERE receipt_id = ?", original, receipt.receipt_id);
    rehash(c, receipt.receipt_id, content => ({ ...content, budget: { ...content.budget, maxRequests: 1 } }));
    const r = await executeVoice(args);
    assert.equal(s.provider.calls.length, 1); assert.equal(r.failure.code, 'BUDGET_EXCEEDED');
    // a request whose rebuilt body differs from the confirmed one is refused before the intent is recorded
    s.service.supersede(c.run2B(p.run.runId), [{ code: 'TEST', message: 'start a second run for the next guard' }]);
    const p2 = await s.preview(), run2 = c.run2B(p2.run.runId), cand2 = s.service.candidate(run2), env2 = cand2.readJson(run2.inputs.envelopes[0]);
    const r2 = confirmReceipt(c, { run: run2, envelope: env2, envelopeRef: run2.inputs.envelopes[0], challenge: p2.challenge.challenge, idempotencyKey: key(21), acknowledgements: ACK, expectedBudget: env2.budget });
    rehash(c, r2.receipt.receipt_id, content => ({ ...content, requests: content.requests.map(x => ({ ...x, requestBodyHash: 'sha256:changed' })) }));
    const before = s.provider.calls.length;
    const out = await executeVoice({ ...args, candidate: cand2, executionId: r2.execution.execution_id, narration: cand2.readJson(run2.inputs.inputRefs.narration), envelope: env2 });
    assert.equal(out.failure.code, 'REQUEST_CHANGED'); assert.equal(s.provider.calls.length, before);
  } finally { s.close(); }
});

test('cache: verified hits are free (no confirmation, no receipt); a corrupt cache entry is a miss; a changed pinned hit blocks', async () => {
  const s = setup();
  try {
    let p = await s.preview();
    await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 4);
    // new revision with the same spoken segments (an Outro copy change): everything is a verified hit → no paid confirmation
    const d = s.store.get(s.id); d.decisions.production.outro.lead = '同一支影片，新的 Outro 文案。'; d.revision++; s.store.persist(d);
    assert.equal(s.wf.run(s.id, { revision: d.revision }).status, 'voice_planned');
    p = await s.preview();
    assert.equal(p.challenge, undefined); assert.equal(p.envelope.requests.length, 0); assert.equal(p.run.milestone, 'voice_generated');
    assert.equal(s.provider.calls.length, 4); assert.equal(s.service.coordinator.all('SELECT * FROM receipts').length, 1);
    // corrupt one entry of the Studio voice store: it is quarantined and shown as a paid miss, never trusted
    const store = new VoiceStore(path.join(s.dir, 'production')), hash = p.envelope.pinned[0].hash, file = store.paths(hash).alignment;
    fs.chmodSync(file, 0o666); fs.writeFileSync(file, '{"broken": true}');
    const d2 = s.store.get(s.id); d2.decisions.production.outro.cta = '再一個新的 CTA。'; d2.revision++; s.store.persist(d2);
    s.wf.run(s.id, { revision: d2.revision });
    p = await s.preview();
    assert.equal(p.envelope.requests.length, 1); assert.equal(p.envelope.requests[0].segmentHash, hash);
    assert.ok(p.envelope.quarantined.some(q => q.hash === hash));
    // a pinned hit that changes after confirmation blocks instead of becoming a paid miss
    const run = s.service.coordinator.run2B(p.run.runId), pinned = s.service.candidate(run).readJson(run.inputs.envelopes[0]).pinned[0];
    const pinnedFile = path.join(s.service.candidate(run).dir, pinned.audio.path); fs.chmodSync(pinnedFile, 0o666); fs.appendFileSync(pinnedFile, Buffer.from([0]));
    // 2B.1: the envelope's pinned pairs are verified transitively, so the change is refused already at confirmation
    await assert.rejects(s.confirm(p, key(30)), e => e.status === 409); await s.service.idle();
    assert.equal(s.provider.calls.length, 4); assert.match(JSON.stringify(s.service.view(s.id).run.reason), /SEALED_INPUT_CHANGED|Sealed artifact changed/);
  } finally { s.close(); }
});

test('phrase and multi-vocabulary: one whole-sentence request each, parts never synthesized separately', async () => {
  for (const kind of ['phrase', 'multiple']) {
    const s = setup({ kind });
    try {
      const p = await s.preview(), env = p.envelope;
      const story = env.requests.filter(r => r.kind === 'story' && r.partIds.length);
      assert.equal(story.length, 1);
      assert.equal(story[0].text, kind === 'phrase' ? 'She was consumed with guilt, but she recovered.' : 'We allocate supplies, then review arbitrary rules.');
      assert.ok(!env.requests.some(r => r.segmentIds.some(id => /Part\d/.test(id))));
      assert.equal(env.requests.filter(r => r.kind === 'meaning').length, kind === 'multiple' ? 2 : 1);
      assert.ok(p.preflight.parity.ok); assert.ok(p.preflight.cards.ok);
    } finally { s.close(); }
  }
});

test('two coordinators cannot execute on one state directory; restart after a crash mid-request leaves an unknown attempt that is never resent', async () => {
  const s = setup();
  try {
    assert.throws(() => new Coordinator(path.join(s.dir, 'production')), e => e.status === 409);
    s.service.close();
    // a separate process confirms and crashes (SIGKILL) while its second request is in flight
    const script = `
      const R = ${JSON.stringify(pathToFileURL(path.join(root, 'video-studio')).href + '/')};
      const { fixture } = await import(R + 'fixtures.mjs'); const { ProductionService } = await import(R + 'production.mjs');
      const { ProductionWorkflow } = await import(R + 'workflow.mjs'); const { DraftStore } = await import(R + 'store.mjs'); const { mockProvider } = await import(R + 'mock-provider.mjs');
      const f = fixture('single', '課堂準備開始了。', { production: true }), dir = ${JSON.stringify(s.dir)};
      const wf = new ProductionWorkflow(new DraftStore(dir, f.catalog), ${JSON.stringify(root)});
      const provider = mockProvider(call => call.n === 2 ? { hang: true } : null);
      const service = new ProductionService({ draftsDir: dir, productionDir: dir + '/production', repoRoot: ${JSON.stringify(root)}, catalogLoader: () => f.catalog, loadedEngineHash: wf.loadedEngineHash, fetchImpl: provider.fetchImpl, apiKey: () => 'test-key-not-real', autoChain: false });
      const p = await service.preview(f.draft.id, { revision: 1 });
      await service.confirm(f.draft.id, { runId: p.run.runId, challenge: p.challenge.challenge, idempotencyKey: 'crash-test-key-0000001', budget: p.envelope.budget, acknowledgements: { noAutomaticRetry: true, estimateIsNotBilling: true } });
      const wait = () => provider.calls.length >= 2 ? console.log('IN_FLIGHT') : setTimeout(wait, 50); wait();`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; child.stderr.on('data', d => { err += d; });
    await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('IN_FLIGHT')) resolve(); }); child.on('exit', code => reject(Error(`child exited ${code}: ${err}`))); });
    child.kill('SIGKILL'); await new Promise(r => child.once('exit', r));
    s.service = s.open(); // the OS released the dead process's lock; restart recovery ran in the constructor
    const v = s.service.view(s.id), e = v.executions[0];
    assert.equal(e.status, 'interrupted'); assert.deepEqual(e.attempts.map(a => a.status).sort(), ['succeeded', 'unknown']);
    assert.throws(() => s.service.resumeVoice(s.id, v.run.runId), /未知/);
    assert.equal(s.provider.calls.length, 0, 'this process never sent anything');
  } finally { s.close(); }
});

test('pre-payment preflight: a vocabulary card taller than the view BLOCKs before any confirmation exists (real renderer, synthetic plan)', async () => {
  const dir = (await import('node:fs')).mkdtempSync(path.join(os.tmpdir(), 'studio-2b-tall-'));
  const { fixture } = await import('./fixtures.mjs'), { DraftStore } = await import('./store.mjs'), { ProductionWorkflow } = await import('./workflow.mjs'), { ProductionService } = await import('./production.mjs');
  const f = fixture('single', '課堂準備開始了。', { production: true, longExample: true });
  const store = new DraftStore(dir, f.catalog); store.persist(f.draft);
  const wf = new ProductionWorkflow(store, root);
  assert.equal(wf.run(f.draft.id, { revision: 1 }).status, 'voice_planned');
  const service = new ProductionService({ draftsDir: dir, productionDir: path.join(dir, 'production'), repoRoot: root, catalogLoader: () => f.catalog, loadedEngineHash: wf.loadedEngineHash, fetchImpl: () => { throw Error('no request may be sent'); }, apiKey: () => 'test-key-not-real', autoChain: false });
  try {
    const p = await service.preview(f.draft.id, { revision: 1 });
    assert.equal(p.run.state, 'blocked'); assert.equal(p.challenge, undefined); assert.equal(p.envelope, null);
    assert.ok(p.run.reason.some(r => r.code === 'CARD_TOO_TALL'), JSON.stringify(p.run.reason));
    assert.equal(service.coordinator.all('SELECT * FROM receipts').length, 0);
  } finally { service.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
