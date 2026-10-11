// Offline tests for segments / cache / generate. A fake `synthesize` stands in for the API: nothing here touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ConfigError } from "./config.mjs";
import { ElevenLabsError } from "./elevenlabs.mjs";
import { createCache } from "./cache.mjs";
import { generateNarration, planNarration } from "./generate.mjs";
import { prepareNarration } from "./segments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = { ELEVENLABS_API_KEY: "sk_0123456789abcdef0123456789abcdef" };
const cfg = () => ({
  provider: "elevenlabs", apiBase: "https://example.invalid", output: { format: "mp3_44100_128" },
  voices: {
    arthur: { voiceId: "A1", lang: "en", model: "m", settings: { stability: 0, similarity_boost: 0 } },
    ling: { voiceId: "L1", lang: "zh", model: "m", settings: { stability: 0, similarity_boost: 0 } },
  },
  roles: { story: "arthur", example: "arthur", meaning: "ling" },
});
const narration = (patch = (x) => x) => patch({
  id: "t1",
  segments: [
    { id: "lead", kind: "story", text: "I decided to allocate", gap: 0.04 },
    { id: "m", kind: "meaning", text: "分配、撥出。", gap: 0.04 },
    { id: "ex", kind: "example", text: "We allocate money to advertising.", gap: 0.08 },
    { id: "budget", kind: "story", text: "ninety percent of the budget.", continuesFrom: "lead" },
    { id: "q", kind: "quiz", silent: true, duration: 0.8, gap: 2 },
  ],
});
const prep = (n = narration(), c = cfg(), opts = {}) => prepareNarration(n, c, { env, ...opts });
const hashes = (p) => Object.fromEntries(p.segments.filter((s) => !s.silent).map((s) => [s.id, s.hash]));

function tmpCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-test-"));
  return { dir, cache: createCache({ audioDir: path.join(dir, "audio"), alignmentDir: path.join(dir, "align") }), manifest: path.join(dir, "t1.manifest.json") };
}
function fakeSynth(calls, behaviour = () => null) {
  return async (p) => {
    calls.push(p);
    const problem = behaviour(p, calls.length);
    if (problem) throw problem;
    const chars = [...p.text];
    return { audio: Buffer.from(`audio:${p.text}`), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.1) }, estimatedDuration: chars.length * 0.1 };
  };
}
const noSleep = async () => {};

// ---------- segments ----------
test("segments: kinds map to voices, quiz stays silent, continuesFrom links both halves", () => {
  const p = prep();
  const by = Object.fromEntries(p.segments.map((s) => [s.id, s]));
  assert.equal(by.lead.voiceName, "arthur");
  assert.equal(by.m.voiceName, "ling");
  assert.equal(by.ex.voiceName, "arthur");
  assert.equal(by.q.silent, true);
  assert.equal(by.lead.nextText, "ninety percent of the budget.");
  assert.equal(by.budget.previousText, "I decided to allocate");
  assert.equal(by.ex.previousText, null);
});

test("segments: hash covers audio inputs only", () => {
  const base = hashes(prep());
  assert.equal(hashes(prep(narration((n) => (n.segments[2].gap = 5, n))))["ex"], base.ex, "gap");
  assert.equal(hashes(prep(narration((n) => (n.segments[2].speak = undefined, n))))["ex"], base.ex);
  const edited = hashes(prep(narration((n) => (n.segments[2].text = "We allocate money to ads.", n))));
  assert.notEqual(edited.ex, base.ex, "edited example changes its own hash");
  for (const id of ["lead", "m", "budget"]) assert.equal(edited[id], base[id], `${id} untouched by an example edit`);
  const c = cfg(); c.voices.ling.settings.stability = 0.5;
  const settings = hashes(prep(narration(), c));
  assert.notEqual(settings.m, base.m, "ling settings change ling");
  assert.equal(settings.ex, base.ex, "…but not arthur");
  const model = cfg(); model.voices.arthur.model = "other";
  assert.notEqual(hashes(prep(narration(), model)).ex, base.ex);
  const half = hashes(prep(narration((n) => (n.segments[3].text = "ninety percent of the money.", n))));
  assert.notEqual(half.lead, base.lead, "the first half hears its continuation, so it changes too");
});

test("segments: display text change does not matter when speak is set", () => {
  const withSpeak = (shown) => hashes(prep(narration((n) => (Object.assign(n.segments[3], { text: shown, speak: "ninety percent of the budget." }), n))));
  assert.equal(withSpeak("90% of the budget.").budget, withSpeak("Ninety percent of the budget!").budget);
});

test("segments: invalid narration files fail before anything else, all problems at once", () => {
  const bad = (patch, re) => assert.throws(() => prep(narration(patch)), (e) => e instanceof ConfigError && re.test(e.message));
  bad((n) => (n.segments[1].id = "lead", n), /duplicate id/);
  bad((n) => (delete n.segments[0].text, n), /text is missing/);
  bad((n) => (n.segments[4].duration = 0, n), /silent segment needs duration/);
  bad((n) => (n.segments[3].continuesFrom = "nope", n), /does not exist/);
  bad((n) => (n.segments[3].continuesFrom = "ex", n), /different kind/);
  bad((n) => (n.segments[0].continuesFrom = "budget", n), /must come earlier/);
  bad((n) => (n.segments[1].kind = "mystery", n), /voice role "mystery" is not defined/);
  bad((n) => (n.segments = [], n), /non-empty array/);
  assert.throws(() => prep(narration(), cfg(), { env: {} }), /ELEVENLABS_API_KEY/);
  assert.doesNotThrow(() => prep(narration(), cfg(), { env: {}, requireApiKey: false }));
  const c = cfg(); c.voices.arthur.voiceId = "TODO_ARTHUR_VOICE_ID";
  assert.throws(() => prep(narration(), c), /voices\.arthur\.voiceId is not set/);
});

// ---------- plan / generate / cache ----------
test("generate: first run buys every spoken segment once, second run buys nothing", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [];
  let plan = planNarration(prep(), cache);
  assert.deepEqual(plan.counts, { hit: 0, miss: 4, silent: 1, duplicate: 0 });
  assert.equal(plan.charsToGenerate, "I decided to allocate".length + 6 + "We allocate money to advertising.".length + "ninety percent of the budget.".length);
  await generateNarration(plan, { cache, manifestPath: manifest, synthesize: fakeSynth(calls), sleep: noSleep });
  assert.equal(calls.length, 4);
  const lead = calls.find((c) => c.text === "I decided to allocate");
  assert.equal(lead.nextText, "ninety percent of the budget.");
  assert.equal(lead.voice.voiceId, "A1");

  plan = planNarration(prep(), cache);
  assert.deepEqual(plan.counts, { hit: 4, miss: 0, silent: 1, duplicate: 0 });
  assert.equal(JSON.parse(fs.readFileSync(manifest, "utf8")).complete, true);
  assert.equal(calls.length, 4, "no new calls");
});

test("generate: editing one example regenerates exactly that segment", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [];
  await generateNarration(planNarration(prep(), cache), { cache, manifestPath: manifest, synthesize: fakeSynth(calls), sleep: noSleep });
  const edited = prep(narration((n) => (n.segments[2].text = "We allocate money to ads.", n)));
  const plan = planNarration(edited, cache);
  assert.deepEqual(plan.segments.filter((s) => s.status === "miss").map((s) => s.id), ["ex"]);
  const more = [];
  await generateNarration(plan, { cache, manifestPath: manifest, synthesize: fakeSynth(more), sleep: noSleep });
  assert.equal(more.length, 1);
});

test("generate: identical text in one episode is generated once", async () => {
  const { cache, manifest } = tmpCache();
  const n = narration((x) => (x.segments.push({ id: "ex2", kind: "example", text: "We allocate money to advertising." }), x));
  const calls = [];
  const plan = planNarration(prep(n), cache);
  assert.equal(plan.counts.duplicate, 1);
  await generateNarration(plan, { cache, manifestPath: manifest, synthesize: fakeSynth(calls), sleep: noSleep });
  assert.equal(calls.length, 4);
  assert.equal(planNarration(prep(n), cache).counts.miss, 0);
});

test("generate: a half-written entry is not a hit", () => {
  const { cache } = tmpCache();
  const p = prep();
  const h = p.segments[0].hash;
  fs.mkdirSync(cache.audioDir, { recursive: true });
  fs.writeFileSync(cache.audioPath(h), "x");
  assert.equal(cache.has(h), false);
  assert.equal(planNarration(p, cache).counts.hit, 0);
});

test("generate: 429 is retried (honouring retry-after), quota stops at once and keeps finished work", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [], slept = [];
  const rate = new ElevenLabsError("slow", { code: "RATE_LIMIT", status: 429, retryAfter: 7, retryable: true });
  await generateNarration(planNarration(prep(), cache), { cache, manifestPath: manifest, synthesize: fakeSynth(calls, (p, n) => (n === 1 ? rate : null)), sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(slept, [7000]);
  assert.equal(calls.length, 5);

  const t = tmpCache();
  const quota = new ElevenLabsError("no credits", { code: "QUOTA", status: 402, retryable: false });
  const more = [];
  await assert.rejects(generateNarration(planNarration(prep(), t.cache), { cache: t.cache, manifestPath: t.manifest, synthesize: fakeSynth(more, (p, n) => (n === 3 ? quota : null)), sleep: noSleep }), { code: "QUOTA" });
  assert.equal(more.length, 3, "stopped at the failure, no retry");
  const m = JSON.parse(fs.readFileSync(t.manifest, "utf8"));
  assert.equal(m.complete, false);
  assert.match(m.lastError, /no credits/);
  assert.deepEqual(m.segments.filter((s) => s.status === "ready").map((s) => s.id), ["lead", "m"]);
  // resume: only the remaining two are bought
  const resume = [];
  await generateNarration(planNarration(prep(), t.cache), { cache: t.cache, manifestPath: t.manifest, synthesize: fakeSynth(resume), sleep: noSleep });
  assert.equal(resume.length, 2);
});

test("generate: retries are bounded", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [];
  const down = new ElevenLabsError("down", { code: "SERVER", status: 503, retryable: true });
  await assert.rejects(generateNarration(planNarration(prep(), cache), { cache, manifestPath: manifest, synthesize: fakeSynth(calls, () => down), sleep: noSleep }), { code: "SERVER" });
  assert.equal(calls.length, 4, "1 try + 3 retries");
});

test("generate: an invalid alignment is retried once, then fails and is NOT cached", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [];
  const synth = async (p) => { calls.push(p); const chars = [...p.text]; return { audio: Buffer.from("a"), alignment: { characters: chars.slice(1), character_start_times_seconds: [], character_end_times_seconds: [] }, estimatedDuration: 1 }; };
  await assert.rejects(generateNarration(planNarration(prep(), cache), { cache, manifestPath: manifest, synthesize: synth, sleep: noSleep }), { name: "AlignmentError" });
  assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(cache.audioDir), false);
});

test("generate: --max-chars guard stops before any call", async () => {
  const { cache, manifest } = tmpCache();
  const calls = [];
  await assert.rejects(generateNarration(planNarration(prep(), cache), { cache, manifestPath: manifest, synthesize: fakeSynth(calls), maxChars: 10 }), ConfigError);
  assert.equal(calls.length, 0);
});

// ---------- CLI (never with --yes: that would spend credits) ----------
test("cli: plan-only and --frozen on the real p2 narration send nothing", () => {
  const run = (...a) => spawnSync(process.execPath, [path.join(HERE, "..", "voice.mjs"), ...a], { encoding: "utf8", env: { ...process.env, ELEVENLABS_API_KEY: "" } });
  const plan = run("p2");
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /plan only \(nothing sent\)|nothing to generate/);
  assert.match(plan.stdout, /episode p2: /);
  const frozen = run("p2", "--frozen");
  assert.match(frozen.stdout + frozen.stderr, /--frozen|frozen check passed/);
  assert.equal(run("no-such-episode").status, 1);
});
