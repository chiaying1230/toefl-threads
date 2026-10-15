// REVIEW ONLY: final finite N2 checks, valid synthetic TTS responses, runtime fake key, temporary workspace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { setup } from './test-support.mjs';
import { synthAudio } from './mock-provider.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { DECODE_DEPTH } from './paid-voice.mjs';

const pct = s => [...s].map(c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
const b64 = s => Buffer.from(s).toString('base64');
const layers = (s, n, alternating = false) => { let t = s; for (let i = 0; i < n; i++) t = Buffer.from(t).toString(alternating && i % 2 ? 'hex' : 'base64'); return t; };
const files = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? files(path.join(d, x.name)) : [path.join(d, x.name)]);

// Exactly one confirmed miss: the other real fixture segments are pinned from local synthetic pairs.
// This isolates retry/resume of the rejected request from separately authorized, never-attempted requests.
function pinOtherSegments(s) {
  const prepared = prepareNarration(s.wf.read(s.store.get(s.id), 'narration'), loadVoiceConfig(), { requireApiKey: false, env: {} });
  const unique = [...new Map(prepared.segments.filter(x => !x.silent).map(x => [x.hash, x])).values()];
  for (const seg of unique.slice(1)) {
    const pair = synthAudio(seg.speak);
    s.service.voiceStore.publish(seg.hash, pair.audio, Buffer.from(JSON.stringify({ hash: seg.hash, text: seg.speak, voiceId: seg.voice.voiceId, model: seg.voice.model, settings: seg.voice.settings, languageCode: seg.voice.languageCode ?? null, takeId: seg.voice.takeId ?? null, outputFormat: prepared.outputFormat, previousText: seg.previousText ?? null, nextText: seg.nextText ?? null, alignment: pair.alignment })));
  }
}

const attacks = {
  literal: k => k,
  'base64-percent-composition': k => b64(pct(k)),
  'double-base64': k => layers(k, 2),
  'depth-plus-one-base64': k => layers(k, DECODE_DEPTH + 1),
  'depth-plus-two-alternating': k => layers(k, DECODE_DEPTH + 2, true),
  'segmented': k => JSON.stringify([...k]),
  'depth-plus-one-binary-padded': k => {
    // Standard base64 with non-printable padding around the credential, then four further base64 layers.
    const bytes = Buffer.concat([Buffer.alloc(256, 1), Buffer.from(k), Buffer.alloc(256, 1)]);
    const t = layers(bytes.toString('base64'), DECODE_DEPTH);
    let decoded = t;
    for (let i = 0; i < DECODE_DEPTH; i++) decoded = Buffer.from(decoded, 'base64').toString();
    assert.deepEqual(Buffer.from(decoded, 'base64'), bytes, 'independent reversible-encoding oracle');
    return t;
  },
};

for (const mode of [...Object.keys(attacks), 'allowlisted-header-secret', 'unexpected-headers', 'deep-header', 'transport-echo']) test(`N2 FINAL success/persistence: ${mode}`, async () => {
  const secret = `sk_${randomBytes(24).toString('hex')}`, encoded = attacks[mode]?.(secret) ?? (mode === 'deep-header' ? layers(secret, DECODE_DEPTH + 2) : secret);
  const s = setup({ apiKey: () => secret }); let requests = 0, originalRaw;
  const failClosed = Boolean(attacks[mode]) || mode === 'deep-header';
  const transport = async (_url, init) => {
    requests++;
    if (mode === 'transport-echo') throw Object.assign(new Error(`transport echo ${encoded}`), { name: secret, cause: { code: secret.toUpperCase() } });
    const pair = synthAudio(JSON.parse(init.body).text);
    const body = { audio_base64: pair.audio.toString('base64'), alignment: pair.alignment, normalized_alignment: null };
    if (attacks[mode]) body.provider_diagnostic = encoded;
    let headers = { 'content-type': 'application/json', 'request-id': 'safe-request-id' };
    if (mode === 'allowlisted-header-secret') headers = { ...headers, 'request-id': secret, 'history-item-id': b64(pct(secret)), 'character-cost': '17' };
    if (mode === 'deep-header') headers['request-id'] = encoded;
    if (mode === 'unexpected-headers') headers = { 'Request-ID': 'safe-request-id', 'Content-Type': 'application/json', 'X-Request-ID-Extra': 'unapproved', 'foo-history-item-id': 'unapproved', [`x-request-id-${secret}`]: 'unapproved', 'x-unexpected': encoded, 'character-cost': '17' };
    originalRaw = JSON.stringify(body);
    return new Response(originalRaw, { status: 200, headers });
  };
  try {
    pinOtherSegments(s); s.service.fetchImpl = transport;
    const p = await s.preview(); assert.equal(p.envelope.requests.length, 1, 'exactly one authorized miss');
    await s.confirm(p); await s.service.idle(); assert.equal(requests, 1);
    const c = s.service.candidate(s.service.coordinator.run2B(p.run.runId)), dir = path.join(c.dir, 'voice/responses');
    const saved = fs.existsSync(dir) ? JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')) : null;
    const needles = [secret, encoded, JSON.stringify(encoded).slice(1, -1)].map(x => x.toLowerCase());
    const scan = () => files(s.dir).filter(f => needles.some(n => fs.readFileSync(f).toString('latin1').toLowerCase().includes(n))).map(f => path.relative(s.dir, f));
    const liveLeaks = scan();
    s.service.close(); s.service = s.open(); s.service.fetchImpl = transport;
    const view = s.service.view(s.id), restoredLeaks = scan();
    assert.equal(view.readiness.productionReady, false);
    // Invoke real resume after restart; a rejected attempted hash must never be sent again.
    try { s.service.resumeVoice(s.id, p.run.runId); await s.service.idle(); } catch (e) { assert.equal(e.status, 409); }
    assert.equal(requests, 1, 'no automatic retry, restart/GET/resume must not resend');
    const after = s.service.view(s.id), resumedLeaks = scan();
    const allLeaks = [...new Set([...liveLeaks, ...restoredLeaks, ...resumedLeaks])];
    const uiLeak = needles.some(n => JSON.stringify(after).toLowerCase().includes(n));
    console.info(`N2 FINAL ${mode}: omitted=${saved?.raw === null}; requestCount=${requests}; leakPaths=${allLeaks.length}; uiLeak=${uiLeak}; errorCode=${view.executions[0].error?.code ?? 'none'}`);
    assert.deepEqual(allLeaks, [], 'credential-bearing durable artifact found; paths only');
    assert.equal(uiLeak, false);
    if (failClosed) {
      assert.ok(saved?.raw === null, 'success body/header at unsafe or undecidable encoding depth must be omitted');
      assert.deepEqual(saved.headers, {}); assert.equal(saved.sanitization.failed, 'SECRET_SANITIZATION_FAILED');
      assert.equal(view.executions[0].error.code, 'SECRET_SANITIZATION_FAILED');
      assert.equal(view.executions[0].attempts[0].providerRequestId, null);
    } else if (!transport || mode !== 'transport-echo') {
      assert.equal(saved.raw, originalRaw, 'clean success remains verbatim for replay');
      assert.equal(view.run.milestone, 'voice_generated');
      if (mode === 'unexpected-headers') assert.deepEqual(saved.headers, { 'content-type': 'application/json', 'request-id': 'safe-request-id', 'character-cost': '17' });
      if (mode === 'allowlisted-header-secret') { assert.equal(saved.headers['request-id'], undefined); assert.equal(saved.headers['history-item-id'], undefined); assert.equal(view.executions[0].attempts[0].providerRequestId, null); }
    }
  } finally { s.close(); }
});
