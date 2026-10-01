// Emulator test for send.js:  firebase emulators:exec --only firestore "node scripts/notify/test-send.js"
const assert = require("assert");
const admin = require("firebase-admin");
const { run } = require("./send");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-toefl" });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

async function main() {
  const sent = [];
  const send = async (msg) => {
    if (msg.token === "dead-token") { const e = new Error("gone"); e.code = "messaging/registration-token-not-registered"; throw e; }
    sent.push(msg);
  };
  const quiet = () => {};
  const at = (iso) => new Date(iso);
  const T = (iso) => Timestamp.fromDate(at(iso));

  // Taipei (UTC+8). 2026-10-05 is a Monday.
  await db.doc("pushTokens/alice").set({ tokens: ["alice-phone", "dead-token"], prefs: { replies: true, likes: true, weekly: true }, tz: 480 });
  await db.doc("pushTokens/bob").set({ tokens: ["bob-phone"], prefs: { replies: false, likes: true, weekly: true }, tz: 480 });
  await db.doc("posts/pA").set({ uid: "alice", name: "Alice", text: "My first thread", likes: 0, replies: 0, createdAt: T("2026-10-04T00:00:00Z") });
  await db.doc("posts/pB").set({ uid: "bob", name: "Bob", text: "Bob's thread", likes: 0, replies: 0, createdAt: T("2026-10-04T00:00:00Z") });
  await db.doc("notifyState/_meta").set({ lastRepliesAt: T("2026-10-04T10:00:00Z") });

  // Run 1 — Sunday 2026-10-04 19:05 Taipei. Replies only; likes baseline is recorded silently.
  await db.doc("comments/c1").set({ postId: "pA", uid: "bob", name: "Bob", text: "Great use of 'ubiquitous'!", createdAt: T("2026-10-04T11:00:00Z") });
  await db.doc("comments/c2").set({ postId: "pA", uid: "alice", name: "Alice", text: "thanks", createdAt: T("2026-10-04T11:01:00Z") });  // own thread
  await db.doc("comments/c3").set({ postId: "p10", uid: "bob", name: "Bob", text: "Poor penguin", createdAt: T("2026-10-04T11:02:00Z") }); // character thread
  await db.doc("comments/c4").set({ postId: "pB", uid: "alice", name: "Alice", text: "Hi Bob", createdAt: T("2026-10-04T11:03:00Z") }); // bob turned replies off
  let r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-04T11:05:00Z"), log: quiet });
  assert.deepStrictEqual(r.outbox.map((n) => n.kind + ":" + n.uid), ["replies:alice"], "run 1 outbox");
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].token, "alice-phone");
  assert.match(sent[0].notification.title, /Bob replied to your thread/);
  assert.match(sent[0].webpush.fcmOptions.link, /#\/t\/pA$/);
  assert.strictEqual(r.result.removedTokens, 1);
  assert.deepStrictEqual((await db.doc("pushTokens/alice").get()).data().tokens, ["alice-phone"], "dead token removed");
  console.log("PASS replies: only the thread owner, not own/character/opted-out; dead token removed");

  // Run 2 — same evening 20:30 Taipei, 3 new likes on Alice's thread. No repeat of old replies.
  sent.length = 0;
  await db.doc("posts/pA").update({ likes: 3 });
  r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-04T12:30:00Z"), log: quiet });
  assert.deepStrictEqual(r.outbox.map((n) => n.kind + ":" + n.uid), ["likes:alice"], "run 2 outbox");
  assert.match(sent[0].notification.title, /3 new likes today/);
  console.log("PASS daily likes summary at 8 pm local time; replies not repeated");

  // Run 3 — 21:00, nothing new → nothing sent (once per day).
  sent.length = 0;
  await db.doc("posts/pA").update({ likes: 4 });
  r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-04T13:00:00Z"), log: quiet });
  assert.strictEqual(sent.length, 0, "likes summary only once a day");
  console.log("PASS likes summary is sent at most once a day");

  // Review reminders. Alice has 2 words due (and 1 not yet); Bob has due words but turned reminders off.
  const due = at("2026-10-04T00:00:00Z").getTime(), later = at("2026-10-20T00:00:00Z").getTime();
  await db.doc("users/alice").set({ words: { ubiquitous: { box: 1, due }, arduous: { box: 0 }, verbose: { box: 3, due: later } } });
  await db.doc("users/bob").set({ words: { candid: { box: 1, due } } });
  await db.doc("pushTokens/bob").set({ prefs: { replies: false, likes: true, review: false } }, { merge: true });
  // Run 4 — Monday 08:30 Taipei: too early.
  sent.length = 0;
  r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-05T00:30:00Z"), log: quiet });
  assert.ok(!r.outbox.some((n) => n.kind === "review"), "no review reminder before 9 am");
  // Run 5 — Monday 09:05 Taipei: Alice gets "2 words to review today"; Bob doesn't (turned off).
  r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-05T01:05:00Z"), log: quiet });
  assert.deepStrictEqual(r.outbox.filter((n) => n.kind === "review").map((n) => n.uid), ["alice"]);
  const review = sent.find((m) => /to review today/.test(m.notification.title));
  assert.ok(review && /2 words/.test(review.notification.title), "review count");
  assert.match(review.webpush.fcmOptions.link, /#\/review$/);
  console.log("PASS review reminder from 9 am: " + review.notification.title);
  sent.length = 0;
  r = await run({ db, send, Timestamp, FieldValue, now: at("2026-10-05T03:00:00Z"), log: quiet });
  assert.ok(!sent.some((m) => /to review today/.test(m.notification.title)), "review reminder only once a day");
  console.log("PASS review reminder is sent at most once a day");
  console.log("ALL SENDER TESTS PASSED");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL", e.message); process.exit(1); });
