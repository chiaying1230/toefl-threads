// Offline tests for the display/spoken mapping, play order of split sentences, and the assembled plan. No network, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AlignmentError, alignmentToWords, remapWordsToDisplay } from "./align.mjs";
import { SAMPLE_RATE as SR } from "./audio.mjs";
import { assembleNarration } from "./assemble.mjs";
import { createCache } from "./cache.mjs";
import { ConfigError } from "./config.mjs";
import { prepareNarration } from "./segments.mjs";

const env = { ELEVENLABS_API_KEY: "sk_0123456789abcdef0123456789abcdef" };
const cfg = {
  provider: "elevenlabs", output: { format: "mp3_44100_128" },
  voices: { arthur: { voiceId: "A1", lang: "en", model: "m", settings: { stability: 0 } }, ling: { voiceId: "L1", lang: "zh", model: "m", settings: { stability: 0 } } },
  roles: { story: "arthur", example: "arthur", meaning: "ling" },
};

// ---------- speak ≠ text ----------
const evenAlignment = (speak) => { const c = [...speak]; return { characters: c, character_start_times_seconds: c.map((_, i) => i * 0.1), character_end_times_seconds: c.map((_, i) => (i + 1) * 0.1) }; };
const remap = (speak, text) => remapWordsToDisplay(alignmentToWords(speak, evenAlignment(speak)).words, speak, text);

test("remap: identical text is untouched", () => {
  const w = alignmentToWords("a b c", evenAlignment("a b c")).words;
  assert.equal(remapWordsToDisplay(w, "a b c", "a b c"), w);
});

test("remap: one displayed word covers several spoken words ('90%' ← 'ninety percent')", () => {
  const spoken = alignmentToWords("We saved ninety percent of it.", evenAlignment("We saved ninety percent of it.")).words;
  const shown = remap("We saved ninety percent of it.", "We saved 90% of it.");
  assert.deepEqual(shown.map((w) => [w.text, w.pos, w.count]), [["We", 0, 2], ["saved", 3, 5], ["90", 9, 3], ["of", 13, 2], ["it", 16, 3]]);
  const ninety = spoken.find((w) => w.text === "ninety"), percent = spoken.find((w) => w.text === "percent");
  assert.equal(shown[2].at, ninety.at);
  assert.equal(shown[2].until, percent.until);
  assert.equal(shown[3].at, spoken.find((w) => w.text === "of").at, "later words keep their own real times");
});

test("remap: same number of words that differ is 1:1 (spelling / number swaps)", () => {
  const shown = remap("It costs five dollars.", "It costs 5 dollars.");
  assert.deepEqual(shown.map((w) => w.text), ["It", "costs", "5", "dollars"]);
  assert.equal(shown[2].until - shown[2].at > 0, true);
});

test("remap: anything that would need guessing is refused", () => {
  assert.throws(() => remap("one two three four", "1 2 three four 5"), AlignmentError, "spoken word with no displayed counterpart");
  assert.throws(() => remap("alpha beta gamma", "A B C D E gamma"), AlignmentError, "2 spoken ↔ 5 displayed");
});

// ---------- play order ----------
const narration = (patch = (x) => x) => patch({ id: "t", segments: [
  { id: "hook", kind: "story", text: "A hook line.", gap: 0.1 },
  { id: "first", kind: "story", text: "I decided to allocate ninety percent of it.", parts: [{ id: "lead", through: "allocate", gap: 0.05 }, { id: "rest", resumeAfter: "ex", gap: 0.1 }] },
  { id: "m", kind: "meaning", text: "分配、撥出。", gap: 0.05 },
  { id: "ex", kind: "example", text: "We allocate money.", gap: 0.1 },
  { id: "tail", kind: "story", text: "The end.", gap: 0.2 },
  { id: "q", kind: "quiz", silent: true, duration: 0.8, gap: 2 },
  { id: "a", kind: "quiz", silent: true, duration: 1.25, gap: 0 },
] });
const prep = (n = narration()) => prepareNarration(n, cfg, { env });

test("order: a split sentence's later part plays right after its resumeAfter segment", () => {
  const p = prep();
  assert.deepEqual(p.order.map((o) => o.part || o.segment), ["hook", "lead", "m", "ex", "rest", "tail", "q", "a"]);
});

test("order: bad resumeAfter declarations fail up front", () => {
  const bad = (patch, re) => assert.throws(() => prep(narration(patch)), (e) => e instanceof ConfigError && re.test(e.message));
  bad((n) => (delete n.segments[1].parts[1].resumeAfter, n), /"resumeAfter".*required/);
  bad((n) => (n.segments[1].parts[1].resumeAfter = "nope", n), /does not exist/);
  bad((n) => (n.segments[1].parts[1].resumeAfter = "hook", n), /must be listed after/);
  bad((n) => (n.segments[1].parts[0].resumeAfter = "ex", n), /remove "resumeAfter"/);
});

test("order: changing resumeAfter never changes any hash (no regeneration)", () => {
  const a = prep().segments.map((s) => s.hash), b = prep(narration((n) => (n.segments[1].parts[1].resumeAfter = "m", n))).segments.map((s) => s.hash);
  assert.deepEqual(a, b);
});

// ---------- assemble ----------
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-test-"));
  const cache = createCache({ audioDir: path.join(dir, "audio"), alignmentDir: path.join(dir, "align") });
  const prepared = prep();
  for (const s of prepared.segments.filter((x) => !x.silent)) {
    // 'audio' = a tone that fills the clip from 0.1 s (so trimming has something to do) to the end of the text
    const a = evenAlignment(s.speak); const end = a.character_end_times_seconds.at(-1);
    a.character_start_times_seconds = a.character_start_times_seconds.map((v) => v + 0.1); a.character_end_times_seconds = a.character_end_times_seconds.map((v) => v + 0.1);
    cache.write(s.hash, { audio: Buffer.from(JSON.stringify({ end: end + 0.1, id: s.id })), alignment: a, meta: { segment: s.id } });
  }
  const decode = (file) => {
    const { end } = JSON.parse(fs.readFileSync(file, "utf8")); const x = new Float32Array(Math.round((end + 0.3) * SR));
    for (let i = Math.round(0.1 * SR); i < Math.round(end * SR); i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
    return x;
  };
  return { prepared, cache, decode };
}

test("assemble: plan has the V4.2 shape, in playback order, with a real timeline", () => {
  const { prepared, cache, decode } = fixture();
  const { plan, samples } = assembleNarration(prepared, cache, { decode });
  assert.deepEqual(plan.lines.map((l) => l.id), ["hook", "lead", "m", "ex", "rest", "tail", "q", "a"]);
  for (let i = 1; i < plan.lines.length; i++) {
    const prev = plan.lines[i - 1];
    assert.ok(Math.abs(plan.lines[i].start - (prev.end + prev.gap)) < 1e-5, `${plan.lines[i].id} starts after ${prev.id} + gap`);
  }
  for (const l of plan.lines) {
    assert.equal(typeof l.text, "string"); assert.ok(Array.isArray(l.words)); assert.ok(l.duration > 0); assert.ok(Math.abs(l.end - l.start - l.duration) < 1e-5);
    for (const w of l.words) { assert.ok(w.at >= 0 && w.until >= w.at && w.until <= l.duration + 1e-6); assert.ok(l.text.slice(w.pos, w.pos + w.count).length === w.count); }
  }
  assert.equal(plan.lines.find((l) => l.id === "m").words.length, 0, "Chinese stays phrase-level");
  assert.deepEqual(plan.lines.find((l) => l.id === "rest").words.map((w) => w.text), ["ninety", "percent", "of", "it"]);
  assert.equal(plan.lines.find((l) => l.id === "rest").words[0].pos, 0, "split part's pos is relative to its own text");
  assert.equal(plan.lines.find((l) => l.id === "q").silent, true);
  assert.equal(plan.audioEnd, plan.lines.find((l) => l.id === "tail").end);
  assert.equal(plan.frames, Math.ceil(plan.lines.at(-1).end * 30 - 1e-9));
  assert.equal(samples.length, Math.round(plan.duration * SR));
  assert.ok(Math.max(...samples.subarray(0, 100)) < 0.1, "starts at the trimmed onset, fades in");
  const tail = plan.lines.find((l) => l.id === "tail");
  assert.ok(Math.max(...samples.subarray(Math.round((tail.start + 0.05) * SR), Math.round((tail.end - 0.1) * SR)).map(Math.abs)) > 0.1, "audio sits where the plan says");
});

test("assemble: refuses to run with segments that were never generated", () => {
  const { prepared, decode } = fixture();
  const empty = createCache({ audioDir: path.join(os.tmpdir(), "nope-a"), alignmentDir: path.join(os.tmpdir(), "nope-b") });
  assert.throws(() => assembleNarration(prepared, empty, { decode }), (e) => e instanceof ConfigError && /not generated yet: hook, first/.test(e.message));
});
