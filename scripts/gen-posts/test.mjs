import test from "node:test";
import assert from "node:assert/strict";
import * as L from "./lib.mjs";

const task = { id: "p1", author: "ann", topic: "Food", band: 2, words: [
  { key: "subtle", pos: "adj.", zh: "細微的；微妙的", band: 2 },
  { key: "alleviate", pos: "v.", zh: "減輕；緩和", band: 3 } ] };
const ok = { text: "The flavor is [[subtle]]. 這個湯超好喝!\n\nTea can [[alleviate|alleviated]] stress. 😅", zh: "味道很淡。\n\n茶能舒緩壓力。" };

test("valid post passes", () => assert.deepEqual(L.validatePost(task, ok), []));
test("missing word", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text.replace("[[subtle]]", "subtle") }).some((e) => /subtle/.test(e))));
test("unassigned word", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text + " [[bold]]" }).some((e) => /not an assigned/.test(e))));
test("chinese meaning leak", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text.replace("這個湯超好喝", "這個很微妙") }).some((e) => /微妙/.test(e))));
test("paragraph too long for band<=4", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text + "\n\n" + "a".repeat(176) }).some((e) => /max 175/.test(e))));
test("long paragraph ok for advanced levels", () => assert.deepEqual(L.validatePost({ ...task, band: 8 }, { ...ok, text: ok.text + "\n\n" + "a".repeat(200) }), []));
test("malformed marker", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text + " [[oops" }).length));
test("zh with markers", () => assert.ok(L.validatePost(task, { ...ok, zh: "[[subtle]]" }).length));
test("parse", () => {
  const r = L.parseResponse("### p1\nHello [[a]]\n\nSecond\n---\n你好\n\n### p2\nX\n---\nY");
  assert.equal(r.p1.text, "Hello [[a]]\n\nSecond"); assert.equal(r.p1.zh, "你好"); assert.equal(r.p2.zh, "Y");
});
test("plan covers every word once, 2-3 per post, deterministic", () => {
  const { CHARACTERS, TOPICS } = L.loadSite();
  const words = Array.from({ length: 24 }, (_, i) => ({ key: "w" + String.fromCharCode(97 + i), pos: "n.", zh: "字", band: 1 + (i % 4) }));
  const a = L.makePlan({ words, characters: CHARACTERS, topics: TOPICS, startId: 500 });
  assert.equal(a.length, 10);
  assert.ok(a.every((t) => t.words.length >= 2 && t.words.length <= 3));
  assert.deepEqual(a.flatMap((t) => t.words.map((w) => w.key)).sort(), words.map((w) => w.key).sort());
  assert.deepEqual(a, L.makePlan({ words, characters: CHARACTERS, topics: TOPICS, startId: 500 }));
  assert.equal(a.filter((t) => CHARACTERS[t.author].lang === "mix").length, 5); // band 1–4 words → mixShare 0.5
});
test("cost", () => assert.equal(L.costOf({ input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 1e6 }, [2, 10]), 12.2));

test("form identical to headword is rejected", () => assert.ok(L.validatePost(task, { ...ok, text: ok.text.replace("[[alleviate|alleviated]]", "[[alleviate|alleviate]]") }).some((e) => /repeats the word/.test(e))));
test("review prompt lists drafts and the OK protocol", () => {
  const p = L.buildReview([task], { p1: ok });
  assert.ok(p.includes("### p1") && p.includes("OK") && p.includes("[[subtle]]"));
});
test("system prompt carries the naturalness / facts rules", () => {
  const { CHARACTERS } = L.loadSite();
  const sys = L.buildSystem({ characters: CHARACTERS, examples: {}, authors: ["ann"] })[0].text;
  assert.ok(/non sequiturs/.test(sys) && /Soviet Union/.test(sys) && /sentence where its meaning can be inferred/.test(sys));
});

test("easy profile rejects very long sentences, allows normal ones", () => {
  const easy = { ...task, band: 1 };
  const longS = "Yesterday I went to the big new shop near my house because my mother asked me to buy some bread for dinner tonight.";
  assert.ok(L.validatePost(easy, { ...ok, text: ok.text + "\n\n" + longS }).some((e) => /English words/.test(e)));
  assert.deepEqual(L.validatePost(easy, ok), []);
  assert.equal(L.profileOf(3), "easy"); assert.equal(L.profileOf(4), "medium"); assert.equal(L.profileOf(6), "medium"); assert.equal(L.profileOf(7), "advanced");
});
test("level map", () => {
  assert.equal(L.levelOf(7, L.parseLevelMap()), 7); // identity by default (10 levels)
  assert.equal(L.levelOf(4, L.parseLevelMap("1=1,2=1,3=2,4=3")), 3);
  assert.equal(L.levelOf(11, L.parseLevelMap()), 10);
  assert.throws(() => L.parseLevelMap("1=x"));
  assert.equal(L.normPos("adj"), "adj."); assert.equal(L.normPos("n."), "n.");
});

test("vocab validation", () => {
  const w = { key: "arrive", pos: "v", zh: "抵達", band: 2 };
  assert.deepEqual(L.validateVocab(w, { ex: "The bus will arrive at six o'clock.", exZh: "公車六點會到。" }), []);
  assert.ok(L.validateVocab(w, { ex: "The bus came at six.", exZh: "公車六點到。" }).some((e) => /does not use/.test(e)));
  assert.ok(L.validateVocab(w, { ex: "We arrive 抵達 soon at home today now.", exZh: "好" }).length);
  const p = L.parseVocab("### arrive\nEN: I arrive at six.\nZH: 我六點到。\n\n### the end\nEN: x\nZH: y");
  assert.equal(p.arrive.ex, "I arrive at six."); assert.equal(p.the_end.exZh, "y");
});

test("pool: roughly half mix, many distinct characters", () => {
  const { CHARACTERS, TOPICS } = L.loadSite();
  const words = Array.from({ length: 80 }, (_, i) => ({ key: "w" + i.toString(36).replace(/\d/g, (d) => "abcdefghij"[d]), pos: "n.", zh: "字", band: 1 + (i % 4) }));
  const a = L.makePlan({ words, characters: CHARACTERS, topics: TOPICS, startId: 1 });
  const mix = a.filter((t) => CHARACTERS[t.author].lang === "mix").length;
  assert.ok(Math.abs(mix - a.length / 2) <= 1);
  assert.ok(new Set(a.map((t) => t.author)).size >= 15);
});

test("near-duplicate index", () => {
  const ix = L.makeSimIndex();
  ix.add("a", "I left my umbrella at the bus stop today and it rained a lot all day long.");
  assert.ok(ix.nearest("I left my umbrella at the bus stop today and it rained all day.").sim > 0.3);
  assert.ok(ix.nearest("Dragons prefer spicy noodles when the moon is full tonight.").sim < 0.1);
});
test("scene seed is attached to tasks", () => {
  const { CHARACTERS, TOPICS } = L.loadSite();
  const words = Array.from({ length: 6 }, (_, i) => ({ key: "x" + "abcdef"[i], pos: "n.", zh: "字", band: 2 }));
  assert.ok(L.makePlan({ words, characters: CHARACTERS, topics: TOPICS, startId: 1 }).every((t) => /angle:/.test(t.scene)));
});
test("estimate and batch discount", () => {
  assert.equal(L.costOf({ input: 1e6, output: 0, cacheWrite: 0, cacheRead: 0 }, [2, 10], 0.5), 1);
  assert.ok(L.estimateCost({ posts: 5, prefixTokens: 5000, prices: [2, 10], discount: 0.5 }) < 0.02);
});
