// Small audio helpers for the local (free) assembly steps: decode, loudness blocks, trim, WAV output.
// Decoding uses ffmpeg: $FFMPEG_PATH, else the ffmpeg the existing V4.2 render scripts use, else `ffmpeg` on PATH.
import fs from "node:fs";
import { spawnSync } from "node:child_process";

export const SAMPLE_RATE = 44100;
const KNOWN_FFMPEG = "C:/Users/123/OneDrive/桌面/Arc/tools/x64/ffmpeg-win64.exe";

export function findFfmpeg(env = process.env) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  return fs.existsSync(KNOWN_FFMPEG) ? KNOWN_FFMPEG : "ffmpeg";
}

/** Decode any audio file to mono float32 at SAMPLE_RATE. */
export function decodeAudio(file, ffmpeg = findFfmpeg()) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"], { maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.error?.message || String(r.stderr).slice(0, 200)}`);
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 4)));
}

export function rms(x, from, to) {
  let s = 0;
  const a = Math.max(0, from), b = Math.min(x.length, to);
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return b > a ? Math.sqrt(s / (b - a)) : 0;
}

/** First / last sample that is louder than `threshold` in 10 ms blocks (the V4.2 voiced-speech criterion). */
export function voicedBounds(x, threshold = 0.004, sr = SAMPLE_RATE) {
  const w = Math.round(sr * 0.01), levels = [];
  for (let i = 0; i < x.length; i += w) levels.push(rms(x, i, i + w));
  const active = levels.map((v, i) => (v > threshold ? i : -1)).filter((i) => i >= 0);
  if (!active.length) return null;
  const voiced = levels.filter((v) => v > threshold).sort((p, q) => p - q);
  return { first: active[0] * w, last: Math.min(x.length, (active.at(-1) + 1) * w), medianLevel: voiced[voiced.length >> 1] };
}

export function fade(x, inSamples, outSamples) {
  const y = Float32Array.from(x);
  const a = Math.min(inSamples, y.length >> 1), b = Math.min(outSamples, y.length >> 1);
  for (let i = 0; i < a; i++) y[i] *= i / a;
  for (let i = 0; i < b; i++) y[y.length - 1 - i] *= i / b;
  return y;
}

export function concat(chunks) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function writeWav(file, samples, sr = SAMPLE_RATE) {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, pcm]));
}
