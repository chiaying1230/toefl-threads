// Offline tests: narration ↔ episode cross-validation. Uses the real (frozen) P2 files as the known-good case and mutates copies of them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, REPO_ROOT, loadVoiceConfig } from "./config.mjs";
import { loadNarration, prepareNarration } from "./segments.mjs";
import { assertEpisode, findEpisodeFor, linesFromNarration, linesFromPlan, validateEpisode } from "./episode-refs.mjs";

const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
const have = fs.existsSync(path.join(REPO_ROOT, "scripts/video/episodes/p2-auto.json")) && fs.existsSync(path.join(REPO_ROOT, "docs/p2-auto/p2-auto.plan.json"));
const prepared = prepareNarration(loadNarration(path.join(REPO_ROOT, "scripts/video/narration/p2.json")), loadVoiceConfig(), { requireApiKey: false });
const lines = () => linesFromNarration(prepared);
const episode = () => structuredClone(read("scripts/video/episodes/p2-auto.json"));
const problems = (mutate, from = lines()) => { const e = episode(); mutate(e); return validateEpisode(e, from); };
const has = (list, re) => assert.ok(list.some((p) => re.test(p)), `expected a problem matching ${re}, got:\n${list.join("\n")}`);

test("known-good: the real P2 episode matches its narration and its assembled plan", (t) => {
  if (!have) return t.skip("P2 files not present");
  assert.deepEqual(validateEpisode(episode(), lines()), []);
  assert.deepEqual(validateEpisode(episode(), linesFromPlan(read("docs/p2-auto/p2-auto.plan.json"))), []);
  assert.equal(path.basename(findEpisodeFor("p2")), "p2-auto.json");
  assert.equal(findEpisodeFor("no-such-narration"), null);
});

test("lines come out in playback order, split sentences as their parts", () => {
  assert.deepEqual([...lines().keys()], ["hook", "lead", "allocateMeaning", "allocateExample", "budget", "cfo", "pen", "decision", "arbitraryMeaning", "arbitraryExample", "bye", "question", "answer"]);
  assert.equal(lines().get("question").silent, true);
});

test("Hook Chinese: explicit null is valid for both variants, existing strings stay unchanged, missing/invalid copy fails", () => {
  for (const type of ['number_contrast', 'scene_contrast']) {
    const e = episode();
    if (type === 'scene_contrast') { e.hook.type = type; e.hook.setup = ['A scene']; }
    const original = e.hook.zh;
    assert.deepEqual(validateEpisode(e, lines()), []);
    assert.equal(e.hook.zh, original);
    e.hook.zh = null;
    assert.deepEqual(validateEpisode(e, lines()), []);
    assert.equal(e.hook.zh, null);
    e.hook.zh = ' '; // P5 frozen legacy input remains accepted; new Studio emits null.
    assert.deepEqual(validateEpisode(e, lines()), []);
    for (const invalid of [undefined, '', false, 42, {}, []]) {
      e.hook.zh = invalid;
      has(validateEpisode(e, lines()), /hook\.zh/);
    }
  }
});

test("missing references fail early, each with its field path", (t) => {
  if (!have) return t.skip();
  has(problems((e) => { e.story[0].parts[0].line = "ghost"; }), /story\[0\].*parts\[0\]\.line: unknown narration line "ghost"/);
  has(problems((e) => { e.vocabulary[0].meaningLine = "nope"; }), /vocabulary\[0\].*meaningLine: unknown narration line "nope"/);
  has(problems((e) => { e.vocabulary[1].exampleLine = undefined; }), /exampleLine: is required/);
  has(problems((e) => { e.camera[1].at.line = "missing"; }), /camera\[1\]\.at\.line: unknown narration line/);
  has(problems((e) => { e.quiz.answerLine = "gone"; }), /quiz\.answerLine: unknown narration line/);
  has(problems((e) => { e.hook.reveal.line = "nowhere"; }), /hook\.reveal\.line: unknown narration line/);
  has(problems((e) => { e.soundEffects[0].at = { line: "x" }; }), /soundEffects\[0\]\.at\.line/);
  has(problems((e) => { delete e.quiz; }), /episode\.quiz: is required/);
});

test("a word that is not in its line fails (open / reveal / reaction / time refs)", (t) => {
  if (!have) return t.skip();
  has(problems((e) => { e.vocabulary[0].open.word = "banana"; }), /open\.word: word "banana" is not in line "lead"/);
  has(problems((e) => { e.hook.reveal.word = "zebra"; }), /hook\.reveal\.word/);
  has(problems((e) => { e.reaction.word = "flew"; }), /reaction\.word/);
  has(problems((e) => { e.camera[2].at.word = "nothing"; }), /camera\[2\]\.at\.word/);
});

test("duplicate and invalid references fail", (t) => {
  if (!have) return t.skip();
  has(problems((e) => { e.story[1].parts[0].line = "lead"; }), /already displayed at/);
  has(problems((e) => { e.vocabulary[1].id = e.vocabulary[0].id; }), /already used at/);
  has(problems((e) => { e.story[0].id = "decision"; }), /already used at/);
  has(problems((e) => { e.story[0].parts[1].id = "nope"; e.story[0].parts[1].type = "vocabulary"; }), /unknown vocabulary "nope"/);
  has(problems((e) => { e.story[2].parts.push({ type: "vocabulary", id: "arbitraryNote" }); }), /placed twice/);
  has(problems((e) => { e.story[0].parts.splice(1, 1); }), /defined but never placed/);
  has(problems((e) => { e.story[0].parts.push({ type: "carousel" }); }), /unsupported part type "carousel"/);
  has(problems((e) => { e.story[1].parts.find((p) => p.type === "illustration").kind = "balloon"; }), /unsupported illustration "balloon"/);
  has(problems((e) => { e.reaction.kind = "confetti"; }), /unsupported reaction/);
  has(problems((e) => { e.reaction.captionId = "other"; }), /reaction\.captionId/);
  has(problems((e) => { e.camera[0].id = "chapter9"; }), /camera\[0\]\.id: "chapter9" is not a block/);
  has(problems((e) => { e.visibility[0].id = "chapter9"; }), /visibility\[0\]\.id/);
  has(problems((e) => { e.camera[3].at = "soon"; }), /time reference must be a number/);
  has(problems((e) => { e.camera[3].at = { line: "lead", edge: "middle" }; }), /edge/);
  has(problems((e) => { e.quiz.answer = 7; }), /quiz\.answer/);
  has(problems((e) => { e.story[0].id = "status"; }), /reserved by the template/);
});

test("narration order and kinds are enforced", (t) => {
  if (!have) return t.skip();
  has(problems((e) => { const v = e.vocabulary[0]; [v.meaningLine, v.exampleLine] = [v.exampleLine, v.meaningLine]; }), /open → meaning → example → close/);
  has(problems((e) => { e.vocabulary[0].close.line = "hook"; }), /open → meaning → example → close/);
  has(problems((e) => { [e.quiz.questionLine, e.quiz.answerLine] = [e.quiz.answerLine, e.quiz.questionLine]; }), /must come before/);
  has(problems((e) => { e.story[0].parts[0].line = "question"; }), /silent/);
  has(problems((e) => { e.story[0].parts.shift(); }), /"lead" is spoken but the episode never displays or uses it|never displays/);
});

test("optional parts really are optional (no reaction, no outro, no music / effects)", (t) => {
  if (!have) return t.skip();
  const list = problems((e) => {
    delete e.reaction; delete e.outro; delete e.music; delete e.soundEffects;
    e.story[1].parts = e.story[1].parts.filter((p) => p.type !== "illustration" && p.type !== "reaction");
    e.camera = e.camera.filter((c) => c.id !== "outro");
  });
  assert.deepEqual(list, []);
});

test("assertEpisode throws one ConfigError listing every problem with the file name", (t) => {
  if (!have) return t.skip();
  const e = episode(); e.story[0].parts[0].line = "ghost"; e.camera[0].id = "chapter9";
  assert.throws(() => assertEpisode(e, lines(), "p3.json"), (err) => err instanceof ConfigError && err.problems.length >= 2 && err.problems.every((p) => p.startsWith("p3.json: ")));
});

test("hook types: a hook without `type` is number_contrast; number / caption / ratio are required only there", (t) => {
  if (!have) return t.skip();
  assert.deepEqual(problems((e) => { e.hook.type = "number_contrast"; }), []);
  has(problems((e) => { delete e.hook.number; }), /hook\.number: is required/);
  has(problems((e) => { e.hook.type = "quote"; }), /hook\.type: unsupported hook type "quote" \(renderer supports: number_contrast, scene_contrast\)/);
  // the same data as scene_contrast: setup replaces number / caption / ratio, which stop being required
  const asScene = problems((e) => { e.hook.type = "scene_contrast"; delete e.hook.number; delete e.hook.caption; delete e.hook.ratio; e.hook.setup = ["A scene", "and a place."]; });
  assert.deepEqual(asScene, []);
  has(problems((e) => { e.hook.type = "scene_contrast"; delete e.hook.number; delete e.hook.caption; delete e.hook.ratio; }), /hook\.setup: is required/);
  has(problems((e) => { e.hook.type = "scene_contrast"; e.hook.setup = "not an array"; }), /hook\.setup: must be an array/);
});

test("known-good: the p348 draft episode matches its draft narration (scene_contrast)", (t) => {
  const ep = path.join(REPO_ROOT, "scripts/video/episodes/p348-auto.json"), nar = path.join(REPO_ROOT, "scripts/video/narration/p348.json");
  if (!fs.existsSync(ep) || !fs.existsSync(nar)) return t.skip("p348 draft not present");
  const l = linesFromNarration(prepareNarration(loadNarration(nar), loadVoiceConfig(), { requireApiKey: false }));
  const e = JSON.parse(fs.readFileSync(ep, "utf8"));
  assert.equal(e.hook.type, "scene_contrast");
  assert.deepEqual(validateEpisode(e, l), []);
  assert.equal(path.basename(findEpisodeFor("p348")), "p348-auto.json");
});
