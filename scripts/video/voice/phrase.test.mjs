// Offline tests: multi-word vocabulary ("phrase") matching in the browser file reference/Phrase.js, its validator twin in
// episode-refs.mjs, and the episode validation around phrases. Real toeic-079 text is the corpus. No browser, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.mjs";
import * as twin from "./episode-refs.mjs";
import { linesFromPlan, validateEpisode } from "./episode-refs.mjs";

// the browser file, executed as it is (no package.json "type", so it is loaded through a data URL)
const browserFile = path.join(REPO_ROOT, "scripts/video/reference/Phrase.js");
const B = await import("data:text/javascript;base64," + Buffer.from(fs.readFileSync(browserFile)).toString("base64"));
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));

// ---- toeic-079 (js/data/packs/toeic.js), keys resolved: [[a_game_of_cat_and_mouse]], [[be_consumed_with|was consumed with]] ----
const STORY = [
  "Business update: a rival hive keeps following my scouts to my best flower field.",
  "I move the scouts, they follow, and I move again.",
  "It has become a game of cat and mouse that wastes time for both of us.",
  "Worse, I was consumed with spying on their queen, so I forgot to check my own honey sales.",
  "She, meanwhile, was napping.",
];
const EX = [
  "In the yard, the children played a game of cat and mouse, with one pretending to be the cat and the other the mouse.",
  "She was consumed with guilt after the accident.",
];
const PATTERNS = B.phrasePatterns(["a game of cat and mouse", "be consumed with", "was consumed with"]);

// minimal stand-in for the line element ReadingCue builds: one .cue per token
function fakeLine(text) {
  const cues = [...text.matchAll(/\S+/g)].map((m) => ({ textContent: m[0], classes: new Set(["cue"]), classList: { add(...c) { c.forEach((x) => this._s.add(x)); }, _s: null } }));
  cues.forEach((c) => (c.classList._s = c.classes));
  return { cues, querySelectorAll: () => cues };
}
const lit = (text, patterns = PATTERNS) => { const l = fakeLine(text); B.annotatePhrases(l, patterns); return l.cues.filter((c) => c.classes.has("key")).map((c) => c.textContent); };

test("phrase patterns: only terms with a space are phrases; single words stay on the old path", () => {
  assert.deepEqual(PATTERNS, [["a", "game", "of", "cat", "and", "mouse"], ["be", "consumed", "with"], ["was", "consumed", "with"]]);
  assert.deepEqual(B.phrasePatterns(["allocate", "allocated", "arbitrary"]), [], "P2 vocabulary: no phrase");
  assert.deepEqual(B.phrasePatterns(["accuse", "accused", "witness", "guilty"]), [], "P3 vocabulary: no phrase");
  assert.deepEqual(B.phrasePatterns(["Was  consumed   WITH", "was consumed with"]), [["was", "consumed", "with"]], "case / spacing / duplicates");
  assert.equal(B.isPhrase("was consumed with"), true);
  assert.equal(B.isPhrase("accused"), false);
  assert.deepEqual(B.phraseTokens("a — b"), [], "a phrase containing a punctuation-only word is not valid");
});

test("the whole phrase lights up, in the story and in the example – and nothing else does", () => {
  assert.deepEqual(lit(STORY[2]), ["a", "game", "of", "cat", "and", "mouse"]);
  assert.deepEqual(lit(STORY[3]), ["was", "consumed", "with"]);
  assert.deepEqual(lit(EX[0]), ["a", "game", "of", "cat", "and", "mouse,"], "trailing comma on the last word does not break the match");
  assert.deepEqual(lit(EX[1]), ["was", "consumed", "with"]);
});

test("a / of / and / was / with outside the phrase stay plain", () => {
  assert.deepEqual(lit(STORY[0]), [], "a rival hive");
  assert.deepEqual(lit(STORY[1]), [], "… and I move again");
  assert.deepEqual(lit(STORY[4]), [], "was napping");
  // "with one pretending" follows the phrase in the example and must not be lit; neither the second "and"
  const l = fakeLine(EX[0]); B.annotatePhrases(l, PATTERNS);
  const plain = l.cues.filter((c) => !c.classes.has("key")).map((c) => c.textContent);
  assert.ok(["with", "and", "the"].every((w) => plain.includes(w)), `plain tokens: ${plain.join(" ")}`);
  assert.equal(l.cues.filter((c) => c.classes.has("key")).length, 6);
});

test("every story + example line: exactly the expected tokens are key (no leak anywhere)", () => {
  const all = [...STORY, ...EX].map((t) => lit(t).length);
  assert.deepEqual(all, [0, 0, 6, 3, 0, 6, 3]);
});

test("partial phrases do not match", () => {
  assert.deepEqual(lit("She was consumed by guilt."), [], "was consumed + by");
  assert.deepEqual(lit("It was consumed."), []);
  assert.deepEqual(lit("They played a game of cat."), [], "a game of cat");
  assert.deepEqual(lit("a game of cat and"), []);
  assert.deepEqual(lit("consumed with guilt"), [], "without was / be");
  assert.deepEqual(lit("a game, of cat and mouse"), ["a", "game,", "of", "cat", "and", "mouse"], "a comma after a word is only punctuation");
});

test("case, quotes and punctuation are normalized", () => {
  assert.deepEqual(lit("WAS Consumed With."), ["WAS", "Consumed", "With."]);
  assert.deepEqual(lit("“A game of cat and mouse,” she said."), ["“A", "game", "of", "cat", "and", "mouse,”"]);
  assert.deepEqual(lit("He was (consumed) with fear"), ["was", "(consumed)", "with"]);
  assert.deepEqual(B.phraseTokens("don’t give up"), ["don't", "give", "up"], "curly apostrophe = straight apostrophe");
  assert.deepEqual(lit("I don't give up.", B.phrasePatterns(["don’t give up"])), ["don't", "give", "up."]);
});

test("overlap: the longer phrase wins, then the earlier one; two occurrences are both marked", () => {
  const p = B.phrasePatterns(["consumed with", "was consumed with", "with guilt"]);
  assert.deepEqual(B.findSpans(["she", "was", "consumed", "with", "guilt"], p), [{ from: 1, to: 4 }]);
  assert.deepEqual(B.findSpans(["a", "b", "a", "b"], [["a", "b"]]), [{ from: 0, to: 2 }, { from: 2, to: 4 }]);
  assert.deepEqual(B.findSpans(["x", "a", "b", "c"], [["a", "b"], ["b", "c"]]), [{ from: 1, to: 3 }], "equal length: the earlier wins");
});

test("positions: pstart / pmid / pend, a one-word span never happens", () => {
  const l = fakeLine("Worse, I was consumed with spying"); B.annotatePhrases(l, PATTERNS);
  const pos = (i) => ["pstart", "pmid", "pend"].filter((c) => l.cues[i].classes.has(c));
  assert.deepEqual([2, 3, 4].map(pos), [["pstart"], ["pmid"], ["pend"]]);
  assert.ok([2, 3, 4].every((i) => l.cues[i].classes.has("phrase") && l.cues[i].classes.has("key")));
  assert.deepEqual([0, 1, 5].map((i) => l.cues[i].classes.size), [1, 1, 1], "tokens outside the phrase get no class at all");
});

test("no phrase: annotatePhrases reads nothing and changes nothing", () => {
  let touched = false;
  const root = { querySelectorAll() { touched = true; return []; } };
  assert.deepEqual(B.annotatePhrases(root, []), []);
  assert.equal(touched, false);
});

// ---- the validator's twin must behave exactly like the browser file ----
test("parity: browser Phrase.js and the validator twin agree on a corpus", () => {
  const words = ["a", "Game", "OF", "cat,", "and", "mouse.", "“quoted”", "(paren)", "don’t", "don't", "—", "…", "was", "consumed", "with", "", "x-ray", "3.5%", "naïve", "Ünder", "they’re", "ʼn"];
  for (const w of words) assert.equal(twin.normalizeToken(w), B.normalizeToken(w), `normalizeToken(${JSON.stringify(w)})`);
  const phrases = ["a game of cat and mouse", "Was  Consumed WITH", "be consumed with.", "don’t give up", "a — b", "single", " ", "", "what's up?"];
  for (const t of phrases) {
    assert.deepEqual(twin.phraseTokens(t), B.phraseTokens(t), `phraseTokens(${JSON.stringify(t)})`);
    assert.equal(twin.isPhrase(t), B.isPhrase(t), `isPhrase(${JSON.stringify(t)})`);
  }
  const lines = [...STORY, ...EX, "was consumed with was consumed with", "a game of cat and mouse and a game of cat and mouse", "consumed with was consumed with a"];
  for (const l of lines) {
    const toks = [...l.matchAll(/\S+/g)].map((m) => B.normalizeToken(m[0]));
    assert.deepEqual(twin.findSpans(toks, PATTERNS), B.findSpans(toks, PATTERNS), l);
  }
  // seeded random sequences over a small alphabet: many overlaps
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alpha = ["a", "b", "c", "a b", "b c"];
  for (let n = 0; n < 300; n++) {
    const toks = Array.from({ length: 1 + rnd(14) }, () => ["a", "b", "c"][rnd(3)]);
    const pats = Array.from({ length: 1 + rnd(3) }, () => alpha[rnd(alpha.length)].split(" ")).concat([["a", "b", "c"]]).slice(0, 1 + rnd(4));
    assert.deepEqual(twin.findSpans(toks, pats), B.findSpans(toks, pats), JSON.stringify([toks, pats]));
  }
});

// ---- validator: real p348 episode + plan as the base ----
const haveP3 = fs.existsSync(path.join(REPO_ROOT, "docs/p348-auto/p348-auto.plan.json")) && fs.existsSync(path.join(REPO_ROOT, "scripts/video/episodes/p348-auto.json"));
const haveP2 = fs.existsSync(path.join(REPO_ROOT, "docs/p2-auto/p2-auto.plan.json")) && fs.existsSync(path.join(REPO_ROOT, "scripts/video/episodes/p2-auto.json"));
const p3 = () => ({ episode: structuredClone(read("scripts/video/episodes/p348-auto.json")), lines: linesFromPlan(read("docs/p348-auto/p348-auto.plan.json")) });
const check = ({ episode, lines }) => { const warnings = []; const problems = validateEpisode(episode, lines, { warnings }); return { problems, warnings }; };
const has = (list, re) => assert.ok(list.some((p) => re.test(p)), `expected a message matching ${re}, got:\n${list.join("\n")}`);
const guilty = (e) => e.vocabulary.find((v) => v.id === "guiltyNote");

test("P2 and P3 (frozen episodes): no problem and no warning – the new checks are silent for single words", (t) => {
  if (!haveP2 || !haveP3) return t.skip("P2 / P3 files not present");
  const p2 = { episode: read("scripts/video/episodes/p2-auto.json"), lines: linesFromPlan(read("docs/p2-auto/p2-auto.plan.json")) };
  assert.deepEqual(check(p2), { problems: [], warnings: [] });
  assert.deepEqual(check(p3()), { problems: [], warnings: [] });
});

test("validator: a phrase inside one line, opened on a word of it, is valid", (t) => {
  if (!haveP3) return t.skip();
  const x = p3(); guilty(x.episode).word = "found guilty"; guilty(x.episode).forms = ["was found guilty"];
  assert.deepEqual(check(x), { problems: [], warnings: [] });
});

test("validator: no silent failure – data that would light nothing is an error", (t) => {
  if (!haveP3) return t.skip();
  let x = p3(); guilty(x.episode).word = "guilty found"; guilty(x.episode).forms = [];
  has(check(x).problems, /guiltyNote.*none of "guilty found" appears in any displayed reading line.*only matches as a whole/);
  x = p3(); guilty(x.episode).word = "zebra"; guilty(x.episode).forms = ["zebras"]; guilty(x.episode).open = { line: "found", word: "guilty" };
  has(check(x).problems, /none of "zebra", "zebras" appears in any displayed reading line/);
  x = p3(); guilty(x.episode).word = "guilty!"; guilty(x.episode).forms = [];
  has(check(x).problems, /none of "guilty!" appears/, "ReadingCue strips only . and , – a key with ! can never match");
});

test("validator: a phrase may not be split across narration lines", (t) => {
  if (!haveP3) return t.skip();
  const x = p3(); const v = x.episode.vocabulary.find((q) => q.id === "accuseNote"); v.word = "accused of"; v.forms = [];
  has(check(x).problems, /split across the narration lines "accusedLead" and "accusedRest".*through/);
});

test("validator: open.word is inside the highlighted phrase or the last word of the line (the handoff boundary)", (t) => {
  if (!haveP3) return t.skip();
  const x = p3(); const g = guilty(x.episode); g.word = "was found"; g.forms = [];
  g.open = { line: "found", word: "guilty" };            // last word of the line, after the phrase: the pause comes there
  assert.deepEqual(check(x).problems, []);
  g.open = { line: "found", word: "he" };                // before the phrase: neither
  has(check(x).problems, /open\.word: "he" \(token 0 of line "found"\) is neither inside the highlighted phrase nor the last word of the line/);
  const y = p3(); const g2 = guilty(y.episode); g2.word = "was found"; g2.forms = []; g2.open = { line: "witnessLead", word: "witness" };
  has(check(y).problems, /open\.line: line "witnessLead" does not contain the phrase "was found"/);
});

test("validator: a repeated open.word is only a warning", (t) => {
  if (!haveP3) return t.skip();
  const x = p3(); const l = x.lines.get("found");
  x.lines.set("found", { ...l, text: "He was found guilty, guilty.", tokens: [...l.tokens, "guilty"] });
  const r = check(x);
  assert.deepEqual(r.problems, []);
  has(r.warnings, /open\.word: "guilty" occurs 2 times in line "found"; the handoff opens on the first one/);
});

test("validator: a phrase made of punctuation is rejected", (t) => {
  if (!haveP3) return t.skip();
  const x = p3(); guilty(x.episode).forms = ["found — guilty"];
  has(check(x).problems, /"found — guilty" is not a valid phrase/);
});
