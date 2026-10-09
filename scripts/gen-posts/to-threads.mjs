#!/usr/bin/env node
// Move gen.mjs output into a word pack's thread file, then rebuild the pack.
//   node to-threads.mjs out/hs.js hs            appends to data-src/threads/hs.txt
//   node to-threads.mjs out/hs.js hs --print    only show what would be added
// After that:  python3 scripts/build-packs.py && node scripts/make-kk.mjs <node_modules> && node scripts/check-data.js
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const { values: o, positionals: [file, pack] } = parseArgs({ allowPositionals: true, options: { print: { type: "boolean", default: false }, to: { type: "string" } } });
if (!file || !/^(elem|hs|toeic|ielts)$/.test(pack || "")) { console.error("Usage: node to-threads.mjs <out/file.js> <elem|hs|toeic|ielts> [--print]"); process.exit(1); }

const w = { POSTS: [] };
new Function("window", fs.readFileSync(path.resolve(here, file), "utf8"))(w);
const target = o.to ? path.resolve(o.to) : path.join(REPO, "data-src/threads", pack + ".txt");
const old = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
const ids = [...old.matchAll(new RegExp(`^${pack}-(\\d+) \\|`, "gm"))].map((m) => Number(m[1]));
let n = ids.length ? Math.max(...ids) : 0;
const have = new Set([...old.matchAll(/^(.+?)\n---\n/gms)].map((m) => m[1].split("\n").slice(1).join("\n").trim()));
const blocks = [];
for (const p of w.POSTS) {
  if (have.has(p.text.trim())) continue;
  n++;
  blocks.push(`${pack}-${String(n).padStart(3, "0")} | ${p.author} | ${p.topic}\n${p.text.trim()}\n---\n${p.zh.trim()}\n===\n`);
}
console.log(`${blocks.length} new thread(s) for ${pack} (${w.POSTS.length - blocks.length} already there)`);
if (o.print) console.log("\n" + blocks.join("\n"));
else if (blocks.length) fs.writeFileSync(target, old.replace(/\s*$/, "\n") + blocks.join(""));
