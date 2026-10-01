// Storage layer. Two modes behind one interface:
//  - local: everything in this browser's localStorage (default, no setup needed)
//  - cloud: Firebase (Google sign-in + Firestore) when js/firebase-config.js is filled in.
//    Signed-out visitors still use the local state until they sign in.
(function () {
  "use strict";

  var KEY = "toeflThreads.v2";
  var OLD_KEY = "vocabThreads.v1";
  var SEEN_KEY = "toeflThreads.seen";
  var MERGED_KEY = "toeflThreads.mergedInto";
  var LAST_UID_KEY = "toeflThreads.lastUid";
  var CLOUD_CACHE = "toeflThreads.cloud.";   // + uid: last known copy of the account state
  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  var SYNCED_FIELDS = ["liked", "bookmarked", "words", "profile", "prefs", "following", "daily", "settings", "stats", "badges", "reposted"];

  function freshState() {
    return {
      liked: {},
      bookmarked: {},
      words: {},       // key -> { addedAt, from, box, due }
      profile: { name: "You", handle: "toefl_learner", avatar: "🙂", photo: "", bio: "", target: 0 },
      prefs: { levels: [1, 2, 3], topics: [], onboarded: false },
      following: {},
      daily: { goal: 10, log: {}, met: {} },
      settings: { rate: 1, lang: "en" },   // lang: "en" English only, "bi" English + 中文
      stats: { quiz: 0, cards: 0, replies: 0 },
      badges: {},      // badge id -> unlocked timestamp
      reposted: {},    // postId -> when I reposted it
      myPosts: [],     // local mode only: { id, text, ts, quoteOf? }
      myComments: []   // local mode only: { id, postId, text, ts }
    };
  }

  function withDefaults(s) {
    var base = freshState();
    Object.keys(base).forEach(function (k) {
      if (s && s[k] !== undefined && s[k] !== null) base[k] = s[k];
    });
    var fresh = freshState();
    ["daily", "settings", "stats", "prefs", "profile"].forEach(function (k) {
      Object.keys(fresh[k]).forEach(function (f) { if (base[k][f] === undefined) base[k][f] = fresh[k][f]; });
    });
    return base;
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function loadGuest() {
    var s = readJSON(KEY);
    if (s) return withDefaults(s);
    // Migrate data saved by the first version of the app.
    var old = readJSON(OLD_KEY);
    var st = freshState();
    if (old) {
      ["liked", "bookmarked", "words", "myPosts"].forEach(function (k) { if (old[k]) st[k] = old[k]; });
      if (old.profile) st.profile = old.profile;
    }
    return st;
  }

  function unionMap(a, b) {
    var out = {};
    Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
    Object.keys(a || {}).forEach(function (k) { if (!(k in out)) out[k] = a[k]; });
    return out;
  }

  function mergeInto(cloud, guest) {
    var s = withDefaults(cloud);
    ["liked", "bookmarked", "words", "following", "badges"].forEach(function (k) { s[k] = unionMap(guest[k], s[k]); });
    Object.keys(guest.daily.log).forEach(function (d) {
      s.daily.log[d] = Math.max(s.daily.log[d] || 0, guest.daily.log[d]);
    });
    s.daily.met = unionMap(guest.daily.met, s.daily.met);
    ["quiz", "cards", "replies"].forEach(function (k) { s.stats[k] = Math.max(s.stats[k] || 0, guest.stats[k] || 0); });
    return s;
  }

  function handleFrom(u) {
    var base = (u.email || "").split("@")[0] || u.displayName || "";
    return base.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24) || "toefl_learner";
  }

  function millis(ts) {
    if (!ts) return Date.now();
    if (typeof ts === "number") return ts;
    if (ts.toMillis) return ts.toMillis();
    return Date.now();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  var listeners = [];
  var guest = loadGuest();
  var db = null;
  var auth = null;
  var saveTimer = null;
  var community = [];     // cloud posts by users, newest first
  var stats = {};         // postId -> { likes, replies, reposts } (cloud extras for built-in posts)
  var reposts = [];       // cloud reposts by everyone, newest first: { uid, postId, name, handle, avatar, createdAt }
  var unsubscribers = [];

  var Store = {
    mode: "local",
    configured: false,
    ready: false,
    user: null,
    state: guest,
    seen: readJSON(SEEN_KEY) || {},
    onChange: function (fn) { listeners.push(fn); },
    emit: function (kind) { listeners.forEach(function (fn) { fn(kind); }); }
  };

  function isCloud() { return Store.mode === "cloud" && Store.user; }

  // Ask the browser not to evict our data (helps on Android and some iOS versions).
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

  // ---------- Persistence ----------
  Store.save = function () {
    var s = Store.state;
    // Keep this device's copy of the feed preferences in sync, so a failed or slow
    // cloud load never sends someone back through the "choose your level" screen.
    if (s !== guest && s.prefs.onboarded) {
      guest.prefs = s.prefs;
      guest.daily.goal = s.daily.goal;
      writeJSON(KEY, guest);
    }
    if (isCloud()) {
      writeJSON(CLOUD_CACHE + Store.user.uid, s);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(pushUserDoc, 600);
    } else {
      writeJSON(KEY, s);
    }
  };

  var deleting = false;   // set while deleting the account: never write the account back

  function pushUserDoc() {
    if (!isCloud() || deleting) return;
    var doc = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    SYNCED_FIELDS.forEach(function (k) { doc[k] = Store.state[k]; });
    db.collection("users").doc(Store.user.uid).set(doc).catch(function (e) {
      console.error(e);
      Store.emit("error:save");
    });
  }

  // Save immediately when the app goes to the background, instead of waiting for the timer.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      pushUserDoc();
    }
  });

  var seenTimer = null;
  Store.markSeen = function (id) {
    if (Store.seen[id]) return;
    Store.seen[id] = 1;
    clearTimeout(seenTimer);
    seenTimer = setTimeout(function () { writeJSON(SEEN_KEY, Store.seen); }, 1000);
  };

  // True when this browser was signed in last time but no longer is.
  Store.wasSignedOut = function () {
    return Store.mode === "cloud" && !Store.user && !!readJSON(LAST_UID_KEY);
  };

  // ---------- Init ----------
  Store.init = function () {
    var cfg = window.FIREBASE_CONFIG;
    Store.configured = !!(cfg && cfg.apiKey && cfg.projectId);
    if (!Store.configured) {
      Store.ready = true;
      return Promise.resolve();
    }
    return loadScript(SDK + "firebase-app-compat.js")
      .then(function () {
        var parts = [loadScript(SDK + "firebase-auth-compat.js"), loadScript(SDK + "firebase-firestore-compat.js")];
        // App Check (optional): proves requests come from this site, not from scripts.
        if (window.FIREBASE_APPCHECK_KEY) parts.push(loadScript(SDK + "firebase-app-check-compat.js").catch(function (e) { console.error(e); }));
        return Promise.all(parts);
      })
      .then(function () {
        firebase.initializeApp(cfg);
        if (window.FIREBASE_APPCHECK_KEY && firebase.appCheck) {
          try {
            var key = window.FIREBASE_APPCHECK_KEY;
            var Provider = window.FIREBASE_APPCHECK_PROVIDER === "enterprise"
              ? firebase.appCheck.ReCaptchaEnterpriseProvider
              : firebase.appCheck.ReCaptchaV3Provider;
            var provider = Provider ? new Provider(key) : key;
            firebase.appCheck().activate(provider, true);
          } catch (e) { console.error(e); }
        }
        auth = firebase.auth();
        db = firebase.firestore();
        // Offline cache: account data still loads when the network is slow at startup.
        db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* unsupported or another tab */ });
        Store.mode = "cloud";
        return auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () { /* keep default */ });
      })
      .then(function () {
        subscribeShared();
        return new Promise(function (resolve) {
          var first = true;
          auth.onAuthStateChanged(function (u) {
            handleAuth(u).then(function () {
              if (first) { first = false; Store.ready = true; resolve(); }
              else Store.emit("auth");
            });
          });
        });
      })
      .catch(function (e) {
        console.error(e);
        Store.mode = "local";
        Store.configured = false;
        Store.ready = true;
        Store.emit("error:offline");
      });
  };

  function rawPost(id, x) {
    return { id: id, uid: x.uid, name: x.name, handle: x.handle, avatar: x.avatar, text: x.text, quoteOf: x.quoteOf || null, createdAt: millis(x.createdAt), likes: x.likes || 0, replies: x.replies || 0, reposts: x.reposts || 0 };
  }

  function subscribeShared() {
    unsubscribers.push(db.collection("posts").orderBy("createdAt", "desc").limit(300).onSnapshot(function (snap) {
      community = snap.docs.map(function (d) {
        var x = d.data();
        return rawPost(d.id, x);
      });
      Store.emit("community");
    }, function (e) { console.error(e); }));
    unsubscribers.push(db.collection("reposts").orderBy("createdAt", "desc").limit(300).onSnapshot(function (snap) {
      reposts = snap.docs.map(function (d) {
        var x = d.data();
        return { uid: x.uid, postId: x.postId, name: x.name, handle: x.handle, avatar: x.avatar, createdAt: millis(x.createdAt) };
      });
      Store.emit("reposts");
    }, function (e) { console.error(e); }));
    unsubscribers.push(db.collection("postStats").onSnapshot(function (snap) {
      stats = {};
      snap.docs.forEach(function (d) { stats[d.id] = d.data(); });
      Store.emit("stats");
    }, function (e) { console.error(e); }));
  }

  function getWithRetry(ref, tries) {
    return ref.get().catch(function (e) {
      if (tries <= 1) throw e;
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return getWithRetry(ref, tries - 1); });
    });
  }

  function handleAuth(u) {
    if (!u) {
      Store.user = null;
      Store.state = guest;
      return Promise.resolve();
    }
    Store.user = { uid: u.uid, name: u.displayName || "TOEFL learner", photo: u.photoURL };
    writeJSON(LAST_UID_KEY, u.uid);
    var cached = readJSON(CLOUD_CACHE + u.uid);
    return getWithRetry(db.collection("users").doc(u.uid), 3).then(function (snap) {
      var alreadyMerged = readJSON(MERGED_KEY) === u.uid;
      var cloudState = snap.exists ? snap.data() : null;
      var s;
      if (!cloudState) {
        s = withDefaults(cached || guest);
        s.profile = cached ? s.profile : { name: u.displayName || guest.profile.name, handle: handleFrom(u), avatar: guest.profile.avatar };
      } else {
        s = alreadyMerged ? withDefaults(cloudState) : mergeInto(cloudState, guest);
      }
      if (!s.prefs.onboarded && guest.prefs.onboarded) s.prefs = guest.prefs;
      s.myPosts = [];
      s.myComments = [];
      Store.state = s;
      Store.pendingLocalPosts = alreadyMerged ? [] : guest.myPosts.slice();
      writeJSON(MERGED_KEY, u.uid);
      writeJSON(CLOUD_CACHE + u.uid, s);
      ensurePublicProfile(u.uid);
      if (!snap.exists || !alreadyMerged) pushUserDoc();
    }).catch(function (e) {
      // Stay signed in. Use the last copy saved on this device and try the cloud again later.
      console.error(e);
      var s = withDefaults(cached || guest);
      if (!s.prefs.onboarded && guest.prefs.onboarded) s.prefs = guest.prefs;
      s.myPosts = [];
      s.myComments = [];
      Store.state = s;
      Store.pendingLocalPosts = [];
      Store.emit("error:load");
    });
  }

  Store.signIn = function () {
    if (!auth) return Promise.reject(new Error("not configured"));
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return auth.signInWithPopup(provider).catch(function (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
        return auth.signInWithRedirect(provider);
      }
      throw e;
    });
  };

  Store.signOut = function () {
    removeKey(LAST_UID_KEY);
    if (Store.user) removeKey(CLOUD_CACHE + Store.user.uid);
    return auth ? auth.signOut() : Promise.resolve();
  };

  // Posting and replying need an account once the cloud is set up.
  Store.canWrite = function () { return Store.mode === "local" || !!Store.user; };

  // ---------- Community posts ----------
  Store.communityPosts = function () {
    if (Store.mode === "cloud") return community.slice();
    var p = Store.state.profile;
    return Store.state.myPosts.map(function (m) {
      return { id: m.id, uid: "me", name: p.name, handle: p.handle, avatar: p.avatar, text: m.text, quoteOf: m.quoteOf || null, createdAt: m.ts, likes: 0, replies: 0, reposts: 0 };
    });
  };

  Store.myUid = function () {
    if (Store.mode === "local") return "me";
    return Store.user ? Store.user.uid : null;
  };

  // quoted: the post being quoted (optional). A quote counts as a repost of it.
  Store.createPost = function (text, quoted) {
    var p = Store.state.profile;
    if (!isCloud()) {
      var m = { id: "me" + Date.now(), text: text, ts: Date.now() };
      if (quoted) m.quoteOf = quoted.id;
      Store.state.myPosts.unshift(m);
      Store.save();
      Store.emit("community");
      return Promise.resolve();
    }
    var doc = {
      uid: Store.user.uid, name: p.name, handle: p.handle, avatar: p.avatar, text: text,
      likes: 0, replies: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (quoted) doc.quoteOf = quoted.id;
    // At most one thread every 30 seconds (enforced by the security rules).
    var b = db.batch();
    var ref = db.collection("posts").doc();
    b.set(limitsRef(), { post: now() }, { merge: true });
    b.set(ref, doc);
    return b.commit().then(function () { return ref; });
  };

  Store.deletePost = function (id) {
    delete Store.state.liked[id];
    delete Store.state.bookmarked[id];
    if (!isCloud()) {
      Store.state.myPosts = Store.state.myPosts.filter(function (m) { return m.id !== id; });
      Store.state.myComments = Store.state.myComments.filter(function (c) { return c.postId !== id; });
      Store.save();
      Store.emit("community");
      return Promise.resolve();
    }
    Store.save();
    return db.collection("posts").doc(id).delete();
  };

  Store.userPosts = function (uid) {
    if (Store.mode === "local") return Promise.resolve(Store.communityPosts());
    return db.collection("posts").where("uid", "==", uid).get().then(function (snap) {
      return snap.docs.map(function (d) {
        var x = d.data();
        return rawPost(d.id, x);
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  };

  // ---------- Likes & counts ----------
  // Extra likes on top of a post's built-in number.
  Store.extraLikes = function (post) {
    if (Store.mode === "local") return Store.state.liked[post.id] ? 1 : 0;
    if (post.kind === "user") {
      var c = find(community, post.id);
      return c ? Math.max(0, c.likes) : 0;
    }
    return Math.max(0, (stats[post.id] && stats[post.id].likes) || 0);
  };

  Store.replyCount = function (post) {
    if (Store.mode === "local") {
      return Store.state.myComments.filter(function (c) { return c.postId === post.id; }).length;
    }
    if (post.kind === "user") {
      var c = find(community, post.id);
      return c ? Math.max(0, c.replies) : 0;
    }
    return Math.max(0, (stats[post.id] && stats[post.id].replies) || 0);
  };

  Store.repostCount = function (post) {
    if (Store.mode === "local") {
      return Store.state.reposted[post.id] ? 1 : 0;
    }
    if (post.kind === "user") {
      var c = find(community, post.id);
      return c ? Math.max(0, c.reposts || 0) : 0;
    }
    return Math.max(0, (stats[post.id] && stats[post.id].reposts) || 0);
  };

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // Counters live on posts/{id} (people's threads) or postStats/{id} (character threads).
  function collOf(post) { return post.kind === "user" ? "posts" : "postStats"; }
  function now() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function limitsRef() { return db.collection("limits").doc(Store.user.uid); }

  // Adds a ±1 counter change to a batch and updates the numbers shown right away.
  // Returns a function that undoes the local change if the batch fails.
  function bumpIn(batch, post, field, delta) {
    var data = {};
    data[field] = firebase.firestore.FieldValue.increment(delta);
    var local;
    if (post.kind === "user") {
      local = find(community, post.id);
      batch.update(db.collection("posts").doc(post.id), data);
    } else {
      stats[post.id] = stats[post.id] || { likes: 0, replies: 0, reposts: 0 };
      local = stats[post.id];
      batch.set(db.collection("postStats").doc(post.id), data, { merge: true });
    }
    if (local) local[field] = (local[field] || 0) + delta;
    return function () { if (local) local[field] = (local[field] || 0) - delta; Store.emit("stats"); };
  }

  // One likes/{uid}_{postId} record per person per thread; the counter moves with it.
  Store.setLiked = function (post, liked) {
    if (liked) Store.state.liked[post.id] = true;
    else delete Store.state.liked[post.id];
    Store.save();
    if (!isCloud()) return;
    var b = db.batch();
    var rec = db.collection("likes").doc(Store.user.uid + "_" + post.id);
    if (liked) b.set(rec, { uid: Store.user.uid, postId: post.id, coll: collOf(post), createdAt: now() });
    else b.delete(rec);
    var undo = bumpIn(b, post, "likes", liked ? 1 : -1);
    // Fails harmlessly for likes made before like records existed (nothing to remove).
    b.commit().catch(function (e) { console.error(e); undo(); });
  };

  // ---------- Reposts ----------
  Store.setReposted = function (post, on) {
    if (on) Store.state.reposted[post.id] = Date.now();
    else delete Store.state.reposted[post.id];
    Store.save();
    if (!isCloud()) { Store.emit("reposts"); return Promise.resolve(); }
    var uid = Store.user.uid, p = Store.state.profile;
    var b = db.batch();
    var ref = db.collection("reposts").doc(uid + "_" + post.id);
    if (on) b.set(ref, { uid: uid, postId: post.id, coll: collOf(post), name: p.name, handle: p.handle, avatar: p.avatar, createdAt: now() });
    else b.delete(ref);
    var undo = bumpIn(b, post, "reposts", on ? 1 : -1);
    return b.commit().catch(function (e) { console.error(e); undo(); });
  };

  // Everyone's recent reposts (cloud), or just mine (this device).
  Store.repostsFeed = function () {
    if (Store.mode === "cloud") return reposts.slice();
    var p = Store.state.profile;
    return Object.keys(Store.state.reposted).map(function (id) {
      return { uid: "me", postId: id, name: p.name, handle: p.handle, avatar: p.avatar, createdAt: Store.state.reposted[id] };
    }).sort(function (a, b) { return b.createdAt - a.createdAt; });
  };

  // ---------- Comments ----------
  // Everything I've replied, newest first.
  Store.myComments = function () {
    var p = Store.state.profile;
    if (Store.mode === "local") {
      return Promise.resolve(Store.state.myComments.map(function (c) {
        return { id: c.id, postId: c.postId, uid: "me", name: p.name, handle: p.handle, avatar: p.avatar, text: c.text, createdAt: c.ts };
      }).sort(function (a, b) { return b.createdAt - a.createdAt; }));
    }
    if (!Store.user) return Promise.resolve([]);
    return db.collection("comments").where("uid", "==", Store.user.uid).get().then(function (snap) {
      return snap.docs.map(function (d) {
        var x = d.data();
        return { id: d.id, postId: x.postId, uid: x.uid, name: x.name, handle: x.handle, avatar: x.avatar, text: x.text, createdAt: millis(x.createdAt) };
      }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    });
  };

  Store.comments = function (postId) {
    if (Store.mode === "local") {
      var p = Store.state.profile;
      return Promise.resolve(Store.state.myComments.filter(function (c) { return c.postId === postId; }).map(function (c) {
        return { id: c.id, postId: c.postId, uid: "me", name: p.name, handle: p.handle, avatar: p.avatar, text: c.text, createdAt: c.ts };
      }));
    }
    return db.collection("comments").where("postId", "==", postId).get().then(function (snap) {
      return snap.docs.map(function (d) {
        var x = d.data();
        return { id: d.id, postId: x.postId, uid: x.uid, name: x.name, handle: x.handle, avatar: x.avatar, text: x.text, createdAt: millis(x.createdAt) };
      }).sort(function (a, b) { return a.createdAt - b.createdAt; });
    });
  };

  Store.addComment = function (post, text) {
    var p = Store.state.profile;
    if (Store.mode === "local") {
      var c = { id: "c" + Date.now(), postId: post.id, text: text, ts: Date.now() };
      Store.state.myComments.push(c);
      Store.save();
      return Promise.resolve(c.id);
    }
    // At most one reply every 10 seconds; the reply counter moves in the same batch.
    var b = db.batch();
    var ref = db.collection("comments").doc();
    b.set(limitsRef(), { comment: now() }, { merge: true });
    b.set(ref, {
      postId: post.id, coll: collOf(post), uid: Store.user.uid, name: p.name, handle: p.handle, avatar: p.avatar, text: text,
      createdAt: now()
    });
    var undo = bumpIn(b, post, "replies", 1);
    return b.commit().then(function () { return ref.id; }, function (e) { undo(); throw e; });
  };

  Store.deleteComment = function (post, comment) {
    if (Store.mode === "local") {
      Store.state.myComments = Store.state.myComments.filter(function (c) { return c.id !== comment.id; });
      Store.save();
      return Promise.resolve();
    }
    var b = db.batch();
    b.delete(db.collection("comments").doc(comment.id));
    b.set(limitsRef(), { uncomment: now() }, { merge: true });
    var undo = bumpIn(b, post, "replies", -1);
    return b.commit().catch(function (e) { undo(); throw e; });
  };

  // ---------- Reports ----------
  // kind: "post" or "comment". At most one report every 10 seconds.
  Store.report = function (kind, target, postId, reason) {
    if (!isCloud()) return Promise.resolve();
    var b = db.batch();
    b.set(limitsRef(), { report: now() }, { merge: true });
    b.set(db.collection("reports").doc(), {
      uid: Store.user.uid, kind: kind, targetId: target.id, postId: postId, authorUid: String(target.uid || ""),
      reason: reason, text: String(target.text || "").slice(0, 500), createdAt: now()
    });
    return b.commit();
  };

  // ---------- Delete account ----------
  // Removes everything this person wrote or saved, then the sign-in account itself.
  // progress(message) is called as it goes.
  Store.deleteAccount = function (progress) {
    progress = progress || function () {};
    if (!isCloud()) {
      [KEY, SEEN_KEY, PUSH_KEY, LAST_UID_KEY, MERGED_KEY].forEach(removeKey);
      return Promise.resolve();
    }
    var uid = Store.user.uid;
    deleting = true;
    var mine = function (coll) { return db.collection(coll).where("uid", "==", uid).get().then(function (s) { return s.docs; }); };
    var one = function (docs, fn) { return docs.reduce(function (p, d) { return p.then(function () { return fn(d).catch(function (e) { console.error(e); }); }); }, Promise.resolve()); };
    // Likes and reposts: remove each record together with its counter.
    var undoRecord = function (field) {
      return function (d) {
        var x = d.data(), b = db.batch();
        b.delete(d.ref);
        var data = {};
        data[field] = firebase.firestore.FieldValue.increment(-1);
        if (x.coll === "posts") b.update(db.collection("posts").doc(x.postId), data);
        else b.set(db.collection("postStats").doc(x.postId), data, { merge: true });
        return b.commit().catch(function () { return d.ref.delete(); });
      };
    };
    clearTimeout(saveTimer);
    return Store.disablePush()
      .then(function () { progress("Removing your threads…"); return mine("posts"); })
      .then(function (docs) { return one(docs, function (d) { return d.ref.delete(); }); })
      .then(function () { progress("Removing your replies…"); return mine("comments"); })
      .then(function (docs) { return one(docs, function (d) { return d.ref.delete(); }); })
      .then(function () { progress("Removing your likes…"); return mine("likes"); })
      .then(function (docs) { return one(docs, undoRecord("likes")); })
      .then(function () { progress("Removing your reposts…"); return mine("reposts"); })
      .then(function (docs) { return one(docs, undoRecord("reposts")); })
      .then(function () {
        progress("Removing your profile…");
        return Promise.all(["profiles", "pushTokens", "limits", "users"].map(function (c) {
          return db.collection(c).doc(uid).delete().catch(function (e) { console.error(e); });
        }));
      })
      .then(function () {
        progress("Deleting your sign-in…");
        var u = auth.currentUser;
        return u.delete().catch(function (e) {
          if (e && e.code === "auth/requires-recent-login") {
            var provider = new firebase.auth.GoogleAuthProvider();
            return u.reauthenticateWithPopup(provider).then(function () { return u.delete(); });
          }
          throw e;
        });
      })
      .then(function () {
        [KEY, SEEN_KEY, PUSH_KEY, LAST_UID_KEY, MERGED_KEY, CLOUD_CACHE + uid].forEach(removeKey);
      }, function (e) { deleting = false; throw e; });
  };

  // ---------- Public profiles ----------
  // profiles/{uid} holds what other people see: name, handle, bio, avatar or photo.
  // Posts and comments keep a copy of the name/avatar from when they were written;
  // the app shows the latest profile instead whenever it has one.
  var profiles = {};
  var profileRequests = {};
  var profileTimer = null;

  function publicProfile(p) {
    return {
      name: String(p.name || "").slice(0, 40),
      handle: String(p.handle || "").slice(0, 24),
      avatar: String(p.avatar || "🙂").slice(0, 16),
      photo: p.photo || "",
      bio: String(p.bio || "").slice(0, 160),
      target: p.target || 0
    };
  }

  function ensurePublicProfile(uid) {
    db.collection("profiles").doc(uid).get().then(function (snap) {
      if (!snap.exists) return writePublicProfile();
      profiles[uid] = snap.data();
    }).catch(function (e) { console.error(e); });
  }

  function writePublicProfile() {
    if (!isCloud() || deleting) return Promise.resolve();
    var data = publicProfile(Store.state.profile);
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    profiles[Store.user.uid] = data;
    return db.collection("profiles").doc(Store.user.uid).set(data);
  }

  // Latest known profile for a user id, or null (and it starts loading it).
  Store.profileOf = function (uid) {
    if (!uid) return null;
    if (uid === Store.myUid()) return Store.state.profile;
    if (profiles[uid]) return profiles[uid];
    if (Store.mode === "cloud" && db && !profileRequests[uid]) {
      profileRequests[uid] = true;
      db.collection("profiles").doc(uid).get().then(function (snap) {
        if (!snap.exists) return;
        profiles[uid] = snap.data();
        clearTimeout(profileTimer);
        profileTimer = setTimeout(function () { Store.emit("profiles"); }, 80);
      }).catch(function () { /* keep the copy stored on the post */ });
    }
    return null;
  };

  Store.saveProfile = function (p) {
    Store.state.profile = Object.assign({}, Store.state.profile, p);
    Store.save();
    return writePublicProfile();
  };

  // ---------- Push notifications (Firebase Cloud Messaging) ----------
  var PUSH_KEY = "toeflThreads.push";
  var messaging = null;

  Store.pushInfo = function () {
    var info = readJSON(PUSH_KEY) || { enabled: false, prefs: { replies: true, likes: true, review: true } };
    info.prefs = info.prefs || {};
    if (info.prefs.review === undefined) info.prefs.review = true;
    return info;
  };

  // "unsupported" | "ios-needs-install" | "needs-setup" | "needs-signin" | "denied" | "ready"
  Store.pushStatus = function () {
    var ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (ios && !standalone) return "ios-needs-install";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    if (Store.mode !== "cloud" || !window.FIREBASE_VAPID_KEY) return "needs-setup";
    if (!Store.user) return "needs-signin";
    if (Notification.permission === "denied") return "denied";
    return "ready";
  };

  function getMessaging() {
    if (messaging) return Promise.resolve(messaging);
    var load = firebase.messaging ? Promise.resolve() : loadScript(SDK + "firebase-messaging-compat.js");
    return load.then(function () {
      messaging = firebase.messaging();
      messaging.onMessage(function (payload) {
        var n = payload.notification || {};
        Store.emit({ type: "push", title: n.title, body: n.body, link: (payload.fcmOptions || {}).link });
      });
      return messaging;
    });
  }

  // An error that says which step failed: permission / sw / token / save.
  function pushError(stage, e) {
    var err = new Error(stage);
    err.stage = stage;
    err.detail = e ? String(e.code || e.name || "") + (e.message ? ": " + e.message : "") : "";
    return err;
  }

  function swReady() {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("Service worker not ready (timed out)")); }, 10000);
      navigator.serviceWorker.ready.then(function (reg) { clearTimeout(timer); resolve(reg); }, reject);
    });
  }

  function currentToken() {
    var reg;
    return swReady().catch(function (e) { throw pushError("sw", e); })
      .then(function (r) { reg = r; return getMessaging(); })
      .then(function (m) {
        var get = function () { return m.getToken({ vapidKey: window.FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg }); };
        return get().catch(function () {
          // Chrome keeps an old push subscription after a domain or key change, and FCM then
          // fails with "push service error". Drop the old subscription and try once more.
          return reg.pushManager.getSubscription()
            .then(function (sub) { return sub && sub.unsubscribe(); })
            .then(get);
        });
      })
      .catch(function (e) { throw e && e.stage ? e : pushError("token", e); });
  }

  function writeTokenDoc(token, prefs) {
    var FV = firebase.firestore.FieldValue;
    return db.collection("pushTokens").doc(Store.user.uid).set({
      tokens: FV.arrayUnion(token),
      prefs: prefs,
      tz: -new Date().getTimezoneOffset(),
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
  }

  // Turns notifications on. Only marks them "on" here once the token is saved to the account.
  // Rejects with err.stage = "permission" | "sw" | "token" | "save" and err.detail.
  Store.enablePush = function (prefs) {
    if (Store.pushStatus() !== "ready") return Promise.reject(pushError(Store.pushStatus()));
    var token;
    return Promise.resolve(Notification.requestPermission()).then(function (perm) {
      if (perm !== "granted") throw pushError("permission", { message: "Notification permission: " + perm });
      return currentToken();
    }).then(function (t) {
      if (!t) throw pushError("token", { message: "No token returned" });
      token = t;
      return writeTokenDoc(token, prefs).catch(function (e) { throw pushError("save", e); });
    }).then(function () {
      writeJSON(PUSH_KEY, { enabled: true, token: token, prefs: prefs, uid: Store.user.uid, error: null });
    }, function (e) {
      var info = Store.pushInfo();
      writeJSON(PUSH_KEY, { enabled: false, prefs: info.prefs || prefs, error: { stage: e.stage || "token", detail: e.detail || String(e.message || e), at: Date.now() } });
      throw e;
    });
  };

  // Shows a notification on this device right away (no server involved).
  Store.testNotification = function () {
    return swReady().then(function (reg) {
      return reg.showNotification("Notifications are on 🎉", {
        body: "You'll hear from toEfu when someone replies to your thread.",
        icon: "icon-192.png", badge: "icon-192.png", tag: "toefu-test", data: { link: "./" }
      });
    });
  };

  Store.updatePushPrefs = function (prefs) {
    var info = Store.pushInfo();
    info.prefs = prefs;
    writeJSON(PUSH_KEY, info);
    if (!info.enabled || !isCloud()) return Promise.resolve();
    return db.collection("pushTokens").doc(Store.user.uid).set({ prefs: prefs, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  };

  Store.disablePush = function () {
    var info = Store.pushInfo();
    writeJSON(PUSH_KEY, { enabled: false, prefs: info.prefs });
    if (!isCloud() || !info.token) return Promise.resolve();
    return db.collection("pushTokens").doc(Store.user.uid).set({ tokens: firebase.firestore.FieldValue.arrayRemove(info.token) }, { merge: true })
      .then(function () { return getMessaging(); })
      .then(function (m) { return m.deleteToken(); })
      .catch(function (e) { console.error(e); });
  };

  // Tokens can change; refresh it quietly on start when notifications are on.
  Store.refreshPush = function () {
    var info = Store.pushInfo();
    if (!info.enabled || Store.pushStatus() !== "ready" || Notification.permission !== "granted") return;
    currentToken().then(function (token) {
      if (!token) return;
      if (token !== info.token || info.uid !== Store.user.uid) {
        info.token = token;
        info.uid = Store.user.uid;
        writeJSON(PUSH_KEY, info);
      }
      return writeTokenDoc(token, info.prefs);
    }).catch(function (e) { console.error(e); });
  };

  window.Store = Store;
})();
