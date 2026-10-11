// Cached segments → the two things the renderer consumes: narration.wav and a plan.json.
//
// Local and free: it only reads voice-cache/ and the tracked alignment files; it never calls the API.
// The plan has exactly the shape docs/p2-v4.2/p2-v4.2.plan.json has, so ReadingCue.js / PostTemplate.js need no change:
//   { id, duration, frames, fps, voices, audioEnd, lines: [{ id, lang, text, gap, start, end, duration, words: [{ at, until, pos, count, text }] }] }
//
// Timeline rule (same as the V4.2 prototype): a line starts where the previous one ended plus the previous line's `gap`;
// silent lines (quiz prompts) take their declared duration and add no audio. Each spoken clip is trimmed to its voiced part
// (35 ms before, 50 ms after) and the word times are shifted by exactly the trimmed amount – never re-estimated.
import { AlignmentError, alignmentToWords, remapWordsToDisplay } from "./align.mjs";
import { SAMPLE_RATE as SR, decodeAudio, fade, voicedBounds } from "./audio.mjs";
import { ConfigError } from "./config.mjs";
import { HEAD_PAD, TAIL_PAD, partAudio, splitSentence } from "./split.mjs";

export const FPS = 30;

function trimClip(x) {
  const b = voicedBounds(x);
  if (!b) throw new AlignmentError("the audio is silent");
  const from = Math.max(0, b.first - Math.round(HEAD_PAD * SR)), to = Math.min(x.length, b.last + Math.round(TAIL_PAD * SR));
  const n = Math.round(0.006 * SR);
  return { from, to, audio: fade(x.subarray(from, to), n, n) };
}

/** Rebase words from the untrimmed clip to the trimmed clip: shift by `t0`, clamp into [0, duration]. */
function rebase(words, t0, duration) {
  return words.map((w) => ({ ...w, at: Math.min(duration, Math.max(0, w.at - t0)), until: Math.min(duration, Math.max(0, w.until - t0)) }));
}

/**
 * @param {object} prepared  from prepareNarration
 * @param {object} cache     from createCache
 * @param {object} [deps]    { decode } – injectable for tests
 * @returns {{ plan: object, samples: Float32Array, provenance: object }}
 */
export function assembleNarration(prepared, cache, { decode = decodeAudio, fps = FPS } = {}) {
  const missing = prepared.segments.filter((s) => !s.silent && !cache.has(s.hash)).map((s) => s.id);
  if (missing.length) throw new ConfigError(`cannot assemble: not generated yet: ${missing.join(", ")} (run voice.mjs with --yes)`);

  const lines = [], clips = [], provenance = { segments: [], warnings: [] };
  const voices = {};
  let cursor = 0;

  const place = (line, audio) => {
    line.start = cursor; line.end = cursor + line.duration; line.start = +line.start.toFixed(6); line.end = +line.end.toFixed(6);
    lines.push(line);
    if (audio) clips.push({ at: Math.round(line.start * SR), audio });
    cursor = line.end + line.gap;
  };

  const bySegment = new Map(prepared.segments.map((s) => [s.id, s]));
  const decoded = new Map(); // a split sentence is decoded and cut once, however many parts it has
  const notes = new Map();
  for (const item of prepared.order) {
    const seg = bySegment.get(item.segment);
    if (seg.silent) {
      place({ id: seg.id, lang: null, text: "", gap: seg.gap, duration: seg.duration, words: [], silent: true, alignment: "silent visual segment; no recorded narration" }, null);
      notes.set(seg.id, { id: seg.id, silent: true });
      continue;
    }
    voices[seg.lang] = `ElevenLabs ${seg.voiceName} (${seg.voice.model}, ${seg.voice.voiceId})`;
    const { alignment } = cache.readAlignment(seg.hash);
    const x = decoded.get(seg.id)?.x ?? decode(cache.audioPath(seg.hash));
    const tokens = seg.lang === "zh" ? "none" : "whitespace";

    if (seg.parts) {
      if (!decoded.has(seg.id)) {
        const r = splitSentence(seg, alignment, x);
        decoded.set(seg.id, { x, r });
        notes.set(seg.id, { id: seg.id, hash: seg.hash, voice: seg.voiceName, sourceDuration: +(x.length / SR).toFixed(3), parts: r.parts.map((p) => p.id), cuts: r.cuts });
        provenance.warnings.push(...r.warnings);
      }
      const p = decoded.get(seg.id).r.parts.find((q) => q.id === item.part);
      place({ id: p.id, lang: seg.lang, text: p.text, gap: p.gap, duration: p.duration, words: p.words, alignment: `ElevenLabs character alignment, part of ${seg.id} (${seg.hash.slice(0, 8)})` }, partAudio(x, p));
    } else {
      const { from, to, audio } = trimClip(x);
      const t0 = from / SR, duration = (to - from) / SR;
      let words = alignmentToWords(seg.speak, alignment, { audioDuration: x.length / SR, tolerance: 0.25, tokens }).words;
      words = remapWordsToDisplay(words, seg.speak, seg.text);
      place({ id: seg.id, lang: seg.lang, text: seg.text, gap: seg.gap, duration, words: rebase(words, t0, duration), alignment: `ElevenLabs character alignment (${seg.hash.slice(0, 8)})` }, audio);
      notes.set(seg.id, { id: seg.id, hash: seg.hash, voice: seg.voiceName, sourceDuration: +(x.length / SR).toFixed(3) });
    }
  }
  provenance.segments = [...notes.values()];

  const spoken = lines.filter((l) => !l.silent);
  const audioEnd = spoken.length ? spoken.at(-1).end : 0;
  const lastEnd = Math.max(...lines.map((l) => l.end));
  const frames = Math.ceil(lastEnd * fps - 1e-9), duration = frames / fps;

  const samples = new Float32Array(Math.round(duration * SR));
  for (const c of clips) {
    if (c.at + c.audio.length > samples.length) throw new AlignmentError("a clip runs past the end of the timeline");
    samples.set(c.audio, c.at);
  }
  for (let i = 1; i < lines.length; i++) if (lines[i].start < lines[i - 1].end - 1e-9) throw new AlignmentError(`lines overlap: ${lines[i - 1].id} / ${lines[i].id}`);

  const plan = { id: `${prepared.id}-auto`, duration, frames, fps, voices, audioEnd, source: "ElevenLabs voice pipeline (voice.mjs → assemble)", lines };
  return { plan, samples, provenance: { ...provenance, duration, audioEnd, frames } };
}
