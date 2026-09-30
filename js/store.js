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
  var SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  var SYNCED_FIELDS = ["liked", "bookmarked", "words", "profile", "prefs", "following", "daily"];

  function freshState() {
    return {
      liked: {},
      bookmarked: {},
      words: {},
      profile: { name: "You", handle: "toefl_learner", avatar: "🙂" },
      prefs: { levels: [1, 2, 3], topics: [], onboarded: false },
      following: {},
      daily: { goal: 10, log: {}, met: {} },
      myPosts: [],     // local mode only: { id, text, ts }
      myComments: []   // local mode only: { id, postId, text, ts }
    };
  }

  function withDefaults(s) {
    var base = freshState();
    Object.keys(base).forEach(function (k) {
      if (s && s[k] !== undefined && s[k] !== null) base[k] = s[k];
    });
    base.daily.log = base.daily.log || {};
    base.daily.met = base.daily.met || {};
    base.daily.goal = base.daily.goal || 10;
    return base;
  }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
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
      st.prefs.onboarded = false;
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
    ["liked", "bookmarked", "words", "following"].forEach(function (k) { s[k] = unionMap(guest[k], s[k]); });
    Object.keys(guest.daily.log).forEach(function (d) {
      s.daily.log[d] = Math.max(s.daily.log[d] || 0, guest.daily.log[d]);
    });
    s.daily.met = unionMap(guest.daily.met, s.daily.met);
    if (!s.prefs.onboarded && guest.prefs.onboarded) s.prefs = guest.prefs;
    return s;
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
  var stats = {};         // postId -> { likes, replies } (cloud extras for built-in posts)
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

  // ---------- Persistence ----------
  Store.save = function () {
    if (isCloud()) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(pushUserDoc, 600);
    } else {
      writeJSON(KEY, Store.state);
    }
  };

  function pushUserDoc() {
    if (!isCloud()) return;
    var doc = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    SYNCED_FIELDS.forEach(function (k) { doc[k] = Store.state[k]; });
    db.collection("users").doc(Store.user.uid).set(doc).catch(function (e) {
      console.error(e);
      Store.emit("error:save");
    });
  }

  var seenTimer = null;
  Store.markSeen = function (id) {
    if (Store.seen[id]) return;
    Store.seen[id] = 1;
    clearTimeout(seenTimer);
    seenTimer = setTimeout(function () { writeJSON(SEEN_KEY, Store.seen); }, 1000);
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
        return Promise.all([loadScript(SDK + "firebase-auth-compat.js"), loadScript(SDK + "firebase-firestore-compat.js")]);
      })
      .then(function () {
        firebase.initializeApp(cfg);
        auth = firebase.auth();
        db = firebase.firestore();
        Store.mode = "cloud";
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

  function subscribeShared() {
    unsubscribers.push(db.collection("posts").orderBy("createdAt", "desc").limit(300).onSnapshot(function (snap) {
      community = snap.docs.map(function (d) {
        var x = d.data();
        return { id: d.id, uid: x.uid, name: x.name, handle: x.handle, avatar: x.avatar, text: x.text, createdAt: millis(x.createdAt), likes: x.likes || 0, replies: x.replies || 0 };
      });
      Store.emit("community");
    }, function (e) { console.error(e); }));
    unsubscribers.push(db.collection("postStats").onSnapshot(function (snap) {
      stats = {};
      snap.docs.forEach(function (d) { stats[d.id] = d.data(); });
      Store.emit("stats");
    }, function (e) { console.error(e); }));
  }

  function handleAuth(u) {
    if (!u) {
      Store.user = null;
      Store.state = guest;
      return Promise.resolve();
    }
    Store.user = { uid: u.uid, name: u.displayName || "TOEFL learner", photo: u.photoURL };
    var ref = db.collection("users").doc(u.uid);
    return ref.get().then(function (snap) {
      var alreadyMerged = readJSON(MERGED_KEY) === u.uid;
      var cloudState = snap.exists ? snap.data() : null;
      var s;
      if (!cloudState) {
        s = withDefaults(guest);
        s.profile = {
          name: u.displayName || guest.profile.name,
          handle: (u.displayName || "toefl_learner").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24) || "toefl_learner",
          avatar: guest.profile.avatar
        };
      } else {
        s = alreadyMerged ? withDefaults(cloudState) : mergeInto(cloudState, guest);
      }
      s.myPosts = [];
      s.myComments = [];
      Store.state = s;
      Store.pendingLocalPosts = alreadyMerged ? [] : guest.myPosts.slice();
      writeJSON(MERGED_KEY, u.uid);
      if (!snap.exists || !alreadyMerged) pushUserDoc();
    }).catch(function (e) {
      console.error(e);
      Store.state = guest;
      Store.user = null;
      Store.emit("error:signin");
    });
  }

  Store.signIn = function () {
    if (!auth) return Promise.reject(new Error("not configured"));
    var provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).catch(function (e) {
      if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
        return auth.signInWithRedirect(provider);
      }
      throw e;
    });
  };

  Store.signOut = function () {
    return auth ? auth.signOut() : Promise.resolve();
  };

  // Posting and replying need an account once the cloud is set up.
  Store.canWrite = function () { return Store.mode === "local" || !!Store.user; };

  // ---------- Community posts ----------
  Store.communityPosts = function () {
    if (Store.mode === "cloud") return community.slice();
    var p = Store.state.profile;
    return Store.state.myPosts.map(function (m) {
      return { id: m.id, uid: "me", name: p.name, handle: p.handle, avatar: p.avatar, text: m.text, createdAt: m.ts, likes: 0, replies: 0 };
    });
  };

  Store.myUid = function () {
    if (Store.mode === "local") return "me";
    return Store.user ? Store.user.uid : null;
  };

  Store.createPost = function (text) {
    var p = Store.state.profile;
    if (!isCloud()) {
      Store.state.myPosts.unshift({ id: "me" + Date.now(), text: text, ts: Date.now() });
      Store.save();
      Store.emit("community");
      return Promise.resolve();
    }
    return db.collection("posts").add({
      uid: Store.user.uid, name: p.name, handle: p.handle, avatar: p.avatar, text: text,
      likes: 0, replies: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
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
        return { id: d.id, uid: x.uid, name: x.name, handle: x.handle, avatar: x.avatar, text: x.text, createdAt: millis(x.createdAt), likes: x.likes || 0, replies: x.replies || 0 };
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

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function bump(post, field, delta) {
    if (post.kind === "user") {
      var c = find(community, post.id);
      if (c) c[field] = (c[field] || 0) + delta;
      var upd = {};
      upd[field] = firebase.firestore.FieldValue.increment(delta);
      return db.collection("posts").doc(post.id).update(upd);
    }
    stats[post.id] = stats[post.id] || { likes: 0, replies: 0 };
    stats[post.id][field] = (stats[post.id][field] || 0) + delta;
    var data = {};
    data[field] = firebase.firestore.FieldValue.increment(delta);
    return db.collection("postStats").doc(post.id).set(data, { merge: true });
  }

  Store.setLiked = function (post, liked) {
    if (liked) Store.state.liked[post.id] = true;
    else delete Store.state.liked[post.id];
    Store.save();
    if (isCloud()) bump(post, "likes", liked ? 1 : -1).catch(function (e) { console.error(e); });
  };

  // ---------- Comments ----------
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
    return db.collection("comments").add({
      postId: post.id, uid: Store.user.uid, name: p.name, handle: p.handle, avatar: p.avatar, text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function (ref) {
      return bump(post, "replies", 1).then(function () { return ref.id; });
    });
  };

  Store.deleteComment = function (post, comment) {
    if (Store.mode === "local") {
      Store.state.myComments = Store.state.myComments.filter(function (c) { return c.id !== comment.id; });
      Store.save();
      return Promise.resolve();
    }
    return db.collection("comments").doc(comment.id).delete().then(function () { return bump(post, "replies", -1); });
  };

  window.Store = Store;
})();
