// Regression tests for the three P1s of REVIEW-2B1-P6-READINESS.md (N1 partial generation integrity, N2 credential-safe response
// persistence, N3 stale narration restart view). Temporary state + mock provider only; no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setup, FAKE_STEPS, key } from './test-support.mjs';
import { credentialTrace, gateResponse, safeMessage, DECODE_DEPTH } from './paid-voice.mjs';

const rewrite = (f, b) => { fs.chmodSync(f, 0o666); fs.writeFileSync(f, b); };
const acks = r => ({ seams: Object.fromEntries(r.seams.map(s => [s.id, true])), visual: Object.fromEntries(r.visualChecklist.map(s => [s.id, true])), warnings: Object.fromEntries(r.warnings.map(s => [s.id, true])) });
const tamper = {
  audio: f => rewrite(f, Buffer.concat([fs.readFileSync(f), Buffer.from([0])])),
  alignment: f => rewrite(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), changed: true })),
  missing: f => { fs.chmodSync(f, 0o666); fs.unlinkSync(f); },
};
const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]);

// ---------------- N1: partial generation integrity ----------------
for (const [kind, ext] of [['audio', 'mp3'], ['alignment', 'json'], ['missing', 'mp3']]) test(`N1 partial generation: ${kind} generated pair changed → resume sends nothing, stale persists across restarts`, async () => {
  const s = setup({ behavior: call => call.n === 2 ? { status: 500 } : null });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const runId = p.run.runId, run = s.service.coordinator.run2B(runId), c = s.service.candidate(run);
    const success = s.service.view(s.id).executions[0].attempts.find(a => a.status === 'succeeded');
    assert.ok(success, 'one request succeeded'); assert.equal(s.service.chain(run).voice, undefined, 'no voice bundle yet (partial window)');
    assert.equal(s.provider.calls.length, 2);
    const f = path.join(c.dir, 'voice/sealed', `${success.segmentHash}.${ext}`), original = fs.readFileSync(f);
    tamper[kind](f);
    s.service.close(); s.service = s.open();
    assert.throws(() => s.service.resumeVoice(s.id, runId), e => e.status === 409);
    await s.service.idle();
    assert.equal(s.provider.calls.length, 2, 'no further provider request');
    let v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.ok(v.run.reason.some(r => r.code === 'VOICE_EVIDENCE_CHANGED'), JSON.stringify(v.run.reason));
    assert.equal(v.readiness.productionReady, false); assert.notEqual(v.run.milestone, 'voice_generated');
    assert.ok(!['issued', 'running', 'completed'].includes(v.executions[0].status), v.executions[0].status); assert.equal(v.executions[0].receiptStatus, 'revoked');
    // the ledger keeps the original evidence (never re-hashed from the changed file)
    assert.equal(v.executions[0].attempts.find(a => a.segmentHash === success.segmentHash).audioHash, success.audioHash);
    // restart again; even restoring the original bytes does not silently heal the run, and no path sends a request
    s.service.close(); s.service = s.open();
    if (kind === 'missing') fs.writeFileSync(f, original); else rewrite(f, original);
    s.service.close(); s.service = s.open();
    assert.throws(() => s.service.resumeVoice(s.id, runId), e => e.status === 409);
    await assert.rejects(s.preview({ recoveryRunId: runId }), e => e.status === 409);
    await s.service.idle();
    v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.equal(v.readiness.productionReady, false); assert.equal(v.invalidation.stale, true);
    assert.equal(s.provider.calls.length, 2);
  } finally { s.close(); }
});

test('N1 partial generation: a generated pair changed while the next request is in flight stops every later request', async () => {
  let s;
  const behavior = call => {
    if (call.n === 2) { // tamper the pair sealed by request 1 while request 2 is "at the provider"
      const run = s.service.coordinator.all('SELECT run_id FROM runs').map(r => s.service.coordinator.run2B(r.run_id)).at(-1), dir = path.join(s.service.candidate(run).dir, 'voice/sealed');
      tamper.audio(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.mp3'))));
    }
    return null;
  };
  s = setup({ behavior });
  try {
    const p = await s.preview();
    assert.ok(p.envelope.requests.length >= 3, 'fixture needs at least three paid requests');
    await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 2, 'request 3+ never sent');
    const v = s.service.view(s.id);
    assert.equal(v.run.state, 'stale'); assert.ok(v.run.reason.some(r => r.code === 'VOICE_EVIDENCE_CHANGED'));
    assert.equal(v.readiness.productionReady, false);
    s.service.close(); s.service = s.open();
    assert.equal(s.service.view(s.id).run.state, 'stale'); assert.equal(s.provider.calls.length, 2);
  } finally { s.close(); }
});

// ---------------- N2: credential-safe provider response persistence ----------------
test('N2 secret boundary: a provider error echoing the credential (raw / URL / base64 / upper-case / header) leaves it nowhere on disk', async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`; // fake, generated per run; never a real key
  const behavior = call => {
    const k = call.headers['xi-api-key']; // echo what the provider actually received
    return { status: 401, body: JSON.stringify({ detail: { status: 'invalid_api_key', message: `bad key ${k} / ${encodeURIComponent(k)} / ${Buffer.from(k).toString('base64')} / ${k.toUpperCase()}`, echo: { 'xi-api-key': k } } }), headers: { 'request-id': `req-${k}` } };
  };
  const s = setup({ behavior, apiKey: () => secret });
  // the mock only sets request-id itself; let this test's response carry the echoed header too
  const inner = s.provider.fetchImpl;
  s.service.fetchImpl = async (url, init) => { const res = await inner(url, init), b = behavior({ headers: init.headers }); return new Response(await res.text(), { status: res.status, headers: b.headers }); };
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 1, 'one request, no retry');
    s.service.close(); s.service = s.open(); // also flushes the SQLite WAL into the scanned files
    const v = s.service.view(s.id);
    const forms = [secret, secret.toUpperCase(), encodeURIComponent(secret), Buffer.from(secret).toString('base64')];
    for (const f of files(s.dir)) { const b = fs.readFileSync(f), t = b.toString('latin1').toLowerCase(); for (const x of forms) assert.ok(!t.includes(x.toLowerCase()), `${path.relative(s.dir, f)} contains the credential`); }
    assert.ok(!JSON.stringify(v).toLowerCase().includes(secret.toLowerCase()), 'view (UI-readable state)');
    // still diagnosable: status, provider error code, request id (scrubbed), redaction count, ledger error
    const run = s.service.coordinator.run2B(p.run.runId), dir = path.join(s.service.candidate(run).dir, 'voice/responses');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
    // metadata only: the provider code survives, free text and the echoing request id do not
    assert.equal(saved.status, 401); assert.equal(saved.sanitization.mode, 'metadata-only'); assert.ok(saved.sanitization.redactions >= 2);
    assert.equal(saved.raw, '{"detail":{"status":"invalid_api_key"}}'); assert.equal(saved.headers['request-id'], undefined);
    const a = v.executions[0].attempts[0];
    assert.equal(a.httpStatus, 401); assert.equal(a.status, 'failed'); assert.equal(a.providerRequestId, null); assert.match((typeof a.error === "string" ? JSON.parse(a.error) : a.error).message, /401/);
  } finally { s.close(); }
});

test('N2 secret boundary: sanitization leaves successful provider responses byte-identical (parser / alignment / replay unaffected)', async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`;
  const s = setup({ apiKey: () => secret });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    const run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), dir = path.join(c.dir, 'voice/responses');
    const v = s.service.view(s.id);
    assert.equal(v.run.milestone, 'voice_generated'); assert.equal(v.executions[0].status, 'completed');
    for (const name of fs.readdirSync(dir)) {
      const saved = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')), body = JSON.parse(saved.raw);
      assert.equal(saved.sanitization.redactions, 0);
      const hash = v.executions[0].attempts.find(a => JSON.parse(s.service.coordinator.get('SELECT response_ref FROM attempts WHERE segment_hash = ?', a.segmentHash).response_ref).attemptId === saved.attemptId).segmentHash;
      assert.deepEqual(Buffer.from(body.audio_base64, 'base64'), fs.readFileSync(path.join(c.dir, 'voice/sealed', `${hash}.mp3`)));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(c.dir, 'voice/sealed', `${hash}.json`), 'utf8')).alignment, body.alignment);
    }
  } finally { s.close(); }
});

test('N2 credentialTrace: every reversible representation, alone or composed, is detected; clean text stays clean', () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`, bytes = Buffer.from(secret);
  const hex = (c, w) => c.charCodeAt(0).toString(16).padStart(w, '0');
  const pct = t => [...t].map(c => `%${hex(c, 2)}`).join(''), b64 = t => Buffer.from(t).toString('base64'), hx = t => Buffer.from(t).toString('hex');
  const representations = {
    literal: secret, upper: secret.toUpperCase(),
    jsonUnicode: [...secret].map(c => `\\u${hex(c, 4)}`).join(''), jsonUnicodeUpper: [...secret].map(c => `\\u${hex(c, 4).toUpperCase()}`).join(''),
    jsonHexEscape: [...secret].map(c => `\\x${hex(c, 2)}`).join(''), jsonEscapedSlash: secret.replace('_', '\\_').replace(/a/g, '\\/a'),
    percentFull: pct(secret), percentFullUpper: pct(secret).toUpperCase(),
    percentPartial: [...secret].map((c, i) => i % 2 ? `%${hex(c, 2)}` : c).join(''), percentDouble: [...secret].map(c => `%25${hex(c, 2)}`).join(''), percentTriple: pct(pct(pct(secret))),
    mixed: [...secret].map((c, i) => [c, `\\u${hex(c, 4)}`, `%${hex(c, 2)}`][i % 3]).join(''),
    htmlHex: [...secret].map(c => `&#x${hex(c, 2)};`).join(''), htmlDec: [...secret].map(c => `&#${c.charCodeAt(0)};`).join(''),
    base64: bytes.toString('base64'), base64url: bytes.toString('base64url'), hexBytes: bytes.toString('hex'),
    base64Offset1: Buffer.concat([Buffer.from('B'), bytes]).toString('base64'), base64Offset2: b64(`Bearer ${secret}`), utf16le: Buffer.from(secret, 'utf16le').toString('base64'),
    // compositions: the forms the N2-only gate found, and their neighbours
    percentOfBase64: pct(b64(secret)), base64OfPercent: b64(pct(secret)), base64Twice: b64(b64(secret)), hexOfPercent: hx(pct(secret)),
    hexOfBase64: hx(b64(secret)), base64OfHex: b64(hx(secret)), base64OfUnicode: b64([...secret].map(c => `\\u${hex(c, 4)}`).join('')), base64Thrice: b64(b64(b64(secret))),
  };
  for (const [name, form] of Object.entries(representations)) {
    for (const wrap of [t => JSON.stringify({ detail: { message: `rejected ${t} here` } }), t => `req-${t}`, t => `x-request-id-${t}: diagnostic-id`]) {
      assert.notEqual(credentialTrace(wrap(form), [secret]), 'clean', `${name}: ${wrap('…')}`);
    }
  }
  // split by separators (also an encoded form split into chunks): detected, and classified as not localizable
  for (const split of [JSON.stringify([...secret]), JSON.stringify(b64(secret).match(/.{1,5}/g)), b64(`Authorization: Bearer ${secret}`).replace(/.{10}/g, '$&\r\n')]) assert.equal(credentialTrace(split, [secret]), 'segmented', split.slice(0, 30));
  // credential-free text, including escapes / percent / base64 / hex of other content and hashes, is clean
  for (const ok of ['{"audio_base64":"SUQzBAAAAAAAI1RTU0U=","alignment":{"characters":["s","k","_","\\u4e2d"]}}', 'req-abc%20def', 'mock-1', 'ElevenLabs 401 AUTH (invalid_api_key): ', `hash ${randomBytes(32).toString('hex')} ≠ ledger`, b64('an ordinary provider diagnostic, nothing secret here')]) assert.equal(credentialTrace(ok, [secret]), 'clean', ok);
});

test('N2 credentialTrace: bounded and fail-closed — layers beyond the depth bound and runaway input are undecidable, never clean', () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`;
  const pct = t => [...t].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  let deep = secret;
  for (let i = 0; i < DECODE_DEPTH + 2; i++) deep = Buffer.from(deep).toString(i % 2 ? 'hex' : 'base64');
  assert.equal(credentialTrace(deep, [secret]), 'undecidable');
  for (let n = DECODE_DEPTH + 1; n <= 12; n++) { let t = secret; for (let i = 0; i < n; i++) t = Buffer.from(t).toString('base64'); assert.equal(credentialTrace(t, [secret]), 'undecidable', `base64^${n}`); }
  const started = Date.now();
  assert.equal(credentialTrace('x'.repeat((32 << 20) + 1), [secret]), 'undecidable');
  assert.notEqual(credentialTrace('%25'.repeat(300000) + pct(pct(pct(secret))), [secret]), 'clean');
  assert.ok(Date.now() - started < 10000, 'bounded work');
  assert.match(safeMessage(`failed ${Buffer.from(Buffer.from(secret).toString('base64')).toString('hex')}`, [secret]), /^\[omitted/);
  assert.equal(safeMessage('ElevenLabs 500 SERVER: ', [secret]), 'ElevenLabs 500 SERVER: ');
});

test('N2 gateResponse: header names are checked and only exact allowlisted headers are kept; success bodies stay byte-identical', () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`, raw = JSON.stringify({ audio_base64: randomBytes(3000).toString('base64'), alignment: { characters: [...'hello'] } });
  const ok = gateResponse({ attemptId: 'a', status: 200, raw, secrets: [secret], headers: [['request-id', 'req-1'], ['content-type', 'application/json'], ['x-request-id-extra', 'v'], [`x-echo-${secret}`, 'v'], ['history-item-id', Buffer.from(Buffer.from(secret).toString('base64')).toString('hex').slice(0, 120)]] });
  assert.equal(ok.failed, false); assert.equal(ok.body, raw); assert.equal(ok.record.raw, raw); assert.equal(ok.record.sanitization.mode, 'verbatim');
  assert.deepEqual(ok.record.headers, { 'request-id': 'req-1', 'content-type': 'application/json' });
  assert.ok(!JSON.stringify(ok.record).toLowerCase().includes(secret.toLowerCase()));
  // a success body that carries the credential in any detected form is not kept at all
  const body = JSON.stringify({ audio_base64: 'SUQz', alignment: {}, note: Buffer.from([...secret].map(c => `%${c.charCodeAt(0).toString(16)}`).join('')).toString('base64') });
  const g = gateResponse({ attemptId: 'b', status: 200, raw: body, secrets: [secret], headers: [] });
  assert.equal(g.failed, true); assert.equal(g.record.raw, null); assert.deepEqual(g.record.headers, {}); assert.equal(g.record.sanitization.failed, 'SECRET_SANITIZATION_FAILED');
  // an error keeps only a code-shaped provider status; free text is dropped even when it carries no credential
  const err = gateResponse({ attemptId: 'c', status: 422, raw: JSON.stringify({ detail: { status: 'Bad Status!', message: 'anything' } }), secrets: [secret], headers: [] });
  assert.equal(err.record.raw, '{"detail":{}}'); assert.equal(err.record.sanitization.redactions, 0);
});

test('N2 secret boundary: transport errors and credential-bearing success bodies persist nothing reversible and are never resent', async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`;
  for (const mode of ['transport', 'success-body']) {
    const s = setup({ apiKey: () => secret }); let requests = 0;
    s.service.fetchImpl = async () => {
      requests++;
      if (mode === 'transport') throw Object.assign(new Error(`connect failed for ${Buffer.from(encodeURIComponent(secret)).toString('base64')}`), { cause: { code: `E_${secret}` } });
      return new Response(JSON.stringify({ audio_base64: 'SUQzBAAAAAAAI1RTU0U=', alignment: { characters: ['a'] }, debug: Buffer.from(Buffer.from(secret).toString('base64')).toString('base64') }), { status: 200, headers: { 'request-id': 'ok-1' } });
    };
    try {
      const p = await s.preview(); await s.confirm(p); await s.service.idle();
      s.service.close(); s.service = s.open(); await s.service.idle();
      const v = s.service.view(s.id), a = v.executions[0].attempts[0];
      assert.equal(requests, 1, `${mode}: one request, no retry after restart`);
      assert.equal(a.status, mode === 'transport' ? 'unknown' : 'failed'); assert.equal(v.readiness.productionReady, false);
      if (mode === 'success-body') { assert.equal(v.executions[0].error.code, 'SECRET_SANITIZATION_FAILED'); assert.equal(a.providerRequestId, null); }
      const needles = [secret, Buffer.from(secret).toString('base64'), Buffer.from(encodeURIComponent(secret)).toString('base64'), Buffer.from(Buffer.from(secret).toString('base64')).toString('base64')].map(x => x.toLowerCase());
      for (const f of files(s.dir)) { const t = fs.readFileSync(f).toString('latin1').toLowerCase(); assert.ok(!needles.some(x => t.includes(x)), `${mode}: ${path.relative(s.dir, f)}`); }
      assert.ok(!needles.some(x => JSON.stringify(v).toLowerCase().includes(x)), `${mode}: view`);
    } finally { s.close(); }
  }
});

test('N2 secret boundary: an echo that is detected but not redactable persists no payload, stops, and never resends that request', async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`, split = JSON.stringify([...secret]); // reversible by join, not by token
  const s = setup({ apiKey: () => secret });
  const bodies = [];
  s.service.fetchImpl = async (url, init) => { bodies.push(init.body); return new Response(JSON.stringify({ detail: { status: 'invalid_api_key', characters: [...secret] } }), { status: 401, headers: { 'request-id': `req-${split}` } }); };
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(bodies.length, 1);
    const run = s.service.coordinator.run2B(p.run.runId), dir = path.join(s.service.candidate(run).dir, 'voice/responses');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
    assert.equal(saved.status, 401); assert.equal(saved.raw, null); assert.deepEqual(saved.headers, {}); assert.equal(saved.sanitization.failed, 'SECRET_SANITIZATION_FAILED'); assert.ok(saved.rawBytes > 0);
    let v = s.service.view(s.id);
    assert.equal(v.executions[0].attempts[0].status, 'failed'); assert.equal(v.executions[0].attempts[0].httpStatus, 401); assert.equal(v.executions[0].attempts[0].providerRequestId, null);
    assert.equal(v.executions[0].error.code, 'SECRET_SANITIZATION_FAILED'); assert.equal(v.readiness.productionReady, false);
    // resume with the same authorization: the fail-closed request is never resent (only never-attempted segments may go)
    s.service.close(); s.service = s.open(); s.service.fetchImpl = async (url, init) => { bodies.push(init.body); return new Response('{}', { status: 401 }); };
    try { s.service.resumeVoice(s.id, p.run.runId); await s.service.idle(); } catch { /* may refuse */ }
    assert.equal(new Set(bodies).size, bodies.length, 'no request body sent twice');
    s.service.close(); s.service = s.open(); v = s.service.view(s.id);
    for (const f of files(s.dir)) { const t = fs.readFileSync(f).toString('latin1').toLowerCase(); for (const x of [secret, Buffer.from(secret).toString('base64'), split]) assert.ok(!t.includes(x.toLowerCase()), path.relative(s.dir, f)); }
    assert.ok(!JSON.stringify(v).toLowerCase().includes(secret.toLowerCase()));
  } finally { s.close(); }
});

test('N2 secret boundary: a key too short to scrub reliably is refused before any intent or request (fail closed)', async () => {
  const s = setup({ apiKey: () => 'short-key' });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    assert.equal(s.provider.calls.length, 0);
    const v = s.service.view(s.id);
    assert.equal(v.executions[0].attempts.length, 0); assert.equal(v.executions[0].error.code, 'API_KEY_UNSAFE'); assert.equal(v.readiness.productionReady, false);
  } finally { s.close(); }
});

// ---------------- N3: stale narration → restart → GET ----------------
test('N3 stale narration: restart + GET never throws and returns persisted, machine-readable stale readiness with zero requests', async () => {
  const s = setup({ autoChain: true, localSteps: FAKE_STEPS });
  try {
    const p = await s.preview(); await s.confirm(p); await s.service.idle();
    let v = s.service.view(s.id);
    s.service.decideReview(s.id, { runId: v.run.runId, bundleHash: v.review.bundleHash, decision: 'accept', acknowledgements: acks(v.review), idempotencyKey: key(301) });
    assert.equal(s.service.view(s.id).readiness.productionReady, true);
    const runId = v.run.runId, run = s.service.coordinator.run2B(runId), c = s.service.candidate(run), calls = s.provider.calls.length;
    const narration = path.join(c.dir, run.inputs.inputRefs.narration.path);
    rewrite(narration, fs.readFileSync(narration, 'utf8') + ' ');
    const tampered = fs.readFileSync(narration);
    const counts = () => s.service.coordinator.get('SELECT (SELECT COUNT(*) FROM steps) steps, (SELECT COUNT(*) FROM executions) executions, (SELECT COUNT(*) FROM receipts) receipts, (SELECT COUNT(*) FROM runs) runs');
    const before = counts();
    s.service.close(); s.service = s.open();
    v = s.service.view(s.id); // must not throw
    assert.equal(v.run.runId, runId); assert.equal(v.run.state, 'stale'); assert.notEqual(v.run.milestone, 'approved');
    assert.ok(v.run.reason.some(r => r.code === 'SEALED_INPUT_CHANGED' && /narration/.test(r.message)), JSON.stringify(v.run.reason));
    assert.deepEqual({ productionReady: v.readiness.productionReady, stale: v.readiness.stale, canPromote: v.readiness.canPromote, canRender: v.readiness.canRender, canReview: v.readiness.canReview, canGenerate: v.readiness.canGenerate }, { productionReady: false, stale: true, canPromote: false, canRender: false, canReview: false, canGenerate: false });
    const inv = v.invalidation;
    assert.equal(inv.stale, true); assert.equal(inv.productionReady, false); assert.equal(inv.invalidatedFrom, 'voice');
    assert.ok(inv.steps.every(x => x.current === false), 'no downstream step counts for a stale run');
    assert.deepEqual(inv.chainBreak && { step: inv.chainBreak.step, code: inv.chainBreak.code }, { step: 'review', code: 'STEP_INPUT_UNAVAILABLE' });
    assert.equal(inv.requires.newFreePreview, true); assert.equal(inv.requires.humanReview, true); assert.equal(inv.requires.paidConfirmation, 'only_if_new_preview_has_misses'); assert.equal(typeof inv.requires.recompile, 'boolean');
    for (const code of ['NEW_FREE_PREVIEW', 'CONFIRM_IF_MISSES', 'REGENERATE_LOCAL_STEPS', 'HUMAN_REVIEW']) assert.ok(inv.nextActions.some(a => a.code === code), code);
    assert.equal(s.service.coordinator.get("SELECT COUNT(*) n FROM reviews WHERE status = 'accepted'").n, 0);
    // read path: no request, no repair, no rebuild, no new execution / step / run
    assert.equal(s.provider.calls.length, calls); assert.deepEqual(counts(), before); assert.deepEqual(fs.readFileSync(narration), tampered);
    assert.throws(() => s.service.media(s.id, 'final'), e => e.status === 404);
    assert.throws(() => s.service.resume(s.id, runId), e => e.status === 409);
    // persisted: another restart gives the same state
    s.service.close(); s.service = s.open();
    const again = s.service.view(s.id);
    assert.equal(again.run.state, 'stale'); assert.deepEqual(again.run.reason, v.run.reason); assert.deepEqual(again.invalidation, v.invalidation); assert.deepEqual(again.readiness, v.readiness);
    assert.equal(s.provider.calls.length, calls); assert.deepEqual(counts(), before);
  } finally { s.close(); }
});
