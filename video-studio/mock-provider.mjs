// TEST ONLY. A local stand-in for the ElevenLabs /with-timestamps endpoint: it never touches the network.
// For the text it receives it builds a real MP3 (tone bursts per character, silence on spaces / punctuation, encoded by ffmpeg)
// and the matching character alignment, so the real assemble / render / verify pipeline can run on fixtures for free.
// `behavior(call)` can return { status, body } / { throw } / { hang } to simulate provider failures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findFfmpeg, writeWav, SAMPLE_RATE as SR } from '../scripts/video/voice/audio.mjs';

export function synthAudio(text) {
  const chars = [...text], starts = [], ends = [];
  const lead = 0.12, voiced = /[\p{L}\p{N}]/u, zh = /[㐀-鿿]/u;
  let t = lead; const spans = [];
  for (const c of chars) {
    const d = zh.test(c) ? 0.17 : voiced.test(c) ? 0.055 : c === ' ' ? 0.06 : 0.09;
    starts.push(+t.toFixed(4)); t += d; ends.push(+t.toFixed(4));
    if (voiced.test(c)) spans.push([starts.at(-1), ends.at(-1)]);
  }
  const total = t + 0.15, samples = new Float32Array(Math.round(total * SR));
  for (const [a, b] of spans) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) samples[i] = 0.22 * Math.sin(2 * Math.PI * 190 * i / SR) + 0.08 * Math.sin(2 * Math.PI * 570 * i / SR);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-mock-tts-'));
  try {
    writeWav(path.join(dir, 'a.wav'), samples);
    const r = spawnSync(findFfmpeg(), ['-v', 'error', '-y', '-i', path.join(dir, 'a.wav'), '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', String(SR), path.join(dir, 'a.mp3')]);
    if (r.status !== 0) throw Error(`mock mp3 encode failed: ${String(r.stderr).slice(0, 200)}`);
    return { audio: fs.readFileSync(path.join(dir, 'a.mp3')), alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function mockProvider(behavior = () => null) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body), call = { url, body, headers: init.headers, n: calls.length + 1 };
    calls.push(call);
    const b = behavior(call) || {};
    if (b.throw) throw b.throw;
    if (b.hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
    if (b.status) return new Response(b.body ?? JSON.stringify({ detail: { status: 'error', message: 'mock failure' } }), { status: b.status, headers: { 'request-id': `mock-${call.n}` } });
    if (b.raw !== undefined) return new Response(b.raw, { status: 200, headers: { 'request-id': `mock-${call.n}` } });
    const { audio, alignment } = synthAudio(body.text);
    const payload = { audio_base64: audio.toString('base64'), alignment: b.alignment ? b.alignment(alignment) : alignment, normalized_alignment: null };
    if (b.noAlignment) delete payload.alignment;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json', 'request-id': `mock-${call.n}` } });
  };
  return { fetchImpl, calls };
}
