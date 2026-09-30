(function () {
  "use strict";

  var C = window.Core;
  var S = window.Store;
  var VOCAB = window.VOCAB;
  var CHARACTERS = window.CHARACTERS;
  var TOPICS = window.TOPICS;
  var AVATARS = ["🙂", "😎", "🦊", "🐼", "🐯", "🐸", "🦄", "🐙", "🌸", "🍀", "🔥", "📚"];
  var CHUNK = 15;
  var QUIZ_EVERY = 7;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var esc = C.escapeHtml;

  function st() { return S.state; }

  // ---------- Toast & speech ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) { toast("Speech isn't supported on this browser"); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }

  function requireAccount(why) {
    if (S.canWrite()) return true;
    if (confirm("Sign in with Google to " + why + "?")) signIn();
    return false;
  }

  function signIn() {
    S.signIn().catch(function (e) {
      if (e && e.code === "auth/popup-closed-by-user") return;
      toast("Sign-in failed. Please try again.");
      console.error(e);
    });
  }

  // ---------- Posts ----------
  var userPostCache = {};   // id -> normalized user post (for threads opened from profiles)
  var userInfoCache = {};   // uid -> { name, handle, avatar }

  function communityPosts() {
    return S.communityPosts().map(function (raw) {
      var p = C.userPost(raw);
      userPostCache[p.id] = p;
      userInfoCache[raw.uid] = { name: raw.name, handle: raw.handle, avatar: raw.avatar };
      return p;
    });
  }

  function findPost(id) {
    return C.BUILTIN_BY_ID[id] || userPostCache[id] || null;
  }

  function isMine(post) {
    return post.kind === "user" && post.uid === S.myUid();
  }

  var ICON = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>'
  };

  function avatarHtml(author, size) {
    var style = author.color ? ' style="background:' + author.color + '"' : "";
    return '<div class="avatar' + (size ? " " + size : "") + '"' + style + ">" + esc(author.avatar) + "</div>";
  }

  function likeCount(post) { return post.baseLikes + S.extraLikes(post); }

  function renderPost(post, opts) {
    opts = opts || {};
    var a = C.authorOf(post);
    var mine = isMine(post);
    var saved = st().words;
    var liked = !!st().liked[post.id];
    var bookmarked = !!st().bookmarked[post.id];
    var likes = likeCount(post);
    var replies = S.replyCount(post);
    var followable = !mine && !st().following[a.key];

    var tags = "";
    if (post.level) tags += '<span class="level-tag lv' + post.level + '">' + C.LEVEL_NAMES[post.level] + "</span>";
    if (a.lang) tags += '<span class="tag">' + C.LANG_NAMES[a.lang] + "</span>";
    if (post.topic) tags += '<button class="tag" data-topic="' + esc(post.topic) + '">#' + esc(post.topic) + "</button>";
    if (mine) tags += '<span class="tag">You</span>';

    var extra = "";
    if (post.zh) {
      extra = '<button class="translate-btn" data-translate>Translate</button><div class="translation" hidden>' + esc(post.zh) + "</div>";
    }
    if (post.kind === "user" && post.words.length) {
      extra = '<div class="used-words">' + (mine ? "You used " : "Used ") + post.words.length + " TOEFL word" + (post.words.length > 1 ? "s" : "") + " 🎉</div>";
    }

    var last = mine
      ? '<button class="act" data-delete="' + post.id + '" aria-label="Delete">' + ICON.trash + "</button>"
      : '<button class="act' + (bookmarked ? " bookmarked" : "") + '" data-bookmark="' + post.id + '" aria-label="Save">' + ICON.bookmark + "</button>";

    return '<article class="post' + (opts.full ? " full" : "") + '" data-id="' + post.id + '">' +
      '<div class="post-left">' +
        '<button class="avatar-btn" data-person="' + esc(a.key) + '" aria-label="' + esc(a.name) + '">' + avatarHtml(a) + "</button>" +
        (followable ? '<button class="follow-plus" data-follow="' + esc(a.key) + '" aria-label="Follow ' + esc(a.name) + '">' + ICON.plus + "</button>" : "") +
        '<div class="thread-line"></div>' +
      "</div>" +
      '<div class="post-main">' +
        '<div class="post-head"><button class="post-name" data-person="' + esc(a.key) + '">' + esc(a.name) + "</button>" +
          '<span class="post-handle">@' + esc(a.handle) + "</span>" +
          '<span class="post-time">· ' + (post.kind === "char" ? C.formatAge(post.ageMinutes) : C.timeAgo(post.ts)) + "</span></div>" +
        '<div class="post-tags">' + tags + "</div>" +
        '<div class="post-text" data-open="' + post.id + '">' + (post.kind === "char" ? C.renderTagged(post.text, saved) : C.renderFree(post.text, saved)) + "</div>" +
        extra +
        '<div class="actions">' +
          '<button class="act' + (liked ? " liked" : "") + '" data-like="' + post.id + '" aria-label="Like">' + ICON.heart + '<span class="act-count">' + (likes ? C.formatCount(likes) : "") + "</span></button>" +
          '<button class="act" data-open="' + post.id + '" data-reply-count="' + post.id + '" aria-label="Reply">' + ICON.reply + '<span class="act-count">' + (replies ? C.formatCount(replies) : "") + "</span></button>" +
          '<button class="act" data-soon="Reposts" aria-label="Repost">' + ICON.repost + "</button>" +
          last +
        "</div>" +
      "</div>" +
    "</article>";
  }

  // Update like/reply numbers and follow badges everywhere without re-rendering.
  function refreshCounts() {
    $all("[data-like]").forEach(function (b) {
      var post = findPost(b.dataset.like);
      if (!post) return;
      var n = likeCount(post);
      b.classList.toggle("liked", !!st().liked[post.id]);
      b.querySelector(".act-count").textContent = n ? C.formatCount(n) : "";
    });
    $all("[data-reply-count]").forEach(function (b) {
      var post = findPost(b.dataset.replyCount);
      if (!post) return;
      var n = S.replyCount(post);
      b.querySelector(".act-count").textContent = n ? C.formatCount(n) : "";
    });
  }

  function refreshWordMarks() {
    $all(".vocab").forEach(function (el) { el.classList.toggle("saved", !!st().words[el.dataset.key]); });
    var n = Object.keys(st().words).length;
    var badge = $("#reviewBadge");
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? "99+" : n;
  }

  function refreshFollowMarks() {
    $all(".follow-plus").forEach(function (b) { b.hidden = !!st().following[b.dataset.follow]; });
    $all(".follow-btn").forEach(function (b) {
      var on = !!st().following[b.dataset.follow];
      b.classList.toggle("on", on);
      b.textContent = on ? "Following" : "Follow";
    });
  }

  // ---------- Daily goal ----------
  function addActivity(n) {
    var d = st().daily;
    var today = C.dayKey();
    d.log[today] = (d.log[today] || 0) + n;
    if (d.log[today] >= d.goal && !d.met[today]) {
      d.met[today] = true;
      var streak = C.streakOf(d);
      setTimeout(function () { toast("🎉 Daily goal reached! 🔥 " + streak + "-day streak", 3200); }, 400);
    }
    S.save();
    renderGoalChip();
  }

  function renderGoalChip() {
    var d = st().daily;
    var done = d.log[C.dayKey()] || 0;
    var pct = Math.min(1, done / d.goal);
    var r = 9, circ = 2 * Math.PI * r;
    $("#goalChip").innerHTML =
      '<svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="' + r + '" class="ring-bg"/>' +
      '<circle cx="12" cy="12" r="' + r + '" class="ring-fg' + (pct >= 1 ? " done" : "") + '" stroke-dasharray="' + circ + '" stroke-dashoffset="' + (circ * (1 - pct)) + '"/></svg>' +
      "<span>🔥 " + C.streakOf(d) + "</span>";
    $("#goalChip").setAttribute("aria-label", "Daily goal: " + done + " of " + d.goal + " today");
  }

  // ---------- Words ----------
  function addWord(key, from) {
    if (st().words[key]) return false;
    st().words[key] = { addedAt: Date.now(), from: from || null };
    addActivity(1);
    return true;
  }

  var sheetKey = null, sheetFrom = null;

  function openSheet(key, from) {
    var v = VOCAB[key];
    if (!v) return;
    sheetKey = key;
    sheetFrom = from;
    $("#sheetWord").textContent = key;
    $("#sheetPos").textContent = v.pos;
    var lv = $("#sheetLevel");
    lv.className = "level-tag lv" + v.level;
    lv.textContent = C.LEVEL_NAMES[v.level];
    $("#sheetZh").textContent = v.zh;
    var stem = key.length > 5 ? key.slice(0, key.length - 2) : key;
    $("#sheetEx").innerHTML = esc(v.ex).replace(new RegExp("\\b(" + stem + "[a-z]*)", "i"), "<strong>$1</strong>");
    $("#sheetExZh").textContent = v.exZh;
    updateSheetButton();
    $("#sheetOverlay").hidden = false;
    $("#wordSheet").hidden = false;
  }

  function updateSheetButton() {
    var btn = $("#sheetSave");
    var saved = !!st().words[sheetKey];
    btn.textContent = saved ? "✓ In your Review list (tap to remove)" : "+ Add to Review";
    btn.classList.toggle("done", saved);
  }

  function closeSheet() {
    $("#sheetOverlay").hidden = true;
    $("#wordSheet").hidden = true;
    sheetKey = null;
  }

  // ---------- Routing ----------
  var route = { name: "home", param: "", q: "" };
  var scrollMemory = {};
  var routeKey = "";

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("?");
    var path = parts[0].split("/");
    var q = "";
    if (parts[1]) {
      parts[1].split("&").forEach(function (kv) {
        var p = kv.split("=");
        if (p[0] === "q") q = decodeURIComponent(p[1] || "");
      });
    }
    return { name: path[0] || "home", param: decodeURIComponent(path.slice(1).join("/")), q: q };
  }

  function go(hash) {
    if (location.hash === hash) handleRoute();
    else location.hash = hash;
  }

  var VIEW_OF = { home: "home", search: "search", review: "review", profile: "profile", u: "person", t: "thread" };
  var TAB_OF = { home: "home", search: "search", review: "review", profile: "profile" };

  function handleRoute() {
    scrollMemory[routeKey] = window.scrollY;
    route = parseHash();
    if (!VIEW_OF[route.name]) route = { name: "home", param: "", q: "" };
    routeKey = route.name + "/" + route.param;
    var view = VIEW_OF[route.name];
    closeSheet();
    ["home", "search", "review", "profile", "person", "thread"].forEach(function (v) { $("#view-" + v).hidden = v !== view; });
    $all(".tab[data-go]").forEach(function (t) { t.classList.toggle("active", t.dataset.go === TAB_OF[route.name]); });
    var sub = route.name === "u" || route.name === "t";
    $("#backBtn").hidden = !sub;
    document.body.classList.toggle("in-thread", route.name === "t");
    $("#brand").classList.toggle("compact", sub);
    var title = { home: "TOEFL Threads", search: "Search", review: "Review", profile: "Profile", u: "Profile", t: "Thread" }[route.name];
    $("#topbarTitle").textContent = title;

    if (route.name === "home" && feedDirty) buildFeed();
    if (route.name === "search") renderSearch(route.q);
    if (route.name === "review") renderReview();
    if (route.name === "profile") renderProfile();
    if (route.name === "u") renderPerson(route.param);
    if (route.name === "t") renderThread(route.param);
    window.scrollTo(0, scrollMemory[routeKey] || 0);
  }

  // ---------- Feed ----------
  var feedMode = "foryou";
  var feedItems = [];
  var feedIndex = 0;
  var postsShown = 0;
  var cycle = 0;
  var feedDirty = true;
  var followingEndShown = false;
  var quizzes = {};

  function buildFeed() {
    feedDirty = false;
    cycle = 0;
    feedIndex = 0;
    postsShown = 0;
    followingEndShown = false;
    var community = communityPosts().sort(function (a, b) { return b.ts - a.ts; });
    if (feedMode === "foryou") {
      var ranked = C.rankForYou(st(), S.seen, Math.random() * 4294967296);
      feedItems = [];
      var ci = 0;
      ranked.forEach(function (p, i) {
        if (i % 5 === 0 && ci < community.length) feedItems.push(community[ci++]);
        feedItems.push(p);
      });
      while (ci < community.length) feedItems.push(community[ci++]);
    } else {
      var f = st().following;
      var me = S.myUid();
      feedItems = community.filter(function (p) { return f[p.authorKey] || p.uid === me; })
        .concat(C.BUILTIN.filter(function (p) { return f[p.authorKey]; }));
    }
    $all(".feed-tab").forEach(function (t) { t.classList.toggle("active", t.dataset.feed === feedMode); });
    $("#promptAvatar").textContent = st().profile.avatar;
    var feed = $("#feed");
    feed.innerHTML = "";
    if (!feedItems.length && feedMode === "following") {
      feed.innerHTML = '<div class="empty"><span class="big">👀</span>You aren\'t following anyone yet.</div>' + suggestionsHtml(6);
      followingEndShown = true;
      return;
    }
    appendChunk();
  }

  function appendChunk() {
    var feed = $("#feed");
    if (feedIndex >= feedItems.length) {
      if (feedMode === "foryou") {
        cycle++;
        var more = C.rankForYou(st(), S.seen, Math.random() * 4294967296);
        feedItems = feedItems.concat(more);
        feed.insertAdjacentHTML("beforeend", '<div class="divider">✨ You\'re all caught up — shuffling threads for another round</div>');
      } else {
        if (!followingEndShown) {
          followingEndShown = true;
          feed.insertAdjacentHTML("beforeend", '<div class="divider">That\'s everyone you follow. Find more people in <button class="link" data-go="search">Search</button>.</div>');
        }
        return;
      }
    }
    var html = "";
    var end = Math.min(feedItems.length, feedIndex + CHUNK);
    for (; feedIndex < end; feedIndex++) {
      html += renderPost(feedItems[feedIndex]);
      postsShown++;
      if (postsShown % QUIZ_EVERY === 0) html += renderQuizCard();
    }
    feed.insertAdjacentHTML("beforeend", html);
    $all(".post:not([data-observed])", feed).forEach(function (el) {
      el.setAttribute("data-observed", "1");
      if (seenObserver) seenObserver.observe(el);
    });
  }

  var seenObserver = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        S.markSeen(e.target.dataset.id);
        seenObserver.unobserve(e.target);
      }
    });
  }, { threshold: 0.6 }) : null;

  function setupInfiniteScroll() {
    if (!("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && route.name === "home" && feedItems.length) appendChunk();
    }, { rootMargin: "800px" }).observe($("#feedSentinel"));
  }

  // ---------- Quiz ----------
  function quizPool() {
    var saved = Object.keys(st().words);
    if (saved.length >= 4) return saved;
    var fromSeen = [];
    Object.keys(S.seen).forEach(function (id) {
      var p = C.BUILTIN_BY_ID[id];
      if (p) p.words.forEach(function (k) { if (fromSeen.indexOf(k) < 0) fromSeen.push(k); });
    });
    if (fromSeen.length >= 4) return fromSeen;
    var levels = st().prefs.levels || [1, 2, 3];
    return Object.keys(VOCAB).filter(function (k) { return levels.indexOf(VOCAB[k].level) >= 0; });
  }

  function renderQuizCard() {
    var q = C.makeQuiz(quizPool());
    var id = "q" + Math.random().toString(36).slice(2, 9);
    quizzes[id] = q;
    var prompt = q.type === "blank"
      ? '<div class="quiz-q">Fill in the blank:</div><p class="quiz-prompt">' + esc(q.prompt) + '</p><p class="muted small">' + esc(q.hint) + "</p>"
      : '<div class="quiz-q">What does this word mean?</div><p class="quiz-word">' + esc(q.prompt) + ' <span class="muted">' + esc(q.hint) + "</span></p>";
    return '<section class="quiz" id="' + id + '">' +
      '<div class="quiz-head">✏️ Quick quiz</div>' + prompt +
      '<div class="quiz-options">' + q.options.map(function (o) {
        return '<button class="quiz-opt" data-quiz="' + id + '" data-answer="' + esc(o.value) + '">' + esc(o.label) + "</button>";
      }).join("") + "</div>" +
      '<div class="quiz-result" hidden></div></section>';
  }

  function answerQuiz(id, answer) {
    var q = quizzes[id];
    var card = document.getElementById(id);
    if (!q || !card || card.classList.contains("answered")) return;
    card.classList.add("answered");
    var right = answer === q.key;
    $all(".quiz-opt", card).forEach(function (b) {
      b.disabled = true;
      if (b.dataset.answer === q.key) b.classList.add("correct");
      else if (b.dataset.answer === answer) b.classList.add("wrong");
    });
    var v = VOCAB[q.key];
    var res = card.querySelector(".quiz-result");
    res.hidden = false;
    res.innerHTML = (right ? '<b class="ok">Correct! +1 today 🎉</b>' : '<b class="bad">Not quite.</b>') +
      '<div><button class="vocab" data-key="' + q.key + '">' + q.key + "</button> " + esc(v.pos + " " + v.zh) + "</div>" +
      (st().words[q.key] ? "" : '<button class="link" data-quiz-save="' + q.key + '">+ Add to Review</button>');
    if (right) {
      card.classList.add("win");
      addActivity(1);
    }
  }

  // ---------- Follow ----------
  function toggleFollow(key) {
    var f = st().following;
    var name = key.indexOf("uid:") === 0 ? ((userInfoCache[key.slice(4)] || {}).name || "them") : CHARACTERS[key].name;
    if (f[key]) {
      delete f[key];
      toast("Unfollowed " + name);
    } else {
      f[key] = true;
      toast("Following " + name + " ✓");
    }
    S.save();
    refreshFollowMarks();
    feedDirty = true;
    if (feedMode === "following" && route.name !== "home") feedDirty = true;
  }

  function followersLabel(key) {
    var c = CHARACTERS[key];
    return c ? c.followers + " followers" : "";
  }

  function suggestionsHtml(limit) {
    var keys = Object.keys(CHARACTERS).filter(function (k) { return !st().following[k]; });
    var topics = st().prefs.topics || [];
    keys.sort(function (a, b) { return topicScore(b, topics) - topicScore(a, topics); });
    return '<div class="section-title">Suggested for you</div>' + keys.slice(0, limit).map(personRow).join("");
  }

  function topicScore(charKey, topics) {
    return C.BUILTIN.filter(function (p) { return p.authorKey === charKey && topics.indexOf(p.topic) >= 0; }).length;
  }

  function personRow(key) {
    var c = CHARACTERS[key];
    var on = !!st().following[key];
    return '<div class="person-row">' +
      '<button class="avatar-btn" data-person="' + key + '">' + avatarHtml(c) + "</button>" +
      '<button class="person-info" data-person="' + key + '"><b>' + esc(c.name) + '</b><span class="muted">@' + esc(c.handle) + " · " + esc(c.followers) + "</span>" +
        '<span class="bio">' + esc(c.bio) + "</span></button>" +
      '<button class="follow-btn' + (on ? " on" : "") + '" data-follow="' + key + '">' + (on ? "Following" : "Follow") + "</button>" +
    "</div>";
  }

  // ---------- Search ----------
  function renderSearch(q) {
    var input = $("#searchInput");
    if (input.value !== q) input.value = q;
    var body = $("#searchBody");
    q = (q || "").trim();
    if (!q) {
      body.innerHTML = '<div class="section-title">Browse topics</div><div class="topic-grid">' +
        TOPICS.map(function (t) { return '<button class="chip" data-topic="' + esc(t) + '">#' + esc(t) + "</button>"; }).join("") +
        "</div>" + '<div class="section-title">Characters</div>' + Object.keys(CHARACTERS).map(personRow).join("");
      return;
    }
    var html = "";
    if (q.charAt(0) === "#") {
      var topic = q.slice(1).toLowerCase();
      var posts = C.BUILTIN.filter(function (p) { return p.topic.toLowerCase() === topic; });
      html += '<div class="section-title">#' + esc(q.slice(1)) + " · " + posts.length + " threads</div>" + posts.map(function (p) { return renderPost(p); }).join("");
      body.innerHTML = posts.length ? html : '<div class="empty">No threads for that topic.</div>';
      return;
    }
    var lower = q.toLowerCase();
    var words = Object.keys(VOCAB).filter(function (k) {
      return k.indexOf(lower) === 0 || (lower.length > 2 && k.indexOf(lower) > 0) || VOCAB[k].zh.indexOf(q) >= 0;
    }).sort(function (a, b) { return (a.indexOf(lower) === 0 ? 0 : 1) - (b.indexOf(lower) === 0 ? 0 : 1) || a.localeCompare(b); }).slice(0, 12);
    var people = Object.keys(CHARACTERS).filter(function (k) {
      var c = CHARACTERS[k];
      return (c.name + " " + c.handle + " " + c.bio).toLowerCase().indexOf(lower) >= 0;
    });
    var wordKeys = words.slice(0, 3);
    var threads = C.BUILTIN.filter(function (p) {
      return p.text.toLowerCase().indexOf(lower) >= 0 || p.words.some(function (k) { return wordKeys.indexOf(k) >= 0 && k === lower; });
    }).concat(communityPosts().filter(function (p) { return p.text.toLowerCase().indexOf(lower) >= 0; }));

    if (words.length) {
      html += '<div class="section-title">Words</div><div class="word-results">' + words.map(function (k) {
        return '<button class="word-row" data-word="' + k + '"><span class="w">' + k + '</span><span class="z">' + esc(VOCAB[k].pos + " " + VOCAB[k].zh) + '</span><span class="level-tag lv' + VOCAB[k].level + '">' + C.LEVEL_NAMES[VOCAB[k].level] + "</span></button>";
      }).join("") + "</div>";
    }
    if (people.length) html += '<div class="section-title">People</div>' + people.map(personRow).join("");
    if (threads.length) html += '<div class="section-title">Threads · ' + threads.length + "</div>" + threads.slice(0, 40).map(function (p) { return renderPost(p); }).join("");
    body.innerHTML = html || '<div class="empty"><span class="big">🔍</span>No results for “' + esc(q) + "”.</div>";
  }

  // ---------- Person ----------
  function renderPerson(key) {
    var body = $("#personBody");
    if (key.indexOf("uid:") === 0) {
      var uid = key.slice(4);
      if (uid === S.myUid()) { go("#/profile"); return; }
      var info = userInfoCache[uid] || { name: "TOEFL learner", handle: "user", avatar: "🙂" };
      $("#topbarTitle").textContent = "@" + info.handle;
      body.innerHTML = personHeader(key, info.name, info.handle, info.avatar, null, "Learning English on TOEFL Threads", "") + '<div class="empty">Loading…</div>';
      S.userPosts(uid).then(function (raws) {
        var posts = raws.map(function (r) { var p = C.userPost(r); userPostCache[p.id] = p; return p; });
        if (raws[0]) userInfoCache[uid] = { name: raws[0].name, handle: raws[0].handle, avatar: raws[0].avatar };
        body.innerHTML = personHeader(key, info.name, info.handle, info.avatar, null, "Learning English on TOEFL Threads", posts.length + " threads") +
          (posts.length ? posts.map(function (p) { return renderPost(p); }).join("") : '<div class="empty">No threads yet.</div>');
      }).catch(function () { body.querySelector(".empty").textContent = "Couldn't load threads."; });
      return;
    }
    var c = CHARACTERS[key];
    if (!c) { body.innerHTML = '<div class="empty">Profile not found.</div>'; return; }
    $("#topbarTitle").textContent = "@" + c.handle;
    var posts = C.BUILTIN.filter(function (p) { return p.authorKey === key; });
    var topics = {};
    posts.forEach(function (p) { topics[p.topic] = 1; });
    var meta = posts.length + " threads · " + (c.lang === "en" ? "English only" : "English + 中文") + " · " + Object.keys(topics).map(function (t) { return "#" + t; }).join(" ");
    body.innerHTML = personHeader(key, c.name, c.handle, c.avatar, c.color, c.bio, meta, c.followers) + posts.map(function (p) { return renderPost(p); }).join("");
  }

  function personHeader(key, name, handle, avatar, color, bio, meta, followers) {
    var on = !!st().following[key];
    return '<div class="profile-head"><div><h2>' + esc(name) + '</h2><div class="handle">@' + esc(handle) + "</div></div>" +
      '<div class="avatar lg"' + (color ? ' style="background:' + color + '"' : "") + ">" + esc(avatar) + "</div></div>" +
      '<p class="profile-bio">' + esc(bio) + "</p>" +
      '<div class="profile-stats">' + (followers ? "<span><b>" + esc(followers) + "</b> followers</span>" : "") + '<span class="muted">' + esc(meta) + "</span></div>" +
      '<div class="profile-edit"><button class="follow-btn wide' + (on ? " on" : "") + '" data-follow="' + esc(key) + '">' + (on ? "Following" : "Follow") + "</button></div>" +
      '<div class="section-title">Threads</div>';
  }

  // ---------- Thread (post + replies) ----------
  var threadPost = null;
  var justReplied = null;

  function renderThread(id) {
    var body = $("#threadBody");
    var post = findPost(id);
    threadPost = post;
    if (!post) {
      body.innerHTML = '<div class="empty">This thread is no longer available.</div>';
      $("#replyBar").hidden = true;
      return;
    }
    $("#replyBar").hidden = false;
    $("#replyAvatar").textContent = st().profile.avatar;
    $("#replyInput").placeholder = S.canWrite() ? "Reply to " + C.authorOf(post).name + "…" : "Sign in to reply";
    body.innerHTML = renderPost(post, { full: true }) + '<div class="section-title">Replies</div><div id="replies"><div class="empty small">Loading…</div></div>';
    var tr = body.querySelector(".translation");
    if (tr) { tr.hidden = false; body.querySelector("[data-translate]").textContent = "Hide translation"; }
    loadReplies();
  }

  function loadReplies() {
    var post = threadPost;
    if (!post) return;
    S.comments(post.id).then(function (list) {
      if (threadPost !== post) return;
      var box = $("#replies");
      if (!list.length) {
        box.innerHTML = '<div class="empty small">No replies yet. Be the first — ' + (post.kind === "char" ? esc(C.authorOf(post).name) + " will answer you!" : "say something nice!") + "</div>";
        return;
      }
      box.innerHTML = list.map(function (c) { return renderComment(post, c); }).join("");
      if (justReplied) {
        var typing = box.querySelector('[data-typing="' + justReplied + '"]');
        justReplied = null;
        if (typing) setTimeout(function () { typing.classList.remove("typing"); }, 1500);
      }
    }).catch(function (e) {
      console.error(e);
      $("#replies").innerHTML = '<div class="empty small">Couldn\'t load replies.</div>';
    });
  }

  function renderComment(post, c) {
    var mine = c.uid === S.myUid();
    userInfoCache[c.uid] = userInfoCache[c.uid] || { name: c.name, handle: c.handle, avatar: c.avatar };
    var html = '<div class="comment">' +
      '<button class="avatar-btn" data-person="uid:' + esc(c.uid) + '">' + avatarHtml({ avatar: c.avatar }, "sm") + "</button>" +
      '<div class="comment-main"><div class="post-head"><button class="post-name" data-person="uid:' + esc(c.uid) + '">' + esc(c.name) + '</button><span class="post-time">· ' + C.timeAgo(c.createdAt) + "</span>" +
      (mine ? '<button class="link danger small push" data-del-comment="' + esc(c.id) + '">Delete</button>' : "") + "</div>" +
      '<div class="post-text">' + C.renderFree(c.text, st().words) + "</div></div></div>";
    if (post.kind === "char") {
      var a = C.authorOf(post);
      var typing = justReplied === c.id;
      html += '<div class="comment char-reply' + (typing ? " typing" : "") + '"' + (typing ? ' data-typing="' + esc(c.id) + '"' : "") + ">" +
        '<button class="avatar-btn" data-person="' + a.key + '">' + avatarHtml(a, "sm") + "</button>" +
        '<div class="comment-main"><div class="post-head"><button class="post-name" data-person="' + a.key + '">' + esc(a.name) + '</button><span class="post-handle">replied</span></div>' +
        '<div class="dots"><i></i><i></i><i></i></div>' +
        '<div class="post-text">' + C.renderTagged(C.characterReply(a.key, c.id, c.name), st().words) + "</div></div></div>";
    }
    return html;
  }

  function sendReply() {
    var input = $("#replyInput");
    var text = input.value.trim();
    if (!text || !threadPost) return;
    if (!requireAccount("reply")) return;
    var post = threadPost;
    $("#replySend").disabled = true;
    S.addComment(post, text).then(function (id) {
      input.value = "";
      justReplied = id;
      refreshCounts();
      loadReplies();
      var n = C.detectWords(text).length;
      if (n) toast("Nice! You used " + n + " TOEFL word" + (n > 1 ? "s" : "") + " 🎉");
    }).catch(function (e) {
      console.error(e);
      toast("Couldn't post your reply");
    }).then(function () { $("#replySend").disabled = !input.value.trim(); });
  }

  // ---------- Review ----------
  var reviewMode = "list";
  var openWord = null;
  var deck = [], deckIndex = 0, flipped = false, knownCount = 0;

  function savedKeys() {
    var w = st().words;
    return Object.keys(w).sort(function (a, b) { return w[b].addedAt - w[a].addedAt; });
  }

  function renderReview() {
    $all(".seg").forEach(function (s) { s.classList.toggle("active", s.dataset.mode === reviewMode); });
    var keys = savedKeys();
    var body = $("#reviewBody");
    if (!keys.length) {
      body.innerHTML = '<div class="empty"><span class="big">📚</span>Your Review list is empty.<br>Tap a <b>blue word</b> in any thread and choose <b>Add to Review</b>,<br>or tap the bookmark on a thread to save all its words.</div>';
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
      var from = st().words[k].from;
      html += '<div class="word-item"><button class="word-row" data-toggle-word="' + k + '">' +
        '<span class="w">' + k + '</span><span class="z">' + esc(v.pos + " " + v.zh) + '</span><span class="level-tag lv' + v.level + '">' + C.LEVEL_NAMES[v.level] + "</span></button>";
      if (openWord === k) {
        html += '<div class="word-detail"><p>' + esc(v.ex) + '</p><p class="muted">' + esc(v.exZh) + '</p><div class="row-actions">' +
          '<button class="link" data-speak="' + k + '">🔊 Listen</button>' +
          (from && findPost(from) ? '<a class="link" href="#/t/' + esc(from) + '">See thread</a>' : "") +
          '<a class="link" href="#/search?q=' + encodeURIComponent(k) + '">More threads</a>' +
          '<button class="link danger" data-remove-word="' + k + '">Remove</button></div></div>';
      }
      html += "</div>";
    });
    body.innerHTML = html;
  }

  function startDeck() {
    deck = C.shuffle(savedKeys());
    deckIndex = 0; flipped = false; knownCount = 0;
  }

  function renderFlashcards(body) {
    deck = deck.filter(function (k) { return st().words[k]; });
    if (!deck.length && !knownCount) startDeck();
    if (deckIndex >= deck.length) {
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard"><div class="fw">🎉</div><div class="fzh">Nice work!</div><div class="fex">You reviewed ' +
        knownCount + " word" + (knownCount === 1 ? "" : "s") + '.</div></div><div class="flash-buttons"><button class="btn-got" data-restart>Start again</button></div></div>';
      return;
    }
    var k = deck[deckIndex], v = VOCAB[k];
    var card = flipped
      ? '<div class="fw">' + k + '</div><div class="fpos">' + v.pos + '</div><div class="fzh">' + esc(v.zh) + '</div><div class="fex">' + esc(v.ex) + '</div><div class="fexzh">' + esc(v.exZh) + "</div>"
      : '<div class="fw">' + k + '</div><div class="fpos">' + v.pos + '</div><div class="fhint">Tap to reveal the meaning</div>';
    body.innerHTML = '<div class="flash-wrap"><div class="flash-progress">Card ' + (deckIndex + 1) + " of " + deck.length + " · " + knownCount + " known</div>" +
      '<button class="flashcard' + (flipped ? " flip" : "") + '" data-flip>' + card + "</button>" +
      '<div class="flash-buttons"><button class="btn-again" data-again>Still learning</button><button class="btn-got" data-got>Got it ✓</button></div></div>';
  }

  // ---------- Profile ----------
  var editingProfile = false;

  function renderProfile() {
    var s = st(), p = s.profile, d = s.daily;
    var mine = communityPosts().filter(isMine);
    var today = d.log[C.dayKey()] || 0;
    var days = C.lastDays(d, 7);
    var max = Math.max(d.goal, Math.max.apply(null, days.map(function (x) { return x.value; })));

    var html = '<div class="profile-head"><div><h2>' + esc(p.name) + '</h2><div class="handle">@' + esc(p.handle) + "</div></div>" +
      '<div class="avatar lg">' + esc(p.avatar) + "</div></div>";

    // Account
    if (S.mode === "cloud" && S.user) {
      html += '<div class="card account"><span>✅ Signed in as <b>' + esc(S.user.name) + '</b>. Your likes, words and threads are saved to your account.</span><button class="link" data-signout>Sign out</button></div>';
    } else if (S.mode === "cloud") {
      html += '<div class="card account"><span>Sign in to save your progress to your account and post threads everyone can see.</span><button class="primary-btn" data-signin>Sign in with Google</button></div>';
    } else {
      html += '<div class="card account muted small">📱 Saved on this device only.</div>';
    }

    html += '<div class="profile-stats"><span><b>' + mine.length + "</b> threads</span><span><b>" + Object.keys(s.words).length +
      "</b> words</span><span><b>" + Object.keys(s.following).length + "</b> following</span><span><b>🔥 " + C.streakOf(d) + "</b> day streak</span></div>";

    if (editingProfile) {
      html += '<div class="edit-form"><label>Name<input id="editName" maxlength="30" value="' + esc(p.name) + '"></label>' +
        '<label>Username<input id="editHandle" maxlength="24" value="' + esc(p.handle) + '"></label>' +
        '<label>Avatar<div class="emoji-picks">' + AVATARS.map(function (a) {
          return '<button class="emoji-pick' + (a === p.avatar ? " active" : "") + '" data-avatar="' + a + '">' + a + "</button>";
        }).join("") + '</div></label><button class="primary-btn" data-save-profile>Save profile</button></div>';
    } else {
      html += '<div class="profile-edit"><button class="outline-btn" data-edit-profile>Edit profile</button><button class="outline-btn" data-edit-prefs>Feed preferences</button></div>';
    }

    // Daily goal
    html += '<div class="card goal-card" id="goalCard"><div class="goal-top"><b>Daily goal</b><span class="muted">' + today + " / " + d.goal + " today</span></div>" +
      '<div class="goal-bar"><i style="width:' + Math.min(100, Math.round(today / d.goal * 100)) + '%"></i></div>' +
      '<div class="bars">' + days.map(function (x) {
        return '<div class="bar-col"><div class="bar' + (d.met[x.key] ? " met" : "") + '" style="height:' + Math.max(4, Math.round(x.value / max * 60)) + 'px" title="' + x.value + '"></div><span>' + x.label + "</span></div>";
      }).join("") + "</div>" +
      '<div class="goal-pick"><span class="muted small">Goal:</span>' + [5, 10, 20].map(function (g) {
        return '<button class="chip' + (d.goal === g ? " active" : "") + '" data-goal="' + g + '">' + g + " / day</button>";
      }).join("") + '</div><p class="muted small">Each new saved word, correct quiz answer and "Got it" flashcard counts as 1.</p></div>';

    var followKeys = Object.keys(s.following);
    html += '<div class="section-title">Following · ' + followKeys.length + "</div>";
    html += followKeys.length ? '<div class="following-strip">' + followKeys.map(function (k) {
      var c = CHARACTERS[k];
      var info = c || userInfoCache[k.slice(4)] || { avatar: "🙂", name: "User" };
      return '<button class="mini-person" data-person="' + esc(k) + '">' + avatarHtml({ avatar: info.avatar, color: c && c.color }) + "<span>" + esc(info.name.split(" ")[0]) + "</span></button>";
    }).join("") + "</div>" : '<div class="empty small">Not following anyone yet.</div>';

    html += '<div class="section-title">Your threads</div>';
    html += mine.length ? mine.map(function (x) { return renderPost(x); }).join("")
      : '<div class="empty"><span class="big">✍️</span>You haven\'t posted yet.<br>Tap <b>＋</b> below and try the word challenge!</div>';
    $("#profileBody").innerHTML = html;
  }

  // ---------- Onboarding / preferences ----------
  var ob = null;

  function openOnboarding(editing) {
    var p = st().prefs;
    ob = { step: 0, editing: editing, levels: (p.levels || [2]).slice(), topics: (p.topics || []).slice(), follow: {} };
    Object.keys(st().following).forEach(function (k) { ob.follow[k] = true; });
    if (!editing) ob.levels = [2];
    $("#onboard").hidden = false;
    document.body.style.overflow = "hidden";
    renderOnboarding();
  }

  function renderOnboarding() {
    var body = $("#onboardBody");
    var dots = '<div class="ob-dots">' + [0, 1, 2].map(function (i) { return "<i" + (i === ob.step ? ' class="on"' : "") + "></i>"; }).join("") + "</div>";
    var html = "";
    if (ob.step === 0) {
      html = '<div class="ob-hero">@</div><h2>' + (ob.editing ? "Your level" : "Welcome to TOEFL Threads") + "</h2>" +
        '<p class="muted">Funny characters post every day — using real TOEFL words. What level do you want to see?</p>' +
        '<div class="ob-options">' + [[1, "Easy", "Common academic words · ~TOEFL 60–80"], [2, "Medium", "Core TOEFL words · ~TOEFL 80–100"], [3, "Hard", "Advanced words · ~TOEFL 100+"]].map(function (x) {
          var on = ob.levels.indexOf(x[0]) >= 0;
          return '<button class="ob-opt' + (on ? " on" : "") + '" data-ob-level="' + x[0] + '"><b>' + x[1] + "</b><span>" + x[2] + "</span></button>";
        }).join("") + '</div><p class="muted small">Pick one or more.</p>';
    } else if (ob.step === 1) {
      html = "<h2>What do you like?</h2><p class=\"muted\">We'll show these topics more often. You'll still see a mix.</p><div class=\"topic-grid\">" +
        TOPICS.map(function (t) { return '<button class="chip' + (ob.topics.indexOf(t) >= 0 ? " active" : "") + '" data-ob-topic="' + esc(t) + '">#' + esc(t) + "</button>"; }).join("") + "</div>";
    } else {
      var keys = Object.keys(CHARACTERS).sort(function (a, b) { return topicScore(b, ob.topics) - topicScore(a, ob.topics); });
      if (!ob.editing && !Object.keys(ob.follow).length) keys.slice(0, 3).forEach(function (k) { ob.follow[k] = true; });
      html = "<h2>Follow some characters</h2><p class=\"muted\">Their threads show up in your <b>Following</b> tab.</p><div class=\"ob-people\">" + keys.map(function (k) {
        var c = CHARACTERS[k], on = !!ob.follow[k];
        return '<button class="ob-person' + (on ? " on" : "") + '" data-ob-follow="' + k + '">' + avatarHtml(c) + '<span class="person-info"><b>' + esc(c.name) + '</b><span class="bio">' + esc(c.bio) + '</span></span><span class="ob-check">' + (on ? "✓" : "+") + "</span></button>";
      }).join("") + "</div>";
    }
    var next = ob.step < 2 ? "Next" : ob.editing ? "Save" : "Start scrolling";
    body.innerHTML = dots + '<div class="ob-content">' + html + "</div>" +
      '<div class="ob-nav">' + (ob.step > 0 ? '<button class="outline-btn" data-ob-back>Back</button>' : ob.editing ? '<button class="outline-btn" data-ob-close>Cancel</button>' : "<span></span>") +
      '<button class="primary-btn" data-ob-next' + (ob.step === 0 && !ob.levels.length ? " disabled" : "") + ">" + next + "</button></div>";
    body.scrollTop = 0;
  }

  function finishOnboarding() {
    var s = st();
    s.prefs = { levels: ob.levels.sort(), topics: ob.topics, onboarded: true };
    s.following = {};
    Object.keys(ob.follow).forEach(function (k) { if (ob.follow[k]) s.following[k] = true; });
    S.save();
    closeOnboarding();
    buildFeed();
    window.scrollTo(0, 0);
    if (route.name === "profile") renderProfile();
    toast("Your feed is ready ✨");
  }

  function closeOnboarding() {
    $("#onboard").hidden = true;
    document.body.style.overflow = "";
    ob = null;
  }

  // ---------- Composer ----------
  var challenge = [];

  function pickChallenge() {
    var pool = Object.keys(st().words);
    if (pool.length < 3) {
      var levels = st().prefs.levels || [1, 2, 3];
      pool = Object.keys(VOCAB).filter(function (k) { return levels.indexOf(VOCAB[k].level) >= 0; });
    }
    challenge = C.shuffle(pool).slice(0, 3);
  }

  function renderChallenge() {
    var used = C.detectWords($("#composerText").value);
    $("#challengeWords").innerHTML = challenge.map(function (k) {
      return '<button class="challenge-word' + (used.indexOf(k) >= 0 ? " used" : "") + '" data-insert="' + k + '">' + k + "<small>" + esc(VOCAB[k].zh.split("；")[0]) + "</small></button>";
    }).join("");
  }

  function updateComposer() {
    var text = $("#composerText").value;
    $("#composerCount").textContent = text.length + " / 500";
    $("#composerPost").disabled = !text.trim();
    var used = C.detectWords(text);
    $("#composerDetect").textContent = used.length ? "TOEFL words found: " + used.join(", ") : "";
    renderChallenge();
  }

  function openComposer() {
    if (!requireAccount("post a thread")) return;
    closeSheet();
    $("#composerAvatar").textContent = st().profile.avatar;
    $("#composerName").textContent = st().profile.name;
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
    var before = ta.value.slice(0, start), after = ta.value.slice(end);
    var ins = (before && !/\s$/.test(before) ? " " : "") + word + " ";
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
    $("#composerPost").disabled = true;
    S.createPost(text).then(function () {
      $("#composerText").value = "";
      closeComposer();
      feedMode = "foryou";
      scrollMemory["home/"] = 0;
      buildFeed();
      go("#/home");
      window.scrollTo(0, 0);
      var n = C.detectWords(text).length;
      toast(n ? "Posted! You used " + n + " TOEFL word" + (n > 1 ? "s" : "") + " 🎉" : "Posted!");
    }).catch(function (e) {
      console.error(e);
      toast("Couldn't post. Please try again.");
      $("#composerPost").disabled = false;
    });
  }

  // ---------- Actions ----------
  function toggleLike(id, btn) {
    var post = findPost(id);
    if (!post) return;
    if (!requireAccount("like threads")) return;
    var liked = !st().liked[id];
    S.setLiked(post, liked);
    refreshCounts();
    if (liked) {
      $all('[data-like="' + id + '"]').forEach(function (b) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); });
    }
  }

  function toggleBookmark(id, btn) {
    var post = findPost(id);
    var s = st();
    if (s.bookmarked[id]) {
      delete s.bookmarked[id];
      $all('[data-bookmark="' + id + '"]').forEach(function (b) { b.classList.remove("bookmarked"); });
      toast("Thread unsaved (words stay in Review)");
    } else {
      s.bookmarked[id] = true;
      $all('[data-bookmark="' + id + '"]').forEach(function (b) { b.classList.add("bookmarked", "pop"); });
      var added = post.words.filter(function (k) { return addWord(k, id); }).length;
      toast(added ? added + " word" + (added > 1 ? "s" : "") + " added to Review 📚" : "Thread saved — its words are already in Review");
    }
    S.save();
    refreshWordMarks();
  }

  function deletePost(id) {
    if (!confirm("Delete this thread?")) return;
    S.deletePost(id).then(function () {
      delete userPostCache[id];
      buildFeed();
      if (route.name === "profile") renderProfile();
      if (route.name === "t") history.back();
      toast("Thread deleted");
    }).catch(function () { toast("Couldn't delete the thread"); });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a[href], [data-open], [data-action]");
    if (!t) return;
    var d = t.dataset;
    if (t.tagName === "A") return; // normal hash links

    if (t.classList.contains("vocab")) {
      var postEl = t.closest(".post");
      openSheet(d.key, postEl && C.BUILTIN_BY_ID[postEl.dataset.id] ? postEl.dataset.id : null);
    } else if (d.like) toggleLike(d.like, t);
    else if (d.bookmark) toggleBookmark(d.bookmark, t);
    else if (d.translate !== undefined) {
      var tr = t.nextElementSibling;
      tr.hidden = !tr.hidden;
      t.textContent = tr.hidden ? "Translate" : "Hide translation";
    } else if (d.soon) toast(d.soon + " are coming in the next version");
    else if (d.delete) deletePost(d.delete);
    else if (d.open) { if (route.name !== "t" || route.param !== d.open) go("#/t/" + d.open); }
    else if (d.person) go("#/u/" + encodeURIComponent(d.person));
    else if (d.follow) toggleFollow(d.follow);
    else if (d.topic) go("#/search?q=" + encodeURIComponent("#" + d.topic));
    else if (d.word) openSheet(d.word, null);
    else if (d.go) {
      if (d.go === "home" && route.name === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); if (window.scrollY < 50) { buildFeed(); } }
      else go("#/" + d.go);
    } else if (d.feed) {
      if (feedMode !== d.feed || feedDirty) { feedMode = d.feed; buildFeed(); window.scrollTo(0, 0); }
    } else if (d.action === "compose") openComposer();
    else if (d.quiz) answerQuiz(d.quiz, d.answer);
    else if (d.quizSave) {
      addWord(d.quizSave, null);
      S.save();
      t.replaceWith(document.createTextNode("✓ Added to Review"));
      refreshWordMarks();
    }
    // Review
    else if (d.mode) { reviewMode = d.mode; if (reviewMode === "cards") startDeck(); renderReview(); }
    else if (d.toggleWord) { openWord = openWord === d.toggleWord ? null : d.toggleWord; renderReview(); }
    else if (d.speak) speak(d.speak);
    else if (d.removeWord) {
      delete st().words[d.removeWord];
      S.save(); refreshWordMarks(); renderReview();
      toast("Removed from Review");
    } else if (d.flip !== undefined) { flipped = !flipped; renderReview(); if (flipped) speak(deck[deckIndex]); }
    else if (d.again !== undefined) { deck.push(deck.splice(deckIndex, 1)[0]); flipped = false; renderReview(); }
    else if (d.got !== undefined) { knownCount++; deckIndex++; flipped = false; addActivity(1); renderReview(); }
    else if (d.restart !== undefined) { startDeck(); renderReview(); }
    // Profile
    else if (d.editProfile !== undefined) { editingProfile = true; renderProfile(); }
    else if (d.editPrefs !== undefined) openOnboarding(true);
    else if (d.avatar) $all(".emoji-pick").forEach(function (b) { b.classList.toggle("active", b === t); });
    else if (d.saveProfile !== undefined) {
      var name = $("#editName").value.trim() || "You";
      var handle = $("#editHandle").value.trim().replace(/[^A-Za-z0-9_.]/g, "") || "toefl_learner";
      var picked = $(".emoji-pick.active");
      st().profile = { name: name, handle: handle, avatar: picked ? picked.dataset.avatar : st().profile.avatar };
      editingProfile = false;
      S.save();
      renderProfile();
      buildFeed();
      toast("Profile updated");
    } else if (d.goal) {
      st().daily.goal = parseInt(d.goal, 10);
      var today = C.dayKey();
      if ((st().daily.log[today] || 0) >= st().daily.goal) st().daily.met[today] = true;
      S.save(); renderGoalChip(); renderProfile();
    } else if (d.signin !== undefined) signIn();
    else if (d.signout !== undefined) S.signOut();
    else if (d.delComment) {
      if (!confirm("Delete this reply?")) return;
      S.comments(threadPost.id).then(function (list) {
        var c = list.filter(function (x) { return x.id === d.delComment; })[0];
        return c && S.deleteComment(threadPost, c);
      }).then(function () { refreshCounts(); loadReplies(); });
    }
    // Composer
    else if (d.insert) insertWord(d.insert);
    // Onboarding
    else if (d.obLevel) {
      var lv = parseInt(d.obLevel, 10), i = ob.levels.indexOf(lv);
      if (i >= 0) ob.levels.splice(i, 1); else ob.levels.push(lv);
      renderOnboarding();
    } else if (d.obTopic) {
      var j = ob.topics.indexOf(d.obTopic);
      if (j >= 0) ob.topics.splice(j, 1); else ob.topics.push(d.obTopic);
      renderOnboarding();
    } else if (d.obFollow) { ob.follow[d.obFollow] = !ob.follow[d.obFollow]; renderOnboarding(); }
    else if (d.obNext !== undefined) { if (ob.step < 2) { ob.step++; renderOnboarding(); } else finishOnboarding(); }
    else if (d.obBack !== undefined) { ob.step--; renderOnboarding(); }
    else if (d.obClose !== undefined) closeOnboarding();
  });

  // Word sheet
  $("#sheetOverlay").addEventListener("click", closeSheet);
  $("#speakBtn").addEventListener("click", function () { if (sheetKey) speak(sheetKey); });
  $("#sheetSave").addEventListener("click", function () {
    if (!sheetKey) return;
    if (st().words[sheetKey]) { delete st().words[sheetKey]; toast("Removed from Review"); }
    else { addWord(sheetKey, sheetFrom); toast("Added to Review 📚"); }
    S.save();
    updateSheetButton();
    refreshWordMarks();
    if (route.name === "review") renderReview();
  });
  $("#sheetMore").addEventListener("click", function () {
    var k = sheetKey;
    closeSheet();
    go("#/search?q=" + encodeURIComponent(k));
  });
  (function swipeToClose() {
    var sheet = $("#wordSheet"), startY = null;
    sheet.addEventListener("touchstart", function (e) { startY = sheet.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (startY === null) return;
      sheet.style.transform = "translateY(" + Math.max(0, e.touches[0].clientY - startY) + "px)";
    }, { passive: true });
    sheet.addEventListener("touchend", function (e) {
      if (startY === null) return;
      var dy = e.changedTouches[0].clientY - startY;
      sheet.style.transform = "";
      startY = null;
      if (dy > 80) closeSheet();
    });
  })();

  // Composer
  $("#composerCancel").addEventListener("click", function () {
    if ($("#composerText").value.trim() && !confirm("Discard this thread?")) return;
    $("#composerText").value = "";
    closeComposer();
  });
  $("#composerText").addEventListener("input", updateComposer);
  $("#composerPost").addEventListener("click", submitPost);
  $("#challengeShuffle").addEventListener("click", function () { pickChallenge(); renderChallenge(); });

  // Replies
  $("#replyInput").addEventListener("input", function () { $("#replySend").disabled = !this.value.trim(); });
  $("#replyInput").addEventListener("focus", function () { if (!S.canWrite()) { this.blur(); requireAccount("reply"); } });
  $("#replyInput").addEventListener("keydown", function (e) { if (e.key === "Enter") sendReply(); });
  $("#replySend").addEventListener("click", sendReply);

  // Search
  var searchTimer = null;
  $("#searchInput").addEventListener("input", function () {
    var q = this.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      history.replaceState(null, "", "#/search" + (q ? "?q=" + encodeURIComponent(q) : ""));
      route.q = q;
      renderSearch(q);
    }, 150);
  });

  $("#backBtn").addEventListener("click", function () {
    if (history.length > 1) history.back(); else go("#/home");
  });
  $("#goalChip").addEventListener("click", function () {
    go("#/profile");
    setTimeout(function () { var g = $("#goalCard"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("#wordSheet").hidden) closeSheet();
  });
  window.addEventListener("hashchange", handleRoute);

  // ---------- Store events ----------
  S.onChange(function (kind) {
    if (kind === "community") {
      communityPosts();
      if (route.name === "home" && window.scrollY < 300) buildFeed(); else feedDirty = true;
      if (route.name === "profile") renderProfile();
      refreshCounts();
    } else if (kind === "stats") {
      refreshCounts();
    } else if (kind === "auth") {
      editingProfile = false;
      renderAll();
      if (S.user) {
        toast("Signed in as " + S.user.name);
        var pending = S.pendingLocalPosts || [];
        S.pendingLocalPosts = [];
        if (pending.length && confirm("Publish the " + pending.length + " thread(s) you wrote on this device to your account? Everyone will be able to see them.")) {
          pending.slice().reverse().reduce(function (p, m) { return p.then(function () { return S.createPost(m.text); }); }, Promise.resolve());
        }
      }
    } else if (kind === "error:offline") {
      toast("Couldn't reach the cloud — using this device only");
    } else if (kind === "error:save") {
      toast("Couldn't save to your account");
    } else if (kind === "error:signin") {
      toast("Sign-in problem — using this device only");
    }
  });

  function renderAll() {
    renderGoalChip();
    refreshWordMarks();
    buildFeed();
    handleRoute();
    if (!st().prefs.onboarded) openOnboarding(false);
  }

  // ---------- Init ----------
  setupInfiniteScroll();
  S.init().then(renderAll);
})();
