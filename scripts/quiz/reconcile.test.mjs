// Tests for the daily reconcile job against the Firestore emulator. Run with the rules tests (npm test --prefix scripts/quiz).
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath, Timestamp } from "firebase-admin/firestore";
import { reconcile, fieldOf } from "./reconcile.js";

let db;
before(() => { initializeApp({ projectId: "demo-toefu-reconcile" }); db = getFirestore(); });
beforeEach(async () => { await db.recursiveDelete(db.collection("quizRuns")); await db.recursiveDelete(db.collection("quizStats")); await db.recursiveDelete(db.collection("quizNotes")); });

const now = new Date("2026-10-10T12:00:00Z");
const ago = (min) => Timestamp.fromMillis(now.getTime() - min * 60000);
const R = (over = {}) => ({
  date: "2026-10-10", createdAt: ago(60), device: "dev-aaaaaaaa", attempt_no: 1, is_best: true, self_estimate: null, challenge: null,
  vocab: 5500, theta: 0.4, correct: 9, total_ms: 72000, source: "web",
  answers: [
    { n: 1, word: "hole", level: 1, result: "correct", picked: "洞", options: ["雪人", "洞", "蛋糕", "記號"] },
    { n: 2, word: "hometown", level: 1, result: "wrong", picked: "祖母", options: ["祖母", "小狗", "家鄉", "房間"] }], ...over
});
const args = () => ({ db, FieldValue, FieldPath, Timestamp, now, log: () => {} });
const get = async (p) => (await db.doc(p).get()).data();

test("counts results, caps one device at 10 a day, and rewrites the live documents", async () => {
  for (let i = 0; i < 12; i++) await db.doc("quizRuns/r" + String(i).padStart(3, "0")).set(R({ createdAt: ago(100 - i) }));
  await db.doc("quizRuns/other-device-1").set(R({ device: "dev-bbbbbbbb", createdAt: ago(30) }));
  await db.doc("quizStats/all").set({ v55_t7: 99, n: 99, last: "stale" });          // a wrong live value gets corrected
  const out = await reconcile(args());
  assert.equal(out.processed, 13); assert.equal(out.excess, 2);
  const all = await get("quizStats/all");
  assert.equal(all.n, 11); assert.equal(all[fieldOf(5500, 72000)], 11);
  const day = await get("quizStats/day-2026-10-10");
  assert.equal(day.n, 11);
  const w = await get("quizStats/words");
  assert.equal(w.hole.n, 11); assert.equal(w.hole.c, 11); assert.equal(w.hometown.n, 11); assert.equal(w.hometown.c, 0);
  // distractor stats: "祖母" was shown 11 times and picked every time; the correct option "家鄉" is not listed
  assert.deepEqual(w.hometown.o["祖母"], { s: 11, p: 11 }); assert.deepEqual(w.hometown.o["小狗"], { s: 11, p: 0 });
  assert.equal(w.hometown.o["家鄉"], undefined); assert.deepEqual(w.hole.o["雪人"], { s: 11, p: 0 });
  const st = await get("quizStats/state");
  assert.ok(st.cursorId && st.verified.n === 11);
  assert.ok(!JSON.stringify(st).includes("dev-aaaaaaaa"), "device ids must not be stored in readable form");
});

test("a second run changes nothing; only attempt 1 counts for word stats", async () => {
  await db.doc("quizRuns/a1").set(R({ attempt_no: 1 }));
  await db.doc("quizRuns/a2").set(R({ attempt_no: 2, device: "dev-cccccccc", createdAt: ago(50) }));
  await reconcile(args());
  const before = await get("quizStats/all");
  const again = await reconcile(args());
  assert.equal(again.processed, 0);
  assert.deepEqual(await get("quizStats/all"), before);
  assert.equal((await get("quizStats/words")).hole.n, 1);
});

test("results newer than the cursor stay in the live counters", async () => {
  await db.doc("quizRuns/old").set(R({ createdAt: ago(60) }));
  await db.doc("quizRuns/fresh").set(R({ device: "dev-dddddddd", createdAt: ago(1), vocab: 8000 }));   // inside the 5-minute settle window
  await reconcile(args());
  const all = await get("quizStats/all");
  assert.equal(all.n, 2); assert.equal(all[fieldOf(5500, 72000)], 1); assert.equal(all[fieldOf(8000, 72000)], 1);
  assert.equal(all.last, "fresh");
  assert.equal((await get("quizStats/state")).verified.n, 1);
});

test("unknown words in answers are ignored", async () => {
  await db.doc("quizRuns/x").set(R({ answers: [{ n: 1, word: "not-a-quiz-word", result: "correct" }] }));
  await reconcile(args());
  const w = await get("quizStats/words");
  assert.ok(!w || Object.keys(w).length === 0);
});

test("forged options are not counted", async () => {
  await db.doc("quizRuns/f").set(R({ answers: [{ n: 1, word: "hole", level: 1, result: "wrong", picked: "x.y", options: ["x.y", "洞", "雪人", "a/b"] }] }));
  await reconcile(args());
  const w = await get("quizStats/words");
  assert.deepEqual(Object.keys(w.hole.o), ["雪人"]);
  assert.deepEqual(w.hole.o["雪人"], { s: 1, p: 0 });
});

const N = (word, reason, result, over = {}) => ({ run: "r1", device: "dev-aaaaaaaa", word, picked: "x", result, ms: 5000, reason, createdAt: ago(60), ...over });

test("notes are counted per word as reason_result", async () => {
  await db.doc("quizNotes/a").set(N("hole", "sure", "wrong"));
  await db.doc("quizNotes/b").set(N("hole", "sure", "wrong", { device: "dev-bbbbbbbb", createdAt: ago(59) }));
  await db.doc("quizNotes/c").set(N("hole", "sure", "correct", { device: "dev-cccccccc", createdAt: ago(58) }));
  await db.doc("quizNotes/d").set(N("hole", "lookalike", "wrong", { device: "dev-dddddddd", createdAt: ago(57), other_word: "whole" }));
  await db.doc("quizNotes/e").set(N("hometown", "misclick", "wrong", { device: "dev-eeeeeeee", createdAt: ago(56) }));
  const out = await reconcile(args());
  assert.equal(out.notesProcessed, 5); assert.equal(out.notesCounted, 5);
  const w = await get("quizStats/words");
  assert.deepEqual(w.hole.r, { sure_wrong: 2, sure_correct: 1, lookalike_wrong: 1 });
  assert.deepEqual(w.hometown.r, { misclick_wrong: 1 });
  assert.ok(!JSON.stringify(await get("quizStats/state")).includes("whole"), "other_word is not copied into the stats");
});

test("one device counts at most 10 notes a day", async () => {
  for (let i = 0; i < 13; i++) await db.doc("quizNotes/n" + String(i).padStart(2, "0")).set(N("hole", "guess", "wrong", { createdAt: ago(100 - i) }));
  await db.doc("quizNotes/other").set(N("hole", "guess", "wrong", { device: "dev-bbbbbbbb", createdAt: ago(30) }));
  const out = await reconcile(args());
  assert.equal(out.notesProcessed, 14); assert.equal(out.notesExcess, 3); assert.equal(out.notesCounted, 11);
  assert.equal((await get("quizStats/words")).hole.r.guess_wrong, 11);
});

test("notes are counted once, and unknown words, reasons and results are ignored", async () => {
  await db.doc("quizNotes/a").set(N("hole", "torn", "correct"));
  await db.doc("quizNotes/f1").set(N("not-a-quiz-word", "torn", "correct", { device: "dev-bbbbbbbb", createdAt: ago(55) }));
  await db.doc("quizNotes/f2").set(N("hole", "a.b", "wrong", { device: "dev-cccccccc", createdAt: ago(54) }));
  await db.doc("quizNotes/f3").set(N("hole", "torn", "skip", { device: "dev-dddddddd", createdAt: ago(53) }));
  await reconcile(args());
  const before = await get("quizStats/words");
  assert.deepEqual(before.hole.r, { torn_correct: 1 });
  const again = await reconcile(args());
  assert.equal(again.notesProcessed, 0);
  assert.deepEqual(await get("quizStats/words"), before);
});

test("a note newer than the settle window waits for the next run", async () => {
  await db.doc("quizNotes/fresh").set(N("hole", "sure", "wrong", { createdAt: ago(1) }));
  const out = await reconcile(args());
  assert.equal(out.notesProcessed, 0);
});
