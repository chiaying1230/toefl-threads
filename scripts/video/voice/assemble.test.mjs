// Offline tests for the display/spoken mapping, play order of split sentences, and the assembled plan. No network, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AlignmentError, alignmentToWords, remapWordsToDisplay } from "./align.mjs";
import { SAMPLE_RATE as SR, voicedBounds } from "./audio.mjs";
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

test("assemble: fade-removed terminal transient cannot retain a silent tail; final duration and original alignment stay consistent", () => {
  const text = "A short sentence.", p = prepareNarration({ id: 'final-waveform', segments: [{ id: 'line', kind: 'story', text, gap: .08 }] }, cfg, { requireApiKey: false, env: {} });
  const alignment = evenAlignment(text);
  alignment.character_start_times_seconds = alignment.character_start_times_seconds.map((_, i) => i / text.length);
  alignment.character_end_times_seconds = alignment.character_end_times_seconds.map((_, i) => (i + 1) / text.length);
  const originalAlignment = structuredClone(alignment), x = new Float32Array(Math.round(1.6 * SR));
  for (let i = Math.round(.1 * SR); i < Math.round(1.15 * SR); i++) x[i] = .15 * Math.sin(2 * Math.PI * 220 * i / SR);
  // Short terminal burst above the normal threshold BEFORE the end fade, below it AFTER fade.
  for (let i = x.length - Math.round(.001 * SR); i < x.length; i++) x[i] = .02;
  const before = Float32Array.from(x);
  const cache = { has: () => true, audioPath: () => 'synthetic-only', readAlignment: () => ({ alignment }) };
  const a = assembleNarration(p, cache, { decode: () => x }), b = assembleNarration(p, cache, { decode: () => x });
  assert.deepEqual(a, b); assert.deepEqual(x, before); assert.deepEqual(alignment, originalAlignment);
  const l = a.plan.lines[0], v = voicedBounds(a.samples);
  assert.ok(l.duration < 1.3, 'removed transient must not keep the old 1.6s tail');
  assert.ok(l.start <= v.first / SR && v.first / SR - l.start <= .06);
  assert.ok(l.end >= v.last / SR && l.end - v.last / SR <= .06);
  const from = Math.max(0, voicedBounds(x).first - Math.round(.035 * SR)) / SR;
  const originalWords = alignmentToWords(text, alignment).words;
  l.words.forEach((w, i) => { assert.equal(w.at, Math.min(l.duration, Math.max(0, originalWords[i].at - from))); assert.equal(w.until, Math.min(l.duration, Math.max(0, originalWords[i].until - from))); });
});

test("assemble: audio made completely silent by fade fails closed", () => {
  const text = 'A.', p = prepareNarration({ id: 'fade-silent', segments: [{ id: 'line', kind: 'story', text }] }, cfg, { requireApiKey: false, env: {} });
  const x = new Float32Array(Math.round(.01 * SR)); x[0] = .1;
  const cache = { has: () => true, audioPath: () => 'synthetic-only', readAlignment: () => ({ alignment: evenAlignment(text) }) };
  assert.throws(() => assembleNarration(p, cache, { decode: () => x }), /processed audio is silent/);
});

test('assemble: source-grid-only weak tail cannot leave over 60ms slack on final playback PCM; alignment and source stay immutable',()=>{
  const text='A short line.',prepared=prepareNarration({id:'playback-grid',segments:[{id:'line',kind:'story',text,gap:.08}]},cfg,{requireApiKey:false,env:{}});
  const alignment=evenAlignment(text);alignment.character_start_times_seconds=alignment.character_start_times_seconds.map((_,i)=>.08+i*.7/text.length);alignment.character_end_times_seconds=alignment.character_end_times_seconds.map((_,i)=>.08+(i+1)*.7/text.length);
  const x=new Float32Array(SR);for(let i=Math.round(.08*SR);i<Math.round(.80*SR);i++)x[i]=.15*Math.sin(2*Math.PI*220*i/SR);
  // This pulse straddles a playback-grid boundary but sits inside one source-grid block.
  for(let i=Math.round(.844*SR);i<Math.round(.846*SR);i++)x[i]=.011;
  const source=Float32Array.from(x),saved=structuredClone(alignment),cache={has:()=>true,audioPath:()=> 'test',readAlignment:()=>({alignment})};
  const result=assembleNarration(prepared,cache,{decode:()=>x}),l=result.plan.lines[0];
  const pcm=Float32Array.from(result.samples,v=>Math.max(-32768,Math.min(32767,Math.round(v*32767)))/32768),bounds=voicedBounds(pcm);
  assert.ok(l.end-bounds.last/SR<=.06);assert.ok(bounds.first/SR-l.start<=.06);assert.ok(l.duration<.855);
  assert.deepEqual(x,source);assert.deepEqual(alignment,saved);assert.deepEqual(assembleNarration(prepared,cache,{decode:()=>x}),result);
  assert.ok(l.words.every(w=>w.at>=0&&w.until<=l.duration));
});

test("assemble: split resume drops a fade-removed tail transient, preserves immutable take and exact word offsets", () => {
  const text='Go now.', prepared=prepareNarration({id:'split-tail',segments:[{id:'story',kind:'story',text,parts:[{id:'lead',through:'Go'},{id:'rest',resumeAfter:'pause'}]},{id:'pause',kind:'quiz',silent:true,duration:.3}]},cfg,{requireApiKey:false,env:{}});
  const alignment=evenAlignment(text);alignment.character_start_times_seconds=alignment.character_start_times_seconds.map(t=>t+.1);alignment.character_end_times_seconds=alignment.character_end_times_seconds.map(t=>t+.1);
  const x=new Float32Array(Math.round(1.01*SR));for(let i=Math.round(.1*SR);i<Math.round(.78*SR);i++)x[i]=.15*Math.sin(2*Math.PI*220*i/SR);
  for(let i=Math.round(1.009*SR);i<x.length;i++)x[i]=.02;
  const original=Float32Array.from(x),saved=structuredClone(alignment),cache={has:()=>true,audioPath:()=> 'synthetic',readAlignment:()=>({alignment})};
  const result=assembleNarration(prepared,cache,{decode:()=>x}),rest=result.plan.lines.find(l=>l.id==='rest');
  const pcm=Float32Array.from(result.samples,v=>Math.max(-32768,Math.min(32767,Math.round(v*32767)))/32768),bounds=voicedBounds(pcm.subarray(Math.round(rest.start*SR),Math.round(rest.end*SR)));
  assert.ok(rest.duration-bounds.last/SR<=.06);assert.ok(bounds.first/SR<=.06);assert.ok(rest.end-rest.start<.7);
  assert.deepEqual(x,original);assert.deepEqual(alignment,saved);assert.deepEqual(assembleNarration(prepared,cache,{decode:()=>x}),result);
  assert.ok(rest.words.every(w=>w.at>=0&&w.until<=rest.duration));
});

test("assemble: fade-removed leading transient rebases original word times by the exact final sample offset", () => {
  const text = 'A word.', p = prepareNarration({ id: 'leading-waveform', segments: [{ id: 'line', kind: 'story', text }] }, cfg, { requireApiKey: false, env: {} });
  const a = evenAlignment(text); a.character_start_times_seconds = a.character_start_times_seconds.map(t => t + .35); a.character_end_times_seconds = a.character_end_times_seconds.map(t => t + .35);
  const saved = structuredClone(a), x = new Float32Array(Math.round(1.3 * SR));
  for (let i = 0; i < Math.round(.001 * SR); i++) x[i] = .02;
  for (let i = Math.round(.35 * SR); i < Math.round(1.05 * SR); i++) x[i] = .15 * Math.sin(2 * Math.PI * 220 * i / SR);
  const cache = { has: () => true, audioPath: () => 'synthetic-only', readAlignment: () => ({ alignment: a }) };
  const result = assembleNarration(p, cache, { decode: () => x }), l = result.plan.lines[0], v = voicedBounds(result.samples);
  const shift = (Math.round(.35 * SR) - Math.round(.035 * SR)) / SR;
  assert.equal(l.words[0].at, a.character_start_times_seconds[0] - shift);
  assert.ok(v.first / SR - l.start <= .06); assert.ok(l.end - v.last / SR <= .06);
  assert.deepEqual(a, saved);
});
