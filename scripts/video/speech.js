// Loudness of a speaker at time t, for the mascot's mouth.
// Real audio: each line carries `env` (60 values/s, 0..1) measured from its mp3.
// Without audio a syllable-like envelope is synthesised from the word timings.
// Both are pure functions of t, so renders are repeatable.
import { clamp, hash } from "./core.js";

export function createSpeech(lines) {
  const lineAt = (t, speaker) => lines.find((l) => l.speaker === speaker && t >= l.start && t <= l.end) || null;
  function raw(t, speaker) {
    const l = lineAt(t, speaker);
    if (!l) return 0;
    if (l.env) return l.env[clamp(Math.floor((t - l.start) * 60), 0, l.env.length - 1)] || 0;
    const k = l.tokens.find((x) => t >= x.s && t <= x.e);
    if (!k) return 0;
    const d = k.e - k.s, x = t - k.s, env = Math.min(1, x / 0.05, (d - x) / 0.05);
    const seed = 0.65 + 0.35 * ((hash(k.text) % 7) / 6);
    return clamp(env, 0, 1) * seed * (0.45 + 0.55 * Math.abs(Math.sin(x * Math.PI * 6.2)));
  }
  // smoothed over the last `win` seconds so movement follows loudness without jitter
  function level(t, speaker, win = 0.18) {
    const n = 7; let sum = 0;
    for (let i = 0; i < n; i++) sum += raw(t - (i / (n - 1)) * win, speaker);
    return sum / n;
  }
  return { lineAt, raw, level };
}
