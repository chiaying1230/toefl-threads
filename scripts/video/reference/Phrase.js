// Multi-word vocabulary (a vocabulary `word` / `forms` entry that contains a space is a phrase).
// A phrase is yellow only where ALL of its tokens appear in a row inside one reading line – never its words one by one,
// so the "a" / "of" / "and" of "a game of cat and mouse" stay plain everywhere else.
// ReadingCue.js is not involved: it never touches the `key` class after it creates a token, so the span is added afterwards.
// Browser file. scripts/video/voice/episode-refs.mjs holds a small twin of normalizeToken / phraseTokens / findSpans for the
// validator (the repo has no package.json "type", so Node cannot import this file); phrase.test.mjs locks the two together.

/** One display token / phrase word → its comparison form: lower case, quotes unified, leading / trailing punctuation and symbols removed. */
export function normalizeToken(text) {
  return String(text).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

/** The words of a phrase string, normalized. [] if any word is empty after normalizing (a phrase made of punctuation is not valid). */
export function phraseTokens(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).map(normalizeToken);
  return words.every(Boolean) ? words : [];
}

/** A vocabulary term is a phrase when it has more than one word. */
export function isPhrase(term) {
  return /\s/.test(String(term).trim());
}

/** The phrase patterns of a vocabulary list's terms (`word` and `forms`), duplicates removed. */
export function phrasePatterns(terms) {
  const seen = new Set(), out = [];
  for (const term of terms) {
    if (!isPhrase(term)) continue;
    const tokens = phraseTokens(term), key = tokens.join(" ");
    if (tokens.length > 1 && !seen.has(key)) { seen.add(key); out.push(tokens); }
  }
  return out;
}

/**
 * Non-overlapping spans where a pattern matches `tokens` (already normalized) completely and in a row.
 * Longer phrases win an overlap; among equals the earlier one. Returns [{from, to}] (to exclusive), in line order.
 */
export function findSpans(tokens, patterns) {
  const found = [];
  for (const p of patterns) for (let i = 0; i + p.length <= tokens.length; i++) if (p.every((w, k) => tokens[i + k] === w)) found.push({ from: i, to: i + p.length });
  found.sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from);
  const taken = new Set(), spans = [];
  for (const s of found) {
    let free = true;
    for (let k = s.from; k < s.to; k++) if (taken.has(k)) free = false;
    if (!free) continue;
    for (let k = s.from; k < s.to; k++) taken.add(k);
    spans.push(s);
  }
  return spans.sort((a, b) => a.from - b.from);
}

/**
 * Mark the phrases in one reading line (the element ReadingCue built: one .cue span per token).
 * Matching tokens get `key` (the existing yellow) plus `phrase` and `pstart` / `pmid` / `pend` so CSS can join them.
 * With no patterns nothing is read or changed.
 */
export function annotatePhrases(root, patterns) {
  if (!patterns.length) return [];
  const cues = [...root.querySelectorAll(".cue")];
  const spans = findSpans(cues.map((c) => normalizeToken(c.textContent)), patterns);
  for (const { from, to } of spans) {
    for (let k = from; k < to; k++) cues[k].classList.add("key", "phrase", k === from ? "pstart" : k === to - 1 ? "pend" : "pmid");
  }
  return spans;
}
