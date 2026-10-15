// REVIEW/PREFLIGHT ONLY: exact production code; real frozen recordings are READ ONLY.
// Native HTTP fetch is restricted to this test's loopback server. No real API key,
// no external request, no P6, no production render or promotion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { setup, ACK, key } from './test-support.mjs';
import { buildRequest, synthesizeWithTimestamps } from '../scripts/video/voice/elevenlabs.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { createCache } from '../scripts/video/voice/cache.mjs';
import { assembleNarration } from '../scripts/video/voice/assemble.mjs';
import { alignmentToWords } from '../scripts/video/voice/align.mjs';
import { decodeAudio, SAMPLE_RATE } from '../scripts/video/voice/audio.mjs';
import { validatePair } from './voice-envelope.mjs';
import { bufferHash } from './hashing.mjs';
import { root } from './server.mjs';
import { runNode } from './production-steps.mjs';
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'scripts/video/voices.json'), 'utf8'));
const nativeLoopbackFetch = globalThis.fetch;
const DUMMY = 'preflight-dummy-not-an-api-key';
let recorded;

test('ZERO PAID: current envelope reconstructs exact provider request/roles/parts/settings/accounting for all fixture types', async () => {
  for (const kind of ['single', 'phrase', 'multiple']) {
    const s = setup({ kind });
    try {
      const p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), envelope = c.readJson(run.inputs.envelopes.at(-1));
      const prepared = prepareNarration(c.readJson(run.inputs.inputRefs.narration), s.service.voiceConfig(run), { requireApiKey: false, env: {} });
      for (const r of envelope.requests) {
        const seg = prepared.segments.find(x => x.hash === r.segmentHash);
        const request = buildRequest({ voice: seg.voice, text: seg.speak, previousText: seg.previousText, nextText: seg.nextText, apiBase: prepared.apiBase, outputFormat: prepared.outputFormat });
        assert.equal(new URL(request.url).origin, 'https://api.elevenlabs.io');
        assert.equal(new URL(request.url).pathname, `/v1/text-to-speech/${seg.voice.voiceId}/with-timestamps`);
        assert.equal(new URL(request.url).searchParams.get('output_format'), 'mp3_44100_128');
        assert.equal(bufferHash(Buffer.from(JSON.stringify(request.body))), r.requestBodyHash);
        assert.equal(request.body.text, r.text); assert.equal(request.body.model_id, r.model);
        assert.deepEqual(request.body.voice_settings, r.settings); assert.equal(r.chars, r.text.length);
        assert.equal(r.speaker, cfg.roles[r.kind]); assert.equal(r.voiceId, cfg.voices[r.speaker].voiceId);
        if (seg.parts) assert.equal(envelope.requests.filter(x => x.segmentHash === seg.hash).length, 1);
      }
      assert.equal(envelope.requests.reduce((n, r) => n + r.chars, 0), envelope.charsFromPlanner);
      assert.equal(s.provider.calls.length, 0); assert.equal(s.service.coordinator.all('SELECT * FROM receipts').length, 0);
    } finally { s.close(); }
  }
});

test('ZERO PAID: 46 real cached recordings/alignment parse, timestamp validation and five interrupted sentences assemble read-only', async () => {
  const cache = createCache({ audioDir: path.join(root, 'voice-cache'), alignmentDir: path.join(root, 'scripts/video/narration/alignment') });
  let spoken = 0, interrupted = 0;
  for (const id of ['p2', 'p348', 'toeic-079', 'ielts-068']) {
    const narration = JSON.parse(fs.readFileSync(path.join(root, `scripts/video/narration/${id}.json`), 'utf8'));
    const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} });
    for (const seg of prepared.segments.filter(x => !x.silent)) {
      assert.ok(cache.has(seg.hash), `${id}/${seg.id}`);
      const audio = fs.readFileSync(cache.audioPath(seg.hash)), entry = cache.readAlignment(seg.hash);
      const raw = JSON.stringify({ audio_base64: audio.toString('base64'), alignment: entry.alignment, normalized_alignment: null });
      const params = { voice: seg.voice, text: seg.speak, previousText: seg.previousText, nextText: seg.nextText, outputFormat: prepared.outputFormat, apiBase: prepared.apiBase, apiKey: DUMMY };
      const result = await synthesizeWithTimestamps({ ...params, fetchImpl: async (url, init) => {
        const expected = buildRequest(params); assert.equal(url, expected.url); assert.equal(init.method, 'POST'); assert.equal(init.body, JSON.stringify(expected.body)); return new Response(raw, { status: 200 });
      } });
      assert.equal(bufferHash(result.audio), bufferHash(audio));
      const words = alignmentToWords(seg.speak, result.alignment, { audioDuration: decodeAudio(cache.audioPath(seg.hash)).length / SAMPLE_RATE, tokens: seg.lang === 'zh' ? 'none' : 'whitespace' });
      assert.ok(words.speechEnd > words.speechStart); assert.equal(result.characters, seg.speak.length);
      validatePair(seg, prepared.outputFormat, cache.audioPath(seg.hash), fs.readFileSync(cache.alignmentPath(seg.hash), 'utf8'));
      spoken++; if (seg.parts) interrupted++;
      recorded ||= { params, raw, alignment: entry.alignment };
    }
    const assembled = assembleNarration(prepared, cache);
    const frozenPlan = JSON.parse(fs.readFileSync(path.join(root, `docs/${id}-auto/${id}-auto.plan.json`), 'utf8'));
    assert.equal(assembled.plan.frames, frozenPlan.frames); assert.deepEqual(assembled.plan.lines.map(l => l.id), frozenPlan.lines.map(l => l.id));
    for (const seg of prepared.segments.filter(x => x.parts)) for (const p of seg.parts) assert.ok(assembled.plan.lines.some(l => l.id === p.id));
  }
  assert.equal(spoken, 46); assert.equal(interrupted, 5);
  // Client parser rejects incomplete response; alignment validator rejects incomplete/backward timestamp arrays.
  for (const body of ['{bad json', '{}', '{"audio_base64":"YQ=="}', '{"audio_base64":"","alignment":{}}']) await assert.rejects(synthesizeWithTimestamps({ ...recorded.params, fetchImpl: async () => new Response(body) }));
  const truncated = { ...recorded.alignment, character_end_times_seconds: recorded.alignment.character_end_times_seconds.slice(1) };
  assert.throws(() => alignmentToWords(recorded.params.text, truncated));
  assert.throws(() => alignmentToWords(recorded.params.text, { ...recorded.alignment, character_start_times_seconds: recorded.alignment.character_start_times_seconds.map((t, i) => i === 1 ? -1 : t) }));
});

test('ZERO PAID: native loopback transport serializes real client requests and rejects HTTP failure, truncated bodies, timeout, bad JSON', async () => {
  assert.ok(recorded); let mode = 'success', requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const b of req) chunks.push(b);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (mode === 'timeout') return;
    if (mode === 'truncated') { res.writeHead(200, { 'content-length': 100000 }); res.write('{'); return res.destroy(); }
    if (mode === 'http') { res.writeHead(500); return res.end(JSON.stringify({ detail: { message: 'loopback failure' } })); }
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'loopback-recorded' }); res.end(mode === 'malformed' ? '{bad' : recorded.raw);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const restrictedFetch = (url, init) => { assert.equal(new URL(url).origin, base); return nativeLoopbackFetch(url, init); };
  try {
    const params = { ...recorded.params, apiBase: base, fetchImpl: restrictedFetch, timeoutMs: 3000 };
    const result = await synthesizeWithTimestamps(params); assert.ok(result.audio.length);
    assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].headers['xi-api-key'], DUMMY);
    assert.equal(requests[0].headers['content-type'], 'application/json'); assert.equal(requests[0].headers.accept, 'application/json');
    assert.equal(requests[0].body, JSON.stringify(buildRequest(params).body));
    for (const m of ['http', 'truncated', 'timeout', 'malformed']) {
      mode = m; await assert.rejects(synthesizeWithTimestamps({ ...params, timeoutMs: m === 'timeout' ? 100 : 3000 }), e => ['SERVER','NETWORK','TIMEOUT','BAD_RESPONSE'].includes(e.code));
    }
    assert.equal(requests.length, 5);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('ZERO PAID: guarded Studio adapter persists real HTTP responses in loopback; streaming failure stays unknown without retry', async () => {
  let mode = 'success', count = 0, accepted = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const b of req) chunks.push(b); count++;
    const body = JSON.parse(Buffer.concat(chunks).toString()); accepted.push({ text: body.text, method: req.method, headers: req.headers });
    if (mode === 'truncated') { res.writeHead(200, { 'content-length': 999999 }); res.write('{'); return res.destroy(); }
    const nativeResponse = await current.provider.fetchImpl('mock://loopback', { body: JSON.stringify(body), headers: {}, signal: AbortSignal.timeout(5000) });
    res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'loopback-guarded' }); res.end(await nativeResponse.text());
  });
  let current;
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const m of ['success', 'truncated']) {
      current = setup(); mode = m; const before = count;
      try {
        // The adapter retains and checks the real ElevenLabs URL/body; ONLY this injected test transport maps to loopback.
        current.service.fetchImpl = (url, init) => { assert.equal(new URL(url).origin, 'https://api.elevenlabs.io'); return nativeLoopbackFetch(base + new URL(url).pathname + new URL(url).search, init); };
        const p = await current.preview(); await current.confirm(p, key(301)); await current.service.idle();
        const v = current.service.view(current.id), run = current.service.coordinator.run2B(p.run.runId), c = current.service.candidate(run);
        if (m === 'success') {
          assert.equal(count - before, 4); assert.equal(v.run.milestone, 'voice_generated');
          const attempts = current.service.coordinator.attempts(v.executions[0].executionId);
          for (const a of attempts) { assert.equal(a.status, 'succeeded'); assert.equal(a.provider_request_id, 'loopback-guarded'); c.verify(a.response_ref); }
          assert.ok(accepted.slice(before).every(r => r.method === 'POST' && r.headers['xi-api-key'] === 'test-key-not-real'));
        } else { assert.equal(count - before, 1); assert.equal(v.executions[0].attempts[0].status, 'unknown'); assert.throws(() => current.service.resumeVoice(current.id, run.run_id)); }
      } finally { current.close(); }
    }
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('ZERO PAID: candidate subprocess env excludes the dummy key; no candidate .env or git copy', async () => {
  const s = setup(), prior = process.env.ELEVENLABS_API_KEY;
  try {
    const p = await s.preview(), run = s.service.coordinator.run2B(p.run.runId), c = s.service.candidate(run), attempt = c.attemptRoot('review-env', '00000000-0000-0000-0000-000000000077');
    assert.ok(!fs.existsSync(path.join(attempt, '.env')) && !fs.existsSync(path.join(attempt, '.git')));
    process.env.ELEVENLABS_API_KEY = DUMMY;
    const r = await runNode({ cwd: attempt, script: '-e', args: ['process.stdout.write(JSON.stringify({hasKey:Object.hasOwn(process.env,"ELEVENLABS_API_KEY")}))'], logDir: path.dirname(attempt) });
    assert.equal(r.code, 0); assert.equal(JSON.parse(r.stdout).hasKey, false); assert.ok(!r.stdout.includes(DUMMY));
    assert.equal(s.provider.calls.length, 0);
  } finally { if (prior === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prior; s.close(); }
});
