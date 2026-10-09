#!/usr/bin/env node
// Batch-generate toEfu threads with the Claude API. Writes to scripts/gen-posts/out/ only —
// never touches js/data/. The API key is read from ANTHROPIC_API_KEY and nothing else.
//
//   node gen.mjs --words words.csv --out out/run1.js --review                  (sync, a few hundred threads)
//   node gen.mjs --words words.csv --out out/run1.js --review --mode batch     (Batch API: 50% cheaper, slow is fine)
//   node gen.mjs --words words.csv --dry-run                                   (plan + cost estimate, no API call)
//   node gen.mjs --words words.csv --mock [--mode batch]                       (offline pipeline test)
// Re-run the same command to resume (also collects a batch that was submitted earlier).
// Words already in js/data/ are skipped unless --include-existing. Word-list "band" = level 1–10.
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
    out: { type: "string", default: "out/sample.js" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    mode: { type: "string", default: "sync" }, // sync | batch
    concurrency: { type: "string", default: "1" }, // parallel requests in sync mode
    "batch-size": { type: "string", default: "5" }, // threads per request
    "max-cost": { type: "string", default: "1.00" }, // USD, cumulative across resumes
    retries: { type: "string", default: "3" }, // generation rounds per thread
    effort: { type: "string", default: "medium" },
    review: { type: "boolean", default: false },
    "review-effort": { type: "string", default: "high" },
    examples: { type: "string", default: "3" },
    "max-tokens": { type: "string", default: "8000" },
    seed: { type: "string", default: "1" },
    "start-id": { type: "string" },
    "mix-share": { type: "string", default: "0.5" },
    "easy-max": { type: "string", default: "3" }, // levels 1..easy-max are the easy profile
    "medium-max": { type: "string", default: "6" }, // ..medium-max medium; above that advanced
    "chunk-size": { type: "string", default: "0" }, // threads per output file (0 = one file); 40 matches js/data/batch-N.js
    "sim-threshold": { type: "string", default: "0.3" }, // reject threads this similar to an existing/accepted one
    inspect: { type: "string", default: "20" }, // how many random threads to list for a human spot check
    "poll-seconds": { type: "string", default: "60" },
    "price-in": { type: "string" },
    "price-out": { type: "string" },
    "include-existing": { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    redo: { type: "string" }, // comma-separated ids to regenerate
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (o.help || !o.words) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 11).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
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
if (!prices || prices.some((x) => !Number.isFinite(x))) die(`No price known for ${model}; pass --price-in and --price-out ($ per million tokens)`);
try { L.configureLevels({ easyMax: num("easy-max"), mediumMax: num("medium-max") }); } catch (e) { die(e.message); }
const maxCost = num("max-cost"), batchSize = num("batch-size"), retries = num("retries");

// ---------- plan ----------
const site = L.loadSite();
let words = L.loadWords(path.resolve(o.words));
const existing = words.filter((w) => site.VOCAB[w.key]);
if (existing.length && !o["include-existing"]) {
  log(`Skipping ${existing.length} word(s) already in js/data (use --include-existing to include): ${existing.slice(0, 12).map((w) => w.key).join(", ")}${existing.length > 12 ? ", …" : ""}`);
  words = words.filter((w) => !site.VOCAB[w.key]);
}
if (words.length < 2) die("need at least 2 new words");
const maxId = Math.max(...site.POSTS.map((p) => Number(p.id.slice(1))));
const startId = o["start-id"] ? num("start-id") : maxId + 1;
const plan = L.makePlan({ words, characters: site.CHARACTERS, topics: site.TOPICS, startId, seed: num("seed"), mixShare: num("mix-share") });
const planById = Object.fromEntries(plan.map((t) => [t.id, t]));
const sig = L.planSignature(plan);
const authors = [...new Set(plan.map((t) => t.author))];
const system = L.buildSystem({ characters: site.CHARACTERS, examples: L.pickExamples(site.POSTS, site.CHARACTERS, authors, num("examples")), authors });
const prefixTokens = Math.round(system[0].text.length / 3.5);
const discount = o.mode === "batch" ? 0.5 : 1;
const estGen = (n) => L.estimateCost({ posts: n, prefixTokens, prices, discount, kind: "gen" });
const estRev = (n) => L.estimateCost({ posts: n, prefixTokens, prices, discount, kind: "review" });
const requestsFor = (n) => Math.ceil(n / batchSize);
const estTotal = requestsFor(plan.length) * estGen(batchSize) * 1.25 + (o.review ? requestsFor(plan.length) * estRev(batchSize) : 0);

const counts = (key) => Object.entries(plan.reduce((m, t) => ((m[t[key]] = (m[t[key]] || 0) + 1), m), {})).map(([k, n]) => `${k}×${n}`).join(" ");
log(`Words ${words.length} → ${plan.length} threads (ids p${startId}–p${startId + plan.length - 1}), model ${model}, mode ${o.mode}, ${batchSize} threads/request`);
log(`Levels      easy 1–${L.LEVELS.easyMax}: ${plan.filter((t) => L.profileOf(t.band) === "easy").length} threads · medium: ${plan.filter((t) => L.profileOf(t.band) === "medium").length} · advanced: ${plan.filter((t) => L.profileOf(t.band) === "advanced").length}`);
if (plan.length <= 60) { log(`Characters  ${counts("author")}`); log(`Topics      ${counts("topic")}`); }
else log(`Characters  ${authors.length} distinct, most used ${Math.max(...Object.values(plan.reduce((m, t) => ((m[t.author] = (m[t.author] || 0) + 1), m), {})))}×`);
log(`Cached prompt ≈ ${prefixTokens} tokens · rough cost estimate $${estTotal.toFixed(2)}${o.review ? " (with review)" : ""} · cap $${maxCost}`);
if (o["dry-run"]) {
  for (const t of plan.slice(0, 40)) log(`  ${t.id} ${t.author.padEnd(9)} ${t.topic.padEnd(12)} lvl ${t.band}: ${t.words.map((w) => w.key).join(", ")}`);
  if (plan.length > 40) log(`  … ${plan.length - 40} more`);
  process.exit(0);
}

// ---------- progress / resume ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
if (o.fresh) fs.rmSync(progFile, { force: true });
const store = createStore(progFile, { type: "header", sig, model, at: new Date().toISOString() });
if (store.records[0].sig !== sig) die(`${path.relative(here, progFile)} was made from a different word list/seed/ids/settings. Use --fresh to start over.`);
if (o.redo) {
  const ids = new Set(o.redo.split(",").map((x) => x.trim()));
  store.rewrite((r) => !((r.type === "post" || r.type === "reviewed") && ids.has(r.id)));
  log(`Redo: dropped ${[...ids].join(", ")} from saved progress`);
}
const accepted = {}; // id -> { text, zh }
const reviewed = new Set();
const tally = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };
for (const r of store.records) {
  if (r.type === "post") { accepted[r.id] = { text: r.text, zh: r.zh }; if (r.reviewed) reviewed.add(r.id); }
  if (r.type === "reviewed") reviewed.add(r.id);
  if (r.type === "usage") { for (const k of ["input", "output", "cacheWrite", "cacheRead", "cost"]) tally[k] += r[k]; tally.calls++; }
}
for (const t of plan) { // saved drafts that fail today's checks are re-queued
  if (!accepted[t.id]) continue;
  const errs = L.validatePost(t, accepted[t.id]);
  if (errs.length) { log(`Re-queued ${t.id} (saved draft fails current checks: ${errs[0]})`); delete accepted[t.id]; reviewed.delete(t.id); }
}
if (store.records.length > 1) log(`Resuming: ${Object.keys(accepted).length}/${plan.length} threads done, $${tally.cost.toFixed(4)} spent so far`);

const sim = L.makeSimIndex();
site.POSTS.forEach((p) => sim.add(p.id, p.text));
for (const t of plan) if (accepted[t.id]) sim.add(t.id, accepted[t.id].text);
const simMax = num("sim-threshold");
const checkAll = (t, post) => {
  const errs = L.validatePost(t, post);
  if (!errs.length) { const n = sim.nearest(post.text); if (n.sim > simMax) errs.push(`too similar to ${n.id} (${n.sim.toFixed(2)}): use a different scene, joke and wording`); }
  return errs;
};

// ---------- client / engine ----------
let client;
if (o.mock) client = makeMock(mockRespond, path.join(OUT_DIR, ".mock-batches.json"));
else {
  if (!process.env.ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY is not set (export it in your shell; it is never read from a file)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic({ maxRetries: 4 });
}
const engine = createEngine({ client, mode: o.mode, concurrency: num("concurrency"), model, prices, maxTokens: num("max-tokens"), pollSeconds: o.mock ? 0 : num("poll-seconds"), store, tally, log });

// keep a round under the cost cap using the pre-flight estimate
function affordable(requests, est) {
  const room = maxCost - tally.cost;
  let total = 0, n = 0;
  for (const r of requests) { const e = est(r); if (total + e > room) break; total += e; n++; }
  return requests.slice(0, n);
}
const failReasons = {};
const note = (errs) => errs.forEach((e) => { const k = e.replace(/"[^"]*"/g, '"…"').replace(/\d+(\.\d+)?/g, "N").slice(0, 80); failReasons[k] = (failReasons[k] || 0) + 1; });
const reviewStats = { ok: 0, rewritten: 0, rejected: 0 };
let stoppedForCost = false;

// ---------- generation rounds ----------
let feedback = {};
for (let round = 1; round <= retries; round++) {
  const pending = plan.filter((t) => !accepted[t.id]);
  if (!pending.length) break;
  let requests = [];
  for (let i = 0; i < pending.length; i += batchSize) {
    const group = pending.slice(i, i + batchSize);
    requests.push({ id: `g${round}_${group[0].id}`, tasks: group, content: L.buildUser(group, feedback), effort: o.effort });
  }
  const before = requests.length;
  requests = affordable(requests, (r) => estGen(r.tasks.length));
  if (requests.length < before) { stoppedForCost = true; log(`Cost cap $${maxCost}: ${requests.length}/${before} requests fit this round.`); }
  if (!requests.length) break;
  log(`Round ${round}/${retries}: ${requests.length} requests, ${requests.reduce((n, r) => n + r.tasks.length, 0)} threads (${o.mode})`);
  const results = await engine.run(requests, { system, stage: "gen", round });
  feedback = {};
  let okCount = 0;
  for (const req of requests) {
    const res = results.get(req.id);
    const parsed = res && res.text ? L.parseResponse(res.text) : {};
    for (const t of req.tasks) {
      const errs = parsed[t.id] ? checkAll(t, parsed[t.id]) : [res && res.error ? `request failed: ${res.error}` : "missing from response"];
      if (errs.length) { feedback[t.id] = errs; note(errs); }
      else { accepted[t.id] = parsed[t.id]; store.append({ type: "post", id: t.id, ...parsed[t.id] }); sim.add(t.id, parsed[t.id].text); okCount++; }
    }
  }
  log(`  accepted ${okCount}, to retry ${Object.keys(feedback).length}. Spent $${tally.cost.toFixed(4)}`);
  if (stoppedForCost) break;
}

// ---------- review pass ----------
if (o.review && !stoppedForCost) {
  const todo = plan.filter((t) => accepted[t.id] && !reviewed.has(t.id));
  let requests = [];
  for (let i = 0; i < todo.length; i += batchSize) {
    const group = todo.slice(i, i + batchSize);
    requests.push({ id: `r1_${group[0].id}`, tasks: group, content: L.buildReview(group, Object.fromEntries(group.map((t) => [t.id, accepted[t.id]]))), effort: o["review-effort"] });
  }
  const before = requests.length;
  requests = affordable(requests, (r) => estRev(r.tasks.length));
  if (requests.length < before) { stoppedForCost = true; log(`Cost cap $${maxCost}: only ${requests.length}/${before} review requests fit.`); }
  if (requests.length) {
    log(`Review: ${requests.length} requests (${o.mode}, effort ${o["review-effort"]})`);
    const results = await engine.run(requests, { system, stage: "review", round: 1 });
    for (const req of requests) {
      const res = results.get(req.id);
      if (!res || !res.text) { log(`  review request ${req.id} failed (${res && res.error}) — will be retried on the next run`); continue; }
      const parsed = L.parseResponse(res.text);
      for (const t of req.tasks) {
        const r = parsed[t.id];
        if (!r) continue; // not reviewed: retried next run
        if (r.text.trim() === "OK" && !r.zh) { reviewStats.ok++; }
        else {
          const errs = L.validatePost(t, r);
          const n = errs.length ? null : sim.nearest(r.text);
          if (errs.length || (n.sim > simMax && n.id !== t.id)) { reviewStats.rejected++; note(errs.length ? errs : ["review rewrite too similar"]); }
          else { accepted[t.id] = r; store.append({ type: "post", id: t.id, ...r, reviewed: true }); sim.add(t.id, r.text); reviewStats.rewritten++; reviewed.add(t.id); continue; }
        }
        reviewed.add(t.id); store.append({ type: "reviewed", id: t.id });
      }
    }
    log(`  review: ${reviewStats.ok} ok, ${reviewStats.rewritten} rewritten, ${reviewStats.rejected} rewrites rejected (draft kept)`);
  }
}

// ---------- write output ----------
const done = plan.filter((t) => accepted[t.id]);
const fmt = (t) => `  { id: ${JSON.stringify(t.id)}, author: ${JSON.stringify(t.author)}, topic: ${JSON.stringify(t.topic)},\n    text: ${JSON.stringify(accepted[t.id].text)},\n    zh: ${JSON.stringify(accepted[t.id].zh)} }`;
const chunkSize = num("chunk-size") || done.length || 1;
for (const f of fs.readdirSync(OUT_DIR)) if (f === path.basename(outFile) || (f.startsWith(path.basename(base) + "-") && /-\d{3}\.js$/.test(f))) fs.rmSync(path.join(OUT_DIR, f));
const files = [];
for (let i = 0; i < done.length || (i === 0 && !files.length); i += chunkSize) {
  const part = done.slice(i, i + chunkSize);
  const file = num("chunk-size") ? `${base}-${String(files.length + 1).padStart(3, "0")}.js` : outFile;
  const used = [...new Set(part.flatMap((t) => t.words.map((w) => w.key)))];
  fs.writeFileSync(file, `// Generated by scripts/gen-posts (model ${model}). NOT merged into the site — review first.\n// Words used: ${used.join(", ")}\n\nwindow.POSTS.push(\n${part.map(fmt).join(",\n")}\n);\n`);
  files.push(file);
}
{ // re-check what was actually written
  const ids = new Set();
  for (const f of files) {
    const w = { POSTS: [] };
    new Function("window", fs.readFileSync(f, "utf8"))(w);
    for (const p of w.POSTS) {
      const t = planById[p.id];
      const errs = [...L.validatePost(t, p), ...(ids.has(p.id) ? ["duplicate id"] : [])];
      ids.add(p.id);
      if (errs.length || p.author !== t.author || p.topic !== t.topic) die(`output re-check failed for ${p.id}: ${errs.join("; ")}`);
    }
  }
}

// ---------- report ----------
const covered = new Set(done.flatMap((t) => t.words.map((w) => w.key)));
const missing = plan.filter((t) => !accepted[t.id]);
let seedState = num("seed") + 99;
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) >>> 0) / 4294967296);
const inspectIds = [...done].sort(() => rnd() - 0.5).slice(0, num("inspect")).map((t) => t.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const perChar = done.reduce((m, t) => ((m[t.author] = (m[t.author] || 0) + 1), m), {});
fs.writeFileSync(base + ".report.json", JSON.stringify({ at: new Date().toISOString(), model, mode: o.mode, threads: { planned: plan.length, done: done.length, failed: missing.map((t) => t.id) }, wordsCovered: covered.size, wordsTotal: words.length, tokens: tally, reviews: reviewStats, failReasons, characters: perChar, inspect: inspectIds }, null, 2));

log(`\n=== Summary ===`);
log(`Threads    ${done.length}/${plan.length}${missing.length ? `  (not done: ${missing.length} — re-run to retry${stoppedForCost ? " or raise --max-cost" : ""})` : ""}`);
log(`Words      ${covered.size}/${words.length} covered`);
log(`Characters ${Object.keys(perChar).length} used${plan.length <= 60 ? ": " + Object.entries(perChar).map(([k, n]) => `${k}×${n}`).join(" ") : ""}`);
if (o.review) log(`Review     ${reviewStats.ok} ok · ${reviewStats.rewritten} rewritten · ${reviewStats.rejected} rewrites rejected`);
log(`Tokens     input ${tally.input} · cache-write ${tally.cacheWrite} · cache-read ${tally.cacheRead} · output ${tally.output}  (${tally.calls} calls)`);
log(`Est. cost  $${tally.cost.toFixed(4)} at $${prices[0]}/$${prices[1]} per MTok${o.mode === "batch" ? " (batch: 50% off, cache write 2×)" : " (cache read 0.1×, write 1.25×)"}${o.mock ? "  [MOCK — fake numbers]" : ""}`);
if (Object.keys(failReasons).length) log(`Top rejection reasons: ${Object.entries(failReasons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n}× ${k}`).join(" | ")}`);
log(`Output     ${files.map((f) => path.relative(process.cwd(), f)).slice(0, 3).join(", ")}${files.length > 3 ? ` … (${files.length} files)` : ""}`);
log(`Spot-check these ids by eye: ${inspectIds.join(" ")}   (report: ${path.relative(process.cwd(), base + ".report.json")})`);
process.exit(missing.length ? 2 : 0);

// ---------- offline responder for --mock ----------
function mockRespond({ messages }) {
  const user = messages[0].content;
  const usage = { input_tokens: 300, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 };
  if (user.startsWith("Review these")) {
    const blocks = user.split(/^### /m).slice(1).filter((b) => /^p\d+/.test(b));
    const text = blocks.map((b, i) => {
      const id = b.match(/^(p\d+)/)[1];
      if (process.env.MOCK_REVIEW_REWRITE && i === 0) {
        const keys = b.match(/target words: ([^\]]+)\]/)[1].split(";").map((x) => x.trim().split(" ")[0]);
        return `### ${id}\nRewritten mock thread ${id} with ${keys.map((k) => `[[${k}]]`).join(" and ")} inside it today. 😀\n---\n改寫的模擬串文。`;
      }
      return `### ${id}\nOK`;
    }).join("\n\n");
    return { text, usage };
  }
  const blocks = user.split(/^### /m).slice(1).filter((b) => /^p\d+/.test(b));
  const text = blocks.map((b) => {
    const id = b.match(/^(p\d+)/)[1];
    const keys = [...b.matchAll(/^ {2}- ([a-z_]+)/gm)].map((m) => m[1]);
    return `### ${id}\nMock thread ${id} about ${keys.map((k) => `[[${k}]]`).join(" and ")}. 😀\n---\n模擬串文。`;
  }).join("\n\n");
  return { text, usage };
}
