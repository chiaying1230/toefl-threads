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
test("long paragraph ok for band 5", () => assert.deepEqual(L.validatePost({ ...task, band: 5 }, { ...ok, text: ok.text + "\n\n" + "a".repeat(200) }), []));
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
  assert.ok(a.filter((t) => CHARACTERS[t.author].lang === "mix").length >= 7);
});
test("cost", () => assert.equal(L.costOf({ input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 1e6 }, [2, 10]), 12.2));
