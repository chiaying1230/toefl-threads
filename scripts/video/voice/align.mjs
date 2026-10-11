// ElevenLabs character alignment → the `words` array the renderer already reads.
//
//   in : { characters[], character_start_times_seconds[], character_end_times_seconds[] }  (the API's
//        `alignment`, NOT `normalized_alignment`: its characters match the text we sent)
//   out: [{ at, until, pos, count, text }]  – same contract as docs/p2-v4.2/p2-v4.2.plan.json and
//        reference/ReadingCue.js: one entry per whitespace-delimited token, `pos`/`count` are the
//        token's position and length in the source text, `text` is the token without edge punctuation,
//        `until` is the next token's `at` (the last token ends where its last character ends).
//
// Times are the API's own, relative to the start of the audio, unmodified. Nothing is interpolated or
// repaired: any inconsistency throws AlignmentError.

export class AlignmentError extends Error {
  constructor(message) { super(message); this.name = "AlignmentError"; }
}

const EPS = 1e-6;

function checkAlignment(text, a, audioDuration, tolerance) {
  if (!a || typeof a !== "object") throw new AlignmentError("alignment is missing");
  const { characters: c, character_start_times_seconds: s, character_end_times_seconds: e } = a;
  if (![c, s, e].every(Array.isArray)) throw new AlignmentError("alignment needs characters, character_start_times_seconds and character_end_times_seconds arrays");
  if (c.length !== s.length || c.length !== e.length) throw new AlignmentError(`alignment array lengths differ (characters ${c.length}, starts ${s.length}, ends ${e.length})`);
  if (!c.length) throw new AlignmentError("alignment is empty");
  if (c.some((x) => typeof x !== "string" || x.length === 0)) throw new AlignmentError("alignment characters must be non-empty strings");
  if (c.join("") !== text) throw new AlignmentError("alignment characters do not equal the source text (text was changed or normalised by the API)");
  for (let i = 0; i < c.length; i++) {
    if (![s[i], e[i]].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) throw new AlignmentError(`alignment time at character ${i} is not a finite number >= 0`);
    if (e[i] < s[i] - EPS) throw new AlignmentError(`alignment character ${i} ends before it starts`);
    if (i && (s[i] < s[i - 1] - EPS || e[i] < e[i - 1] - EPS)) throw new AlignmentError(`alignment times go backwards at character ${i}`);
  }
  if (audioDuration != null && e[e.length - 1] > audioDuration + tolerance) {
    throw new AlignmentError(`alignment ends at ${e[e.length - 1].toFixed(3)}s, beyond the audio (${audioDuration.toFixed(3)}s + ${tolerance}s tolerance)`);
  }
}

/**
 * @param {string} text   exactly the string that was sent to the API
 * @param {object} alignment  the API's `alignment`
 * @param {object} [opts]
 * @param {number|null} [opts.audioDuration]  seconds; when given the last time must not exceed it by more than `tolerance`
 * @param {number} [opts.tolerance=0.25]
 * @param {"whitespace"|"none"} [opts.tokens="whitespace"]  "none" returns words: [] (phrase-level, e.g. Chinese lines)
 * @returns {{ words: object[], speechStart: number, speechEnd: number }}
 */
export function alignmentToWords(text, alignment, { audioDuration = null, tolerance = 0.25, tokens = "whitespace" } = {}) {
  if (typeof text !== "string" || !text) throw new AlignmentError("source text must be a non-empty string");
  checkAlignment(text, alignment, audioDuration, tolerance);
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const speechStart = starts[0], speechEnd = ends[ends.length - 1];
  if (tokens === "none") return { words: [], speechStart, speechEnd };
  if (tokens !== "whitespace") throw new AlignmentError(`unknown tokens mode: ${tokens}`);

  // string index (UTF-16) of the first unit of each alignment element, so `pos` matches String.matchAll
  const firstAt = new Map();
  let offset = 0;
  characters.forEach((ch, i) => { firstAt.set(offset, i); offset += ch.length; });
  firstAt.set(offset, characters.length);

  const words = [];
  for (const m of text.matchAll(/\S+/g)) {
    const from = firstAt.get(m.index), to = firstAt.get(m.index + m[0].length);
    if (from === undefined || to === undefined || to <= from) throw new AlignmentError(`token "${m[0]}" does not fall on alignment character boundaries`);
    const stripped = m[0].replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
    words.push({ at: starts[from], until: ends[to - 1], pos: m.index, count: m[0].length, text: stripped || m[0] });
  }
  for (let i = 0; i + 1 < words.length; i++) words[i].until = words[i + 1].at;
  return { words, speechStart, speechEnd };
}

const norm = (t) => t.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "").toLowerCase();
const tokensOf = (s) => [...s.matchAll(/\S+/g)].map((m) => ({ pos: m.index, count: m[0].length, raw: m[0], key: norm(m[0]) }));

/**
 * Express words aligned on the SPOKEN text (`speak`) on the DISPLAYED text (`text`), for segments where the two differ
 * (e.g. shown "90% of it", spoken "ninety percent of it"). Words that are identical on both sides anchor the match; between
 * anchors a region must be 1:1 (same number of words) or one displayed word covering several spoken words (its interval runs
 * from the first spoken word's start to the last one's end). Anything else would need guessing, so it throws.
 */
export function remapWordsToDisplay(words, speak, text) {
  if (speak === text) return words;
  const S = tokensOf(speak), D = tokensOf(text);
  if (S.length !== words.length) throw new AlignmentError("words do not match the spoken text");
  // longest common subsequence of identical words = the anchors
  const lcs = Array.from({ length: D.length + 1 }, () => new Array(S.length + 1).fill(0));
  for (let i = D.length - 1; i >= 0; i--) for (let j = S.length - 1; j >= 0; j--) lcs[i][j] = D[i].key && D[i].key === S[j].key ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const anchors = [];
  for (let i = 0, j = 0; i < D.length && j < S.length;) {
    if (D[i].key && D[i].key === S[j].key) { anchors.push([i, j]); i++; j++; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++; else j++;
  }
  anchors.push([D.length, S.length]);
  const out = [], put = (d, at, until) => out.push({ at, until, pos: d.pos, count: d.count, text: d.key ? d.raw.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "") : d.raw });
  let di = 0, sj = 0;
  for (const [ai, aj] of anchors) {
    const dr = D.slice(di, ai), sr = S.slice(sj, aj), sw = words.slice(sj, aj);
    if (dr.length || sr.length) {
      const where = `displayed "${dr.map((t) => t.raw).join(" ")}" vs spoken "${sr.map((t) => t.raw).join(" ")}"`;
      if (!dr.length || !sr.length) throw new AlignmentError(`speak and text differ in a way that cannot be aligned without guessing (${where})`);
      if (dr.length === sr.length) dr.forEach((d, k) => put(d, sw[k].at, sw[k].until));
      else if (dr.length === 1) put(dr[0], sw[0].at, sw.at(-1).until);
      else throw new AlignmentError(`speak and text differ in a way that cannot be aligned without guessing (${where}); keep the same number of words, or use one displayed word for a spoken phrase`);
    }
    if (ai < D.length) put(D[ai], words[aj].at, words[aj].until);
    di = ai + 1; sj = aj + 1;
  }
  return out;
}
