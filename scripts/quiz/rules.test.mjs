// Firestore rules tests for the /quiz collections. Run: npm test --prefix scripts/quiz  (needs Java for the emulator)
import { test, before, after, beforeEach } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, writeBatch, increment, serverTimestamp, updateDoc } from "firebase/firestore";

const rules = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../firestore.rules"), "utf8");
let env;
before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8089").split(":");
  env = await initializeTestEnvironment({ projectId: "demo-toefu", firestore: { rules, host, port: +port } });
});
after(async () => { await env.cleanup(); });
let anon;
beforeEach(async () => { await env.clearFirestore(); anon = env.unauthenticatedContext().firestore(); });

const today = new Date().toISOString().slice(0, 10);
const FIELD = "v55_t7";                       // vocab 5,500 → bucket 55; 72 s → bucket 7
const run = (over = {}) => ({
  date: today, createdAt: serverTimestamp(), device: "dev-12345678", attempt_no: 1, is_best: true, self_estimate: null,
  challenge: null, vocab: 5500, theta: 0.4, correct: 9, total_ms: 72000,
  answers: Array.from({ length: 15 }, (_, i) => ({ n: i + 1, word: "w" + i, level: 3, result: "correct", picked: "x", options: ["x", "y", "z", "w"], ms: 2000 })),
  source: "web", ...over
});
const db = () => anon;
const ids = { run: "run-0000001" };

async function writeRunAndStats(d, { runId = ids.run, runOver, fieldOver, nOver, lastOver, skipRun, skipAll, skipDay, extraAll } = {}) {
  const b = writeBatch(d);
  if (!skipRun) b.set(doc(d, "quizRuns", runId), run(runOver));
  const f = fieldOver || FIELD;
  const stat = (id) => ({ [f]: increment(1), n: nOver !== undefined ? nOver : increment(1), last: lastOver || runId, ...(extraAll || {}) });
  if (!skipAll) b.set(doc(d, "quizStats", "all"), stat("all"), { merge: true });
  if (!skipDay) b.set(doc(d, "quizStats", "day-" + today), stat("day"), { merge: true });
  return b.commit();
}

test("a normal result: run + all + day counters, first ever write", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  let s;
  await env.withSecurityRulesDisabled(async (c) => { s = (await getDoc(doc(c.firestore(), "quizStats", "all"))).data(); });
  if (s.n !== 1 || s[FIELD] !== 1 || s.last !== ids.run) throw new Error("unexpected stats " + JSON.stringify(s));
});

test("a second result updates the existing counters", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  await assertSucceeds(writeRunAndStats(db(), { runId: "run-0000002" }));
});

test("anyone can read the stats, nobody can read or change runs", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  await assertSucceeds(getDoc(doc(db(), "quizStats", "all")));
  await assertFails(getDoc(doc(db(), "quizRuns", ids.run)));
  await assertFails(updateDoc(doc(db(), "quizRuns", ids.run), { vocab: 11000 }));
});

test("stats without a result are rejected", async () => {
  await assertFails(writeRunAndStats(db(), { skipRun: true }));
});

test("a result alone (no stats) is allowed", async () => {
  await assertSucceeds(writeRunAndStats(db(), { skipAll: true, skipDay: true }));
});

test("adding 2 at once is rejected", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  const b = writeBatch(db());
  b.set(doc(db(), "quizRuns", "run-0000009"), run());
  b.set(doc(db(), "quizStats", "all"), { [FIELD]: increment(2), n: increment(1), last: "run-0000009" }, { merge: true });
  await assertFails(b.commit());
});

test("changing a different field is rejected", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  const b = writeBatch(db());
  b.set(doc(db(), "quizRuns", "run-0000008"), run());
  b.set(doc(db(), "quizStats", "all"), { [FIELD]: increment(1), n: increment(1), last: "run-0000008", v99_t1: increment(1) }, { merge: true });
  await assertFails(b.commit());
});

test("the field must match the result's vocabulary and time buckets", async () => {
  await assertFails(writeRunAndStats(db(), { fieldOver: "v56_t7" }));
  await assertFails(writeRunAndStats(db(), { fieldOver: "v55_t6" }));
});

test("times of 120 s or more share the last bucket", async () => {
  await assertSucceeds(writeRunAndStats(db(), { runOver: { total_ms: 150000 }, fieldOver: "v55_t12" }));
});

test("last must point at a result created in this batch, not an old one", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  const b = writeBatch(db());
  b.set(doc(db(), "quizStats", "all"), { [FIELD]: increment(1), n: increment(1), last: ids.run }, { merge: true });
  await assertFails(b.commit());
});

test("n must go up by exactly 1", async () => {
  await assertSucceeds(writeRunAndStats(db()));
  await assertFails(writeRunAndStats(db(), { runId: "run-0000003", nOver: increment(2) }));
});

test("the day document must match the result's date and today", async () => {
  const b = writeBatch(db());
  b.set(doc(db(), "quizRuns", "run-0000004"), run());
  b.set(doc(db(), "quizStats", "day-2020-01-01"), { [FIELD]: 1, n: 1, last: "run-0000004" });
  await assertFails(b.commit());
});

test("other quizStats documents are read-only", async () => {
  await assertFails(setDoc(doc(db(), "quizStats", "words"), { hello: 1 }));
  await assertFails(setDoc(doc(db(), "quizStats", "state"), { cursor: 1 }));
  await assertSucceeds(env.withSecurityRulesDisabled(async (c) => setDoc(doc(c.firestore(), "quizStats", "words"), { hello: 1 })));
  await assertSucceeds(getDoc(doc(db(), "quizStats", "words")));
});

test("result validation: bad values are rejected", async () => {
  const bad = [
    { vocab: 11001 }, { vocab: -1 }, { vocab: 5500.5 }, { total_ms: 4999 }, { total_ms: 200001 },
    { answers: [] }, { correct: 16 }, { extra: "x" }, { attempt_no: 0 }, { device: "x" }
  ];
  for (const [i, o] of bad.entries()) {
    await assertFails(setDoc(doc(db(), "quizRuns", "bad-run-" + i + "-00"), run(o)));
  }
  await assertFails(setDoc(doc(db(), "quizRuns", "bad-run-time-0"), run({ createdAt: new Date(2020, 1, 1) })));
});

test("result with a challenge and a self estimate is accepted", async () => {
  await assertSucceeds(setDoc(doc(db(), "quizRuns", "run-0000005"),
    run({ self_estimate: 6000, challenge: { rival_vocab: 7300, rival_sec: 72, won: false } })));
});

test("existing rules still work: meta probe and an unrelated collection", async () => {
  await assertSucceeds(getDoc(doc(db(), "meta", "rules-v8")));
  await assertFails(getDoc(doc(db(), "meta", "rules-v7")));
  await assertFails(getDoc(doc(db(), "users", "someone")));
});
