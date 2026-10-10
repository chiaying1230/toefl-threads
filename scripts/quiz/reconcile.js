// Daily reconcile job for the /quiz statistics (GitHub Actions: .github/workflows/quiz-reconcile.yml).
// Uses the admin key, so Firestore security rules do not apply. What it does (docs/quiz-db-spec.md §4):
//   • reads only the quizRuns written since the last run (cursor in quizStats/state) and adds them to the verified baseline;
//   • counts at most PER_DEVICE_DAILY results per device per day; the rest are left out of the distribution;
//   • rewrites quizStats/all and the day documents in one transaction as "verified baseline + results newer than the cursor",
//     so results that arrive while it runs are never overwritten (the transaction retries if the live documents change);
//   • updates quizStats/words: how often each word was shown and answered correctly (first attempts only).
// Results younger than SETTLE_MS are left for the next run, so a slow write can't slip behind the cursor.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PER_DEVICE_DAILY = 10;
export const SETTLE_MS = 5 * 60 * 1000;
export const KEEP_DAYS = 3;
const PAGE = 500;

// Same bucket names as the page and the security rules: vocab / 100, and 10-second steps capped at 120 s.
export function fieldOf(vocab, ms) {
  return "v" + Math.floor(vocab / 100) + "_t" + (ms >= 120000 ? 12 : Math.floor(ms / 10000));
}

function quizWords() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "js", "data", "quiz-questions.js");
  const ctx = {};
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), ctx);
  return new Set(ctx.QUIZ_QUESTIONS.map((q) => q[0]));
}

const add = (o, f) => { o[f] = (o[f] || 0) + 1; o.n = (o.n || 0) + 1; };
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);   // device ids are not kept in readable form

export async function reconcile({ db, FieldValue, FieldPath, Timestamp, now = new Date(), log = console.log }) {
  const stats = db.collection("quizStats"), runs = db.collection("quizRuns");
  const stateRef = stats.doc("state"), wordsRef = stats.doc("words"), allRef = stats.doc("all");
  const words = quizWords();
  const settle = Timestamp.fromMillis(now.getTime() - SETTLE_MS);
  const old = (await stateRef.get()).data() || {};
  const state = { cursorAt: old.cursorAt || null, cursorId: old.cursorId || "", verified: old.verified || {}, days: old.days || {}, devDay: old.devDay || {} };
  const oldest = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  let processed = 0, excess = 0;

  for (;;) {
    let q = runs.where("createdAt", "<", settle).orderBy("createdAt").orderBy(FieldPath.documentId()).limit(PAGE);
    if (state.cursorAt) q = q.startAfter(state.cursorAt, state.cursorId);
    const snap = await q.get();
    if (snap.empty) break;
    const wordInc = {};
    for (const d of snap.docs) {
      const r = d.data();
      const dev = hash(r.device), day = (state.devDay[r.date] = state.devDay[r.date] || {});
      if ((day[dev] || 0) >= PER_DEVICE_DAILY) { excess++; continue; }
      day[dev] = (day[dev] || 0) + 1;
      const f = fieldOf(r.vocab, r.total_ms);
      add(state.verified, f);
      add((state.days[r.date] = state.days[r.date] || {}), f);
      if (r.attempt_no === 1 && Array.isArray(r.answers)) {
        r.answers.forEach((a) => {
          if (!a || !words.has(a.word)) return;
          const w = (wordInc[a.word] = wordInc[a.word] || { n: 0, c: 0 });
          w.n++; if (a.result === "correct") w.c++;
        });
      }
    }
    const last = snap.docs[snap.docs.length - 1];
    state.cursorAt = last.get("createdAt"); state.cursorId = last.id; processed += snap.size;
    Object.keys(state.devDay).forEach((k) => { if (k < oldest) delete state.devDay[k]; });
    Object.keys(state.days).forEach((k) => { if (k < oldest) delete state.days[k]; });
    // The cursor and the counts it covers are saved together, so nothing is counted twice or skipped.
    const batch = db.batch();
    batch.set(stateRef, { ...state, updatedAt: FieldValue.serverTimestamp() });
    const inc = {};
    Object.keys(wordInc).forEach((w) => { inc[w] = { n: FieldValue.increment(wordInc[w].n), c: FieldValue.increment(wordInc[w].c) }; });
    if (Object.keys(inc).length) batch.set(wordsRef, inc, { merge: true });
    await batch.commit();
  }

  // Live documents = verified baseline + everything newer than the cursor (not yet verified).
  await db.runTransaction(async (tx) => {
    const dates = Object.keys(state.days);
    const refs = [allRef].concat(dates.map((dt) => stats.doc("day-" + dt)));
    const live = await tx.getAll(...refs);
    let lq = runs.orderBy("createdAt").orderBy(FieldPath.documentId());
    if (state.cursorAt) lq = lq.startAfter(state.cursorAt, state.cursorId);
    const late = await tx.get(lq);
    const all = { ...state.verified }, byDay = {};
    dates.forEach((dt) => { byDay[dt] = { ...state.days[dt] }; });
    let lastLate = null;
    late.docs.forEach((d) => {
      const r = d.data(), f = fieldOf(r.vocab, r.total_ms);
      add(all, f);
      if (new Date(r.date) >= new Date(oldest)) add((byDay[r.date] = byDay[r.date] || {}), f);
      lastLate = d.id;
    });
    const lastOf = (snap) => lastLate || (snap.exists && snap.get("last")) || null;
    const write = (ref, counts, snap) => { const l = lastOf(snap); tx.set(ref, l ? { ...counts, last: l } : counts); };
    write(allRef, all, live[0]);
    Object.keys(byDay).forEach((dt, i) => write(stats.doc("day-" + dt), byDay[dt], live[1 + i] || { exists: false }));
  });

  log(`quiz reconcile: ${processed} new results (${excess} over the per-device limit), cursor ${state.cursorId || "-"}`);
  return { processed, excess, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath, Timestamp } = await import("firebase-admin/firestore");
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key && !process.env.FIRESTORE_EMULATOR_HOST) { console.error("FIREBASE_SERVICE_ACCOUNT is not set."); process.exit(1); }
  initializeApp(key ? { credential: cert(JSON.parse(key)) } : { projectId: process.env.GCLOUD_PROJECT || "demo-toefu" });
  await reconcile({ db: getFirestore(), FieldValue, FieldPath, Timestamp });
}
