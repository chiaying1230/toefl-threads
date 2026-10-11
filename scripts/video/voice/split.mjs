// Cut one generated sentence into the parts a narration segment declares (see `parts` in segments.mjs).
//
//   alignment  → where each cut roughly is (end of the part's last word … start of the next word)
//   audio      → the exact cut: the quietest 8 ms inside that window, found automatically (no hand-tuned times)
//
// Output per part: the sample range to keep, its own `words[]` (pos relative to the part text, times relative to
// the part's first sample) – the same shape ReadingCue.js already reads. Nothing is interpolated; if no clearly
// quiet point exists the cut still happens at the quietest point and a warning is returned so it can be listened to.
import { AlignmentError, alignmentToWords } from "./align.mjs";
import { SAMPLE_RATE, fade, rms, voicedBounds } from "./audio.mjs";

const CUT_WINDOW = 0.008;     // seconds of audio compared per candidate cut point
const SEARCH_PAD = 0.04;      // how far outside the word gap the search may reach
const QUIET_RATIO = 0.15;     // cut level / median speech level above which we warn
const LATE_WINDOW = 0.002, LATE_RATIO = 0.25; // cut: "late" – the latest point before the next word whose 2 ms level is still this quiet (relative to median speech level): after a stop's release burst, before the vowel
export const HEAD_PAD = 0.035, TAIL_PAD = 0.05; // silence kept around the voiced part of every clip (as in V4.2)

/** start/end seconds of the alignment element that contains string index `i` of the spoken text. */
function elementAt(alignment, i) {
  let offset = 0;
  for (let k = 0; k < alignment.characters.length; k++) {
    const len = alignment.characters[k].length;
    if (i < offset + len) return { start: alignment.character_start_times_seconds[k], end: alignment.character_end_times_seconds[k] };
    offset += len;
  }
  throw new AlignmentError(`no alignment element at text index ${i}`);
}

/**
 * A cut point inside [lo, hi] samples: among the points that are about as quiet as the quietest one, the one
 * nearest `prefer` (the middle of the gap), so the cut sits in the middle of the silence rather than at its edge.
 */
export function quietestPoint(x, lo, hi, prefer, sr = SAMPLE_RATE) {
  const win = Math.round(sr * CUT_WINDOW), step = Math.max(1, Math.round(sr * 0.001));
  const points = [];
  for (let p = Math.max(win >> 1, lo); p <= Math.min(x.length - (win >> 1), hi); p += step) points.push({ p, level: rms(x, p - (win >> 1), p + (win >> 1)) });
  if (!points.length) throw new AlignmentError("no room to search for a cut point");
  const floor = Math.min(...points.map((q) => q.level));
  const limit = Math.max(floor * 1.5, 0.002);
  return points.filter((q) => q.level <= limit).reduce((a, b) => (Math.abs(b.p - prefer) < Math.abs(a.p - prefer) ? b : a));
}

/**
 * cut: "late" – for a sentence whose previous word ends in a stop consonant that is released into the next word
 * ("accused of"): the quietest point is the stop's closure, which would leave the release burst at the start of the
 * next part ("d-uh returning"). Cut instead at the latest point before the next word that is still quiet, i.e. after the release.
 */
export function latePoint(x, wordEnd, nextStart, median, sr = SAMPLE_RATE) {
  const win = Math.round(sr * LATE_WINDOW), step = Math.max(1, Math.round(sr * 0.0005)), lo = Math.round(wordEnd * sr);
  for (let p = Math.min(x.length - (win >> 1), Math.round(nextStart * sr)); p >= Math.max(win >> 1, lo); p -= step) {
    const level = rms(x, p - (win >> 1), p + (win >> 1));
    if (level <= median * LATE_RATIO) return { p, level };
  }
  return null;
}

/**
 * @param {object} seg        a prepared spoken segment with `parts` (text, parts[])
 * @param {object} alignment  the API alignment for seg.speak
 * @param {Float32Array} x    the decoded audio of that sentence
 * @returns {{ parts: object[], cuts: object[], warnings: string[] }}
 */
export function splitSentence(seg, alignment, x, sr = SAMPLE_RATE) {
  if (!seg.parts || seg.parts.length < 2) throw new AlignmentError(`${seg.id}: nothing to split`);
  if (seg.speak !== seg.text) throw new AlignmentError(`${seg.id}: parts need speak === text`);
  const duration = x.length / sr;
  const bounds = voicedBounds(x, 0.004, sr);
  if (!bounds) throw new AlignmentError(`${seg.id}: the audio is silent`);
  const words = alignmentToWords(seg.speak, alignment, { audioDuration: duration, tolerance: 0.25 }).words;

  const warnings = [], cuts = [];
  for (let i = 0; i < seg.parts.length - 1; i++) {
    const a = seg.parts[i], b = seg.parts[i + 1];
    const wordEnd = elementAt(alignment, a.charTo - 1).end, nextStart = elementAt(alignment, b.charFrom).start;
    const lo = Math.round((Math.min(wordEnd, nextStart) - SEARCH_PAD) * sr), hi = Math.round((Math.max(wordEnd, nextStart) + SEARCH_PAD) * sr);
    const mid = Math.round(((wordEnd + nextStart) / 2) * sr);
    const late = b.cut === "late" ? latePoint(x, wordEnd, nextStart, bounds.medianLevel, sr) : null;
    if (b.cut === "late" && !late) warnings.push(`${seg.id}: cut "late" before "${b.id}" found no quiet point before the next word – used the quietest point instead`);
    const q = late ?? quietestPoint(x, Math.max(0, lo), Math.min(x.length, hi), mid, sr);
    const ratio = q.level / bounds.medianLevel;
    if (ratio > QUIET_RATIO && !late) warnings.push(`${seg.id}: cut before "${b.id}" is not clearly quiet (level ${(ratio * 100).toFixed(0)}% of speech) – listen to this join`);
    cuts.push({ before: b.id, sample: q.p, at: q.p / sr, wordEnd, nextStart, ratio: +ratio.toFixed(3), ...(late ? { cut: "late" } : {}) });
  }

  const edges = [0, ...cuts.map((c) => c.sample), x.length];
  const parts = seg.parts.map((p, i) => {
    // the cut only divides the audio; each part then drops its own leading / trailing silence like any other segment
    const own = voicedBounds(x.subarray(edges[i], edges[i + 1]), 0.004, sr);
    if (!own) throw new AlignmentError(`${seg.id}: part "${p.id}" has no speech after cutting`);
    const from = Math.max(edges[i], edges[i] + own.first - Math.round(HEAD_PAD * sr));
    const to = Math.min(edges[i + 1], edges[i] + own.last + Math.round(TAIL_PAD * sr));
    const t0 = from / sr, dur = (to - from) / sr;
    const partWords = words.filter((w) => w.pos >= p.charFrom && w.pos < p.charTo).map((w) => ({
      at: Math.max(0, w.at - t0), until: Math.max(0, Math.min(dur, w.until - t0)), pos: w.pos - p.charFrom, count: w.count, text: w.text,
    }));
    return { id: p.id, text: p.text, gap: p.gap, from, to, start: t0, duration: dur, words: partWords };
  });
  return { parts, cuts, warnings };
}

/** The audio of one part, with short fades so a cut never clicks. */
export function partAudio(x, part, sr = SAMPLE_RATE, fadeMs = 6) {
  const n = Math.round((fadeMs / 1000) * sr);
  return fade(x.subarray(part.from, part.to), n, n);
}
