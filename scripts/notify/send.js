// Sends Toefl-Tofu push notifications. GitHub Actions runs this every 30 minutes
// (.github/workflows/notifications.yml) with a Firebase service-account key.
//   • Replies:  someone replied to your thread (sent on the next run)
//   • Likes:    daily summary of new likes on your threads, at 8 pm your time
// Bookkeeping lives in Firestore `notifyState/*`, which app users cannot read or write.
const path = require("path");
const fs = require("fs");

const APP_URL = process.env.APP_URL || "https://chiaying1230.github.io/toefl-threads/";
const DAY = 86400000;

function loadCore() {
  if (global.window && global.window.Core) return global.window.Core;
  global.window = {};
  const data = path.join(__dirname, "..", "..", "js", "data");
  require(path.join(data, "characters.js"));
  fs.readdirSync(data).filter((f) => /^batch-\d+\.js$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
    .forEach((f) => require(path.join(data, f)));
  require(path.join(__dirname, "..", "..", "js", "core.js"));
  return global.window.Core;
}

function snip(text, n = 80) {
  text = String(text || "").replace(/\s+/g, " ").trim();
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

// A Date whose UTC fields show the user's local wall-clock time.
function localTime(now, tzMinutes) {
  return new Date(now.getTime() + tzMinutes * 60000);
}

async function run({ db, send, Timestamp, FieldValue, now = new Date(), log = console.log }) {
  const Core = loadCore();
  const metaRef = db.collection("notifyState").doc("_meta");
  const meta = (await metaRef.get()).data() || {};
  const outbox = [];

  // Everyone who turned notifications on.
  const users = {};
  (await db.collection("pushTokens").get()).forEach((d) => {
    const x = d.data();
    if (Array.isArray(x.tokens) && x.tokens.length) {
      users[d.id] = { tokens: x.tokens, prefs: x.prefs || {}, tz: typeof x.tz === "number" ? x.tz : 480 };
    }
  });

  // ---- Replies since the last run ----
  const since = meta.lastRepliesAt ? meta.lastRepliesAt.toDate() : new Date(now.getTime() - 3600000);
  let latest = since;
  const byOwner = {};
  const postCache = {};
  const comments = await db.collection("comments").where("createdAt", ">", Timestamp.fromDate(since)).orderBy("createdAt").get();
  for (const d of comments.docs) {
    const c = d.data();
    const at = c.createdAt.toDate();
    if (at > latest) latest = at;
    if (!(c.postId in postCache)) {
      const p = await db.collection("posts").doc(c.postId).get();
      postCache[c.postId] = p.exists ? p.data() : null;   // character threads have no owner
    }
    const post = postCache[c.postId];
    if (!post || post.uid === c.uid) continue;
    (byOwner[post.uid] = byOwner[post.uid] || []).push({ name: c.name, text: c.text, postId: c.postId });
  }
  for (const [uid, list] of Object.entries(byOwner)) {
    const u = users[uid];
    if (!u || u.prefs.replies === false) continue;
    const first = list[0];
    outbox.push(list.length === 1
      ? { uid, kind: "replies", title: `${first.name} replied to your thread 💬`, body: snip(first.text), link: `#/t/${first.postId}` }
      : { uid, kind: "replies", title: `${list.length} new replies to your threads 💬`, body: `${first.name}: ${snip(first.text)}`, link: `#/t/${first.postId}` });
  }
  meta.lastRepliesAt = Timestamp.fromDate(latest);

  // ---- Daily likes summary, in each person's own time zone ----
  for (const [uid, u] of Object.entries(users)) {
    const stateRef = db.collection("notifyState").doc(uid);
    const state = (await stateRef.get()).data() || {};
    const local = localTime(now, u.tz);
    const localDay = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    let changed = false;

    // Likes: compare each thread's like count with the last summary.
    const due = hour >= 20 && state.lastLikesDay !== localDay;
    if (!state.likes || due) {
      const current = {};
      (await db.collection("posts").where("uid", "==", uid).get()).forEach((d) => { current[d.id] = d.data().likes || 0; });
      if (state.likes && due) {
        let gained = 0, best = null, bestGain = 0;
        for (const [id, n] of Object.entries(current)) {
          const g = n - (state.likes[id] || 0);
          if (g > 0) { gained += g; if (g > bestGain) { bestGain = g; best = id; } }
        }
        if (gained > 0 && u.prefs.likes !== false) {
          outbox.push({ uid, kind: "likes", title: `Your threads got ${gained} new like${gained > 1 ? "s" : ""} today ❤️`, body: "Keep posting with TOEFL words!", link: best ? `#/t/${best}` : "#/profile" });
        }
        state.lastLikesDay = localDay;
      }
      state.likes = current;
      changed = true;
    }

    if (changed) await stateRef.set(state);
  }

  // ---- Send ----
  const result = { sent: 0, failed: 0, removedTokens: 0, byKind: {} };
  for (const n of outbox) {
    for (const token of users[n.uid].tokens) {
      try {
        await send({
          token,
          notification: { title: n.title, body: n.body },
          webpush: {
            notification: { icon: APP_URL + "icon-192.png", badge: APP_URL + "icon-192.png" },
            fcmOptions: { link: APP_URL + n.link }
          }
        });
        result.sent++;
        result.byKind[n.kind] = (result.byKind[n.kind] || 0) + 1;
      } catch (e) {
        const code = (e && (e.code || (e.errorInfo && e.errorInfo.code))) || "";
        if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
          await db.collection("pushTokens").doc(n.uid).update({ tokens: FieldValue.arrayRemove(token) });
          result.removedTokens++;
        } else {
          result.failed++;
          log("send failed", n.uid, code || e);
        }
      }
    }
  }
  await metaRef.set(meta);
  log(`Toefl-Tofu notifications: ${JSON.stringify(result)} (people with notifications on: ${Object.keys(users).length})`);
  return { outbox, result };
}

module.exports = { run };

if (require.main === module) {
  const admin = require("firebase-admin");
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !emulator) {
    console.log("FIREBASE_SERVICE_ACCOUNT secret is not set yet — nothing to do.");
    process.exit(0);
  }
  admin.initializeApp(emulator
    ? { projectId: process.env.GCLOUD_PROJECT || "demo-toefl" }
    : { credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = admin.firestore();
  run({
    db,
    send: (msg) => admin.messaging().send(msg),
    Timestamp: admin.firestore.Timestamp,
    FieldValue: admin.firestore.FieldValue
  }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
