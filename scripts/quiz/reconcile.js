// Daily reconcile job for the /quiz statistics (GitHub Actions: .github/workflows/quiz-reconcile.yml).
// Uses the admin key, so Firestore security rules do not apply. What it does (docs/quiz-db-spec.md §4):
//   • reads only the quizRuns written since the last run (cursor in quizStats/state) and adds them to the verified baseline;
//   • counts at most PER_DEVICE_DAILY results per device per day; the rest are left out of the distribution;
//   • rewrites quizStats/all and the day documents in one transaction as "verified baseline + results newer than the cursor",
//     so results that arrive while it runs are never overwritten (the transaction retries if the live documents change);
//   • reads quizNotes (how a player says they chose a word) with their own cursor and adds, per word, r: how often each reason was
//     given, split by whether the answer was right ("sure_wrong", "sure_correct", ...); at most PER_DEVICE_DAILY notes per device per day.
//     Notes are asked mostly for wrong answers, so r counts are not rates over all answers: read them next to n and c.
//   • updates quizStats/words (first attempts only): per word, how often it was shown (n) and answered correctly (c), and for each
//     wrong option (o) how often it was shown (s) and picked (p), which shows how tempting each distractor is.
//   • review quiz (Review tab → Quiz, docs/review-quiz-spec.md): reads reviewRuns and reviewNotes with cursors of their own and
//     adds, per word, into quizStats/reviewWords-<first letter>: n / c (shown / right), n0 / c0 (the same for words at box 0,
//     i.e. new or just missed), o (wrong options of /quiz bank words: shown s / picked p) and r (reasons, as for /quiz).
//     At most PER_DEVICE_DAILY rounds and PER_DEVICE_DAILY notes per device per day. Kept apart from quizStats/words:
//     these are people's own saved words, seen again and again, so they are a different population.
// Results younger than SETTLE_MS are left for the next run, so a slow write can't slip behind the cursor.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PER_DEVICE_DAILY = 10;
export const SETTLE_MS = 5 * 60 * 1000;
export const KEEP_DAYS = 3;
export const NOTE_REASONS = ["sure", "torn", "lookalike", "affix", "forgot", "guess", "misclick"];
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
  // word -> the known wrong options (only these are counted, so a forged answer can't add fields)
  return new Map(ctx.QUIZ_QUESTIONS.map((q) => [q[0], new Set(q.slice(6, 9))]));
}

// Every word in the app's word lists (main list and packs): review answers for other words are ignored.
function appWords() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "js", "data");
  const ctx = { VOCAB: {}, POSTS: [], PACKS: {}, PACK_POSTS: {} };
  ctx.window = ctx;
  const files = fs.readdirSync(dir).filter((f) => /^batch-\d+\.js$/.test(f)).map((f) => path.join(dir, f))
    .concat(fs.readdirSync(path.join(dir, "packs")).filter((f) => f.endsWith(".js") && f !== "index.js").map((f) => path.join(dir, "packs", f)));
  files.forEach((f) => vm.runInNewContext(fs.readFileSync(f, "utf8"), ctx));
  return new Set(Object.keys(ctx.VOCAB));
}

const reviewDoc = (word) => "reviewWords-" + (/^[a-z]/.test(word) ? word[0] : "other");

const add = (o, f) => { o[f] = (o[f] || 0) + 1; o.n = (o.n || 0) + 1; };
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 12);   // device ids are not kept in readable form

export async function reconcile({ db, FieldValue, FieldPath, Timestamp, now = new Date(), log = console.log }) {
  const stats = db.collection("quizStats"), runs = db.collection("quizRuns");
  const stateRef = stats.doc("state"), wordsRef = stats.doc("words"), allRef = stats.doc("all");
  const words = quizWords();
  const settle = Timestamp.fromMillis(now.getTime() - SETTLE_MS);
  const old = (await stateRef.get()).data() || {};
  const state = { cursorAt: old.cursorAt || null, cursorId: old.cursorId || "", verified: old.verified || {}, days: old.days || {}, devDay: old.devDay || {},
    noteCursorAt: old.noteCursorAt || null, noteCursorId: old.noteCursorId || "", noteDevDay: old.noteDevDay || {},
    rvCursorAt: old.rvCursorAt || null, rvCursorId: old.rvCursorId || "", rvDevDay: old.rvDevDay || {},
    rvNoteCursorAt: old.rvNoteCursorAt || null, rvNoteCursorId: old.rvNoteCursorId || "", rvNoteDevDay: old.rvNoteDevDay || {} };
  const oldest = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  let processed = 0, excess = 0, notesProcessed = 0, notesExcess = 0, notesCounted = 0;
  let rvProcessed = 0, rvExcess = 0, rvNotesProcessed = 0, rvNotesCounted = 0, rvNotesExcess = 0;

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
          const w = (wordInc[a.word] = wordInc[a.word] || { n: 0, c: 0, o: {} });
          w.n++; if (a.result === "correct") w.c++;
          if (Array.isArray(a.options)) {
            a.options.forEach((opt) => {
              if (!words.get(a.word).has(opt)) return;
              const x = (w.o[opt] = w.o[opt] || { s: 0, p: 0 });
              x.s++; if (a.picked === opt) x.p++;
            });
          }
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
    Object.keys(wordInc).forEach((w) => {
      const o = {};
      Object.keys(wordInc[w].o).forEach((t) => { o[t] = { s: FieldValue.increment(wordInc[w].o[t].s), p: FieldValue.increment(wordInc[w].o[t].p) }; });
      inc[w] = { n: FieldValue.increment(wordInc[w].n), c: FieldValue.increment(wordInc[w].c), ...(Object.keys(o).length ? { o } : {}) };
    });
    if (Object.keys(inc).length) batch.set(wordsRef, inc, { merge: true });
    await batch.commit();
  }

  // Notes: same idea as the runs above, with a cursor of their own.
  const notes = db.collection("quizNotes");
  for (;;) {
    let q = notes.where("createdAt", "<", settle).orderBy("createdAt").orderBy(FieldPath.documentId()).limit(PAGE);
    if (state.noteCursorAt) q = q.startAfter(state.noteCursorAt, state.noteCursorId);
    const snap = await q.get();
    if (snap.empty) break;
    const rInc = {};
    for (const d of snap.docs) {
      const r = d.data();
      const date = d.get("createdAt").toDate().toISOString().slice(0, 10);   // notes carry no local date, so the server day is used
      const day = (state.noteDevDay[date] = state.noteDevDay[date] || {});
      const dev = hash(r.device);
      if ((day[dev] || 0) >= PER_DEVICE_DAILY) { notesExcess++; continue; }
      day[dev] = (day[dev] || 0) + 1;
      // only words in the bank and known values are counted, so a forged note can't add fields
      if (!words.has(r.word) || !NOTE_REASONS.includes(r.reason) || (r.result !== "correct" && r.result !== "wrong")) continue;
      const w = (rInc[r.word] = rInc[r.word] || {});
      w[r.reason + "_" + r.result] = (w[r.reason + "_" + r.result] || 0) + 1;
      notesCounted++;
    }
    const last = snap.docs[snap.docs.length - 1];
    state.noteCursorAt = last.get("createdAt"); state.noteCursorId = last.id; notesProcessed += snap.size;
    Object.keys(state.noteDevDay).forEach((k) => { if (k < oldest) delete state.noteDevDay[k]; });
    const batch = db.batch();
    batch.set(stateRef, { ...state, updatedAt: FieldValue.serverTimestamp() });
    const inc = {};
    Object.keys(rInc).forEach((w) => {
      const r = {};
      Object.keys(rInc[w]).forEach((k) => { r[k] = FieldValue.increment(rInc[w][k]); });
      inc[w] = { r };
    });
    if (Object.keys(inc).length) batch.set(wordsRef, inc, { merge: true });
    await batch.commit();
  }

  // Review quiz rounds and notes (docs/review-quiz-spec.md): per-word counts in quizStats/reviewWords-<letter>.
  const vocab = appWords();
  const bankOf = (word) => words.get(word.replace(/_/g, " "));   // review answers use word-list keys ("a_deluge_of")
  // Adds the per-word increments to the right letter documents, together with the state that covers them.
  const commitReview = async (perWord) => {
    const batch = db.batch(), docs = {};
    batch.set(stateRef, { ...state, updatedAt: FieldValue.serverTimestamp() });
    Object.keys(perWord).forEach((w) => { (docs[reviewDoc(w)] = docs[reviewDoc(w)] || {})[w] = perWord[w]; });
    Object.keys(docs).forEach((id) => batch.set(stats.doc(id), docs[id], { merge: true }));
    await batch.commit();
  };
  const incOf = (counts) => {
    const out = {};
    Object.keys(counts).forEach((k) => { out[k] = typeof counts[k] === "number" ? FieldValue.increment(counts[k]) : incOf(counts[k]); });
    return out;
  };

  const rvRuns = db.collection("reviewRuns");
  for (;;) {
    let q = rvRuns.where("createdAt", "<", settle).orderBy("createdAt").orderBy(FieldPath.documentId()).limit(PAGE);
    if (state.rvCursorAt) q = q.startAfter(state.rvCursorAt, state.rvCursorId);
    const snap = await q.get();
    if (snap.empty) break;
    const perWord = {};
    for (const d of snap.docs) {
      const r = d.data();
      const dev = hash(r.device), day = (state.rvDevDay[r.date] = state.rvDevDay[r.date] || {});
      if ((day[dev] || 0) >= PER_DEVICE_DAILY) { rvExcess++; continue; }
      day[dev] = (day[dev] || 0) + 1;
      (Array.isArray(r.answers) ? r.answers.slice(0, 10) : []).forEach((a) => {
        if (!a || typeof a.word !== "string" || !vocab.has(a.word)) return;
        const w = (perWord[a.word] = perWord[a.word] || { n: 0, c: 0, n0: 0, c0: 0 });
        const ok = a.result === "correct";
        w.n++; if (ok) w.c++;
        if (a.box === 0) { w.n0++; if (ok) w.c0++; }
        const known = bankOf(a.word);
        if (known && Array.isArray(a.options)) {
          a.options.forEach((opt) => {
            if (!known.has(opt)) return;
            const x = ((w.o = w.o || {})[opt] = w.o[opt] || { s: 0, p: 0 });
            x.s++; if (a.picked === opt) x.p++;
          });
        }
      });
    }
    const last = snap.docs[snap.docs.length - 1];
    state.rvCursorAt = last.get("createdAt"); state.rvCursorId = last.id; rvProcessed += snap.size;
    Object.keys(state.rvDevDay).forEach((k) => { if (k < oldest) delete state.rvDevDay[k]; });
    const inc = {};
    Object.keys(perWord).forEach((w) => { inc[w] = incOf(perWord[w]); });
    await commitReview(inc);
  }

  const rvNotes = db.collection("reviewNotes");
  for (;;) {
    let q = rvNotes.where("createdAt", "<", settle).orderBy("createdAt").orderBy(FieldPath.documentId()).limit(PAGE);
    if (state.rvNoteCursorAt) q = q.startAfter(state.rvNoteCursorAt, state.rvNoteCursorId);
    const snap = await q.get();
    if (snap.empty) break;
    const perWord = {};
    for (const d of snap.docs) {
      const r = d.data();
      const date = d.get("createdAt").toDate().toISOString().slice(0, 10);
      const day = (state.rvNoteDevDay[date] = state.rvNoteDevDay[date] || {});
      const dev = hash(r.device);
      if ((day[dev] || 0) >= PER_DEVICE_DAILY) { rvNotesExcess++; continue; }
      day[dev] = (day[dev] || 0) + 1;
      if (typeof r.word !== "string" || !vocab.has(r.word) || !NOTE_REASONS.includes(r.reason) || (r.result !== "correct" && r.result !== "wrong")) continue;
      const w = ((perWord[r.word] = perWord[r.word] || {}).r = perWord[r.word].r || {});
      w[r.reason + "_" + r.result] = (w[r.reason + "_" + r.result] || 0) + 1;
      rvNotesCounted++;
    }
    const last = snap.docs[snap.docs.length - 1];
    state.rvNoteCursorAt = last.get("createdAt"); state.rvNoteCursorId = last.id; rvNotesProcessed += snap.size;
    Object.keys(state.rvNoteDevDay).forEach((k) => { if (k < oldest) delete state.rvNoteDevDay[k]; });
    const inc = {};
    Object.keys(perWord).forEach((w) => { inc[w] = incOf(perWord[w]); });
    await commitReview(inc);
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

  log(`quiz reconcile: ${processed} new results (${excess} over the per-device limit), cursor ${state.cursorId || "-"}; ${notesProcessed} new notes (${notesCounted} counted, ${notesExcess} over the per-device limit); ` +
    `review: ${rvProcessed} new rounds (${rvExcess} over the limit), ${rvNotesProcessed} new notes (${rvNotesCounted} counted, ${rvNotesExcess} over the limit)`);
  return { processed, excess, notesProcessed, notesCounted, notesExcess, rvProcessed, rvExcess, rvNotesProcessed, rvNotesCounted, rvNotesExcess, state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath, Timestamp } = await import("firebase-admin/firestore");
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key && !process.env.FIRESTORE_EMULATOR_HOST) { console.error("FIREBASE_SERVICE_ACCOUNT is not set."); process.exit(1); }
  initializeApp(key ? { credential: cert(JSON.parse(key)) } : { projectId: process.env.GCLOUD_PROJECT || "demo-toefu" });
  await reconcile({ db: getFirestore(), FieldValue, FieldPath, Timestamp });
}
