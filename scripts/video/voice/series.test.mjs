// Offline tests: series identity (structured metadata → "TOEIC · #01 · L2"), the legacy path, and the content-emoji default.
// The browser file reference/Header.js is loaded as it is (data URL) and compared with its validator twin in episode-refs.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import * as twin from "./episode-refs.mjs";
import { linesFromPlan, validateEpisode } from "./episode-refs.mjs";

const H = await import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(path.join(REPO_ROOT, "scripts/video/reference/Header.js"))).toString("base64"));
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
const has = (list, re) => assert.ok(list.some((p) => re.test(p)), `expected ${re}, got:\n${list.join("\n")}`);

test("header text: series · #NN · level, level as L2 or L1–L2, episode number at least two digits without a maximum", () => {
  const label = (series, seriesEpisode, min, max = min) => H.headerLabel({ series, seriesEpisode, level: { min, max } });
  assert.equal(label("TOEIC", 1, 2), "TOEIC · #01 · L2");
  assert.equal(label("TOEFL", 2, 1, 2), "TOEFL · #02 · L1–L2");
  assert.equal(label("TOEFL", 1, 2, 3), "TOEFL · #01 · L2–L3");
  assert.equal(label("IELTS", 3, 2), "IELTS · #03 · L2");
  assert.equal(label("高中", 1, 1), "高中 · #01 · L1");
  assert.equal(label("國中", 10, 1), "國中 · #10 · L1");
  assert.equal(label("國小", 1, 1), "國小 · #01 · L1");
  assert.equal(label("TOEFL", 100, 3), "TOEFL · #100 · L3");
  assert.equal(label("TOEIC", 1234, 1, 3), "TOEIC · #1234 · L1–L3");
  assert.equal(H.levelText({ min: 2, max: 2 }), "L2", "min === max shows one level");
  assert.ok(!label("TOEFL", 2, 1, 2).includes("→"), "no arrow: the range is a display form, not stored");
});

test("parity: browser Header.js and the validator twin give the same text", () => {
  for (const series of ["TOEFL", "TOEIC", "IELTS", "高中", "國中", "國小", "國小國中"]) for (const n of [1, 2, 9, 10, 99, 100, 1234]) for (const [min, max] of [[1, 1], [2, 2], [3, 3], [1, 2], [2, 3], [1, 3]]) {
    const d = { series, seriesEpisode: n, level: { min, max } };
    assert.equal(twin.headerLabel(d), H.headerLabel(d), JSON.stringify(d));
  }
  assert.equal(twin.hasStructuredMetadata({ series: "TOEIC" }), true);
  assert.equal(twin.hasStructuredMetadata({ episodeLabel: "TOEFL · EP.01" }), false);
  assert.equal(H.usesSeriesHeader({ series: "TOEIC" }), true);
  assert.equal(H.usesSeriesHeader({ episodeLabel: "x", author: { level: "L2" } }), false);
});

const haveP4 = fs.existsSync(path.join(REPO_ROOT, "docs/toeic-079-auto/toeic-079-auto.plan.json"));
const haveP2 = fs.existsSync(path.join(REPO_ROOT, "docs/p2-auto/p2-auto.plan.json"));
const haveP3 = fs.existsSync(path.join(REPO_ROOT, "docs/p348-auto/p348-auto.plan.json"));
const load = (ep, plan) => ({ episode: structuredClone(read(ep)), lines: linesFromPlan(read(plan)) });
const p4 = () => load("scripts/video/episodes/toeic-079-auto.json", "docs/toeic-079-auto/toeic-079-auto.plan.json");
const check = ({ episode, lines }) => { const warnings = []; return { problems: validateEpisode(episode, lines, { warnings }), warnings }; };

test("P4 (structured metadata): valid, header TOEIC · #01 · L2, no warning", (t) => {
  if (!haveP4) return t.skip();
  const x = p4();
  assert.deepEqual(check(x), { problems: [], warnings: [] });
  assert.deepEqual([x.episode.series, x.episode.seriesEpisode, x.episode.level, x.episode.contentId], ["TOEIC", 1, { min: 2, max: 2 }, "toeic-079"]);
  assert.equal(twin.headerLabel(x.episode), "TOEIC · #01 · L2");
  assert.equal(x.episode.episodeLabel, undefined);
  assert.equal(x.episode.author.level, undefined);
});

test("validator: series, seriesEpisode, level and contentId are explicit and checked", (t) => {
  if (!haveP4) return t.skip();
  const bad = (mutate, re) => { const x = p4(); mutate(x.episode); has(check(x).problems, re); };
  bad((e) => { delete e.series; }, /episode\.series: is required/);
  bad((e) => { e.series = "  "; }, /episode\.series: is required/);
  for (const v of [0, -1, 1.5, "1", null]) bad((e) => { e.seriesEpisode = v; }, /episode\.seriesEpisode: must be a positive integer/);
  bad((e) => { delete e.seriesEpisode; }, /episode\.seriesEpisode: must be a positive integer/);
  bad((e) => { delete e.level; }, /episode\.level: must be \{ min, max \}/);
  bad((e) => { e.level = 2; }, /episode\.level: must be \{ min, max \}/);
  bad((e) => { e.level = { min: 0, max: 2 }; }, /episode\.level\.min: must be an integer from 1 to 3/);
  bad((e) => { e.level = { min: 2, max: 4 }; }, /episode\.level\.max: must be an integer from 1 to 3/);
  bad((e) => { e.level = { min: 1.5, max: 2 }; }, /episode\.level\.min/);
  bad((e) => { e.level = { min: 3, max: 2 }; }, /min \(3\) must not be greater than max \(2\)/);
  bad((e) => { delete e.contentId; }, /episode\.contentId: is required/);
  bad((e) => { e.contentId = ""; }, /episode\.contentId: is required/);
  const ok = p4(); ok.episode.level = { min: 1, max: 2 }; ok.episode.seriesEpisode = 100;
  assert.deepEqual(check(ok).problems, []);
  assert.equal(twin.headerLabel(ok.episode), "TOEIC · #100 · L1–L2");
});

test("nothing is inferred: a content id that says 'toeic' does not supply the series, and 079 is not the episode number", (t) => {
  if (!haveP4) return t.skip();
  const x = p4(); assert.equal(x.episode.contentId, "toeic-079"); delete x.episode.series; delete x.episode.seriesEpisode;
  const p = check(x).problems;
  has(p, /episode\.series: is required/); has(p, /episode\.seriesEpisode: must be a positive integer/);
});

test("structured metadata: episodeLabel / author.level are ignored with a warning (a level must not be shown twice)", (t) => {
  if (!haveP4) return t.skip();
  const x = p4(); x.episode.episodeLabel = "old"; x.episode.author.level = "L2";
  const r = check(x);
  assert.deepEqual(r.problems, []);
  has(r.warnings, /episode\.episodeLabel: is ignored/); has(r.warnings, /author\.level: is ignored/);
});

test("legacy episodes (P2, P3): unchanged – episodeLabel and author.level still required, no structured metadata needed", (t) => {
  if (!haveP2 || !haveP3) return t.skip();
  for (const [ep, plan] of [["scripts/video/episodes/p2-auto.json", "docs/p2-auto/p2-auto.plan.json"], ["scripts/video/episodes/p348-auto.json", "docs/p348-auto/p348-auto.plan.json"]]) {
    const x = load(ep, plan);
    assert.deepEqual(check(x), { problems: [], warnings: [] }, ep);
    assert.equal(x.episode.series, undefined, "the frozen episodes are not rewritten");
    const noLabel = load(ep, plan); delete noLabel.episode.episodeLabel; has(check(noLabel).problems, /episode\.episodeLabel: is required/);
    const noLevel = load(ep, plan); delete noLevel.episode.author.level; has(check(noLevel).problems, /author\.level: is required/);
  }
  assert.equal(load("scripts/video/episodes/p2-auto.json", "docs/p2-auto/p2-auto.plan.json").episode.episodeLabel, "TOEFL · EP.01");
});

test("content emoji: off by default on the new path, an explicit exception is possible, legacy episodes are not checked", (t) => {
  if (!haveP4 || !haveP2 || !haveP3) return t.skip();
  const bad = (mutate, re) => { const x = p4(); mutate(x.episode); has(check(x).problems, re); };
  bad((e) => { e.hook.emoji = "🐝"; }, /hook\.emoji: contains a decorative emoji/);
  bad((e) => { e.hook.payoff[0] += " ⚖️"; }, /hook\.payoff\[0\]: contains a decorative emoji/);
  bad((e) => { e.story[1].parts[5].text += "🐝"; }, /story\[1\]\.parts\[5\]\.text: contains a decorative emoji/);
  bad((e) => { e.vocabulary[0].exampleZh += "😀"; }, /vocabulary\[0\]\.exampleZh: contains a decorative emoji/);
  bad((e) => { e.quiz.feedbackDetail += "🎉"; }, /quiz\.feedbackDetail: contains a decorative emoji/);
  bad((e) => { e.outro.cta += "📌"; }, /outro\.cta: contains a decorative emoji/);
  const ex = p4(); ex.episode.hook.emoji = "🐝"; ex.episode.allowContentEmoji = true;
  assert.deepEqual(check(ex).problems, [], "an explicit exception is allowed");
  const narr = p4(); const l = narr.lines.get("napping"); narr.lines.set("napping", { ...l, text: l.text + " 🐝" });
  has(check(narr).problems, /narration line "napping": contains a decorative emoji/);
  // identity is not content: the avatar emoji and the UI glyphs (✓ ● ↳ …) are fine
  const ok = p4(); assert.ok(/\p{Extended_Pictographic}/u.test(ok.episode.author.avatar)); assert.ok(ok.episode.status.answer.includes("✓"));
  assert.deepEqual(check(ok).problems, []);
  // P2 / P3 keep their emoji
  const p2 = load("scripts/video/episodes/p2-auto.json", "docs/p2-auto/p2-auto.plan.json"); assert.equal(p2.episode.hook.emoji, "📦");
  assert.deepEqual(check(p2).problems, []);
});

test("hook emoji: optional for scene_contrast, still required for number_contrast", (t) => {
  if (!haveP4 || !haveP2) return t.skip();
  assert.equal(p4().episode.hook.emoji, undefined);
  assert.deepEqual(check(p4()).problems, []);
  const p2 = load("scripts/video/episodes/p2-auto.json", "docs/p2-auto/p2-auto.plan.json"); delete p2.episode.hook.emoji;
  has(check(p2).problems, /hook\.emoji: is required/);
});
