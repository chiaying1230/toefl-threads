// Text helpers shared by episode creation and planning.
export const MARK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
export const EMOJI = /\p{Extended_Pictographic}|️|‍/gu;

export const plain = (s) => s.replace(MARK, (m, k, shown) => shown || k);
export const keysIn = (s) => { const ks = []; s.replace(MARK, (m, k) => { if (!ks.includes(k)) ks.push(k); }); return ks; };
export const wordCount = (s) => plain(s).replace(EMOJI, "").split(/\s+/).filter(Boolean).length;
export const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;

const ZH_WORDS = new Intl.Segmenter("zh-TW", { granularity: "word" });
const ABBR = /\b(p\.m|a\.m|mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|no)\.$/i;

// Split a post into sentences (markers kept). Emoji-only tails join the previous sentence;
// abbreviations such as "p.m." do not end a sentence.
export function splitEn(text) {
  // a paragraph break always ends a sentence (some posts use it instead of a full stop)
  return text.split(/\n\s*\n/).flatMap(splitEnPara);
}
function splitEnPara(para) {
  const t = para.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const raw = t.match(/[^.!?]+(?:[.!?]+["”')\]]*)?(?:\s*[\p{Extended_Pictographic}\uFE0F\u200D]+)*\s*/gu) || [t];
  const out = [];
  for (const piece of raw.map((x) => x.trim()).filter(Boolean)) {
    const prev = out[out.length - 1];
    if (prev && (ABBR.test(prev) || !/[A-Za-z0-9]/.test(piece.replace(MARK, "x")))) out[out.length - 1] = prev + " " + piece;
    else out.push(piece);
  }
  return out;
}

export function splitZh(text) {
  return text.split(/\n\s*\n/).flatMap(splitZhPara);
}
function splitZhPara(para) {
  const t = para.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const raw = t.match(/[^。！？!?]+(?:[。！？!?]+[”」』）"]*)?(?:\s*[\p{Extended_Pictographic}\uFE0F\u200D]+)*\s*/gu) || [t];
  const out = [];
  for (const piece of raw.map((x) => x.trim()).filter(Boolean)) {
    if (out.length && !/[\u4e00-\u9fffA-Za-z0-9]/.test(piece)) out[out.length - 1] += " " + piece; else out.push(piece);
  }
  return out;
}

// Text → tokens. Word weights drive the estimated timing (≈ 2.6 English words/s, 0.22 s per Chinese character).
export function tokenize(raw, lang = "en") {
  const out = [];
  const push = (text, key) => {
    text = text.replace(EMOJI, "");
    if (!text.trim()) return;
    const letters = (text.match(/[A-Za-z0-9]/g) || []).length, cjk = (text.match(/[一-鿿]/g) || []).length;
    out.push({ text: text.trim(), key: key || null, w: cjk ? 0.22 * cjk : 0.1 + 0.05 * letters, pause: 0 });
  };
  const addPlain = (seg) => {
    if (lang === "zh") {
      // whole words (意思, 什麼 …), so captions wrap and highlight naturally; punctuation sticks to the word before it
      for (const { segment, isWordLike } of ZH_WORDS.segment(seg)) {
        if (!segment.trim()) continue;
        if (!isWordLike && !/\p{Extended_Pictographic}/u.test(segment) && out.length) out[out.length - 1].text += segment.trim();
        else push(segment);
      }
    } else seg.split(/\s+/).forEach((p) => push(p));
  };
  const addAfterMark = (seg) => { const g = seg.match(/^[^\s]+/); if (g && out.length) { out[out.length - 1].text += g[0]; seg = seg.slice(g[0].length); } addPlain(seg); };
  let last = 0, m, after = false;
  MARK.lastIndex = 0;
  while ((m = MARK.exec(raw))) { (after ? addAfterMark : addPlain)(raw.slice(last, m.index)); push((m[2] || m[1]).replace(/_/g, " "), m[1]); last = m.index + m[0].length; after = true; }
  (after ? addAfterMark : addPlain)(raw.slice(last));
  out.forEach((k) => { k.pause = /[.!?。！？]["”’)]*$/.test(k.text) ? 0.35 : /[,;:，；：、]$/.test(k.text) ? 0.15 : 0; });
  return out;
}

// "任意的；武斷的（形容詞）" → { main: "任意的；武斷的", note: "形容詞" }
export function zhParts(zh) {
  const m = zh.match(/^(.*?)\s*[（(]([^）)]*)[）)]\s*$/);
  return m ? { main: m[1], note: m[2] } : { main: zh, note: "" };
}
// spoken form: no parenthetical, no ellipsis marks
export const zhSpoken = (zh) => zhParts(zh).main.replace(/…/g, "");

// ---------- reading flow helpers ----------
const STOP_END = new Set("of the a an to and or but in on at for with by as that is are was were it its".split(" "));
const STOP_START = new Set("and or but so then".split(" "));
const rawTokens = (s) => s.match(/\[\[[^\]]+\]\]\S*|\S+/g) || [];
const bare = (w) => w.replace(/^[^\p{L}\p{N}%$]+|[^\p{L}\p{N}%$]+$/gu, "");

// Split one sentence (with [[markers]]) into reading chunks that fit ~3 lines of large text.
// Prefers clause boundaries (, ; : — ), keeps the pieces balanced, never splits inside a marker.
export function chunkSentence(sentence, { maxWords = 13, maxChars = 84 } = {}) {
  const toks = rawTokens(sentence);
  const fits = (a, b) => { const p = toks.slice(a, b).map(plain); return p.length <= maxWords && p.join(" ").length <= maxChars; };
  const split = (a, b) => {
    if (fits(a, b) || b - a < 4) return [[a, b]];
    let best = null;
    for (let i = a + 2; i <= b - 2; i++) {
      const punct = /[,;:—–)]$|\.{3}$/.test(toks[i - 1].replace(/\]\]/g, ""));
      const bal = Math.abs((i - a) - (b - i));
      const score = (punct ? 0 : 100) + bal + (fits(a, i) ? 0 : 50) + (fits(i, b) ? 0 : 50);
      if (!best || score < best.score) best = { i, score };
    }
    return [...split(a, best.i), ...split(best.i, b)];
  };
  return split(0, toks.length).map(([a, b]) => toks.slice(a, b).join(" "));
}

// Which tokens of an example/context sentence show the taught word (any inflection: "allocated", "arbitrarily")
export function isKeyToken(text, key) {
  const t = bare(text).toLowerCase();
  const words = key.toLowerCase().split("_").filter((w) => !STOP_END.has(w) && w.length > 1);
  return words.some((w) => t === w || (w.length >= 4 && t.startsWith(w.slice(0, Math.max(4, w.length - 2)))));
}

// A short phrase around the word, taken from the sentence the viewer just read ("allocate 90% of the company budget").
export function deriveContext(sentence, key, pos = "") {
  const raw = rawTokens(sentence), plainT = raw.map(plain);
  const at = raw.findIndex((r) => r.startsWith(`[[${key}]]`) || r.startsWith(`[[${key}|`));
  if (at < 0) return null;
  const endsPunct = (w) => /[,;:.!?—–]$/.test(w);
  const verb = /^v/.test(pos);
  let before = verb ? 0 : 2, after = verb ? 5 : 3, a = at, b = at;
  while (before-- > 0 && a > 0 && !endsPunct(plainT[a - 1])) a--;
  while (after-- > 0 && b < raw.length - 1 && !endsPunct(plainT[b])) b++;
  let words = plainT.slice(a, b + 1).map((w) => w.replace(/[,;:.!?—–"”]+$/g, "").replace(/^["“]/, ""));
  while (words.length > 2 && STOP_START.has(words[0].toLowerCase())) words.shift();
  while (words.length > 2 && STOP_END.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.length >= 2 ? words.join(" ") : null;
}

// The "FROM THIS POST" phrase on a word's card: hand-written `ctx` first, otherwise a short phrase taken from the
// sentence the viewer just read ("completely arbitrary", "allocate 90% of the company budget"). null if there is none.
export function contextFor(ep, key) {
  const w = ep.words[key];
  if (w.ctx) return { text: w.ctx };
  const sent = ep.thread.show.map((i) => ep.thread.sentences[i].en).find((s) => keysIn(s).includes(key));
  const derived = sent ? deriveContext(sent, key, w.pos) : null;
  return derived ? { text: derived } : null;
}
