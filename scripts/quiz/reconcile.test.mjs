// Tests for the daily reconcile job against the Firestore emulator. Run with the rules tests (npm test --prefix scripts/quiz).
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath, Timestamp } from "firebase-admin/firestore";
import { reconcile, fieldOf } from "./reconcile.js";

let db;
before(() => { initializeApp({ projectId: "demo-toefu-reconcile" }); db = getFirestore(); });
beforeEach(async () => { await db.recursiveDelete(db.collection("quizRuns")); await db.recursiveDelete(db.collection("quizStats")); });

const now = new Date("2026-10-10T12:00:00Z");
const ago = (min) => Timestamp.fromMillis(now.getTime() - min * 60000);
const R = (over = {}) => ({
  date: "2026-10-10", createdAt: ago(60), device: "dev-aaaaaaaa", attempt_no: 1, is_best: true, self_estimate: null, challenge: null,
  vocab: 5500, theta: 0.4, correct: 9, total_ms: 72000, source: "web",
  answers: [{ n: 1, word: "hole", level: 1, result: "correct" }, { n: 2, word: "hometown", level: 1, result: "wrong" }], ...over
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
  assert.deepEqual(w.hole, { n: 11, c: 11 }); assert.deepEqual(w.hometown, { n: 11, c: 0 });
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
