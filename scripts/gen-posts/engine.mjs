// Runs groups of API requests either synchronously (optionally several at once) or through the
// Message Batches API (50% cheaper, asynchronous, survives restarts). Shared by gen.mjs and vocab.mjs.
import fs from "node:fs";
import crypto from "node:crypto";
import * as L from "./lib.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
const RETRYABLE = (e) => !e.status || e.status >= 500 || e.status === 429 || e.status === 408;

// Append-only JSONL progress file, loaded into memory.
export function createStore(file, header) {
  let records = [];
  if (fs.existsSync(file)) records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  else { records = [header]; fs.writeFileSync(file, JSON.stringify(header) + "\n"); }
  return {
    file,
    records,
    append(rec) { records.push(rec); fs.appendFileSync(file, JSON.stringify(rec) + "\n"); },
    find(pred) { return records.find(pred); },
    rewrite(keep) { records = records.filter(keep); fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n"); this.records = records; },
  };
}

export function createEngine({ client, mode, concurrency = 1, model, prices, maxTokens, pollSeconds = 60, batchMax = 2000, store, tally, log }) {
  const discount = mode === "batch" ? 0.5 : 1;
  const writeMult = mode === "batch" ? 2 : 1.25; // batches use the 1-hour cache TTL
  const params = (req, system) => ({ model, max_tokens: maxTokens, system, output_config: { effort: req.effort }, messages: [{ role: "user", content: req.content }] });
  const textOf = (message) => message.content.filter((c) => c.type === "text").map((c) => c.text).join("");

  function account(usage, key) {
    const u = L.usageOf(usage);
    const cost = L.costOf(u, prices, discount, writeMult);
    for (const k of Object.keys(u)) tally[k] += u[k];
    tally.cost += cost; tally.calls++;
    store.append({ type: "usage", key, ...u, cost, cacheHit: u.cacheRead > 0 });
    return { u, cost };
  }

  async function runSync(requests, system) {
    const results = new Map();
    let next = 0;
    const worker = async () => {
      while (next < requests.length) {
        const req = requests[next++];
        try {
          const msg = await client.messages.create(params(req, system));
          const { u, cost } = account(msg.usage, req.id);
          log(`  ${req.id}: in ${u.input} / cache-write ${u.cacheWrite} / cache-read ${u.cacheRead} / out ${u.output}  $${cost.toFixed(4)}`);
          results.set(req.id, { text: textOf(msg), stop: msg.stop_reason });
        } catch (e) {
          log(`  ${req.id}: API error ${e.status || ""} ${e.message}`);
          if (!RETRYABLE(e)) throw new Error(`non-retryable API error (${e.status}): ${e.message}`);
          results.set(req.id, { error: e.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, requests.length)) }, worker));
    return results;
  }

  async function runBatch(requests, system, stage, round) {
    const sys = system.map((b) => (b.cache_control ? { ...b, cache_control: { type: "ephemeral", ttl: "1h" } } : b));
    const results = new Map();
    for (let c = 0; c * batchMax < requests.length; c++) {
      const chunk = requests.slice(c * batchMax, (c + 1) * batchMax);
      const key = `${stage}:${round}:${c}:${hash(chunk.map((r) => r.id).join())}`;
      let rec = store.find((r) => r.type === "batch" && r.key === key);
      if (rec) log(`  Resuming batch ${rec.id} (${rec.n} requests)`);
      else {
        const batch = await client.messages.batches.create({ requests: chunk.map((req) => ({ custom_id: req.id, params: params(req, sys) })) });
        rec = { type: "batch", key, id: batch.id, n: chunk.length, at: new Date().toISOString() };
        store.append(rec);
        log(`  Submitted batch ${rec.id} (${rec.n} requests). Safe to stop; re-run the same command to collect the results.`);
      }
      let last = "";
      for (;;) {
        const b = await client.messages.batches.retrieve(rec.id);
        const line = `${b.processing_status} — processing ${b.request_counts.processing}, succeeded ${b.request_counts.succeeded}, errored ${b.request_counts.errored}`;
        if (line !== last) { log(`  [${new Date().toLocaleTimeString()}] batch ${rec.id}: ${line}`); last = line; }
        if (b.processing_status === "ended") break;
        await sleep(pollSeconds * 1000);
      }
      const sum = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      for await (const r of await client.messages.batches.results(rec.id)) {
        if (r.result.type === "succeeded") {
          const m = r.result.message;
          for (const k of Object.keys(sum)) sum[k] += (m.usage && m.usage[k]) || 0;
          results.set(r.custom_id, { text: textOf(m), stop: m.stop_reason });
        } else results.set(r.custom_id, { error: r.result.type === "errored" ? r.result.error?.error?.message || "errored" : r.result.type });
      }
      if (!store.find((x) => x.type === "usage" && x.key === key)) { // count each batch's usage once, even across resumes
        const { u, cost } = account(sum, key);
        log(`  batch usage: in ${u.input} / cache-write ${u.cacheWrite} / cache-read ${u.cacheRead} / out ${u.output}  $${cost.toFixed(4)} (batch price)`);
      }
    }
    return results;
  }

  return {
    discount,
    // requests: [{ id, content, effort }] -> Map(id -> { text, stop } | { error })
    run(requests, { system, stage, round }) {
      return mode === "batch" ? runBatch(requests, system, stage, round) : runSync(requests, system);
    },
  };
}
