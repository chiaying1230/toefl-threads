// Pure helpers for gen.mjs: data loading, planning, prompt building, parsing, validation, cost.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "..", "..");
export const TAG = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
export const MAX_PARA = 175; // chars per paragraph for band 1–4
export const EASY_BAND = 4;
export const PROFILES = { // whole-thread level control, chosen from the highest band among the target words
  easy: { maxWords: 12 }, // band 1–2
  medium: { maxWords: 16 }, // band 3–4
  advanced: { maxWords: Infinity }, // band 5+
};
export const profileOf = (band) => (band <= 2 ? "easy" : band <= EASY_BAND ? "medium" : "advanced");
const EN_EVERY = 5; // every 5th post of an easy batch uses an English-only character

// ---------- data ----------
let siteCache;
export function loadSite() {
  if (siteCache) return siteCache;
  const require = createRequire(import.meta.url);
  globalThis.window = {};
  const dir = path.join(REPO, "js", "data");
  require(path.join(dir, "characters.js"));
  fs.readdirSync(dir)
    .filter((f) => /^batch-\d+\.js$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
    .forEach((f) => require(path.join(dir, f)));
  const { CHARACTERS, TOPICS, POSTS, VOCAB } = window;
  delete globalThis.window;
  return (siteCache = { CHARACTERS, TOPICS, POSTS, VOCAB });
}

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function loadWords(file) {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  for (const h of ["word", "pos", "zh", "band"]) if (!head.includes(h)) throw new Error(`CSV needs a "${h}" column (got: ${head.join(", ")})`);
  const seen = new Set();
  return rows.map((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, (r[j] || "").trim()]));
    const key = o.word.toLowerCase().replace(/\s+/g, "_");
    if (!/^[a-z_]+$/.test(key)) throw new Error(`CSV row ${i + 2}: "${o.word}" must be letters only (spaces become _)`);
    if (seen.has(key)) throw new Error(`CSV row ${i + 2}: duplicate word "${o.word}"`);
    seen.add(key);
    const band = Number(o.band);
    if (!o.zh || !Number.isFinite(band)) throw new Error(`CSV row ${i + 2}: "${o.word}" needs zh and a numeric band`);
    return { key, pos: o.pos, zh: o.zh, band };
  });
}

// ---------- planning (deterministic: same words + seed => same plan) ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function makePlan({ words, characters, topics, startId, seed = 1 }) {
  if (words.length < 2) throw new Error("Need at least 2 words");
  const r = rng(seed);
  const n = words.length;
  const posts = Math.ceil(n / 2.5); // 2–3 words per post
  const base = Math.floor(n / posts);
  let extra = n - base * posts; // this many posts get base+1
  const sorted = shuffle(words, r).sort((a, b) => a.band - b.band); // similar bands share a post
  let groups = [], i = 0;
  for (let p = 0; p < posts; p++) {
    const size = base + (p < extra ? 1 : 0);
    groups.push(sorted.slice(i, i + size));
    i += size;
  }
  groups = shuffle(groups, r);

  const mix = Object.keys(characters).filter((k) => characters[k].lang === "mix");
  const en = Object.keys(characters).filter((k) => characters[k].lang !== "mix");
  const all = Object.keys(characters);
  const used = Object.fromEntries(all.map((k) => [k, 0]));
  const topicUsed = Object.fromEntries(topics.map((t) => [t, 0]));
  const least = (pool, counts) => {
    const m = Math.min(...pool.map((k) => counts[k]));
    const c = pool.filter((k) => counts[k] === m);
    return c[Math.floor(r() * c.length)];
  };
  return groups.map((g, idx) => {
    const band = Math.max(...g.map((w) => w.band));
    const pool = band <= EASY_BAND ? (idx % EN_EVERY === EN_EVERY - 1 ? en : mix) : all;
    const author = least(pool, used);
    used[author]++;
    const topic = least(topics, topicUsed);
    topicUsed[topic]++;
    return { id: `p${startId + idx}`, author, topic, band, words: g };
  });
}

export function planSignature(plan) {
  return crypto.createHash("sha1").update(JSON.stringify(plan)).digest("hex").slice(0, 12);
}

// ---------- prompt ----------
const paras = (t) => t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
const len = (s) => [...s].length;

export function pickExamples(posts, characters, usedAuthors, perCharacter = 3) {
  const out = {};
  for (const a of usedAuthors) {
    const mine = posts.filter((p) => p.author === a);
    const fits = mine.filter((p) => paras(p.text).every((x) => len(x) <= MAX_PARA));
    const pool = fits.length >= 2 ? fits : mine;
    const k = Math.min(perCharacter, pool.length);
    out[a] = Array.from({ length: k }, (_, i) => pool[Math.floor(((i + 0.5) * pool.length) / k)]);
  }
  return out;
}

export function buildSystem({ characters, examples, authors }) {
  const rules = `You write short social-media threads for "toEfu", a TOEFL vocabulary-learning app that looks like Threads. Every thread is posted by a fictional character and teaches target words in context. You will be given thread assignments (id, character, topic, target words); write one thread for each.

OUTPUT FORMAT — exactly this for every thread, nothing before, between or after (no preface, no markdown fences, no notes):
### <id>
<thread text>
---
<Traditional Chinese translation of the thread text>

RULES
1. Use exactly the assigned character's voice (see CHARACTERS: bio, language mode, sample replies) and the assigned topic. Thread text is usually two short paragraphs separated by one blank line: a concrete hook or fact about the topic, then the character's joke or opinion. Use emoji the way that character would.
2. Language mode: "en" characters write English only. "mix" characters write mostly English with natural Taiwanese-style Traditional Chinese mixed in (like the examples).
3. Every assigned target word must appear in the thread text, marked as [[word]] using the exact lowercase headword, or [[word|form]] when it is inflected or changes form, e.g. [[procrastinate|procrastinated]], [[nuclear]]. Mark only the assigned words — never mark any other word. Use each assigned word in the given part of speech and sense.
4. The context must let a learner infer the meaning, but you must NEVER write the Chinese meaning of a target word (or a Chinese gloss/translation of it) anywhere in the thread text, not even in parentheses. Chinese in a "mix" thread is the character's ordinary speech, not a definition.
5. Level profiles. Each assignment names a level profile; the whole thread (not just the target words) must match it, without sounding childish or preachy — it should still read like a real, funny post.
   - easy: only very common everyday English besides the target words (roughly the 1,500 most common words); each sentence at most ${PROFILES.easy.maxWords} English words and one idea; concrete everyday scenes (food, weather, friends, school, home, pets, shopping); no idioms, no phrasal verbs, no long clauses; every paragraph at most ${MAX_PARA} characters.
   - medium: common vocabulary besides the target words; each sentence at most ${PROFILES.medium.maxWords} English words; at most one simple subordinate clause per sentence; short cause-and-effect and contrast are fine; every paragraph at most ${MAX_PARA} characters.
   - advanced: normal TOEFL-level prose; each paragraph under 300 characters.
6. Facts must be true and match the topic. Be funny but not mean; no real people, brands used as jokes, politics or religion.
7. The Chinese translation after the --- line translates the whole thread text naturally (Traditional Chinese, Taiwan usage), keeps paragraph breaks and emoji, and contains no [[ ]] markers.
8. Write each thread fresh; do not copy the examples. If a "previous attempt" note lists problems, fix exactly those.
9. Natural use: each target word must be used in a sentence where its meaning can be inferred from context and where it fits the word's real meaning — never forced in. Check each word: would a native speaker use it this way? If a word does not fit the character's story naturally, change the story, not the word.
10. Logic: the sentences must connect (cause and effect, contrast, a clear joke). No non sequiturs; every sentence should follow from the one before it.
11. Facts: do not write statistics, dates or "firsts" unless you are certain they are exactly right; prefer a safe, general, true statement or an obviously fictional character anecdote. Use correct names (e.g. the Soviet Union in 1957, not "Russia"). Never invent numbers.
12. Never write a form identical to the headword as [[word|word]]; just write [[word]].`;

  const chars = authors
    .map((a) => {
      const c = characters[a];
      const sample = (c.replies || []).slice(0, 2).map((x) => `    - ${x}`).join("\n");
      return `- ${a}: ${c.name} (@${c.handle}), lang=${c.lang}. Bio: ${c.bio}\n  Sample replies:\n${sample}`;
    })
    .join("\n");

  const ex = authors
    .flatMap((a) => (examples[a] || []).map((p) => `### EXAMPLE by ${a} (topic: ${p.topic})\n${p.text}\n---\n${p.zh}`))
    .join("\n\n");

  return [
    { type: "text", text: `${rules}\n\nCHARACTERS\n${chars}\n\nEXAMPLES OF EXISTING THREADS (tag format and voice reference)\n${ex}`, cache_control: { type: "ephemeral" } },
  ];
}

export function buildUser(tasks, feedback = {}) {
  const lines = tasks.map((t) => {
    const w = t.words.map((x) => `  - ${x.key}${x.pos ? ` (${x.pos})` : ""} = ${x.zh}  [band ${x.band}]`).join("\n");
    const fb = feedback[t.id] ? `\n  previous attempt problems: ${feedback[t.id].join("; ")}` : "";
    return `### ${t.id}\ncharacter: ${t.author}\ntopic: ${t.topic}\nlevel profile: ${profileOf(t.band)}\ntarget words (the Chinese is for your understanding only — never write it in the thread):\n${w}${fb}`;
  });
  return `Write ${tasks.length} thread${tasks.length > 1 ? "s" : ""}:\n\n${lines.join("\n\n")}`;
}

export function buildReview(tasks, drafts) {
  const items = tasks.map((t) => {
    const w = t.words.map((x) => `${x.key}${x.pos ? ` (${x.pos})` : ""} = ${x.zh}`).join("; ");
    return `### ${t.id}  [character: ${t.author}; topic: ${t.topic}; level profile: ${profileOf(t.band)}; target words: ${w}]\n${drafts[t.id].text}\n---\n${drafts[t.id].zh}`;
  });
  return `Review these drafted threads as a strict editor. For each one check: (a) every target word is used naturally, with its real meaning, in a way a learner could infer; (b) the sentences are logical and connected, with no non sequiturs; (c) every fact, date and number is certainly correct (names too — if unsure, remove it); (d) the voice fits the character; (e) all the format rules (markers, length, no Chinese gloss of target words); (f) the level profile: every non-target word is simple enough for the thread's profile, sentences are short and single-idea, and the content is everyday and easy to follow without sounding childish.
If a thread passes all checks, output only:
### <id>
OK
If it fails any check, output the full corrected thread in the normal output format (### <id>, text, ---, translation), fixing the problem while keeping the same character, topic and target words.

${items.join("\n\n")}`;
}

// ---------- parsing & validation ----------
export function parseResponse(text) {
  const out = {};
  const parts = text.split(/^### *(p\d+) *$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1].trim();
    const cut = body.search(/^---\s*$/m);
    out[parts[i]] = cut < 0 ? { text: body, zh: "" } : { text: body.slice(0, cut).trim(), zh: body.slice(body.indexOf("\n", cut) + 1).trim() };
  }
  return out;
}

export function zhSegments(zh) {
  return zh
    .replace(/[（(][^）)]*[）)]/g, "")
    .split(/[；;，,、\/／]/)
    .map((s) => s.trim().replace(/[的地得]$/, "").replace(/^[使讓令被把]/, ""))
    .filter((s) => [...s].length >= 2);
}

export function validatePost(task, { text, zh }) {
  const errs = [];
  if (!text) return ["empty text"];
  if (!zh) errs.push("missing Chinese translation after ---");
  if (/\[\[|\]\]/.test(zh)) errs.push("translation contains [[ ]] markers");
  const want = new Set(task.words.map((w) => w.key));
  const found = new Set();
  for (const m of text.matchAll(TAG)) {
    const key = m[1];
    if (!want.has(key)) errs.push(`marked "${key}" which is not an assigned word`);
    else found.add(key);
    if (m[2] !== undefined && !m[2].trim()) errs.push(`empty form in [[${key}|]]`);
    if (m[2] !== undefined && m[2].trim().toLowerCase() === key.replace(/_/g, " ")) errs.push(`[[${key}|${m[2]}]] repeats the word — write [[${key}]]`);
  }
  for (const k of want) if (!found.has(k)) errs.push(`target word "${k}" is not marked as [[${k}]] in the text`);
  if (/\[\[|\]\]/.test(text.replace(TAG, ""))) errs.push("malformed [[ ]] marker");
  if (/^---\s*$/m.test(text)) errs.push("stray --- inside the text");
  for (const w of task.words)
    for (const seg of zhSegments(w.zh)) if (text.replace(TAG, "$1").includes(seg)) errs.push(`text contains the Chinese meaning "${seg}" of "${w.key}"`);
  if (task.band <= EASY_BAND)
    for (const p of paras(text)) if (len(p) > MAX_PARA) errs.push(`paragraph is ${len(p)} chars (max ${MAX_PARA}): "${p.slice(0, 30)}…"`);
  const cap = PROFILES[profileOf(task.band)].maxWords + 2; // prompt asks for the limit; the checker allows 2 words of slack
  if (cap < Infinity)
    for (const sent of text.replace(TAG, (_, k, f) => f || k).split(/[.!?。！？\n]+/)) {
      const n = (sent.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
      if (n > cap) errs.push(`sentence has ${n} English words (max ${cap} for ${profileOf(task.band)}): "${sent.trim().slice(0, 40)}…"`);
    }
  if (len(text) < 40) errs.push("text too short");
  return errs;
}

// ---------- cost ----------
export const PRICES = { // USD per million tokens (input / output)
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};
export function costOf(u, [pin, pout]) {
  const M = 1e6;
  return (u.input * pin + u.cacheWrite * pin * 1.25 + u.cacheRead * pin * 0.1 + u.output * pout) / M;
}
export function usageOf(usage = {}) {
  return {
    input: usage.input_tokens || 0,
    output: usage.output_tokens || 0,
    cacheWrite: usage.cache_creation_input_tokens || 0,
    cacheRead: usage.cache_read_input_tokens || 0,
  };
}

// ---------- vocab levels (the site has levels 1–3; the word list has bands 1–4) ----------
export const DEFAULT_LEVEL_MAP = { 1: 1, 2: 2, 3: 2, 4: 3 };
export function parseLevelMap(str) {
  if (!str) return DEFAULT_LEVEL_MAP;
  const m = {};
  for (const pair of str.split(",")) {
    const [b, l] = pair.split("=").map(Number);
    if (![1, 2, 3].includes(l) || !Number.isFinite(b)) throw new Error(`bad --level-map entry "${pair}" (use band=level with level 1–3, e.g. 1=1,2=2,3=2,4=3)`);
    m[b] = l;
  }
  return m;
}
export const levelOf = (band, map) => map[band] ?? (band > 4 ? 3 : 1);
export function normPos(pos) {
  const p = (pos || "").trim();
  return p && !p.endsWith(".") ? p + "." : p;
}

// ---------- vocab entries (example sentence + translation per word) ----------
export function buildVocabSystem() {
  return [{ type: "text", cache_control: { type: "ephemeral" }, text: `You write dictionary-style example sentences for "toEfu", a TOEFL vocabulary app for Chinese-speaking learners. For each word you are given (headword, part of speech, Chinese meaning, band), write one English example sentence and its Traditional Chinese translation.

OUTPUT FORMAT — exactly this for every word, nothing else (no preface, no markdown, no numbering):
### <headword>
EN: <example sentence>
ZH: <Traditional Chinese translation>

RULES
1. The sentence must use the headword in the given part of speech and sense, in any natural inflected form (e.g. "arrived" for arrive). Do not put markers like [[ ]] around it.
2. The sentence's context must make the meaning clear on its own. Do not write the Chinese meaning in the English sentence.
3. Level: band 1–2 words — a very short, everyday sentence (6–10 English words) using only common words. Band 3–4 words — one clear sentence of 8–14 words with common vocabulary besides the headword. Band 5+ — up to 18 words.
4. One idea per sentence; natural, concrete and a little vivid (a real situation, not "This is a ___"). No proper nouns unless needed, no statistics, no controversial topics.
5. ZH is a natural Taiwan-style Traditional Chinese translation of the whole sentence, ending with proper punctuation, and it must express the word's meaning naturally.` }];
}
export function buildVocabUser(items) {
  return `Write example sentences for ${items.length} word${items.length > 1 ? "s" : ""}:\n\n` + items.map((w) => `- ${w.key.replace(/_/g, " ")} (${w.pos || "?"}) = ${w.zh}  [band ${w.band}]`).join("\n");
}
export function parseVocab(text) {
  const out = {};
  for (const block of text.split(/^### */m).slice(1)) {
    const key = block.split("\n")[0].trim().toLowerCase().replace(/\s+/g, "_");
    const en = block.match(/^EN:\s*(.+)$/m), zh = block.match(/^ZH:\s*(.+)$/m);
    out[key] = { ex: en ? en[1].trim() : "", exZh: zh ? zh[1].trim() : "" };
  }
  return out;
}
export function validateVocab(w, { ex, exZh }) {
  const errs = [];
  if (!ex) return ["missing EN sentence"];
  if (!exZh) errs.push("missing ZH translation");
  if (/[\u4e00-\u9fff]/.test(ex)) errs.push("EN sentence contains Chinese");
  if (exZh && !/[\u4e00-\u9fff]/.test(exZh)) errs.push("ZH has no Chinese");
  if (/\[\[|\]\]/.test(ex + (exZh || ""))) errs.push("contains [[ ]] markers");
  const stem = w.key.replace(/_/g, " ").slice(0, Math.max(3, w.key.length - 3));
  if (!ex.toLowerCase().includes(stem)) errs.push(`sentence does not use "${w.key}"`);
  const n = (ex.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;
  const max = w.band <= 2 ? 12 : w.band <= EASY_BAND ? 16 : 20;
  if (n < 4 || n > max) errs.push(`sentence has ${n} words (allowed 4–${max})`);
  for (const seg of zhSegments(w.zh)) if (ex.includes(seg)) errs.push(`EN contains the Chinese meaning "${seg}"`);
  return errs;
}
