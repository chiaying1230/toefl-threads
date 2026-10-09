#!/usr/bin/env node
// Turn a toEfu word pack (js/data/packs/<pack>.js) into a gen.mjs word list.
//   node pack-words.mjs hs --out out/words-hs.csv [--limit 300] [--skip-used]
// band = Codex difficulty score / 10 (1–10). Function words (a, the, will…) are left out.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, limit: { type: "string", default: "0" }, "skip-used": { type: "boolean", default: false } },
});
const pack = positionals[0];
if (!/^(elem|hs|toeic|ielts)$/.test(pack || "")) { console.error("Usage: node pack-words.mjs <elem|hs|toeic|ielts> --out out/words-<pack>.csv [--limit N] [--skip-used]"); process.exit(1); }
const out = path.resolve(here, o.out || `out/words-${pack}.csv`);
if (path.dirname(out) !== path.join(here, "out")) { console.error("--out must be a file directly inside scripts/gen-posts/out/"); process.exit(1); }

const require = createRequire(import.meta.url);
globalThis.window = {};
require(path.join(REPO, "js/data/characters.js"));
fs.readdirSync(path.join(REPO, "js/data")).filter((f) => /^batch-\d+\.js$/.test(f)).forEach((f) => require(path.join(REPO, "js/data", f)));
require(path.join(REPO, "js/data/packs", pack + ".js"));
const { VOCAB, PACKS } = window;

const used = new Set();
const txt = path.join(REPO, "data-src/threads", pack + ".txt");
if (o["skip-used"] && fs.existsSync(txt)) for (const m of fs.readFileSync(txt, "utf8").matchAll(/\[\[([^\]|]+)/g)) used.add(m[1]);

const SKIP_POS = /^(det|pron|prep|conj|modal|num|quantifier|interj)/;
const csv = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
let rows = PACKS[pack].own
  .filter((k) => /^[a-z_]{3,}$/.test(k) && !used.has(k) && VOCAB[k].pos && !SKIP_POS.test(VOCAB[k].pos))
  .sort()
  .map((k) => [k.replace(/_/g, " "), VOCAB[k].pos.replace(/\s/g, ""), VOCAB[k].zh, Math.max(1, Math.min(10, Math.round((VOCAB[k].diff || 50) / 10)))]);
const limit = Number(o.limit);
if (limit && rows.length > limit) { // an even spread through the alphabet, not just A–C
  const step = rows.length / limit;
  rows = Array.from({ length: limit }, (_, i) => rows[Math.floor(i * step)]);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "word,pos,zh,band\n" + rows.map((r) => r.map(csv).join(",")).join("\n") + "\n");
console.log(`${rows.length} words from the ${pack} pack → ${path.relative(here, out)}`);
