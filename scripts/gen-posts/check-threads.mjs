#!/usr/bin/env node
// Check hand-written (or generated) pack threads against the same rules gen.mjs enforces.
//   node check-threads.mjs <elem|hs|toeic|ielts> <threads.txt> [--words out/w250-<pack>.csv] [--quiet]
// threads.txt uses the data-src/threads format:  id | author | Topic / English / --- / 中文 / ===
// Every tagged word must be a pack word from --words (when given); each thread needs 2–3 distinct words.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: o, positionals: [pack, file] } = parseArgs({ allowPositionals: true, options: { words: { type: "string" }, quiet: { type: "boolean", default: false } } });
if (!/^(elem|hs|toeic|ielts)$/.test(pack || "") || !file) { console.error("Usage: node check-threads.mjs <elem|hs|toeic|ielts> <threads.txt> [--words csv] [--quiet]"); process.exit(1); }

const require = createRequire(import.meta.url);
globalThis.window = {};
const dir = path.join(L.REPO, "js", "data");
require(path.join(dir, "characters.js"));
fs.readdirSync(dir).filter((f) => /^batch-\d+\.js$/.test(f)).forEach((f) => require(path.join(dir, f)));
for (const p of ["elem", "hs", "toeic", "ielts"]) require(path.join(dir, "packs", p + ".js"));
const { VOCAB, CHARACTERS, TOPICS, POSTS, PACK_POSTS } = window;

const csv = o.words ? L.loadWords(path.resolve(here, o.words)) : null;
const listed = csv ? Object.fromEntries(csv.map((w) => [w.key, w])) : null;

const sim = L.makeSimIndex();
POSTS.forEach((p) => sim.add(p.id, p.text));
const mine = fs.readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");
const mineIds = new Set(mine.split("\n").filter((l) => /^[a-z]+-\d+ \|/.test(l)).map((l) => l.split("|")[0].trim()));
for (const [pid, list] of Object.entries(PACK_POSTS)) for (const p of list) if (!mineIds.has(p.id)) sim.add(p.id, p.text);

const blocks = mine.split("\n===\n").filter((b) => b.trim());
let bad = 0;
const seenIds = new Set(), seenWords = {}, authors = {}, topics = {};
const out = (id, msg) => { bad++; console.log(`✗ ${id}: ${msg}`); };
for (const block of blocks) {
  const [head, ...restLines] = block.trim().split("\n");
  const parts = head.split("|").map((x) => x.trim());
  const id = parts[0];
  if (parts.length !== 3) { out(id || "?", `bad header "${head}"`); continue; }
  const [, author, topic] = parts;
  if (seenIds.has(id)) out(id, "duplicate id");
  seenIds.add(id);
  const rest = restLines.join("\n");
  const cut = rest.split("\n---\n");
  if (cut.length !== 2) { out(id, "needs exactly one --- line between English and 中文"); continue; }
  const [text, zh] = cut.map((s) => s.trim());
  if (!CHARACTERS[author]) out(id, `unknown character "${author}"`);
  if (!TOPICS.includes(topic)) out(id, `unknown topic "${topic}"`);
  authors[author] = (authors[author] || 0) + 1; topics[topic] = (topics[topic] || 0) + 1;
  const keys = [...new Set([...text.matchAll(L.TAG)].map((m) => m[1]))];
  const words = keys.map((k) => ({ key: k, pos: (VOCAB[k] || {}).pos, zh: (VOCAB[k] || {}).zh || "", band: (listed && listed[k] && listed[k].band) || Math.round(((VOCAB[k] || {}).diff || 30) / 10) }));
  let ok = true;
  for (const k of keys) {
    if (!VOCAB[k]) { out(id, `[[${k}]] is not a known word`); ok = false; }
    else if (listed && !listed[k]) { out(id, `[[${k}]] is not in the word list for this run`); ok = false; }
    seenWords[k] = (seenWords[k] || 0) + 1;
  }
  if (keys.length < 2 || keys.length > 3) { out(id, `needs 2–3 distinct words, has ${keys.length}`); ok = false; }
  if (!ok) continue;
  const task = { id, band: Math.max(...words.map((w) => w.band)), words };
  const errs = L.validatePost(task, { text, zh });
  const n = sim.nearest(text);
  if (n.sim > 0.3) errs.push(`too similar to ${n.id} (${n.sim.toFixed(2)})`);
  errs.forEach((e) => out(id, e));
  sim.add(id, text);
}
const dupWords = Object.entries(seenWords).filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`);
if (!o.quiet || bad) {
  const mix = blocks.filter((b) => (CHARACTERS[b.trim().split("\n")[0].split("|")[1]?.trim()] || {}).lang === "mix").length;
  console.log(`\n${blocks.length} threads · ${Object.keys(seenWords).length} words${csv ? ` of ${csv.length} listed (${csv.length - Object.keys(seenWords).length} unused)` : ""} · mix-language ${mix} / en ${blocks.length - mix}`);
  console.log(`characters ${Object.keys(authors).length}: ${Object.entries(authors).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${n}`).join(" ")}`);
  console.log(`topics ${Object.keys(topics).length}: ${Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${n}`).join(" ")}`);
  if (dupWords.length) console.log(`words used more than once: ${dupWords.join(" ")}`);
}
console.log(bad ? `\n${bad} problem(s)` : "\nAll good ✔");
process.exit(bad ? 1 : 0);
