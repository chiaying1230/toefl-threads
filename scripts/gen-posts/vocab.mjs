#!/usr/bin/env node
// Generate VOCAB entries (pos, zh, level, ex, exZh) for a word list with the Claude API.
// Writes to scripts/gen-posts/out/ only. pos / zh / level come from the CSV, never from the model.
//
//   node vocab.mjs --words words.csv --out out/vocab.js [--mode batch]      (batch = 50% cheaper, asynchronous)
//   node vocab.mjs --words words.csv --dry-run | --mock
//   node vocab.mjs --words words.csv --level-map 1=1,2=1,3=2                (word-list level → site level; default: same number)
// Re-run the same command to resume. Words already in js/data/ are skipped unless --include-existing.
// KK phonetics are NOT made here (scripts/make-kk.mjs does that when merging).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";
import { createStore, createEngine } from "./engine.mjs";
import { makeMock } from "./mock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "out");
const { values: o } = parseArgs({
  options: {
    words: { type: "string" },
    out: { type: "string", default: "out/vocab.js" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    mode: { type: "string", default: "sync" },
    concurrency: { type: "string", default: "1" },
    "batch-size": { type: "string", default: "12" }, // words per request
    "max-cost": { type: "string", default: "0.50" },
    retries: { type: "string", default: "3" },
    effort: { type: "string", default: "low" },
    "max-tokens": { type: "string", default: "4000" },
    "level-map": { type: "string" },
    "easy-max": { type: "string", default: "3" },
    "medium-max": { type: "string", default: "6" },
    "chunk-size": { type: "string", default: "0" }, // words per output file (0 = one file)
    "poll-seconds": { type: "string", default: "60" },
    "price-in": { type: "string" },
    "price-out": { type: "string" },
    "include-existing": { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (o.help || !o.words) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(o.help ? 0 : 1);
}
const die = (m) => { console.error("Error: " + m); process.exit(1); };
const log = (...a) => console.log(...a);
const num = (k) => Number(o[k]);

const outFile = path.resolve(here, o.out);
if (path.dirname(outFile) !== OUT_DIR || !outFile.endsWith(".js")) die(`--out must be a .js file directly inside ${OUT_DIR}`);
const base = outFile.replace(/\.js$/, "");
const progFile = base + ".progress.jsonl";
if (!["sync", "batch"].includes(o.mode)) die("--mode must be sync or batch");
const model = o.model;
const prices = o["price-in"] ? [num("price-in"), num("price-out")] : L.PRICES[model];
if (!prices || prices.some((x) => !Number.isFinite(x))) die(`No price known for ${model}; pass --price-in and --price-out`);
let levelMap;
try { levelMap = L.parseLevelMap(o["level-map"]); L.configureLevels({ easyMax: num("easy-max"), mediumMax: num("medium-max") }); } catch (e) { die(e.message); }
const maxCost = num("max-cost"), batchSize = num("batch-size"), retries = num("retries");

const site = L.loadSite();
let words = L.loadWords(path.resolve(o.words));
const existing = words.filter((w) => site.VOCAB[w.key]);
if (existing.length && !o["include-existing"]) {
  log(`Skipping ${existing.length} word(s) already in js/data (use --include-existing to redo): ${existing.slice(0, 12).map((w) => w.key).join(", ")}${existing.length > 12 ? ", …" : ""}`);
  words = words.filter((w) => !site.VOCAB[w.key]);
}
if (!words.length) die("nothing to do");
const byKey = Object.fromEntries(words.map((w) => [w.key, w]));
const sig = L.planSignature(words.map((w) => w.key));
const system = L.buildVocabSystem();
const prefixTokens = Math.round(system[0].text.length / 3.5);
const discount = o.mode === "batch" ? 0.5 : 1;
const est = (n) => L.estimateCost({ words: n, prefixTokens, prices, discount, kind: "vocab" });
log(`Vocab for ${words.length} words, model ${model}, mode ${o.mode}, ${batchSize} words/request, rough cost $${(Math.ceil(words.length / batchSize) * est(batchSize) * 1.15).toFixed(2)}, cap $${maxCost}`);
if (o["dry-run"]) { for (const w of words.slice(0, 30)) log(`  ${w.key.padEnd(12)} ${L.normPos(w.pos).padEnd(5)} ${w.zh}  list level ${w.band} (${L.profileOf(w.band)}) → site level ${L.levelOf(w.band, levelMap)}`); if (words.length > 30) log(`  … ${words.length - 30} more`); process.exit(0); }

fs.mkdirSync(OUT_DIR, { recursive: true });
if (o.fresh) fs.rmSync(progFile, { force: true });
const store = createStore(progFile, { type: "header", sig, model, at: new Date().toISOString() });
if (store.records[0].sig !== sig) die("saved progress is for a different word list; use --fresh");
const done = {};
const tally = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };
for (const r of store.records) {
  if (r.type === "word") done[r.key] = { ex: r.ex, exZh: r.exZh };
  if (r.type === "usage") { for (const k of ["input", "output", "cacheWrite", "cacheRead", "cost"]) tally[k] += r[k]; tally.calls++; }
}
for (const w of words) if (done[w.key] && L.validateVocab(w, done[w.key]).length) { log(`Re-queued ${w.key} (saved entry fails current checks)`); delete done[w.key]; }
if (store.records.length > 1) log(`Resuming: ${Object.keys(done).length}/${words.length} done, $${tally.cost.toFixed(4)} spent so far`);

let client;
if (o.mock) client = makeMock(mockRespond, path.join(OUT_DIR, ".mock-batches-vocab.json"));
else {
  if (!process.env.ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY is not set (export it in your shell; it is never read from a file)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic({ maxRetries: 4 });
}
const engine = createEngine({ client, mode: o.mode, concurrency: num("concurrency"), model, prices, maxTokens: num("max-tokens"), pollSeconds: o.mock ? 0 : num("poll-seconds"), store, tally, log });

const failReasons = {};
let stoppedForCost = false;
for (let round = 1; round <= retries; round++) {
  const pending = words.filter((w) => !done[w.key]);
  if (!pending.length) break;
  let requests = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    const group = pending.slice(i, i + batchSize);
    requests.push({ id: `v${round}_${String(i / batchSize).padStart(5, "0")}`, words: group, content: L.buildVocabUser(group), effort: o.effort });
  }
  const room = maxCost - tally.cost;
  let total = 0, n = 0;
  for (const r of requests) { const e = est(r.words.length); if (total + e > room) break; total += e; n++; }
  if (n < requests.length) { stoppedForCost = true; log(`Cost cap $${maxCost}: ${n}/${requests.length} requests fit this round.`); requests = requests.slice(0, n); }
  if (!requests.length) break;
  log(`Round ${round}/${retries}: ${requests.length} requests, ${requests.reduce((s, r) => s + r.words.length, 0)} words (${o.mode})`);
  const results = await engine.run(requests, { system, stage: "vocab", round });
  let okCount = 0;
  for (const req of requests) {
    const res = results.get(req.id);
    const parsed = res && res.text ? L.parseVocab(res.text) : {};
    for (const w of req.words) {
      const errs = parsed[w.key] ? L.validateVocab(w, parsed[w.key]) : [res && res.error ? `request failed: ${res.error}` : "missing from response"];
      if (errs.length) errs.forEach((e) => { const k = e.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N").slice(0, 70); failReasons[k] = (failReasons[k] || 0) + 1; });
      else { done[w.key] = parsed[w.key]; store.append({ type: "word", key: w.key, ...parsed[w.key] }); okCount++; }
    }
  }
  log(`  accepted ${okCount}, to retry ${words.filter((w) => !done[w.key]).length}. Spent $${tally.cost.toFixed(4)}`);
  if (stoppedForCost) break;
}

const ok = words.filter((w) => done[w.key]);
const entry = (w) => `  ${w.key}: { pos: ${JSON.stringify(L.normPos(w.pos))}, zh: ${JSON.stringify(w.zh)}, level: ${L.levelOf(w.band, levelMap)}, ex: ${JSON.stringify(done[w.key].ex)}, exZh: ${JSON.stringify(done[w.key].exZh)} }`;
const chunk = num("chunk-size") || ok.length || 1;
for (const f of fs.readdirSync(OUT_DIR)) if (f === path.basename(outFile) || (f.startsWith(path.basename(base) + "-") && /-\d{3}\.js$/.test(f))) fs.rmSync(path.join(OUT_DIR, f));
const files = [];
for (let i = 0; i < ok.length || (i === 0 && !files.length); i += chunk) {
  const file = num("chunk-size") ? `${base}-${String(files.length + 1).padStart(3, "0")}.js` : outFile;
  fs.writeFileSync(file, `// Generated by scripts/gen-posts/vocab.mjs (model ${model}). NOT merged into the site — review first.\n// KK phonetics are not included: run scripts/make-kk.mjs after merging.\n\nObject.assign(window.VOCAB, {\n${ok.slice(i, i + chunk).map(entry).join(",\n")}\n});\n`);
  files.push(file);
}
let total = 0;
for (const f of files) { const w = { VOCAB: {} }; new Function("window", fs.readFileSync(f, "utf8"))(w); total += Object.keys(w.VOCAB).length; for (const [k, v] of Object.entries(w.VOCAB)) if (L.validateVocab(byKey[k], v) .length) die(`output re-check failed for ${k}`); }
if (total !== ok.length) die("output re-check failed (count mismatch)");

const missing = words.filter((w) => !done[w.key]);
fs.writeFileSync(base + ".report.json", JSON.stringify({ at: new Date().toISOString(), model, mode: o.mode, words: { total: words.length, done: ok.length, failed: missing.map((w) => w.key) }, tokens: tally, failReasons }, null, 2));
log(`\n=== Summary ===`);
log(`Words      ${ok.length}/${words.length}${missing.length ? `  (not done: ${missing.length} — re-run to retry${stoppedForCost ? " or raise --max-cost" : ""})` : ""}`);
log(`Tokens     input ${tally.input} · cache-write ${tally.cacheWrite} · cache-read ${tally.cacheRead} · output ${tally.output}  (${tally.calls} calls)`);
log(`Est. cost  $${tally.cost.toFixed(4)} at $${prices[0]}/$${prices[1]} per MTok${o.mode === "batch" ? " (batch: 50% off)" : ""}${o.mock ? "  [MOCK — fake numbers]" : ""}`);
if (Object.keys(failReasons).length) log(`Top rejection reasons: ${Object.entries(failReasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}× ${k}`).join(" | ")}`);
log(`Output     ${files.map((f) => path.relative(process.cwd(), f)).slice(0, 3).join(", ")}${files.length > 3 ? ` … (${files.length} files)` : ""}`);
process.exit(missing.length ? 2 : 0);

function mockRespond({ messages }) {
  const keys = [...messages[0].content.matchAll(/^- ([a-z ]+) \(/gm)].map((m) => m[1]);
  return { text: keys.map((k) => `### ${k}\nEN: I think the word ${k} is useful today.\nZH: 我覺得這個字今天很有用。`).join("\n\n"), usage: { input_tokens: 200, output_tokens: 30 * keys.length, cache_read_input_tokens: 800 } };
}
