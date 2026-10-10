// Checks the content files for mistakes. Run with: node scripts/check-data.js
const fs = require("fs");
const path = require("path");

global.window = {};
const dataDir = path.join(__dirname, "..", "js", "data");
require(path.join(dataDir, "characters.js"));
fs.readdirSync(dataDir)
  .filter((f) => /^batch-\d+\.js$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
  .forEach((f) => require(path.join(dataDir, f)));
require(path.join(dataDir, "levels.js"));
require(path.join(dataDir, "kk.js"));
require(path.join(dataDir, "convos.js"));

const { VOCAB, POSTS, CHARACTERS, TOPICS } = window;
const TAG = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// Word levels run 1–10. NOTE: the app UI (js/core.js, js/app.js, css) still only knows levels 1–3; see the warning printed below.
const MAX_LEVEL = 10;
const errors = [];
const used = new Set();

function checkTags(text, where) {
  for (const m of text.matchAll(TAG)) {
    const key = m[1];
    if (!/^[a-z_]+$/.test(key)) errors.push(`${where}: key "${key}" must be lowercase letters (use _ between words of a phrase)`);
    else if (!VOCAB[key]) errors.push(`${where}: unknown word "${key}"`);
    used.add(key);
  }
}

for (const [key, v] of Object.entries(VOCAB)) {
  for (const field of ["pos", "zh", "ex", "exZh"]) if (!v[field]) errors.push(`word ${key}: missing ${field}`);
  if (!Number.isInteger(v.level) || v.level < 1 || v.level > MAX_LEVEL) errors.push(`word ${key}: bad level (must be a whole number 1–${MAX_LEVEL})`);
  if (!/^\[.+\]$/.test(window.KK[key] || "")) errors.push(`word ${key}: missing KK phonetics (run scripts/make-kk.mjs)`);
}

const ids = new Set();
const levels = Object.fromEntries(Array.from({ length: MAX_LEVEL }, (_, i) => [i + 1, 0]));
const langs = {};
const topics = {};
for (const p of POSTS) {
  if (ids.has(p.id)) errors.push(`duplicate id ${p.id}`);
  ids.add(p.id);
  if (!CHARACTERS[p.author]) errors.push(`${p.id}: unknown author ${p.author}`);
  if (!TOPICS.includes(p.topic)) errors.push(`${p.id}: unknown topic ${p.topic}`);
  if (!p.zh) errors.push(`${p.id}: missing zh translation`);
  checkTags(p.text, p.id);
  const keys = [...p.text.matchAll(TAG)].map((m) => m[1]).filter((k) => VOCAB[k]);
  if (!keys.length) errors.push(`${p.id}: no vocab words`);
  else {
    const avg = keys.reduce((a, k) => a + VOCAB[k].level, 0) / keys.length;
    levels[Math.min(MAX_LEVEL, Math.max(1, Math.round(avg)))]++;
  }
  const lang = CHARACTERS[p.author] && CHARACTERS[p.author].lang;
  langs[lang] = (langs[lang] || 0) + 1;
  topics[p.topic] = (topics[p.topic] || 0) + 1;
}

for (const [id, c] of Object.entries(CHARACTERS)) {
  if (!c.replies || c.replies.length < 4) errors.push(`character ${id}: needs at least 4 replies`);
  (c.replies || []).forEach((r, i) => checkTags(r, `${id}.replies[${i}]`));
}

// Character conversations under threads
const postIds = new Set(POSTS.map((p) => p.id));
let convoCount = 0;
for (const [pid, list] of Object.entries(window.CONVOS || {})) {
  if (!postIds.has(pid)) errors.push(`convos.${pid}: no such thread`);
  if (!Array.isArray(list) || list.length < 1) errors.push(`convos.${pid}: empty`);
  (list || []).forEach((r, i) => {
    const where = `convos.${pid}[${i}]`;
    if (!CHARACTERS[r.a]) errors.push(`${where}: unknown character ${r.a}`);
    if (!r.t) errors.push(`${where}: missing text`);
    if (!r.zh) errors.push(`${where}: missing zh`);
    checkTags(r.t || "", where);
    convoCount++;
  });
}
console.log(`Conversations: ${Object.keys(window.CONVOS || {}).length} threads, ${convoCount} character replies`);

// Word packs (js/data/packs/*.js)
const baseKeys = new Set(Object.keys(VOCAB));
const packDir = path.join(dataDir, "packs");
let packWords = 0, packPosts = 0;
if (fs.existsSync(packDir)) {
  require(path.join(packDir, "index.js"));
  for (const m of window.PACK_META) {
    if (m.id === "toefl") continue;
    window.PACKS[m.id] = undefined;
    require(path.join(packDir, m.id + ".js"));
    const pack = window.PACKS[m.id];
    for (const k of pack.base) if (!baseKeys.has(k)) errors.push(`pack ${m.id}: base key ${k} is not a TOEFL word`);
    for (const k of pack.own) {
      const v = VOCAB[k];
      if (!/^[a-z_]+$/.test(k)) errors.push(`pack ${m.id}: key "${k}" must be lowercase letters and _`);
      if (baseKeys.has(k)) errors.push(`pack ${m.id}: ${k} collides with a TOEFL word`);
      for (const field of ["zh", "ex", "exZh"]) if (!v[field]) errors.push(`pack ${m.id} word ${k}: missing ${field}`);
      if (![1, 2, 3].includes(v.level)) errors.push(`pack ${m.id} word ${k}: bad level`);
      if (window.KK[k] && !/^\[.+\]$/.test(window.KK[k])) errors.push(`pack ${m.id} word ${k}: bad KK`);
      packWords++;
    }
    for (const p of (window.PACK_POSTS && window.PACK_POSTS[m.id]) || []) {
      if (ids.has(p.id)) errors.push(`duplicate id ${p.id}`);
      ids.add(p.id);
      if (!CHARACTERS[p.author]) errors.push(`${p.id}: unknown author ${p.author}`);
      if (!TOPICS.includes(p.topic)) errors.push(`${p.id}: unknown topic ${p.topic}`);
      if (!p.zh) errors.push(`${p.id}: missing zh translation`);
      checkTags(p.text, p.id);
      packPosts++;
    }
    const n = pack.own.length + new Set(pack.base).size;
    if (n !== m.count) errors.push(`pack ${m.id}: index.js says ${m.count} words, file has ${n}`);
  }
}

// Quiz question bank: every question needs 3 distractors and one distractor type (dtypes) for each.
const DTYPES = ["sem", "l1", "form", "sound", "morph", "ctx"];
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data-src", "quiz_questions_703.json"), "utf8").replace(/^﻿/, ""));
for (const q of bank) {
  if (!Array.isArray(q.dtypes) || q.dtypes.length !== 3) errors.push(`quiz ${q.word}: dtypes must have 3 entries (one per distractor)`);
  else if (q.dtypes.some((t) => !DTYPES.includes(t))) errors.push(`quiz ${q.word}: bad dtypes ${JSON.stringify(q.dtypes)} (allowed: ${DTYPES.join(", ")})`);
  if (!Array.isArray(q.distractors) || q.distractors.length !== 3) errors.push(`quiz ${q.word}: needs 3 distractors`);
}
console.log(`Quiz questions: ${bank.length}`);

const unused = [...baseKeys].filter((k) => !used.has(k));

console.log(`Pack words: ${packWords} (own entries across the extra packs), pack threads: ${packPosts}`);
console.log(`Posts: ${POSTS.length}   Words: ${baseKeys.size}   Characters: ${Object.keys(CHARACTERS).length}`);
console.log(`Post levels  (average word level, rounded) ${Object.entries(levels).filter(([, n]) => n).map(([k, n]) => `L${k}×${n}`).join(" ")}  (1 Soy Milk, 2 Tofu, 3 Natto)`);
const aboveUi = Object.entries(VOCAB).filter(([, v]) => v.level > 3).length;
if (aboveUi) console.warn(`WARNING: ${aboveUi} word(s) have level above 3. The app UI only handles levels 1–3 (LEVEL_NAMES, lv1–lv3 styles, level preferences) — update js/core.js and js/app.js before shipping them.`);
console.log(`Voices       ${Object.entries(langs).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
console.log(`Topics       ${Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
if (unused.length) console.log(`Unused words (${unused.length}): ${unused.join(", ")}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log("\nAll good ✔");
