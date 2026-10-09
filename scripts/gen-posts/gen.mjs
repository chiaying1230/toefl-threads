#!/usr/bin/env node
// Batch-generate toEfu threads with the Claude API. Writes to scripts/gen-posts/out/ only —
// never touches js/data/. The API key is read from ANTHROPIC_API_KEY and nothing else.
//
//   node gen.mjs --words words.csv --out out/sample.js
//   node gen.mjs --words words.csv --dry-run        (plan + prompt size, no API call)
//   node gen.mjs --words words.csv --mock           (offline pipeline test, no API call)
// Re-running the same command resumes from out/<name>.progress.jsonl.
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
    out: { type: "string", default: "out/sample.js" },
    model: { type: "string", default: "claude-sonnet-5-5" },
    "batch-size": { type: "string", default: "5" }, // threads per API request
    "max-cost": { type: "string", default: "1.00" }, // USD, cumulative across resumes
    retries: { type: "string", default: "3" }, // attempts per batch
    effort: { type: "string", default: "medium" }, // low | medium | high
    examples: { type: "string", default: "3" }, // existing threads per character shown as examples
    "max-tokens": { type: "string", default: "8000" },
    seed: { type: "string", default: "1" },
    "start-id": { type: "string" }, // default: one after the highest existing pN
    "price-in": { type: "string" }, // override $/MTok if the model is not in the price table
    "price-out": { type: "string" },
    fresh: { type: "boolean", default: false }, // discard previous progress
    redo: { type: "string" }, // comma-separated ids to regenerate, e.g. p469,p473 (keeps the rest)
    "review-effort": { type: "string", default: "high" }, // thinking effort for the --review pass
    "mix-share": { type: "string", default: "0.5" }, // share of band 1–4 threads written by mix-language characters
    review: { type: "boolean", default: false }, // second pass: model self-checks each batch and rewrites weak threads
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (o.help || !o.words) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(o.help ? 0 : 1);
}

const outFile = path.resolve(here, o.out);
if (path.dirname(outFile) !== OUT_DIR || !outFile.endsWith(".js")) die(`--out must be a .js file directly inside ${OUT_DIR}`);
const progFile = outFile.replace(/\.js$/, ".progress.jsonl");
const model = o.model;
const prices = o["price-in"] ? [Number(o["price-in"]), Number(o["price-out"])] : L.PRICES[model];
if (!prices || prices.some((x) => !Number.isFinite(x))) die(`No price known for ${model}; pass --price-in and --price-out ($ per million tokens)`);
const maxCost = Number(o["max-cost"]), batchSize = Number(o["batch-size"]), retries = Number(o.retries);

function die(msg) { console.error("Error: " + msg); process.exit(1); }
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- plan ----------
const site = L.loadSite();
const words = L.loadWords(path.resolve(o.words));
const maxId = Math.max(...site.POSTS.map((p) => Number(p.id.slice(1))));
const startId = o["start-id"] ? Number(o["start-id"]) : maxId + 1;
const plan = L.makePlan({ words, characters: site.CHARACTERS, topics: site.TOPICS, startId, seed: Number(o.seed), mixShare: Number(o["mix-share"]) });
const sig = L.planSignature(plan);
const authors = [...new Set(plan.map((t) => t.author))];
const system = L.buildSystem({
  characters: site.CHARACTERS,
  examples: L.pickExamples(site.POSTS, site.CHARACTERS, authors, Number(o.examples)),
  authors,
});
const counts = (key) => Object.entries(plan.reduce((m, t) => ((m[t[key]] = (m[t[key]] || 0) + 1), m), {})).map(([k, n]) => `${k}×${n}`).join(" ");
log(`Words ${words.length} → ${plan.length} threads (ids p${startId}–p${startId + plan.length - 1}), model ${model}, batch ${batchSize}, cap $${maxCost}`);
log(`Characters  ${counts("author")}`);
log(`Topics      ${counts("topic")}`);
const sysChars = system[0].text.length;
log(`Cached prompt ≈ ${sysChars} chars (≈ ${Math.round(sysChars / 3.5)} tokens)`);
if (o["dry-run"]) {
  for (const t of plan) log(`  ${t.id} ${t.author.padEnd(9)} ${t.topic.padEnd(12)} band ${t.band}: ${t.words.map((w) => w.key).join(", ")}`);
  process.exit(0);
}

// ---------- progress / resume ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
let accepted = {}; // id -> {text, zh}
let spent = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 };
if (o.fresh) fs.rmSync(progFile, { force: true });
if (o.redo && fs.existsSync(progFile)) {
  const ids = new Set(o.redo.split(",").map((x) => x.trim()));
  const keep = fs.readFileSync(progFile, "utf8").split("\n").filter(Boolean).filter((l) => { const r = JSON.parse(l); return !((r.type === "post" || r.type === "fail") && ids.has(r.id)); });
  fs.writeFileSync(progFile, keep.join("\n") + "\n");
  log(`Redo: dropped ${[...ids].join(", ")} from saved progress`);
}
if (fs.existsSync(progFile)) {
  const lines = fs.readFileSync(progFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (lines[0].sig !== sig) die(`${path.relative(here, progFile)} was made from a different word list/seed/ids. Use --fresh to start over.`);
  for (const l of lines) {
    if (l.type === "post") accepted[l.id] = { text: l.text, zh: l.zh };
    if (l.type === "usage") { for (const k of ["input", "output", "cacheWrite", "cacheRead", "cost"]) spent[k] += l[k]; spent.calls++; }
  }
  log(`Resuming: ${Object.keys(accepted).length}/${plan.length} threads done, $${spent.cost.toFixed(4)} spent so far`);
} else fs.writeFileSync(progFile, JSON.stringify({ type: "header", sig, model, at: new Date().toISOString() }) + "\n");
// saved threads that no longer pass the current validator are re-queued instead of kept
for (const t of plan) {
  if (!accepted[t.id]) continue;
  const errs = L.validatePost(t, accepted[t.id]);
  if (errs.length) { log(`Re-queued ${t.id} (saved draft fails current checks: ${errs.join("; ")})`); delete accepted[t.id]; }
}
const append = (rec) => fs.appendFileSync(progFile, JSON.stringify(rec) + "\n");

// ---------- client ----------
let client;
if (o.mock) client = mockClient();
else {
  if (!process.env.ANTHROPIC_API_KEY) die("ANTHROPIC_API_KEY is not set (export it in your shell; it is never read from a file)");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  client = new Anthropic({ maxRetries: 4 }); // SDK retries 429/5xx/network with backoff
}

// one API call -> parsed threads (or null after a retryable error); tracks usage/cost
async function call(content, attempt = 1, effort = o.effort) {
  let msg;
  try {
    msg = await client.messages.create({
      model,
      max_tokens: Number(o["max-tokens"]),
      system,
      output_config: { effort },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    log(`  API error: ${e.status || ""} ${e.message}`);
    if (e.status && e.status < 500 && e.status !== 429 && e.status !== 408) die(`non-retryable API error (${e.status}); check model name / key`);
    await sleep(2000 * 2 ** (attempt - 1));
    return null;
  }
  const u = L.usageOf(msg.usage);
  const cost = L.costOf(u, prices);
  for (const k of Object.keys(u)) spent[k] += u[k];
  spent.cost += cost; spent.calls++;
  append({ type: "usage", ...u, cost, cacheHit: u.cacheRead > 0 });
  log(`  tokens in ${u.input} / cache-write ${u.cacheWrite} / cache-read ${u.cacheRead} / out ${u.output}  $${cost.toFixed(4)}`);
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") log(`  stop_reason ${msg.stop_reason} — partial output will be validated`);
  return L.parseResponse(msg.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
}

// --review: editor pass over a batch; a rewrite replaces the draft only if it still validates
async function reviewBatch(tasks) {
  if (spent.cost >= maxCost) return;
  log(`  Review pass: ${tasks.map((t) => t.id).join(" ")}`);
  const drafts = Object.fromEntries(tasks.map((t) => [t.id, accepted[t.id]]));
  const parsed = await call(L.buildReview(tasks, drafts), 1, o["review-effort"]);
  if (!parsed) return;
  for (const t of tasks) {
    const r = parsed[t.id];
    if (!r || (r.text.trim() === "OK" && !r.zh)) { log(`  ✓ ${t.id} ok`); continue; }
    const errs = L.validatePost(t, r);
    if (errs.length) { log(`  ↺ ${t.id} rewrite rejected (${errs.join("; ")}) — keeping draft`); continue; }
    accepted[t.id] = r; append({ type: "post", id: t.id, ...r, reviewed: true });
    log(`  ✎ ${t.id} rewritten by review`);
  }
}

// ---------- run ----------
const failed = {};
const pending = plan.filter((t) => !accepted[t.id]);
let stopped = false;
for (let b = 0; b < pending.length && !stopped; b += batchSize) {
  let todo = pending.slice(b, b + batchSize);
  let feedback = {};
  const fresh = []; // threads accepted in this batch (for --review)
  for (let attempt = 1; attempt <= retries && todo.length; attempt++) {
    if (spent.cost >= maxCost) { log(`Cost cap $${maxCost} reached — stopping. Re-run with a higher --max-cost to continue.`); stopped = true; break; }
    log(`Batch ${b / batchSize + 1}: ${todo.map((t) => t.id).join(" ")} (attempt ${attempt}/${retries})`);
    const parsed = await call(L.buildUser(todo, feedback), attempt);
    if (!parsed) continue;
    const next = [];
    feedback = {};
    for (const t of todo) {
      const errs = parsed[t.id] ? L.validatePost(t, parsed[t.id]) : ["missing from response"];
      if (errs.length) { feedback[t.id] = errs; next.push(t); log(`  ✗ ${t.id}: ${errs.join("; ")}`); }
      else { accepted[t.id] = parsed[t.id]; append({ type: "post", id: t.id, ...parsed[t.id] }); fresh.push(t); }
    }
    todo = next;
  }
  if (o.review && fresh.length && !stopped) await reviewBatch(fresh);
  for (const t of todo) { failed[t.id] = feedback[t.id] || ["no valid response"]; append({ type: "fail", id: t.id, errors: failed[t.id] }); }
}

// ---------- write output ----------
const done = plan.filter((t) => accepted[t.id]);
const body = done
  .map((t) => `  { id: ${JSON.stringify(t.id)}, author: ${JSON.stringify(t.author)}, topic: ${JSON.stringify(t.topic)},\n    text: ${JSON.stringify(accepted[t.id].text)},\n    zh: ${JSON.stringify(accepted[t.id].zh)} }`)
  .join(",\n");
fs.writeFileSync(outFile, `// Generated by scripts/gen-posts (model ${model}). NOT merged into the site — review first.\n// Words used: ${[...new Set(done.flatMap((t) => t.words.map((w) => w.key)))].join(", ")}\n\nwindow.POSTS.push(\n${body}\n);\n`);

// final re-check of the written file
{
  const w = { POSTS: [] };
  new Function("window", fs.readFileSync(outFile, "utf8"))(w);
  const ids = new Set();
  for (const p of w.POSTS) {
    const t = plan.find((x) => x.id === p.id);
    const errs = [...L.validatePost(t, p), ...(ids.has(p.id) ? ["duplicate id"] : [])];
    ids.add(p.id);
    if (errs.length || p.author !== t.author || p.topic !== t.topic) die(`output re-check failed for ${p.id}: ${errs.join("; ")}`);
  }
}

const covered = new Set(done.flatMap((t) => t.words.map((w) => w.key)));
log(`\n=== Summary ===`);
log(`Threads    ${done.length}/${plan.length}${Object.keys(failed).length ? `  (failed: ${Object.keys(failed).join(", ")} — re-run to retry)` : ""}`);
log(`Words      ${covered.size}/${words.length} covered${covered.size < words.length ? "  missing: " + words.filter((w) => !covered.has(w.key)).map((w) => w.key).join(", ") : ""}`);
log(`Characters ${Object.entries(done.reduce((m, t) => ((m[t.author] = (m[t.author] || 0) + 1), m), {})).map(([k, n]) => `${k}×${n}`).join(" ")}`);
log(`Tokens     input ${spent.input} · cache-write ${spent.cacheWrite} · cache-read ${spent.cacheRead} · output ${spent.output}  (${spent.calls} calls)`);
log(`Est. cost  $${spent.cost.toFixed(4)} at $${prices[0]}/$${prices[1]} per MTok (cache read 0.1×, write 1.25×)${o.mock ? "  [MOCK — fake numbers]" : ""}`);
log(`Output     ${path.relative(process.cwd(), outFile)}`);
process.exit(done.length === plan.length ? 0 : 2);

// ---------- offline stand-in for the API (--mock) ----------
function mockClient() {
  return {
    messages: {
      create: async ({ messages }) => {
        const user = messages[0].content;
        if (user.startsWith("Review these")) {
          const ids = [...user.matchAll(/^### (p\d+)/gm)].map((m) => m[1]);
          return { stop_reason: "end_turn", content: [{ type: "text", text: ids.map((id) => `### ${id}\nOK`).join("\n\n") }], usage: { input_tokens: 200, output_tokens: 10, cache_read_input_tokens: 4000 } };
        }
        const blocks = user.split(/^### /m).slice(1).map((b) => {
          const id = b.match(/^(p\d+)/)[1];
          const keys = [...b.matchAll(/^ {2}- ([a-z_]+)/gm)].map((m) => m[1]);
          return { id, keys };
        });
        const text = blocks.map(({ id, keys }) => `### ${id}\nMock thread about ${keys.map((k) => `[[${k}]]`).join(" and ")}. 😀\n---\n模擬串文。`).join("\n\n");
        return { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 300, output_tokens: 80 * blocks.length, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 } };
      },
    },
  };
}
