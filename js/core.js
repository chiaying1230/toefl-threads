// Pure helpers shared by the store and the UI: text rendering, word detection,
// post normalization, quiz generation and daily-goal math. No DOM access here.
(function () {
  "use strict";

  var VOCAB = window.VOCAB;
  var CHARACTERS = window.CHARACTERS;
  var TAG = /\[\[([a-z]+)(?:\|([^\]]+))?\]\]/g;
  var LEVEL_NAMES = { 1: "Easy", 2: "Medium", 3: "Hard" };
  var LANG_NAMES = { en: "English", mix: "Mixed" };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Small deterministic hash so fake numbers and picks are stable across reloads/users.
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rand) {
    rand = rand || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function formatAge(minutes) {
    if (minutes < 1) return "now";
    if (minutes < 60) return Math.floor(minutes) + "m";
    if (minutes < 1440) return Math.floor(minutes / 60) + "h";
    if (minutes < 10080) return Math.floor(minutes / 1440) + "d";
    return Math.floor(minutes / 10080) + "w";
  }

  function timeAgo(ts) {
    return formatAge((Date.now() - ts) / 60000);
  }

  // Easy if the average word level <= 1.5, Hard if >= 2.5, otherwise Medium.
  function levelOf(keys) {
    if (!keys.length) return 0;
    var sum = keys.reduce(function (acc, k) { return acc + VOCAB[k].level; }, 0);
    var avg = sum / keys.length;
    return avg <= 1.5 ? 1 : avg >= 2.5 ? 3 : 2;
  }

  function tagsIn(text) {
    var keys = [];
    text.replace(TAG, function (_, key) {
      if (VOCAB[key] && keys.indexOf(key) < 0) keys.push(key);
    });
    return keys;
  }

  // Map every recognizable word form (plural, past tense, -ing…) to its vocab key,
  // so words typed by users can be detected.
  var FORM_INDEX = (function () {
    var idx = {};
    function add(form, key) { if (!idx[form]) idx[form] = key; }
    Object.keys(VOCAB).forEach(function (k) {
      [k, k + "s", k + "es", k + "d", k + "ed", k + "ing", k + "ly"].forEach(function (f) { add(f, k); });
      if (/e$/.test(k)) {
        var stem = k.slice(0, -1);
        [stem + "ing", stem + "y", stem + "ation"].forEach(function (f) { add(f, k); });
      }
      if (/y$/.test(k)) {
        var ystem = k.slice(0, -1);
        [ystem + "ies", ystem + "ied", ystem + "ily"].forEach(function (f) { add(f, k); });
      }
    });
    function collect(text) {
      text.replace(TAG, function (_, key, shown) {
        if (shown && VOCAB[key]) idx[shown.toLowerCase()] = key;
      });
    }
    window.POSTS.forEach(function (p) { collect(p.text); });
    Object.keys(CHARACTERS).forEach(function (c) { CHARACTERS[c].replies.forEach(collect); });
    return idx;
  })();

  function detectWords(text) {
    var found = [];
    (String(text).match(/[A-Za-z]+/g) || []).forEach(function (w) {
      var key = FORM_INDEX[w.toLowerCase()];
      if (key && found.indexOf(key) < 0) found.push(key);
    });
    return found;
  }

  function vocabButton(key, shown, savedWords) {
    var cls = "vocab" + (savedWords && savedWords[key] ? " saved" : "");
    return '<button class="' + cls + '" data-key="' + key + '">' + escapeHtml(shown) + "</button>";
  }

  // Text written by us, with [[key|shown]] tags.
  function renderTagged(text, savedWords) {
    return escapeHtml(text).replace(TAG, function (_, key, shown) {
      return VOCAB[key] ? vocabButton(key, shown || key, savedWords) : escapeHtml(shown || key);
    });
  }

  // Text typed by users: any known word form becomes tappable.
  function renderFree(text, savedWords) {
    return escapeHtml(text).replace(/[A-Za-z]+/g, function (w) {
      var key = FORM_INDEX[w.toLowerCase()];
      return key ? vocabButton(key, w, savedWords) : w;
    });
  }

  // ---------- Posts ----------
  var BUILTIN = window.POSTS.map(function (p, i) {
    var words = tagsIn(p.text);
    var h = hash(p.id);
    return {
      id: p.id,
      kind: "char",
      authorKey: p.author,
      text: p.text,
      zh: p.zh,
      topic: p.topic,
      words: words,
      level: levelOf(words),
      baseLikes: p.likes || 300 + (h % 4200),
      order: i,
      ageMinutes: Math.round(2 + 25 * Math.pow(i, 1.3))
    };
  });
  var BUILTIN_BY_ID = {};
  BUILTIN.forEach(function (p) { BUILTIN_BY_ID[p.id] = p; });

  // A post written by a real user (local or from the cloud).
  function userPost(raw) {
    var words = detectWords(raw.text);
    return {
      id: raw.id,
      kind: "user",
      authorKey: "uid:" + raw.uid,
      uid: raw.uid,
      author: { name: raw.name, handle: raw.handle, avatar: raw.avatar },
      text: raw.text,
      words: words,
      level: levelOf(words),
      baseLikes: 0,
      ts: raw.createdAt || Date.now()
    };
  }

  function authorOf(post) {
    if (post.kind === "char") {
      var c = CHARACTERS[post.authorKey];
      return { key: post.authorKey, name: c.name, handle: c.handle, avatar: c.avatar, color: c.color, lang: c.lang };
    }
    return { key: post.authorKey, name: post.author.name, handle: post.author.handle, avatar: post.author.avatar, color: null, lang: null };
  }

  function characterReply(charKey, commentId, userName) {
    var list = CHARACTERS[charKey].replies;
    return list[hash(commentId) % list.length].replace(/\{name\}/g, userName || "friend");
  }

  // ---------- Feed ranking ----------
  function rankForYou(state, seen, seed) {
    var rand = mulberry(seed);
    var prefs = state.prefs || {};
    var topics = prefs.topics || [];
    var levels = prefs.levels || [1, 2, 3];
    var following = state.following || {};
    return BUILTIN.map(function (p) {
      var s = rand() * 1.3;
      if (topics.indexOf(p.topic) >= 0) s += 1.2;
      s += levels.indexOf(p.level) >= 0 ? 1 : -0.6;
      if (following[p.authorKey]) s += 0.8;
      if (seen[p.id]) s -= 1.5;
      return { p: p, s: s };
    }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.p; });
  }

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Quiz ----------
  // Blank out the word (any inflection) inside its example sentence.
  function blankSentence(key) {
    var ex = VOCAB[key].ex;
    var stem = key.length > 5 ? key.slice(0, key.length - 2) : key;
    var re = new RegExp("\\b" + stem + "[a-z]*", "i");
    if (!re.test(ex)) return null;
    return ex.replace(re, "_____");
  }

  function makeQuiz(pool, rand) {
    rand = rand || Math.random;
    var key = pool[Math.floor(rand() * pool.length)];
    var v = VOCAB[key];
    var sameLevel = Object.keys(VOCAB).filter(function (k) { return k !== key && VOCAB[k].level === v.level; });
    var distractors = shuffle(sameLevel, rand).slice(0, 3);
    var blank = rand() < 0.5 ? blankSentence(key) : null;
    var options = shuffle([key].concat(distractors), rand);
    if (blank) {
      return { key: key, type: "blank", prompt: blank, hint: v.exZh, options: options.map(function (k) { return { value: k, label: k }; }) };
    }
    return { key: key, type: "meaning", prompt: key, hint: v.pos, options: options.map(function (k) { return { value: k, label: VOCAB[k].zh }; }) };
  }

  // ---------- Daily goal ----------
  function dayKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }

  // Consecutive days (ending today, or yesterday if today isn't done yet) where the goal was met.
  function streakOf(daily, now) {
    now = now || new Date();
    var met = (daily && daily.met) || {};
    var d = met[dayKey(now)] ? now : addDays(now, -1);
    var n = 0;
    while (met[dayKey(d)]) { n++; d = addDays(d, -1); }
    return n;
  }

  function lastDays(daily, count, now) {
    now = now || new Date();
    var log = (daily && daily.log) || {};
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var d = addDays(now, -i);
      out.push({ key: dayKey(d), label: "SMTWTFS"[d.getDay()], value: log[dayKey(d)] || 0 });
    }
    return out;
  }

  window.Core = {
    TAG: TAG,
    LEVEL_NAMES: LEVEL_NAMES,
    LANG_NAMES: LANG_NAMES,
    BUILTIN: BUILTIN,
    BUILTIN_BY_ID: BUILTIN_BY_ID,
    escapeHtml: escapeHtml,
    hash: hash,
    shuffle: shuffle,
    formatCount: formatCount,
    formatAge: formatAge,
    timeAgo: timeAgo,
    levelOf: levelOf,
    detectWords: detectWords,
    renderTagged: renderTagged,
    renderFree: renderFree,
    userPost: userPost,
    authorOf: authorOf,
    characterReply: characterReply,
    rankForYou: rankForYou,
    makeQuiz: makeQuiz,
    blankSentence: blankSentence,
    dayKey: dayKey,
    streakOf: streakOf,
    lastDays: lastDays
  };
})();
