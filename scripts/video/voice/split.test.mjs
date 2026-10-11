// Offline tests for `parts` (sentence interrupted by a vocabulary note) and the automatic cut. No network, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import { ConfigError } from "./config.mjs";
import { prepareNarration } from "./segments.mjs";
import { splitSentence, partAudio } from "./split.mjs";
import { SAMPLE_RATE as SR } from "./audio.mjs";

const env = { ELEVENLABS_API_KEY: "sk_0123456789abcdef0123456789abcdef" };
const cfg = {
  provider: "elevenlabs", output: { format: "mp3_44100_128" },
  voices: { arthur: { voiceId: "A1", lang: "en", model: "m", settings: { stability: 0 } } },
  roles: { story: "arthur" },
};
const TEXT = "I decided to allocate ninety percent of the budget.";
const narration = (patch = (x) => x) => patch({ id: "t", segments: [
  { id: "first", kind: "story", text: TEXT, parts: [{ id: "lead", through: "allocate", gap: 0.04 }, { id: "budget", resumeAfter: "mid", gap: 0.08 }] },
  { id: "mid", kind: "story", text: "Inserted." },
  { id: "mid2", kind: "story", text: "Inserted again." },
] });
const prep = (n = narration()) => prepareNarration(n, cfg, { env });

// ---------- schema ----------
test("parts: the sentence is one TTS unit; parts carry the display text the episode already uses", () => {
  const seg = prep().segments[0];
  assert.deepEqual(seg.parts.map((p) => [p.id, p.text, p.gap]), [["lead", "I decided to allocate", 0.04], ["budget", "ninety percent of the budget.", 0.08]]);
  assert.equal(seg.speak, TEXT);
  assert.equal(seg.chars, TEXT.length);
});

test("parts: cut position and gaps never change the audio hash; the sentence does", () => {
  const base = prep().segments[0].hash;
  assert.equal(prep(narration((n) => (n.segments[0].parts[0].through = "decided", n))).segments[0].hash, base);
  assert.equal(prep(narration((n) => (n.segments[0].parts[0].gap = 1, n))).segments[0].hash, base);
  assert.notEqual(prep(narration((n) => (n.segments[0].text = TEXT.replace("budget", "money"), n))).segments[0].hash, base);
});

test("parts: three parts (two interruptions) work; bad declarations fail up front", () => {
  const three = prep(narration((n) => (n.segments[0].parts = [{ id: "a", through: "decided" }, { id: "b", through: "allocate", resumeAfter: "mid" }, { id: "c", resumeAfter: "mid2" }], n)));
  assert.deepEqual(three.segments[0].parts.map((p) => p.text), ["I decided", "to allocate", "ninety percent of the budget."]);
  const bad = (patch, re) => assert.throws(() => prep(narration(patch)), (e) => e instanceof ConfigError && re.test(e.message));
  bad((n) => (n.segments[0].parts[0].through = "nope", n), /not found/);
  bad((n) => (n.segments[0].parts[0].through = "budget", n), /last word of the sentence/);
  bad((n) => (delete n.segments[0].parts[0].through, n), /"through" .* is required/);
  bad((n) => (n.segments[0].parts[1].through = "budget", n), /must not have "through"/);
  bad((n) => (n.segments[0].parts = [{ id: "only" }], n), /at least 2 parts/);
  bad((n) => (n.segments[0].speak = "other", n), /cannot use speak/);
  bad((n) => (n.segments[0].parts[1].id = "lead", n), /collides|duplicate/);
  bad((n) => (n.segments.push({ id: "budget", kind: "story", text: "x" }), n), /duplicate id|collides/);
  bad((n) => (n.segments[0].parts[1].resumeAfter = "first", n), /must be listed after/);
});

// ---------- cutting ----------
// words: [text, start, end]; the audio is a tone inside each word and digital silence in every gap.
function synth(words, total) {
  const x = new Float32Array(Math.round(total * SR));
  const chars = [], starts = [], ends = [];
  words.forEach(([w, s, e], k) => {
    for (let i = Math.round(s * SR); i < Math.round(e * SR); i++) x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
    [...w].forEach((c, j) => { chars.push(c); starts.push(s + ((e - s) * j) / w.length); ends.push(s + ((e - s) * (j + 1)) / w.length); });
    if (k < words.length - 1) { chars.push(" "); starts.push(e); ends.push(words[k + 1][1]); }
  });
  return { x, alignment: { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } };
}

test("split: cuts inside the real silence between the two words, and rebases words[] per part", () => {
  const text = "one two three four";
  const { x, alignment } = synth([["one", 0.2, 0.6], ["two", 0.6, 1.0], ["three", 1.15, 1.6], ["four", 1.6, 2.1]], 2.3);
  const seg = prep(narration((n) => (Object.assign(n.segments[0], { text, parts: [{ id: "a", through: "two" }, { id: "b", resumeAfter: "mid" }] }), n))).segments[0];
  const r = splitSentence(seg, alignment, x);
  assert.equal(r.warnings.length, 0);
  assert.ok(r.cuts[0].at >= 1.0 && r.cuts[0].at <= 1.15, `cut at ${r.cuts[0].at}`);
  const [a, b] = r.parts;
  assert.ok(a.to <= r.cuts[0].sample && r.cuts[0].sample <= b.from, "each part stays on its own side of the cut");
  assert.ok(r.cuts[0].at > 1.0 && r.cuts[0].at < 1.15, "cut sits inside the gap, not at its edge");
  assert.deepEqual(a.words.map((w) => w.text), ["one", "two"]);
  assert.deepEqual(b.words.map((w) => w.text), ["three", "four"]);
  assert.deepEqual(b.words.map((w) => w.pos), [0, 6], "pos is relative to the part text");
  assert.equal(b.words[0].count, 5);
  assert.ok(Math.abs(a.start + a.words[0].at - 0.2) < 1e-6, "times are relative to the part's first sample");
  assert.ok(b.words.every((w) => w.at >= 0 && w.until <= b.duration + 1e-9));
  assert.equal(partAudio(x, a).length, a.to - a.from);
});

test("split: continuous speech (no silence at the join) still cuts, with a warning to listen", () => {
  const text = "one two three four";
  const { x, alignment } = synth([["one", 0.2, 0.6], ["two", 0.6, 1.0], ["three", 1.0, 1.6], ["four", 1.6, 2.1]], 2.3);
  const seg = prep(narration((n) => (Object.assign(n.segments[0], { text, parts: [{ id: "a", through: "two" }, { id: "b", resumeAfter: "mid" }] }), n))).segments[0];
  const r = splitSentence(seg, alignment, x);
  assert.equal(r.parts.length, 2);
  assert.match(r.warnings[0], /not clearly quiet/);
});
