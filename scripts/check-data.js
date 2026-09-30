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

const { VOCAB, POSTS, CHARACTERS, TOPICS } = window;
const TAG = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const errors = [];
const used = new Set();

function checkTags(text, where) {
  for (const m of text.matchAll(TAG)) {
    const key = m[1];
    if (!/^[a-z]+$/.test(key)) errors.push(`${where}: key "${key}" must be lowercase letters`);
    else if (!VOCAB[key]) errors.push(`${where}: unknown word "${key}"`);
    used.add(key);
  }
}

for (const [key, v] of Object.entries(VOCAB)) {
  for (const field of ["pos", "zh", "ex", "exZh"]) if (!v[field]) errors.push(`word ${key}: missing ${field}`);
  if (![1, 2, 3].includes(v.level)) errors.push(`word ${key}: bad level`);
}

const ids = new Set();
const levels = { 1: 0, 2: 0, 3: 0 };
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
    levels[avg <= 1.5 ? 1 : avg >= 2.5 ? 3 : 2]++;
  }
  const lang = CHARACTERS[p.author] && CHARACTERS[p.author].lang;
  langs[lang] = (langs[lang] || 0) + 1;
  topics[p.topic] = (topics[p.topic] || 0) + 1;
}

for (const [id, c] of Object.entries(CHARACTERS)) {
  if (!c.replies || c.replies.length < 4) errors.push(`character ${id}: needs at least 4 replies`);
  (c.replies || []).forEach((r, i) => checkTags(r, `${id}.replies[${i}]`));
}

const unused = Object.keys(VOCAB).filter((k) => !used.has(k));

console.log(`Posts: ${POSTS.length}   Words: ${Object.keys(VOCAB).length}   Characters: ${Object.keys(CHARACTERS).length}`);
console.log(`Post levels  Easy ${levels[1]} / Medium ${levels[2]} / Hard ${levels[3]}`);
console.log(`Voices       ${Object.entries(langs).map(([k, n]) => `${k} ${n}`).join(" / ")}`);
console.log(`Topics       ${Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`);
if (unused.length) console.log(`Unused words (${unused.length}): ${unused.join(", ")}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}
console.log("\nAll good ✔");
