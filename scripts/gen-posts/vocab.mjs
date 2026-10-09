#!/usr/bin/env node
// Generate VOCAB entries (pos, zh, level, ex, exZh) for a word list with the Claude API.
// Writes to scripts/gen-posts/out/ only. pos / zh / level come from the CSV, never from the model.
//
//   node vocab.mjs --words words.csv --out out/vocab.js
//   node vocab.mjs --words words.csv --dry-run | --mock
//   node vocab.mjs --words words.csv --level-map 1=1,2=1,3=2,4=3     (band → site level 1–3)
// Re-running resumes from out/<name>.progress.jsonl. Words already in js/data/ are skipped
// unless --include-existing. KK phonetics are NOT made here (scripts/make-kk.mjs does that on merge).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import * as L from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(here, "out");
const { values: o } = parseArgs({
  options: {
    words: { type: "string" },
    out: { type: "string", default: "out/vocab.js" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    "batch-size": { type: "string", default: "12" },
    "max-cost": { type: "string", default: "0.50" },
    retries: { type: "string", default: "3" },
    effort: { type: "string", default: "low" },
    "max-tokens": { type: "string", default: "4000" },
    "level-map": { type: "string" },
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const outFile = path.resolve(here, o.out);
if (path.dirname(outFile) !== OUT_DIR || !outFile.endsWith(".js")) die(`--out must be a .js file directly inside ${OUT_DIR}`);
const progFile = outFile.replace(/\.js$/, ".progress.jsonl");
const model = o.model;
const prices = o["price-in"] ? [Number(o["price-in"]), Number(o["price-out"])] : L.PRICES[model];
if (!prices || prices.some((x) => !Number.isFinite(x))) die(`No price known for ${model}; pass --price-in and --price-out`);
const maxCost = Number(o["max-cost"]), batchSize = Number(o["batch-size"]), retries = Number(o.retries);
let levelMap;
try { levelMap = L.parseLevelMap(o["level-map"]); } catch (e) { die(e.message); }

const site = L.loadSite();
let words = L.loadWords(path.resolve(o.words));
const existing = words.filter((w) => site.VOCAB[w.key]);
if (existing.length && !o["include-existing"]) {
  log(`Skipping ${existing.length} word(s) already in js/data: ${existing.map((w) => w.key).join(", ")} (use --include-existing to redo)`);
  words = words.filter((w) => !site.VOCAB[w.key]);
}
if (!words.length) die("nothing to do");
const sig = L.planSignature(words.map((w) => w.key));
log(`Vocab for ${words.length} words, model ${model}, batch ${batchSize}, cap $${o["max-cost"]}, level map ${JSON.stringify(levelMap)}`);
if (o["dry-run"]) { for (const w of words) log(`  ${w.key.padEnd(12)} ${L.normPos(w.pos).padEnd(5)} ${w.zh}  band ${w.band} → level ${L.levelOf(w.band, levelMap)}`); process.exit(0); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const done = {};
const spent = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };
if (o.fresh) fs.rmSync(progFile, { force: true });
if (fs.existsSync(progFile)) {
  const lines = fs.readFileSync(progFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (lines[0].sig !== sig) die("saved progress is for a different word list; use --fresh");
  for (const l of lines) {
    if (l.type === "word") done[l.key] = { ex: l.ex, exZh: l.exZh };
    if (l.type === "usage") { for (const k of ["input", "output", "cacheWrite", "cacheRead", "cost"]) spent[k] += l[k]; spent.calls++; }
  }
  for (const w of words) if (done[w.key] && L.validateVocab(w, done[w.key]).length) { log(`Re-queued ${w.key} (saved entry fails current checks)`); delete done[w.key]; }
  log(`Resuming: ${Object.keys(done).length}/${words.length} done, $${spent.cost.toFixed(4)} spent so far`);
} else fs.writeFileSync(progFile, JSON.stringify({ type: "header", sig, model, at: new Date().toISOString() }) + "\n");
const append = (r) => fs.appendFileSync(progFile, JSON.stringify(r) + "\n");

let client;
if (o.mock) client = {
  messages: { create: async ({ messages }) => {
    const keys = [...messages[0].content.matchAll(/^- ([a-z ]+) \(/gm)].map((m) => m[1]);
    return { stop_reason: "end_turn", usage: { input_tokens: 200, output_tokens: 30 * keys.length, cache_read_input_tokens: 800 },
      content: [{ type: "text", text: keys.map((k) => `### ${k}\nEN: I think the word ${k} is useful today.\nZH: 我覺得這個字今天很有用。`).join("\n\n") }] };
  } },
};
else {
  if (!process.env.ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY is not set (export it in your shell; it is never read from a file)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic({ maxRetries: 4 });
}
const system = L.buildVocabSystem();
const failed = {};
const pending = words.filter((w) => !done[w.key]);
let stopped = false;
for (let b = 0; b < pending.length && !stopped; b += batchSize) {
  let todo = pending.slice(b, b + batchSize);
  for (let attempt = 1; attempt <= retries && todo.length; attempt++) {
    if (spent.cost >= maxCost) { log(`Cost cap $${maxCost} reached — stopping. Re-run with a higher --max-cost to continue.`); stopped = true; break; }
    log(`Batch ${b / batchSize + 1}: ${todo.length} words (attempt ${attempt}/${retries})`);
    let msg;
    try {
      msg = await client.messages.create({ model, max_tokens: Number(o["max-tokens"]), system, output_config: { effort: o.effort }, messages: [{ role: "user", content: L.buildVocabUser(todo) }] });
    } catch (e) {
      log(`  API error: ${e.status || ""} ${e.message}`);
      if (e.status && e.status < 500 && e.status !== 429 && e.status !== 408) die(`non-retryable API error (${e.status})`);
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    const u = L.usageOf(msg.usage), cost = L.costOf(u, prices);
    for (const k of Object.keys(u)) spent[k] += u[k];
    spent.cost += cost; spent.calls++;
    append({ type: "usage", ...u, cost });
    log(`  tokens in ${u.input} / cache-write ${u.cacheWrite} / cache-read ${u.cacheRead} / out ${u.output}  $${cost.toFixed(4)}`);
    const parsed = L.parseVocab(msg.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
    const next = [];
    for (const w of todo) {
      const errs = parsed[w.key] ? L.validateVocab(w, parsed[w.key]) : ["missing from response"];
      if (errs.length) { next.push(w); failed[w.key] = errs; log(`  ✗ ${w.key}: ${errs.join("; ")}`); }
      else { done[w.key] = parsed[w.key]; delete failed[w.key]; append({ type: "word", key: w.key, ...parsed[w.key] }); }
    }
    todo = next;
  }
}

const ok = words.filter((w) => done[w.key]);
const entries = ok.map((w) => `  ${w.key}: { pos: ${JSON.stringify(L.normPos(w.pos))}, zh: ${JSON.stringify(w.zh)}, level: ${L.levelOf(w.band, levelMap)}, ex: ${JSON.stringify(done[w.key].ex)}, exZh: ${JSON.stringify(done[w.key].exZh)} }`);
fs.writeFileSync(outFile, `// Generated by scripts/gen-posts/vocab.mjs (model ${model}). NOT merged into the site — review first.\n// KK phonetics are not included: run scripts/make-kk.mjs after merging.\n\nObject.assign(window.VOCAB, {\n${entries.join(",\n")}\n});\n`);
{ const w = { VOCAB: {} }; new Function("window", fs.readFileSync(outFile, "utf8"))(w); if (Object.keys(w.VOCAB).length !== ok.length) die("output re-check failed"); }

log(`\n=== Summary ===`);
log(`Words      ${ok.length}/${words.length}${Object.keys(failed).length ? `  (failed: ${Object.keys(failed).join(", ")} — re-run to retry)` : ""}`);
log(`Tokens     input ${spent.input} · cache-write ${spent.cacheWrite} · cache-read ${spent.cacheRead} · output ${spent.output}  (${spent.calls} calls)`);
log(`Est. cost  $${spent.cost.toFixed(4)} at $${prices[0]}/$${prices[1]} per MTok${o.mock ? "  [MOCK — fake numbers]" : ""}`);
log(`Output     ${path.relative(process.cwd(), outFile)}`);
process.exit(ok.length === words.length ? 0 : 2);
