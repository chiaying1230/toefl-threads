(function () {
  "use strict";

  var VOCAB = window.VOCAB;
  var POSTS = window.POSTS;
  var CHARACTERS = window.CHARACTERS;
  var LEVEL_NAMES = { 1: "Easy", 2: "Medium", 3: "Hard" };
  var LANG_NAMES = { en: "English", mix: "Mixed" };
  var AVATARS = ["🙂", "😎", "🦊", "🐼", "🐯", "🐸", "🦄", "🐙", "🌸", "🍀", "🔥", "📚"];
  var STORE_KEY = "vocabThreads.v1";
  var WORD_TAG = /\[\[([a-z]+)(?:\|([^\]]+))?\]\]/g;

  // ---------- State ----------
  var state = loadState();

  function loadState() {
    var base = {
      liked: {},        // postId -> true
      bookmarked: {},   // postId -> true
      words: {},        // vocab key -> { addedAt, from }
      myPosts: [],      // { id, text, ts }
      profile: { name: "You", handle: "toefl_learner", avatar: "🙂" },
      filter: { level: "all", lang: "all" }
    };
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved) {
        Object.keys(base).forEach(function (k) {
          if (saved[k] !== undefined) base[k] = saved[k];
        });
      }
    } catch (e) { /* storage unavailable: start fresh */ }
    return base;
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- Helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function formatCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function timeAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  function wordsInPost(post) {
    var keys = [];
    post.text.replace(WORD_TAG, function (_, key) {
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    return keys;
  }

  // Easy if average word level <= 1.5, Hard if >= 2.5, otherwise Medium.
  function levelOf(keys) {
    if (!keys.length) return 0;
    var sum = keys.reduce(function (acc, k) { return acc + VOCAB[k].level; }, 0);
    var avg = sum / keys.length;
    return avg <= 1.5 ? 1 : avg >= 2.5 ? 3 : 2;
  }

  POSTS.forEach(function (p) {
    p.words = wordsInPost(p);
    p.level = levelOf(p.words);
  });

  // Map every recognizable word form (plural, past tense, -ing…) to its vocab key,
  // so words in the user's own posts can be detected.
  var FORM_INDEX = (function () {
    var idx = {};
    Object.keys(VOCAB).forEach(function (k) {
      var forms = [k, k + "s", k + "es", k + "d", k + "ed", k + "ing", k + "ly"];
      if (/e$/.test(k)) {
        var stem = k.slice(0, -1);
        forms.push(stem + "ing", stem + "y", stem + "ation");
      }
      if (/y$/.test(k)) {
        var ystem = k.slice(0, -1);
        forms.push(ystem + "ies", ystem + "ied");
      }
      forms.forEach(function (f) { if (!idx[f]) idx[f] = k; });
    });
    POSTS.forEach(function (p) {
      p.text.replace(WORD_TAG, function (_, key, shown) {
        if (shown) idx[shown.toLowerCase()] = key;
      });
    });
    return idx;
  })();

  function detectWords(text) {
    var found = [];
    (text.match(/[A-Za-z]+/g) || []).forEach(function (w) {
      var key = FORM_INDEX[w.toLowerCase()];
      if (key && found.indexOf(key) < 0) found.push(key);
    });
    return found;
  }

  function vocabButton(key, shown) {
    var cls = "vocab" + (state.words[key] ? " saved" : "");
    return '<button class="' + cls + '" data-key="' + key + '">' + escapeHtml(shown) + "</button>";
  }

  function renderPostText(post) {
    if (post.mine) {
      return escapeHtml(post.text).replace(/[A-Za-z]+/g, function (w) {
        var key = FORM_INDEX[w.toLowerCase()];
        return key ? vocabButton(key, w) : w;
      });
    }
    return escapeHtml(post.text).replace(WORD_TAG, function (_, key, shown) {
      return vocabButton(key, shown || key);
    });
  }

  // ---------- Icons ----------
  var ICON = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg>'
  };

  // ---------- Feed ----------
  function myPostObjects() {
    return state.myPosts.map(function (p) {
      var words = detectWords(p.text);
      return { id: p.id, text: p.text, ts: p.ts, mine: true, words: words, level: levelOf(words), likes: 0, replies: 0 };
    });
  }

  function renderPost(post) {
    var author = post.mine
      ? { name: state.profile.name, handle: state.profile.handle, avatar: state.profile.avatar, color: "var(--bg-soft)", lang: null }
      : CHARACTERS[post.author];
    var liked = !!state.liked[post.id];
    var bookmarked = !!state.bookmarked[post.id];
    var likeCount = post.likes + (liked ? 1 : 0);

    var tags = "";
    if (post.level) tags += '<span class="level-tag lv' + post.level + '">' + LEVEL_NAMES[post.level] + "</span>";
    if (author.lang) tags += '<span class="tag">' + LANG_NAMES[author.lang] + "</span>";
    if (post.topic) tags += '<span class="tag">#' + escapeHtml(post.topic) + "</span>";
    if (post.mine) tags += '<span class="tag">Your thread</span>';

    var extra = "";
    if (post.zh) {
      extra = '<button class="translate-btn" data-translate="' + post.id + '">Translate</button>' +
        '<div class="translation" hidden>' + escapeHtml(post.zh) + "</div>";
    }
    if (post.mine && post.words.length) {
      extra = '<div class="used-words">You used ' + post.words.length + " TOEFL word" + (post.words.length > 1 ? "s" : "") + " 🎉</div>";
    }

    var lastBtn = post.mine
      ? '<button class="act" data-delete="' + post.id + '" aria-label="Delete">' + ICON.trash + "</button>"
      : '<button class="act' + (bookmarked ? " bookmarked" : "") + '" data-bookmark="' + post.id + '" aria-label="Save">' + ICON.bookmark + "</button>";

    return '<article class="post" id="post-' + post.id + '">' +
      '<div class="post-left"><div class="avatar" style="background:' + author.color + '">' + author.avatar + '</div><div class="thread-line"></div></div>' +
      '<div class="post-main">' +
        '<div class="post-head"><span class="post-name">' + escapeHtml(author.name) + '</span>' +
          '<span class="post-handle">@' + escapeHtml(author.handle) + '</span>' +
          '<span class="post-time">· ' + (post.mine ? timeAgo(post.ts) : post.time) + "</span></div>" +
        '<div class="post-tags">' + tags + "</div>" +
        '<div class="post-text">' + renderPostText(post) + "</div>" +
        extra +
        '<div class="actions">' +
          '<button class="act' + (liked ? " liked" : "") + '" data-like="' + post.id + '" aria-label="Like">' + ICON.heart + '<span class="act-count">' + (likeCount ? formatCount(likeCount) : "") + "</span></button>" +
          '<button class="act" data-soon="Replies" aria-label="Reply">' + ICON.reply + '<span class="act-count">' + (post.replies ? formatCount(post.replies) : "") + "</span></button>" +
          '<button class="act" data-soon="Reposts" aria-label="Repost">' + ICON.repost + "</button>" +
          lastBtn +
        "</div>" +
      "</div>" +
    "</article>";
  }

  function visiblePosts() {
    var f = state.filter;
    return POSTS.filter(function (p) {
      if (f.level !== "all" && String(p.level) !== f.level) return false;
      if (f.lang !== "all" && CHARACTERS[p.author].lang !== f.lang) return false;
      return true;
    });
  }

  function renderFeed() {
    var html = myPostObjects().map(renderPost).join("");
    var posts = visiblePosts();
    html += posts.map(renderPost).join("");
    if (!posts.length) {
      html += '<div class="empty"><span class="big">🔍</span>No threads match these filters.</div>';
    }
    $("#feed").innerHTML = html;
    $all("#levelFilter .chip").forEach(function (c) { c.classList.toggle("active", c.dataset.level === state.filter.level); });
    $all("#langFilter .chip").forEach(function (c) { c.classList.toggle("active", c.dataset.lang === state.filter.lang); });
    $("#promptAvatar").textContent = state.profile.avatar;
  }

  function findPost(id) {
    for (var i = 0; i < POSTS.length; i++) if (POSTS[i].id === id) return POSTS[i];
    return null;
  }

  // ---------- Saved words ----------
  function addWord(key, from) {
    if (state.words[key]) return false;
    state.words[key] = { addedAt: Date.now(), from: from || null };
    return true;
  }

  function removeWord(key) {
    delete state.words[key];
  }

  function refreshWordMarks() {
    $all(".vocab").forEach(function (el) {
      el.classList.toggle("saved", !!state.words[el.dataset.key]);
    });
    var n = Object.keys(state.words).length;
    var badge = $("#reviewBadge");
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? "99+" : n;
  }

  // ---------- Word sheet ----------
  var sheetKey = null;
  var sheetFrom = null;

  function openSheet(key, from) {
    var v = VOCAB[key];
    if (!v) return;
    sheetKey = key;
    sheetFrom = from;
    $("#sheetWord").textContent = key;
    $("#sheetPos").textContent = v.pos;
    var lv = $("#sheetLevel");
    lv.className = "level-tag lv" + v.level;
    lv.textContent = LEVEL_NAMES[v.level];
    $("#sheetZh").textContent = v.zh;
    var exHtml = escapeHtml(v.ex).replace(new RegExp("\\b(" + key.slice(0, Math.max(4, key.length - 2)) + "[a-z]*)", "i"), "<strong>$1</strong>");
    $("#sheetEx").innerHTML = exHtml;
    $("#sheetExZh").textContent = v.exZh;
    updateSheetButton();
    $("#sheetOverlay").hidden = false;
    $("#wordSheet").hidden = false;
  }

  function updateSheetButton() {
    var btn = $("#sheetSave");
    var saved = !!state.words[sheetKey];
    btn.textContent = saved ? "✓ In your Review list (tap to remove)" : "+ Add to Review";
    btn.classList.toggle("done", saved);
  }

  function closeSheet() {
    $("#sheetOverlay").hidden = true;
    $("#wordSheet").hidden = true;
    sheetKey = null;
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) { toast("Speech isn't supported on this browser"); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(msg) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  // ---------- Views ----------
  var currentView = "home";
  var homeScroll = 0;
  var TITLES = { home: "Vocab Threads", review: "Review", profile: "Profile" };

  function showView(name) {
    if (currentView === "home") homeScroll = window.scrollY;
    currentView = name;
    ["home", "review", "profile"].forEach(function (v) {
      $("#view-" + v).hidden = v !== name;
    });
    $all(".tab[data-view]").forEach(function (t) { t.classList.toggle("active", t.dataset.view === name); });
    $("#topbarTitle").textContent = TITLES[name];
    if (name === "review") renderReview();
    if (name === "profile") renderProfile();
    window.scrollTo(0, name === "home" ? homeScroll : 0);
  }

  function goToPost(id) {
    var post = findPost(id);
    if (post && visiblePosts().indexOf(post) < 0) {
      state.filter = { level: "all", lang: "all" };
      saveState();
      renderFeed();
    }
    showView("home");
    var el = $("#post-" + id);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
  }

  // ---------- Review ----------
  var reviewMode = "list";
  var openWord = null;
  var deck = [];
  var deckIndex = 0;
  var flipped = false;
  var knownCount = 0;

  function savedKeys() {
    return Object.keys(state.words).sort(function (a, b) {
      return state.words[b].addedAt - state.words[a].addedAt;
    });
  }

  function renderReview() {
    $all(".seg").forEach(function (s) { s.classList.toggle("active", s.dataset.mode === reviewMode); });
    var keys = savedKeys();
    var body = $("#reviewBody");
    if (!keys.length) {
      body.innerHTML = '<div class="empty"><span class="big">📚</span>' +
        "Your Review list is empty.<br>Tap a <b>blue word</b> in any thread and choose <b>Add to Review</b>,<br>or tap the bookmark on a thread to save all its words.</div>";
      return;
    }
    if (reviewMode === "list") renderWordList(keys, body);
    else renderFlashcards(body);
  }

  function renderWordList(keys, body) {
    var counts = { 1: 0, 2: 0, 3: 0 };
    keys.forEach(function (k) { counts[VOCAB[k].level]++; });
    var html = '<div class="review-summary">' + keys.length + " word" + (keys.length > 1 ? "s" : "") +
      " · Easy " + counts[1] + " · Medium " + counts[2] + " · Hard " + counts[3] + "</div>";
    keys.forEach(function (k) {
      var v = VOCAB[k];
      var from = state.words[k].from;
      html += '<div class="word-item">' +
        '<button class="word-row" data-toggle-word="' + k + '">' +
          '<span class="w">' + k + "</span>" +
          '<span class="z">' + escapeHtml(v.pos + " " + v.zh) + "</span>" +
          '<span class="level-tag lv' + v.level + '">' + LEVEL_NAMES[v.level] + "</span>" +
        "</button>";
      if (openWord === k) {
        html += '<div class="word-detail">' +
          "<p>" + escapeHtml(v.ex) + "</p>" +
          '<p class="muted">' + escapeHtml(v.exZh) + "</p>" +
          '<div class="row-actions">' +
            '<button class="link" data-speak="' + k + '">🔊 Listen</button>' +
            (from && findPost(from) ? '<button class="link" data-goto="' + from + '">See thread</button>' : "") +
            '<button class="link danger" data-remove-word="' + k + '">Remove</button>' +
          "</div></div>";
      }
      html += "</div>";
    });
    body.innerHTML = html;
  }

  function startDeck() {
    deck = shuffle(savedKeys());
    deckIndex = 0;
    flipped = false;
    knownCount = 0;
  }

  function renderFlashcards(body) {
    // Drop cards whose word was removed from the list meanwhile.
    deck = deck.filter(function (k) { return state.words[k]; });
    if (!deck.length && !knownCount) startDeck();
    if (deckIndex >= deck.length) {
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard"><div class="fw">🎉</div>' +
        '<div class="fzh">Nice work!</div><div class="fex">You reviewed ' + knownCount + " word" + (knownCount === 1 ? "" : "s") + ".</div></div>" +
        '<div class="flash-buttons"><button class="btn-got" data-restart>Start again</button></div></div>';
      return;
    }
    var k = deck[deckIndex];
    var v = VOCAB[k];
    var card = flipped
      ? '<div class="fw">' + k + '</div><div class="fpos">' + v.pos + '</div><div class="fzh">' + escapeHtml(v.zh) + "</div>" +
        '<div class="fex">' + escapeHtml(v.ex) + '</div><div class="fexzh">' + escapeHtml(v.exZh) + "</div>"
      : '<div class="fw">' + k + '</div><div class="fpos">' + v.pos + '</div><div class="fhint">Tap to reveal the meaning</div>';
    body.innerHTML = '<div class="flash-wrap">' +
      '<div class="flash-progress">Card ' + (deckIndex + 1) + " of " + deck.length + " · " + knownCount + " known</div>" +
      '<button class="flashcard' + (flipped ? " flip" : "") + '" data-flip>' + card + "</button>" +
      '<div class="flash-buttons">' +
        '<button class="btn-again" data-again>Still learning</button>' +
        '<button class="btn-got" data-got>Got it ✓</button>' +
      "</div></div>";
  }

  // ---------- Profile ----------
  var editingProfile = false;

  function renderProfile() {
    var p = state.profile;
    var html = '<div class="profile-head"><div><h2>' + escapeHtml(p.name) + '</h2><div class="handle">@' + escapeHtml(p.handle) + "</div></div>" +
      '<div class="avatar lg">' + p.avatar + "</div></div>" +
      '<div class="profile-stats"><span><b>' + state.myPosts.length + "</b> threads</span>" +
      "<span><b>" + Object.keys(state.words).length + "</b> words saved</span>" +
      "<span><b>" + Object.keys(state.liked).length + "</b> likes</span></div>";
    if (editingProfile) {
      html += '<div class="edit-form">' +
        '<label>Name<input id="editName" maxlength="30" value="' + escapeHtml(p.name) + '"></label>' +
        '<label>Username<input id="editHandle" maxlength="24" value="' + escapeHtml(p.handle) + '"></label>' +
        '<label>Avatar<div class="emoji-picks">' + AVATARS.map(function (a) {
          return '<button class="emoji-pick' + (a === p.avatar ? " active" : "") + '" data-avatar="' + a + '">' + a + "</button>";
        }).join("") + "</div></label>" +
        '<button class="primary-btn" data-save-profile>Save profile</button></div>';
    } else {
      html += '<div class="profile-edit"><button class="outline-btn" data-edit-profile>Edit profile</button>' +
        '<button class="outline-btn" data-action="compose">New thread</button></div>';
    }
    html += '<div class="section-title">Your threads</div>';
    var mine = myPostObjects();
    html += mine.length
      ? mine.map(renderPost).join("")
      : '<div class="empty"><span class="big">✍️</span>You haven\'t posted yet.<br>Try the word challenge in <b>New</b>!</div>';
    $("#profileBody").innerHTML = html;
  }

  // ---------- Composer ----------
  var challenge = [];

  function pickChallenge() {
    var pool = Object.keys(state.words);
    if (pool.length < 3) pool = Object.keys(VOCAB);
    challenge = shuffle(pool).slice(0, 3);
  }

  function renderChallenge() {
    var used = detectWords($("#composerText").value);
    $("#challengeWords").innerHTML = challenge.map(function (k) {
      return '<button class="challenge-word' + (used.indexOf(k) >= 0 ? " used" : "") + '" data-insert="' + k + '">' +
        k + "<small>" + escapeHtml(VOCAB[k].zh.split("；")[0]) + "</small></button>";
    }).join("");
  }

  function updateComposer() {
    var text = $("#composerText").value;
    $("#composerCount").textContent = text.length + " / 500";
    $("#composerPost").disabled = !text.trim();
    var used = detectWords(text);
    $("#composerDetect").textContent = used.length
      ? "TOEFL words found: " + used.join(", ")
      : "";
    renderChallenge();
  }

  function openComposer() {
    closeSheet();
    $("#composerAvatar").textContent = state.profile.avatar;
    $("#composerName").textContent = state.profile.name;
    pickChallenge();
    $("#composer").hidden = false;
    document.body.style.overflow = "hidden";
    updateComposer();
    setTimeout(function () { $("#composerText").focus(); }, 50);
  }

  function closeComposer() {
    $("#composer").hidden = true;
    document.body.style.overflow = "";
  }

  function insertWord(word) {
    var ta = $("#composerText");
    var start = ta.selectionStart || ta.value.length;
    var end = ta.selectionEnd || ta.value.length;
    var before = ta.value.slice(0, start);
    var after = ta.value.slice(end);
    var pad = before && !/\s$/.test(before) ? " " : "";
    var ins = pad + word + " ";
    if (before.length + ins.length + after.length > 500) return;
    ta.value = before + ins + after;
    var pos = before.length + ins.length;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    updateComposer();
  }

  function submitPost() {
    var text = $("#composerText").value.trim();
    if (!text) return;
    state.myPosts.unshift({ id: "me" + Date.now(), text: text, ts: Date.now() });
    saveState();
    $("#composerText").value = "";
    closeComposer();
    renderFeed();
    homeScroll = 0;
    showView("home");
    var n = detectWords(text).length;
    toast(n ? "Posted! You used " + n + " TOEFL word" + (n > 1 ? "s" : "") + " 🎉" : "Posted!");
  }

  // ---------- Events ----------
  function rerenderAll() {
    renderFeed();
    if (currentView === "profile") renderProfile();
  }

  function toggleLike(id, btn) {
    if (state.liked[id]) delete state.liked[id];
    else state.liked[id] = true;
    saveState();
    // Update every rendered copy of this post (feed + profile) without re-rendering.
    var post = findPost(id);
    var base = post ? post.likes : 0;
    var liked = !!state.liked[id];
    $all('[data-like="' + id + '"]').forEach(function (b) {
      b.classList.toggle("liked", liked);
      var n = base + (liked ? 1 : 0);
      b.querySelector(".act-count").textContent = n ? formatCount(n) : "";
    });
    if (liked) {
      btn.classList.remove("pop");
      void btn.offsetWidth;
      btn.classList.add("pop");
    }
  }

  function toggleBookmark(id, btn) {
    var post = findPost(id);
    if (state.bookmarked[id]) {
      delete state.bookmarked[id];
      btn.classList.remove("bookmarked");
      toast("Thread unsaved (words stay in Review)");
    } else {
      state.bookmarked[id] = true;
      btn.classList.add("bookmarked", "pop");
      var added = post.words.filter(function (k) { return addWord(k, id); }).length;
      toast(added
        ? added + " word" + (added > 1 ? "s" : "") + " added to Review 📚"
        : "Thread saved — its words are already in Review");
    }
    saveState();
    refreshWordMarks();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, [data-action], .composer-prompt");
    if (!t) return;
    var d = t.dataset;

    if (t.classList.contains("vocab")) {
      var postEl = t.closest(".post");
      var from = postEl ? postEl.id.replace("post-", "") : null;
      openSheet(d.key, from && findPost(from) ? from : null);
    } else if (d.like) {
      toggleLike(d.like, t);
    } else if (d.bookmark) {
      toggleBookmark(d.bookmark, t);
    } else if (d.translate) {
      var tr = t.nextElementSibling;
      tr.hidden = !tr.hidden;
      t.textContent = tr.hidden ? "Translate" : "Hide translation";
    } else if (d.soon) {
      toast(d.soon + " are coming in the next version");
    } else if (d.delete) {
      if (confirm("Delete this thread?")) {
        state.myPosts = state.myPosts.filter(function (p) { return p.id !== d.delete; });
        delete state.liked[d.delete];
        saveState();
        rerenderAll();
        toast("Thread deleted");
      }
    } else if (d.level) {
      state.filter.level = d.level;
      saveState();
      renderFeed();
    } else if (d.lang) {
      state.filter.lang = d.lang;
      saveState();
      renderFeed();
    } else if (d.view) {
      if (d.view === currentView && d.view === "home") window.scrollTo({ top: 0, behavior: "smooth" });
      else showView(d.view);
    } else if (d.action === "compose" || t.classList.contains("composer-prompt")) {
      openComposer();
    } else if (d.mode) {
      reviewMode = d.mode;
      if (reviewMode === "cards") startDeck();
      renderReview();
    } else if (d.toggleWord) {
      openWord = openWord === d.toggleWord ? null : d.toggleWord;
      renderReview();
    } else if (d.speak) {
      speak(d.speak);
    } else if (d.goto) {
      goToPost(d.goto);
    } else if (d.removeWord) {
      removeWord(d.removeWord);
      saveState();
      refreshWordMarks();
      renderReview();
      toast("Removed from Review");
    } else if (d.flip !== undefined) {
      flipped = !flipped;
      renderReview();
      if (flipped) speak(deck[deckIndex]);
    } else if (d.again !== undefined) {
      deck.push(deck.splice(deckIndex, 1)[0]);
      flipped = false;
      renderReview();
    } else if (d.got !== undefined) {
      knownCount++;
      deckIndex++;
      flipped = false;
      renderReview();
    } else if (d.restart !== undefined) {
      startDeck();
      renderReview();
    } else if (d.editProfile !== undefined) {
      editingProfile = true;
      renderProfile();
    } else if (d.avatar) {
      $all(".emoji-pick").forEach(function (b) { b.classList.toggle("active", b === t); });
    } else if (d.saveProfile !== undefined) {
      var name = $("#editName").value.trim() || "You";
      var handle = $("#editHandle").value.trim().replace(/[^A-Za-z0-9_.]/g, "") || "toefl_learner";
      var picked = $(".emoji-pick.active");
      state.profile = { name: name, handle: handle, avatar: picked ? picked.dataset.avatar : state.profile.avatar };
      editingProfile = false;
      saveState();
      rerenderAll();
      toast("Profile updated");
    } else if (d.insert) {
      insertWord(d.insert);
    }
  });

  $("#sheetOverlay").addEventListener("click", closeSheet);
  $("#speakBtn").addEventListener("click", function () { if (sheetKey) speak(sheetKey); });
  $("#sheetSave").addEventListener("click", function () {
    if (!sheetKey) return;
    if (state.words[sheetKey]) {
      removeWord(sheetKey);
      toast("Removed from Review");
    } else {
      addWord(sheetKey, sheetFrom);
      toast("Added to Review 📚");
    }
    saveState();
    updateSheetButton();
    refreshWordMarks();
    if (currentView === "review") renderReview();
  });

  // Swipe the sheet down to close it.
  (function () {
    var sheet = $("#wordSheet");
    var startY = null;
    sheet.addEventListener("touchstart", function (e) {
      startY = sheet.scrollTop === 0 ? e.touches[0].clientY : null;
    }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (startY === null) return;
      var dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    sheet.addEventListener("touchend", function (e) {
      if (startY === null) return;
      var dy = e.changedTouches[0].clientY - startY;
      sheet.style.transform = "";
      startY = null;
      if (dy > 80) closeSheet();
    });
  })();

  $("#composerCancel").addEventListener("click", function () {
    if ($("#composerText").value.trim() && !confirm("Discard this thread?")) return;
    $("#composerText").value = "";
    closeComposer();
  });
  $("#composerText").addEventListener("input", updateComposer);
  $("#composerPost").addEventListener("click", submitPost);
  $("#challengeShuffle").addEventListener("click", function () { pickChallenge(); renderChallenge(); });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("#wordSheet").hidden) closeSheet();
  });

  // ---------- Init ----------
  renderFeed();
  refreshWordMarks();
})();
