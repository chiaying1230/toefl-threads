(function () {
  "use strict";

  var C = window.Core;
  var S = window.Store;
  var VOCAB = window.VOCAB;
  var CHARACTERS = window.CHARACTERS;
  var TOPICS = window.TOPICS;
  var AVATARS = ["🙂", "😎", "🤓", "🥳", "😺", "🦊", "🐼", "🐯", "🐸", "🐨", "🐧", "🦄", "🐙", "🦖", "🐝", "🌸", "🌻", "🍀", "🔥", "⭐", "🌈", "📚", "✏️", "🎧", "🎨", "⚽", "🏀", "🎮", "🍜", "🧋", "🍣", "🍩", "☕", "🧈", "🚀", "🌏"];
  var TARGETS = [0, 80, 90, 100, 105, 110, 115];
  var CHUNK = 15;
  var QUIZ_EVERY = 7;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var esc = C.escapeHtml;

  // The toEfu mascot: a little block of tofu with a face.
  function tofuSvg(size) {
    return '<svg class="tofu" style="width:' + size + "px;height:" + size + 'px" viewBox="0 0 64 64" aria-hidden="true">' +
      '<ellipse cx="32" cy="58" rx="22" ry="3.5" fill="#000" opacity=".08"/>' +
      '<rect x="8" y="18" width="48" height="38" rx="12" fill="#E9D3A3"/>' +
      '<rect x="8" y="12" width="48" height="38" rx="12" fill="#FFF6E0" stroke="#E7CF9C" stroke-width="1.5"/>' +
      '<path d="M17 19h12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="23.5" cy="31" r="3" fill="#3B2F2F"/><circle cx="40.5" cy="31" r="3" fill="#3B2F2F"/>' +
      '<circle cx="24.5" cy="30" r="1" fill="#fff"/><circle cx="41.5" cy="30" r="1" fill="#fff"/>' +
      '<ellipse cx="17.5" cy="37" rx="4" ry="2.4" fill="#FFB4A8" opacity=".8"/><ellipse cx="46.5" cy="37" rx="4" ry="2.4" fill="#FFB4A8" opacity=".8"/>' +
      '<path d="M28.5 37.5q3.5 3.5 7 0" stroke="#3B2F2F" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  }

  function st() { return S.state; }

  // KK phonetic symbols, e.g. "[juˋbɪkwɪtəs]".
  function kk(key) { return (window.KK && window.KK[key]) || ""; }
  function kkHtml(key) { var k = kk(key); return k ? '<span class="kk">' + esc(k) + "</span>" : ""; }

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
    u.rate = (S.state.settings && S.state.settings.rate) || 1;
    window.speechSynthesis.speak(u);
    return u;
  }

  var readingId = null;
  function readPost(id) {
    var post = findPost(id);
    if (!post || !("speechSynthesis" in window)) { speak(""); return; }
    $all(".act.reading").forEach(function (b) { b.classList.remove("reading"); });
    if (readingId === id && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      readingId = null;
      return;
    }
    readingId = id;
    var u = speak(C.speakable(post.text));
    $all('[data-read="' + id + '"]').forEach(function (b) { b.classList.add("reading"); });
    u.onend = u.onerror = function () {
      if (readingId === id) readingId = null;
      $all('[data-read="' + id + '"]').forEach(function (b) { b.classList.remove("reading"); });
    };
  }

  function requireAccount(why) {
    if (S.canWrite()) return true;
    if (confirm("Sign in with Google to " + why + "?")) signIn();
    return false;
  }

  function signIn() {
    var app = inAppBrowser();
    if (app) { if (confirm("Google sign-in doesn't work inside the " + app + " app's browser. " + (isAndroid() ? "Open in Chrome now?" : "Copy the link so you can paste it in Safari?"))) openInBrowser(); return; }
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
    plus: '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
    quote: '<svg viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4z"/><path d="M9 9h6M9 12h4"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M21 3 10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/></svg>',
    speaker: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>'
  };

  // ---------- Interface language: "en" (English) or "bi" (English + 中文 小字) ----------
  var TOPIC_ZH = { Art: "藝術", Astronomy: "天文", Biology: "生物", Business: "商業", "Campus Life": "校園生活", Chemistry: "化學", Culture: "文化",
    Economics: "經濟", Environment: "環境", Food: "美食", Geology: "地質", Health: "健康", History: "歷史", Literature: "文學",
    Philosophy: "哲學", Psychology: "心理", Tech: "科技", Travel: "旅行" };
  function bilingual() { return st().settings.lang === "bi"; }
  function zhSub(zh) { return ' <span class="zh-sub">' + zh + "</span>"; }
  function T(en, zh) { return bilingual() ? en + zhSub(zh) : en; }   // main interface
  function B(en, zh) { return en + zhSub(zh); }                       // first-run screens: always both
  function TP(en, zh) { return bilingual() ? en + " · " + zh : en; }  // placeholders (plain text)

  // Static labels in index.html carry data-zh / data-zh-ph.
  function applyLang() {
    $all("[data-zh]").forEach(function (el) {
      if (el.dataset.en === undefined) el.dataset.en = el.innerHTML;
      el.innerHTML = bilingual() ? el.dataset.en + zhSub(el.dataset.zh) : el.dataset.en;
    });
    $all("[data-zh-ph]").forEach(function (el) {
      if (el.dataset.enPh === undefined) el.dataset.enPh = el.placeholder;
      el.placeholder = TP(el.dataset.enPh, el.dataset.zhPh);
    });
  }

  function setLang(lang) {
    st().settings.lang = lang === "bi" ? "bi" : "en";
    S.save();
    applyLang();
    buildFeed();
    if (route.name === "profile") renderProfile();
    if (route.name === "review") renderReview();
    if (ob) renderOnboarding();
  }

  function avatarHtml(author, size) {
    var style = author.color ? ' style="background:' + author.color + '"' : "";
    var inner = author.photo ? '<img src="' + esc(author.photo) + '" alt="">' : esc(author.avatar || "🙂");
    return '<div class="avatar' + (size ? " " + size : "") + (author.photo ? " has-photo" : "") + '"' + style + ">" + inner + "</div>";
  }

  // Overlay the latest public profile (name, avatar, photo…) of a real user.
  function withProfile(info, uid) {
    var pr = S.profileOf(uid);
    if (!pr) return info;
    return Object.assign({}, info, {
      name: pr.name || info.name, handle: pr.handle || info.handle, avatar: pr.avatar || info.avatar,
      photo: pr.photo || "", bio: pr.bio || "", target: pr.target || 0
    });
  }

  function authorFor(post) {
    var a = C.authorOf(post);
    return post.kind === "user" ? withProfile(a, post.uid) : a;
  }

  function likeCount(post) { return post.baseLikes + S.extraLikes(post); }

  function renderPost(post, opts) {
    opts = opts || {};
    var a = authorFor(post);
    var mine = isMine(post);
    var saved = st().words;
    var liked = !!st().liked[post.id];
    var bookmarked = !!st().bookmarked[post.id];
    var likes = likeCount(post);
    var replies = replyTotal(post);
    var reposted = !!st().reposted[post.id];
    var reposts = S.repostCount(post);
    var followable = !mine && !st().following[a.key];

    var tags = "";
    if (post.level) tags += '<span class="level-tag lv' + post.level + '">' + C.LEVEL_NAMES[post.level] + "</span>";
    if (a.lang) tags += '<span class="tag">' + C.LANG_NAMES[a.lang] + "</span>";
    if (post.topic) tags += '<button class="tag" data-topic="' + esc(post.topic) + '">#' + esc(post.topic) + "</button>";
    if (mine) tags += '<span class="tag">You</span>';

    var extra = "";
    if (post.zh) {
      extra = '<button class="translate-btn" data-translate>' + T("Translate", "翻譯") + '</button><div class="translation" hidden>' + esc(post.zh) + "</div>";
    }
    if (post.quoteOf) extra += quoteCardHtml(findPost(post.quoteOf), post.quoteOf);
    if (post.kind === "user" && post.words.length) {
      extra += '<div class="used-words">' + (mine ? "You used " : "Used ") + post.words.length + " word" + (post.words.length > 1 ? "s" : "") + " 🎉</div>";
    }

    var last = mine
      ? '<button class="act" data-delete="' + post.id + '" aria-label="Delete">' + ICON.trash + "</button>"
      : '<button class="act' + (bookmarked ? " bookmarked" : "") + '" data-bookmark="' + post.id + '" aria-label="Save">' + ICON.bookmark + "</button>";

    var repostLine = opts.repostedBy ? '<div class="repost-line">' + ICON.repost + "<span>" + esc(opts.repostedBy) + " reposted</span></div>" : "";
    return '<article class="post' + (opts.full ? " full" : "") + (repostLine ? " has-repost" : "") + '" data-id="' + post.id + '">' + repostLine +
      '<div class="post-left">' +
        '<button class="avatar-btn" data-person="' + esc(a.key) + '" aria-label="' + esc(a.name) + '"' + (post.uid ? ' data-avatar-uid="' + esc(post.uid) + '"' : "") + ">" + avatarHtml(a) + "</button>" +
        (followable ? '<button class="follow-plus" data-follow="' + esc(a.key) + '" aria-label="Follow ' + esc(a.name) + '">' + ICON.plus + "</button>" : "") +
        '<div class="thread-line"></div>' +
      "</div>" +
      '<div class="post-main">' +
        '<div class="post-head"><button class="post-name" data-person="' + esc(a.key) + '"' + (post.uid ? ' data-name-uid="' + esc(post.uid) + '"' : "") + ">" + esc(a.name) + "</button>" +
          '<span class="post-handle">@' + esc(a.handle) + "</span>" +
          '<span class="post-time">· ' + (post.kind === "char" ? C.formatAge(post.ageMinutes) : C.timeAgo(post.ts)) + "</span>" +
          (post.kind === "user" && !mine ? '<button class="more-btn" data-report-post="' + post.id + '" aria-label="More">⋯</button>' : "") + "</div>" +
        '<div class="post-tags">' + tags + "</div>" +
        '<div class="post-text" data-open="' + post.id + '">' + (post.kind === "char" ? C.renderTagged(post.text, saved) : C.renderFree(post.text, saved)) + "</div>" +
        extra +
        '<div class="actions">' +
          '<button class="act' + (liked ? " liked" : "") + '" data-like="' + post.id + '" aria-label="Like">' + ICON.heart + '<span class="act-count">' + (likes ? C.formatCount(likes) : "") + "</span></button>" +
          '<button class="act" data-open="' + post.id + '" data-reply-count="' + post.id + '" aria-label="Reply">' + ICON.reply + '<span class="act-count">' + (replies ? C.formatCount(replies) : "") + "</span></button>" +
          '<button class="act' + (reposted ? " reposted" : "") + '" data-repost="' + post.id + '" aria-label="Repost">' + ICON.repost + '<span class="act-count">' + (reposts ? C.formatCount(reposts) : "") + "</span></button>" +
          '<button class="act" data-read="' + post.id + '" aria-label="Read aloud">' + ICON.speaker + "</button>" +
          '<button class="act" data-share="' + post.id + '" aria-label="Share">' + ICON.share + "</button>" +
          last +
        "</div>" +
        (opts.full ? "" : convoPeekHtml(post)) +
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
    $all("[data-repost]").forEach(function (b) {
      var post = findPost(b.dataset.repost);
      if (!post) return;
      var n = S.repostCount(post);
      b.classList.toggle("reposted", !!st().reposted[post.id]);
      b.querySelector(".act-count").textContent = n ? C.formatCount(n) : "";
    });
    $all("[data-reply-count]").forEach(function (b) {
      var post = findPost(b.dataset.replyCount);
      if (!post) return;
      var n = replyTotal(post);
      b.querySelector(".act-count").textContent = n ? C.formatCount(n) : "";
    });
  }

  function refreshWordMarks() {
    $all(".vocab").forEach(function (el) { el.classList.toggle("saved", !!st().words[el.dataset.key]); });
    var n = dueKeys().length;
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

  function refreshProfiles() {
    $all("[data-avatar-uid]").forEach(function (el) {
      var pr = S.profileOf(el.dataset.avatarUid);
      if (!pr) return;
      var small = el.querySelector(".avatar.sm") ? "sm" : "";
      el.innerHTML = avatarHtml({ avatar: pr.avatar, photo: pr.photo }, small);
    });
    $all("[data-name-uid]").forEach(function (el) {
      var pr = S.profileOf(el.dataset.nameUid);
      if (pr && pr.name) el.textContent = pr.name;
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
    checkBadges();
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
    $("#sheetWord").textContent = C.label(key);
    $("#sheetPos").textContent = v.pos;
    $("#sheetKK").textContent = kk(key);
    var lv = $("#sheetLevel");
    lv.className = "level-tag lv" + v.level;
    lv.textContent = C.LEVEL_NAMES[v.level];
    $("#sheetZh").textContent = v.zh;
    $("#sheetEx").innerHTML = esc(v.ex).replace(C.wordPattern(key), "<strong>$&</strong>");
    $("#sheetExZh").textContent = v.exZh;
    updateSheetButton();
    $("#sheetOverlay").hidden = false;
    $("#wordSheet").hidden = false;
  }

  function updateSheetButton() {
    var btn = $("#sheetSave");
    var saved = !!st().words[sheetKey];
    btn.innerHTML = saved ? T("✓ In your Review list (tap to remove)", "已在複習清單（點一下移除）") : T("+ Add to Review", "加入複習清單");
    btn.classList.toggle("done", saved);
  }

  function closeSheet() {
    $("#sheetOverlay").hidden = true;
    $("#wordSheet").hidden = true;
    $("#repostSheet").hidden = true;
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
    if (route.name !== "review") rqSave();
    if (!VIEW_OF[route.name]) route = { name: "home", param: "", q: "" };
    routeKey = route.name + "/" + route.param;
    if (route.name !== "profile") profileSettings = false;
    var view = VIEW_OF[route.name];
    closeSheet();
    ["home", "search", "review", "profile", "person", "thread"].forEach(function (v) { $("#view-" + v).hidden = v !== view; });
    $all(".tab[data-go]").forEach(function (t) { t.classList.toggle("active", t.dataset.go === TAB_OF[route.name]); });
    var sub = route.name === "u" || route.name === "t";
    $("#backBtn").hidden = !sub;
    document.body.classList.toggle("in-thread", route.name === "t");
    $("#brand").classList.toggle("compact", sub);
    var title = { home: "toEfu", search: "Search", review: "Review", profile: "Profile", u: "Profile", t: "Thread" }[route.name];
    $("#topbarTitle").textContent = title;

    if (route.name === "home" && feedDirty) buildFeed();
    if (route.name === "search") renderSearch(route.q);
    if (route.name === "review") renderReview();
    if (route.name === "profile") renderProfile();
    if (route.name === "u") renderPerson(route.param);
    if (route.name === "t") renderThread(route.param);
    window.scrollTo(0, scrollMemory[routeKey] || 0);
    if (booted && !st().prefs.onboarded && route.name !== "t" && !ob) openOnboarding(false);
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

  // ---------- Word of the day ----------
  var WOTD_KEY = "toefu.wotdHidden";

  // Top of Home: one row with the word-list button and the vocabulary-test button. The word-list button shows
  // the lists that are on and opens the chips (one per list) that toggle them for the Word of the Day, quizzes and flashcards.
  var packsOpen = false;
  function homeBarHtml() {
    var on = st().prefs.packs && st().prefs.packs.length ? st().prefs.packs : ["toefl"];
    var names = C.PACK_META.filter(function (m) { return on.indexOf(m.id) >= 0; }).map(function (m) { return m.name; }).join(", ");
    var html = '<div class="home-bar"><button class="chip packs-btn' + (packsOpen ? " open" : "") + '" data-packs-open aria-expanded="' + packsOpen + '" aria-label="Word lists: ' + esc(names) + '">' +
      '<span class="packs-names">📚 ' + esc(names) + '</span><span class="packs-caret">▾</span></button>' + quizEntryHtml() + "</div>";
    if (packsOpen) {
      html += '<div class="pack-strip">' + C.PACK_META.map(function (m) {
        return '<button class="chip' + (on.indexOf(m.id) >= 0 ? " active" : "") + '" data-pack-toggle="' + m.id + '">' + esc(m.name) + "</button>";
      }).join("") + "</div>";
    }
    return html;
  }

  function togglePack(id) {
    var s = st(), on = (s.prefs.packs && s.prefs.packs.length ? s.prefs.packs : ["toefl"]).slice(), i = on.indexOf(id);
    if (i >= 0) { if (on.length === 1) { toast("Keep at least one word list"); return; } on.splice(i, 1); } else on.push(id);
    s.prefs.packs = on;
    S.save();
    renderWordOfDay();
    C.loadPacks(on, function (ok) {
      if (!ok) toast("Couldn't load that word list. Check your connection.");
      buildFeed();
      refreshWordMarks();
    });
  }

  // ---------- Entry to the vocabulary-size test (/quiz) ----------
  // /quiz is on the same site, so its best score (localStorage "quizBest": { v: words, ms }) can be read here.
  function quizBestVocab() {
    try { var b = JSON.parse(localStorage.getItem("quizBest")); if (b && isFinite(b.v)) return +b.v; } catch (e) { /* ignore */ }
    return null;
  }

  function quizEntryHtml() {
    var v = quizBestVocab();
    return '<a class="chip quiz-chip" href="quiz/?from=home">' + (v != null ? "📏 " + v.toLocaleString() + " words" : "🧪 Vocabulary test") + "</a>";
  }

  function renderWordOfDay() {
    var slot = $("#wotdSlot");
    if (!slot) return;
    var today = C.dayKey(), hidden = null;
    try { hidden = localStorage.getItem(WOTD_KEY); } catch (e) { /* ignore */ }
    if (feedMode !== "foryou" || !st().prefs.onboarded) { slot.innerHTML = ""; return; }
    var key = C.wordOfDay(today, st().prefs.levels, C.activePool(st().prefs));
    var v = VOCAB[key];
    if (!v) { slot.innerHTML = homeBarHtml(); return; }
    if (hidden === today) {
      slot.innerHTML = homeBarHtml() + '<button class="wotd-mini" data-wotd-show>📅 ' + T("Word of the day", "每日一字") + ": <b>" + esc(C.label(key)) + "</b></button>";
      return;
    }
    var saved = !!st().words[key];
    slot.innerHTML = homeBarHtml() + '<div class="card wotd">' +
      '<div class="wotd-top"><span class="muted small">📅 ' + T("Word of the day", "每日一字") + '</span><button class="notice-x" data-wotd-hide aria-label="Hide">✕</button></div>' +
      '<div class="wotd-word"><b>' + esc(C.label(key)) + '</b><button class="icon-btn plain" data-speak="' + key + '" aria-label="Pronounce">🔊</button></div>' +
      '<div class="wotd-meta"><span class="kk">' + esc(kk(key)) + "</span> · " + esc(v.pos) + ' · <span class="level-tag lv' + v.level + '">' + C.LEVEL_NAMES[v.level] + "</span></div>" +
      '<div class="wotd-zh">' + esc(v.zh) + "</div>" +
      '<div class="wotd-ex">' + esc(v.ex).replace(C.wordPattern(key), "<strong>$&</strong>") + '<div class="muted small">' + esc(v.exZh) + "</div></div>" +
      '<div class="wotd-actions">' + (saved
        ? '<span class="saved-note">✓ ' + T("In your Review list", "已在複習清單") + "</span>"
        : '<button class="primary-btn small" data-wotd-save="' + key + '">' + T("+ Add to Review", "加入複習") + "</button>") +
      '<button class="link" data-word="' + key + '">' + T("More", "更多") + "</button></div></div>";
  }

  function buildFeed() {
    feedDirty = false;
    renderWordOfDay();
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
      // Reposts by people I follow (and me) come first, newest first; each thread shows once.
      var shown = {};
      var reposted = S.repostsFeed().filter(function (r) { return r.uid === me || f["uid:" + r.uid]; }).map(function (r) {
        var p = findPost(r.postId);
        if (!p || shown[p.id]) return null;
        shown[p.id] = true;
        return { repost: true, post: p, by: r.uid === me ? "You" : withProfile({ name: r.name }, r.uid).name };
      }).filter(Boolean);
      feedItems = reposted.concat(community.filter(function (p) { return !shown[p.id] && (f[p.authorKey] || p.uid === me); }))
        .concat(C.BUILTIN.filter(function (p) { return !shown[p.id] && f[p.authorKey]; }));
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
      var item = feedItems[feedIndex];
      html += item.repost ? renderPost(item.post, { repostedBy: item.by }) : renderPost(item);
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
    var saved = loadedWordKeys();
    if (saved.length >= 4) return saved;
    var fromSeen = [];
    Object.keys(S.seen).forEach(function (id) {
      var p = C.BUILTIN_BY_ID[id];
      if (p) p.words.forEach(function (k) { if (fromSeen.indexOf(k) < 0) fromSeen.push(k); });
    });
    if (fromSeen.length >= 4) return fromSeen;
    return C.activePool(st().prefs);
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
      (st().words[q.key] ? "" : '<button class="link" data-quiz-save="' + q.key + '">' + T("+ Add to Review", "加入複習") + "</button>");
    if (st().words[q.key]) { reviewWord(q.key, right); S.save(); refreshWordMarks(); }
    if (right) {
      card.classList.add("win");
      st().stats.quiz = (st().stats.quiz || 0) + 1;
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
    return '<div class="section-title">' + T("Suggested for you", "推薦追蹤") + '</div>' + keys.slice(0, limit).map(personRow).join("");
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
      body.innerHTML = '<div class="section-title">' + T("Browse topics", "瀏覽題材") + '</div><div class="topic-grid">' +
        TOPICS.map(function (t) { return '<button class="chip" data-topic="' + esc(t) + '">#' + esc(t) + "</button>"; }).join("") +
        "</div>" + '<div class="section-title">' + T("Characters", "角色") + '</div>' + Object.keys(CHARACTERS).map(personRow).join("");
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
      var w = C.label(k);
      return w.indexOf(lower) === 0 || (lower.length > 2 && w.indexOf(lower) > 0) || VOCAB[k].zh.indexOf(q) >= 0;
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
      html += '<div class="section-title">' + T("Words", "單字") + '</div><div class="word-results">' + words.map(function (k) {
        return '<button class="word-row" data-word="' + k + '"><span class="w">' + esc(C.label(k)) + '</span><span class="z">' + kkHtml(k) + " " + esc(VOCAB[k].pos + " " + VOCAB[k].zh) + '</span><span class="level-tag lv' + VOCAB[k].level + '">' + C.LEVEL_NAMES[VOCAB[k].level] + "</span></button>";
      }).join("") + "</div>";
    }
    if (people.length) html += '<div class="section-title">' + T("People", "人物") + '</div>' + people.map(personRow).join("");
    if (threads.length) html += '<div class="section-title">Threads · ' + threads.length + "</div>" + threads.slice(0, 40).map(function (p) { return renderPost(p); }).join("");
    body.innerHTML = html || '<div class="empty"><span class="big">🔍</span>No results for “' + esc(q) + "”.</div>";
  }

  // ---------- Person ----------
  function renderPerson(key) {
    var body = $("#personBody");
    if (key.indexOf("uid:") === 0) {
      var uid = key.slice(4);
      if (uid === S.myUid()) { go("#/profile"); return; }
      var info = withProfile(userInfoCache[uid] || { name: "English learner", handle: "user", avatar: "🙂" }, uid);
      var bio = info.bio || "Learning English on toEfu";
      var target = info.target ? "🎯 Target: " + info.target + " · " : "";
      $("#topbarTitle").textContent = "@" + info.handle;
      body.innerHTML = personHeader(key, info.name, info.handle, info.avatar, null, bio, target, "", info.photo) + '<div class="empty">Loading…</div>';
      S.userPosts(uid).then(function (raws) {
        var posts = raws.map(function (r) { var p = C.userPost(r); userPostCache[p.id] = p; return p; });
        if (raws[0]) userInfoCache[uid] = { name: raws[0].name, handle: raws[0].handle, avatar: raws[0].avatar };
        info = withProfile(userInfoCache[uid] || info, uid);
        body.innerHTML = personHeader(key, info.name, info.handle, info.avatar, null, info.bio || bio, target + posts.length + " threads", "", info.photo) +
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

  function personHeader(key, name, handle, avatar, color, bio, meta, followers, photo) {
    var on = !!st().following[key];
    return '<div class="profile-head"><div><h2>' + esc(name) + '</h2><div class="handle">@' + esc(handle) + "</div></div>" +
      avatarHtml({ avatar: avatar, color: color, photo: photo }, "lg") + "</div>" +
      '<p class="profile-bio">' + esc(bio) + "</p>" +
      '<div class="profile-stats">' + (followers ? "<span><b>" + esc(followers) + "</b> followers</span>" : "") + '<span class="muted">' + esc(meta) + "</span></div>" +
      '<div class="profile-edit"><button class="follow-btn wide' + (on ? " on" : "") + '" data-follow="' + esc(key) + '">' + (on ? "Following" : "Follow") + "</button></div>" +
      '<div class="section-title">Threads</div>';
  }

  // ---------- Thread (post + replies) ----------
  var threadPost = null;
  var threadComments = {};
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
    var visitor = !st().prefs.onboarded;
    $("#replyBar").hidden = visitor;
    $("#joinBar").hidden = !visitor;
    if (visitor) $("#joinBar").innerHTML = joinBarHtml();
    $("#replyAvatar").textContent = st().profile.avatar;
    $("#replyInput").placeholder = S.canWrite() ? TP("Reply to " + authorFor(post).name + "…", "留言回覆") : TP("Sign in to reply", "登入後留言");
    body.innerHTML = (visitor ? joinCardHtml(post) : "") + renderPost(post, { full: true }) + '<div class="section-title">' + T("Replies", "回覆") + '</div><div id="replies"><div class="empty small">Loading…</div></div>';
    loadReplies();
  }

  // ---------- Reposts & quotes ----------
  function quoteCardHtml(p, id) {
    if (!p) return '<div class="quote-card missing muted small">This thread is no longer available.</div>';
    var a = authorFor(p), text = plainText(p);
    if (text.length > 160) text = text.slice(0, 157).replace(/\s+\S*$/, "") + "…";
    return '<div class="quote-card" data-open="' + esc(p.id) + '"><div class="quote-head">' + avatarHtml(a, "xs") +
      "<b>" + esc(a.name) + '</b><span class="post-handle">@' + esc(a.handle) + '</span></div><div class="quote-text">' + esc(text) + "</div></div>";
  }

  var repostTarget = null;

  function openRepostSheet(id) {
    var post = findPost(id);
    if (!post || !requireAccount("repost")) return;
    repostTarget = post;
    var on = !!st().reposted[id];
    $("#repostSheet").innerHTML = '<div class="sheet-handle"></div>' +
      '<button class="sheet-option' + (on ? " danger" : "") + '" data-repost-do>' + ICON.repost + "<span>" + (on ? "Remove repost" : "Repost") + "</span></button>" +
      '<button class="sheet-option" data-quote>' + ICON.quote + "<span>Quote</span></button>" +
      '<button class="outline-btn sheet-cancel" data-repost-cancel>Cancel</button>';
    $("#sheetOverlay").hidden = false;
    $("#repostSheet").hidden = false;
  }

  function closeRepostSheet() {
    $("#repostSheet").hidden = true;
    if ($("#wordSheet").hidden && $("#installGuide").hidden) $("#sheetOverlay").hidden = true;
  }

  function toggleRepost() {
    var post = repostTarget;
    closeRepostSheet();
    if (!post) return;
    var on = !st().reposted[post.id];
    S.setReposted(post, on);
    refreshCounts();
    feedDirty = true;
    toast(on ? "Reposted 🔁" : "Repost removed");
    if (route.name === "profile") renderProfile();
  }

  function startQuote() {
    var post = repostTarget;
    closeRepostSheet();
    if (post) openComposer(post.id);
  }

  // Profile → Replies: each of my replies under a small card of the thread it answers.
  var myReplies = null;

  function repliesListHtml(list) {
    if (!list.length) return '<div class="empty">' + tofuSvg(64) + "<br>Your replies will show up here.<br>Open any thread and say something!</div>";
    var p = st().profile;
    return list.map(function (c) {
      return '<div class="reply-item">' + quoteCardHtml(findPost(c.postId), c.postId) +
        '<div class="comment" data-open="' + esc(c.postId) + '">' + avatarHtml(p, "sm") +
        '<div class="comment-main"><div class="post-head"><b class="post-name">' + esc(p.name) + '</b><span class="post-time">· ' + C.timeAgo(c.createdAt) + "</span></div>" +
        '<div class="post-text">' + C.renderFree(c.text, st().words) + "</div></div></div></div>";
    }).join("");
  }

  function loadMyReplies() {
    S.myComments().then(function (list) {
      myReplies = list;
      if (route.name !== "profile" || profileTab !== "replies") return;
      var box = $("#profileList");
      if (box) box.innerHTML = repliesListHtml(list);
      var count = $('[data-ptab="replies"] .muted');
      if (count) count.textContent = list.length;
    }).catch(function (e) {
      console.error(e);
      var box = $("#profileList");
      if (box && !myReplies) box.innerHTML = '<div class="empty small">Couldn\'t load your replies.</div>';
    });
  }

  // ---------- Reporting ----------
  var reportTarget = null;

  function openReportSheet(kind, target, postId) {
    if (!target || !requireAccount("report")) return;
    reportTarget = { kind: kind, target: target, postId: postId };
    $("#repostSheet").innerHTML = '<div class="sheet-handle"></div><h3 class="sheet-title">Report this ' + (kind === "post" ? "thread" : "reply") + "?</h3>" +
      '<p class="muted small">Reports are private. The author won\'t see who reported it.</p>' +
      [["spam", "Spam or scam"], ["harassment", "Harassment or hate"], ["inappropriate", "Inappropriate or sexual content"], ["other", "Something else"]].map(function (r) {
        return '<button class="sheet-option" data-report-reason="' + r[0] + '"><span>' + r[1] + "</span></button>";
      }).join("") +
      '<button class="outline-btn sheet-cancel" data-repost-cancel>Cancel</button>';
    $("#sheetOverlay").hidden = false;
    $("#repostSheet").hidden = false;
  }

  function sendReport(reason) {
    var r = reportTarget;
    closeRepostSheet();
    if (!r) return;
    S.report(r.kind, r.target, r.postId, reason).then(function () {
      toast("Thanks — we'll take a look 🙏");
    }, function (e) {
      console.error(e);
      toast("Couldn't send the report. Wait a few seconds and try again.");
    });
  }

  // ---------- Delete account ----------
  function deleteAccount() {
    var cloud = S.mode === "cloud" && S.user;
    var msg = cloud
      ? "Delete your toEfu account?\n\nThis permanently removes your threads, replies, likes, reposts, saved words, profile and sign-in. It can't be undone."
      : "Delete all toEfu data saved on this device? This can't be undone.";
    if (!confirm(msg)) return;
    if (cloud && !confirm("Are you sure? Everything will be gone for good.")) return;
    toast(cloud ? "Deleting your account…" : "Deleting…", 10000);
    S.deleteAccount(function (m) { toast(m, 10000); }).then(function () {
      toast("Your account was deleted. Bye for now 👋", 4000);
      setTimeout(function () { location.hash = ""; location.reload(); }, 1800);
    }, function (e) {
      console.error(e);
      toast("Couldn't finish deleting. Please sign in again and retry.", 5000);
    });
  }

  // ---------- Sharing ----------
  function appUrl(hash) {
    return location.origin + location.pathname + (hash || "");
  }

  function plainText(post) {
    return post.text.replace(/\[\[([a-z_]+)(?:\|([^\]]+))?\]\]/g, function (m, k, shown) { return shown || C.label(k); })
      .replace(/\s+/g, " ").trim();
  }

  function sharePost(id) {
    var post = findPost(id);
    if (!post) return;
    var a = authorFor(post), text = plainText(post);
    if (text.length > 110) text = text.slice(0, 107).replace(/\s+\S*$/, "") + "…";
    shareLink({ title: a.name + " on toEfu", text: "“" + text + "” — " + a.name + " on toEfu 🧈", url: appUrl("#/t/" + id) });
  }

  function shareApp() {
    shareLink({ title: "toEfu", text: "I'm learning English words by scrolling funny threads on toEfu. Join me! 🧈", url: appUrl("") });
  }

  // Phone share sheet (LINE, Messages, Instagram…) when available, otherwise copy the link.
  function shareLink(data) {
    if (navigator.share) {
      navigator.share(data).catch(function (e) { if (e && e.name !== "AbortError") copyLink(data.url); });
    } else {
      copyLink(data.url);
    }
  }

  function copyLink(url) {
    var done = function () { toast("Link copied — paste it anywhere to share 🔗"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url) ? done() : window.prompt("Copy this link:", url); });
    } else if (fallbackCopy(url)) done();
    else window.prompt("Copy this link:", url);
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // Someone opened a shared thread before setting up the app: show the thread first, then invite them in.
  function joinCardHtml(post) {
    return '<div class="card join-card">' + tofuSvg(48) + '<div class="install-text"><b>A friend shared this thread 👋</b>' +
      '<span class="muted small">toEfu is a free app where funny characters post with real English vocabulary. Tap any <span class="vocab-demo">underlined word</span> to learn it.</span></div></div>';
  }

  function joinBarHtml() {
    return '<button class="primary-btn" data-join>Join toEfu — it\'s free</button>' +
      (canInstall() ? '<button class="outline-btn small" data-install>Get the app</button>' : "");
  }

  function loadReplies() {
    var post = threadPost;
    if (!post) return;
    S.comments(post.id).then(function (list) {
      if (threadPost !== post) return;
      var box = $("#replies");
      var convo = convoHtml(post);
      if (!list.length) {
        box.innerHTML = convo + (convo ? "" : '<div class="empty small">No replies yet. Be the first — ' + (post.kind === "char" ? esc(authorFor(post).name) + " will answer you!" : "say something nice!") + "</div>");
        return;
      }
      threadComments = {};
      list.forEach(function (c) { threadComments[c.id] = c; });
      box.innerHTML = convo + list.map(function (c) { return renderComment(post, c); }).join("");
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

  // ---------- Character conversations (js/data/convos.js) ----------
  function convoOf(post) {
    return post && post.kind === "char" && window.CONVOS && window.CONVOS[post.id] || [];
  }

  function replyTotal(post) {
    return S.replyCount(post) + convoOf(post).length;
  }

  function convoHtml(post) {
    return convoOf(post).map(function (r) {
      var c = CHARACTERS[r.a];
      if (!c) return "";
      return '<div class="comment char-convo">' +
        '<button class="avatar-btn" data-person="' + r.a + '">' + avatarHtml(c, "sm") + "</button>" +
        '<div class="comment-main"><div class="post-head"><button class="post-name" data-person="' + r.a + '">' + esc(c.name) + '</button><span class="post-handle">@' + esc(c.handle) + "</span></div>" +
        '<div class="post-text">' + C.renderTagged(r.t, st().words) + "</div>" +
        '<button class="translate-btn small" data-translate>' + T("Translate", "翻譯") + '</button><div class="translation" hidden>' + esc(r.zh) + "</div></div></div>";
    }).join("");
  }

  // Under a thread in the feed: little avatars of the characters chatting in the replies.
  function convoPeekHtml(post) {
    var list = convoOf(post);
    if (!list.length) return "";
    var who = [];
    list.forEach(function (r) { if (who.indexOf(r.a) < 0 && CHARACTERS[r.a]) who.push(r.a); });
    return '<button class="convo-peek" data-open="' + post.id + '">' +
      '<span class="peek-avatars">' + who.slice(0, 3).map(function (k) { return avatarHtml(CHARACTERS[k], "xs"); }).join("") + "</span>" +
      "<span>" + esc(CHARACTERS[who[0]].name.split(" ")[0]) + (who.length > 1 ? " and " + (who.length - 1) + " other" + (who.length > 2 ? "s" : "") : "") + " replied</span></button>";
  }

  function renderComment(post, c) {
    var mine = c.uid === S.myUid();
    userInfoCache[c.uid] = userInfoCache[c.uid] || { name: c.name, handle: c.handle, avatar: c.avatar };
    var who = withProfile({ name: c.name, handle: c.handle, avatar: c.avatar }, c.uid);
    var html = '<div class="comment">' +
      '<button class="avatar-btn" data-person="uid:' + esc(c.uid) + '" data-avatar-uid="' + esc(c.uid) + '">' + avatarHtml(who, "sm") + "</button>" +
      '<div class="comment-main"><div class="post-head"><button class="post-name" data-person="uid:' + esc(c.uid) + '" data-name-uid="' + esc(c.uid) + '">' + esc(who.name) + '</button><span class="post-time">· ' + C.timeAgo(c.createdAt) + "</span>" +
      (mine ? '<button class="link danger small push" data-del-comment="' + esc(c.id) + '">Delete</button>' : '<button class="link muted small push" data-report-comment="' + esc(c.id) + '">Report</button>') + "</div>" +
      '<div class="post-text">' + C.renderFree(c.text, st().words) + "</div></div></div>";
    if (post.kind === "char") {
      var a = authorFor(post);
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
      myReplies = null;
      st().stats.replies = (st().stats.replies || 0) + 1;
      S.save();
      checkBadges();
      refreshCounts();
      loadReplies();
      var n = C.detectWords(text).length;
      if (n) toast("Nice! You used " + n + " word" + (n > 1 ? "s" : "") + " 🎉");
    }).catch(function (e) {
      console.error(e);
      toast("Couldn't post your reply — wait a few seconds between replies and try again.");
    }).then(function () { $("#replySend").disabled = !input.value.trim(); });
  }

  // ---------- Review (spaced repetition) ----------
  var reviewMode = "list";
  var openWord = null;
  var deck = [], deckIndex = 0, flipped = false, knownCount = 0, practiceAll = false;

  // Saved words whose word list is loaded. A word saved from another list (or from /quiz) stays saved
  // and shows up once its list arrives; until then it would have no meaning or example to show.
  function loadedWordKeys() {
    return Object.keys(st().words).filter(function (k) { return VOCAB[k]; });
  }

  function savedKeys() {
    var w = st().words;
    return loadedWordKeys().sort(function (a, b) { return w[b].addedAt - w[a].addedAt; });
  }

  function dueKeys() {
    var w = st().words, now = Date.now();
    return loadedWordKeys().filter(function (k) { return C.isDue(w[k], now); });
  }

  function renderReview() {
    $all(".seg").forEach(function (s) { s.classList.toggle("active", s.dataset.mode === reviewMode); });
    var keys = savedKeys();
    var body = $("#reviewBody");
    if (!keys.length) {
      body.innerHTML = '<div class="empty">' + tofuSvg(64) + '<br>Your Review list is empty.<br>Tap a <b>blue word</b> in any thread and choose <b>Add to Review</b>,<br>or tap the bookmark on a thread to save all its words.' + (bilingual() ? '<br><span class="zh-sub">複習清單是空的。點串文裡的藍色單字並加入複習，或收藏整則串文。</span>' : "") + "</div>";
      return;
    }
    if (reviewMode === "list") renderWordList(keys, body);
    else if (reviewMode === "quiz") renderReviewQuiz(body);
    else renderFlashcards(body);
  }

  function renderWordList(keys, body) {
    var w = st().words, due = dueKeys().length;
    var mastered = keys.filter(function (k) { return (w[k].box || 0) >= 4; }).length;
    var html = '<div class="card srs-card"><div><b>' + (due ? T(due + " word" + (due > 1 ? "s" : "") + " due today", "今天有 " + due + " 個字要複習") : T("All caught up for today ✨", "今天都複習完了")) + "</b>" +
      '<div class="muted small">' + keys.length + " saved · " + mastered + " mastered · words you know well come back less often</div></div>" +
      (due ? '<button class="post-btn small" data-mode="cards">Review</button>' : "") + "</div>";
    keys.forEach(function (k) {
      var v = VOCAB[k];
      var from = w[k].from;
      var label = C.dueLabel(w[k]);
      html += '<div class="word-item"><button class="word-row" data-toggle-word="' + k + '">' +
        '<span class="w">' + esc(C.label(k)) + '</span><span class="z">' + esc(v.pos + " " + v.zh) + "</span>" +
        '<span class="due' + (label === "Due" ? " now" : "") + '">' + label + "</span></button>";
      if (openWord === k) {
        html += '<div class="word-detail">' + kkHtml(k) + "<p>" + esc(v.ex) + '</p><p class="muted">' + esc(v.exZh) + '</p><div class="row-actions">' +
          '<span class="level-tag lv' + v.level + '">' + C.LEVEL_NAMES[v.level] + "</span>" +
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
    deck = C.shuffle(practiceAll ? savedKeys() : dueKeys());
    deckIndex = 0; flipped = false; knownCount = 0;
  }

  function renderFlashcards(body) {
    deck = deck.filter(function (k) { return st().words[k]; });
    if (!deck.length && !knownCount) startDeck();
    if (!deck.length) {
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard">' + tofuSvg(72) + '<div class="fzh">All caught up!</div>' +
        '<div class="fex">No words are due today. Come back tomorrow — spaced repetition works best a little at a time.</div></div>' +
        '<div class="flash-buttons"><button class="btn-again" data-practice-all>Practice all words anyway</button></div></div>';
      return;
    }
    if (deckIndex >= deck.length) {
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard"><div class="fw">🎉</div><div class="fzh">Nice work!</div><div class="fex">You reviewed ' +
        knownCount + " word" + (knownCount === 1 ? "" : "s") + ". Words you knew will come back in a few days.</div></div>" +
        '<div class="flash-buttons"><button class="btn-got" data-restart>Review again</button></div></div>';
      return;
    }
    var k = deck[deckIndex], v = VOCAB[k];
    var card = flipped
      ? '<div class="fw">' + esc(C.label(k)) + "</div>" + kkHtml(k) + '<div class="fpos">' + v.pos + '</div><div class="fzh">' + esc(v.zh) + '</div><div class="fex">' + esc(v.ex) + '</div><div class="fexzh">' + esc(v.exZh) + "</div>"
      : '<div class="fw">' + esc(C.label(k)) + "</div>" + kkHtml(k) + '<div class="fpos">' + v.pos + '</div><div class="fhint">Tap to reveal the meaning</div>';
    body.innerHTML = '<div class="flash-wrap"><div class="flash-progress">' + (practiceAll ? "Practice" : "Due today") + " · card " + (deckIndex + 1) + " of " + deck.length + " · " + knownCount + " known</div>" +
      '<button class="flashcard' + (flipped ? " flip" : "") + '" data-flip>' + card + "</button>" +
      '<div class="flash-buttons"><button class="btn-again" data-again>Still learning</button><button class="btn-got" data-got>Got it ✓</button></div></div>';
  }

  // ---------- Review quiz: pick the meaning; sometimes say how you chose (docs/review-quiz-spec.md) ----------
  // Questions for words in the /quiz bank reuse its sentence and hand-picked wrong answers; other words use the
  // word list's example and wrong answers from words with the same part of speech. Each answer moves the word in
  // spaced repetition like a flashcard. For half of the devices (same anonymous id as /quiz), a few answers are
  // followed by "how did you choose?" before the answer is shown; finished rounds are saved anonymously.
  var RQ_MAX = 10, RQ_NOTE_DAY_MAX = 6, RQ_NOTE_RATE = 0.5, RQ_NOTE_KEY = "toefu.reviewNotesDay";
  // Same wording as /quiz so the answers can be compared.
  var RQ_REASONS = [["sure", "我會，很確定"], ["torn", "在兩個答案之間猶豫"], ["lookalike", "想到另一個很像的字"], ["affix", "看字的一部分猜的"], ["forgot", "有印象，但想不起來"], ["guess", "用猜的"]];
  var rq = null;              // the current round
  var rqBank = null, rqBankState = "";   // word key -> /quiz bank row; "", "loading", "ready", "failed"

  function quizDeviceId() {
    var id = null;
    try { id = localStorage.getItem("quizDevice"); } catch (e) { /* ignore */ }
    if (!id) {
      var a = new Uint8Array(12);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      id = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      try { localStorage.setItem("quizDevice", id); } catch (e) { /* ignore */ }
    }
    return id;
  }
  function rqNoteArm() { return parseInt(quizDeviceId().slice(0, 8), 16) / 4294967296 < RQ_NOTE_RATE; }
  function rqNotesToday() {
    try { var x = JSON.parse(localStorage.getItem(RQ_NOTE_KEY)); return x && x.day === C.dayKey() ? x.n : 0; } catch (e) { return 0; }
  }
  function rqCountNote() {
    try { localStorage.setItem(RQ_NOTE_KEY, JSON.stringify({ day: C.dayKey(), n: rqNotesToday() + 1 })); } catch (e) { /* ignore */ }
  }

  function rqLoadBank(done) {
    function build() {
      rqBank = {};
      (window.QUIZ_QUESTIONS || []).forEach(function (r) { rqBank[r[0].replace(/ /g, "_")] = r; });
      rqBankState = "ready"; done();
    }
    if (window.QUIZ_QUESTIONS) return build();
    if (rqBankState === "loading") return;
    rqBankState = "loading";
    var el = document.createElement("script");
    el.onload = build;
    el.onerror = function () { rqBankState = "failed"; done(); };
    el.src = "js/data/quiz-questions.js";
    document.head.appendChild(el);
  }

  function rqItem(k) {
    var v = VOCAB[k], row = rqBank && rqBank[k], m;
    if (row) {
      m = /^(.*?)\{([^}]+)\}(.*)$/.exec(row[3]);
      var opts = [{ zh: row[5], t: "answer" }].concat([6, 7, 8].map(function (j, n) { return { zh: row[j], t: (row[9] && row[9][n]) || "" }; }));
      return { key: k, bank: true, author: row[2], before: m ? m[1] : row[3], word: m ? m[2] : null, after: m ? m[3] : "", options: C.shuffle(opts) };
    }
    var all = Object.keys(VOCAB).filter(function (x) { return x !== k && VOCAB[x].zh !== v.zh; });
    var samePos = all.filter(function (x) { return VOCAB[x].pos === v.pos; });
    var sameLevel = samePos.filter(function (x) { return VOCAB[x].level === v.level; });
    var picked = [], seen = {}; seen[v.zh] = 1;
    [sameLevel, samePos, all].forEach(function (pool) {
      C.shuffle(pool).some(function (x) {
        if (picked.length >= 3) return true;
        if (!seen[VOCAB[x].zh]) { seen[VOCAB[x].zh] = 1; picked.push({ zh: VOCAB[x].zh, t: "gen" }); }
        return false;
      });
    });
    m = C.wordPattern(k).exec(v.ex);
    return { key: k, bank: false, author: null, before: m ? v.ex.slice(0, m.index) : v.ex, word: m ? m[0] : null, after: m ? v.ex.slice(m.index + m[0].length) : "",
      options: C.shuffle([{ zh: v.zh, t: "answer" }].concat(picked)) };
  }

  function rqStart() {
    var keys = C.shuffle(practiceAll ? savedKeys() : dueKeys()).slice(0, RQ_MAX);
    rq = { items: keys.map(rqItem), i: 0, phase: keys.length ? "question" : "empty", shownAt: Date.now(), hid: false,
      answers: [], notes: [], asked: { wrong: 0, slow: 0 }, from: 0, other: false };
  }

  // Ask about every wrong answer (up to 2 a round) and one right answer that took much longer than the others.
  function rqShouldAsk(a) {
    if (!rqNoteArm() || rqNotesToday() >= RQ_NOTE_DAY_MAX) return false;
    if (a.result === "wrong") return rq.asked.wrong < 2;
    if (a.hid || rq.asked.slow >= 1) return false;
    var prev = rq.answers.slice(0, -1).map(function (x) { return x.ms; }).sort(function (x, y) { return x - y; });
    if (prev.length < 3) return false;
    var n = prev.length, med = n % 2 ? prev[(n - 1) / 2] : (prev[n / 2 - 1] + prev[n / 2]) / 2;
    return a.ms > 1.5 * med;
  }

  function rqPick(n) {
    if (!rq || rq.phase !== "question") return;
    var it = rq.items[rq.i], o = it.options[n], w = st().words[it.key];
    var a = { word: it.key, bank: it.bank, options: it.options.map(function (x) { return x.zh; }), picked: o.zh,
      result: o.t === "answer" ? "correct" : "wrong", ms: Math.min(600000, Date.now() - rq.shownAt), hid: rq.hid, box: (w && w.box) || 0 };
    rq.answers.push(a);
    it.picked = n;
    if (w) {
      reviewWord(it.key, a.result === "correct");
      if (a.result === "correct") { st().stats.quiz = (st().stats.quiz || 0) + 1; addActivity(1); }
      S.save(); refreshWordMarks();
    }
    if (rqShouldAsk(a)) {
      rq.asked[a.result === "wrong" ? "wrong" : "slow"]++;
      rqCountNote();
      rq.phase = "note"; rq.other = false;
    } else rq.phase = "reveal";
    renderReview();
  }

  function rqReason(reason, other) {
    if (!rq || rq.phase !== "note") return;
    var a = rq.answers[rq.answers.length - 1];
    var note = { at: rq.answers.length - 1, word: a.word, picked: a.picked, result: a.result, ms: Math.min(60000, a.ms), reason: reason, box: a.box };
    if (other) note.other_word = other;
    if (reason) rq.notes.push(note);
    rq.phase = "reveal";
    renderReview();
  }

  function rqNext() {
    if (!rq || rq.phase !== "reveal") return;
    rq.i++;
    if (rq.i >= rq.items.length) { rq.phase = "done"; rqSave(); }
    else { rq.phase = "question"; rq.shownAt = Date.now(); rq.hid = false; }
    renderReview(); window.scrollTo(0, 0);
  }

  // Saves the answers not saved yet: at the end of a round, or when leaving it with at least 3 new answers.
  // The notes are written only after their round is saved (the database rules check that the round exists).
  function rqSave() {
    if (!rq) return;
    var answers = rq.answers.slice(rq.from), from = rq.from;
    if (!answers.length || (rq.phase !== "done" && answers.length < 3)) return;
    var notes = rq.notes.filter(function (x) { return x.at >= from; }).map(function (x) {
      var n = Object.assign({}, x); delete n.at; return n;
    });
    rq.from = rq.answers.length;
    S.saveReviewRun({
      device: quizDeviceId(), date: C.dayKey(), source: "app", qv: String(window.QUIZ_QV || ""),
      correct: answers.filter(function (x) { return x.result === "correct"; }).length, answers: answers
    }).then(function (runId) {
      if (runId) notes.forEach(function (n) { S.saveReviewNote(runId, Object.assign({ run: runId, device: quizDeviceId() }, n)); });
    });
  }

  function rqStemHtml(it) {
    var who = it.author && CHARACTERS[it.author];
    var text = it.word != null ? esc(it.before) + '<span class="rq-target">' + esc(it.word) + "</span>" + esc(it.after) : esc(it.before);
    return '<div class="rq-card">' + (who ? '<div class="rq-who">' + avatarHtml(who, "sm") + "<b>" + esc(who.name) + "</b></div>" : "") +
      '<p class="rq-text" lang="en">' + text + "</p></div>";
  }

  function renderReviewQuiz(body) {
    if (rqBankState !== "ready" && rqBankState !== "failed") {
      body.innerHTML = '<div class="flash-wrap"><p class="muted" style="text-align:center">Loading…</p></div>';
      rqLoadBank(function () { if (route.name === "review" && reviewMode === "quiz") renderReview(); });
      return;
    }
    if (!rq) rqStart();
    if (rq.phase === "empty") {
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard">' + tofuSvg(72) + '<div class="fzh">' + T("All caught up!", "今天都複習完了") + "</div>" +
        '<div class="fex">' + T("No words are due today.", "今天沒有要複習的字。") + "</div></div>" +
        '<div class="flash-buttons"><button class="btn-again" data-rq-all>' + T("Quiz me on all my words", "用全部單字出題") + "</button></div></div>";
      return;
    }
    if (rq.phase === "done") {
      var right = rq.answers.filter(function (x) { return x.result === "correct"; }).length;
      body.innerHTML = '<div class="flash-wrap"><div class="flashcard"><div class="fw">' + (right === rq.answers.length ? "🎉" : "💪") + "</div>" +
        '<div class="fzh">' + right + " / " + rq.answers.length + " " + T("correct", "答對") + "</div>" +
        '<div class="rq-sum">' + rq.answers.map(function (x) {
          return '<span class="' + (x.result === "correct" ? "ok" : "bad") + '">' + (x.result === "correct" ? "✓ " : "✗ ") + esc(C.label(x.word)) + "</span>";
        }).join("") + "</div></div>" +
        '<div class="flash-buttons"><button class="btn-got" data-rq-restart>' + T("Another round", "再來一輪") + "</button></div>" +
        '<a class="rq-full" href="quiz/?from=review">📏 ' + T("How many English words do you know? Take the full test →", "想知道總單字量？做完整測驗 →") + "</a></div>";
      return;
    }
    var it = rq.items[rq.i], v = VOCAB[it.key];
    var head = '<div class="flash-progress">' + (practiceAll ? "Practice" : T("Due today", "今日複習")) + " · " + (rq.i + 1) + " / " + rq.items.length + "</div>" +
      '<div class="quiz-word">' + esc(C.label(it.key)) + '</div><div class="quiz-q">' + T("What does it mean here?", "在這裡是什麼意思？") + "</div>" + rqStemHtml(it);
    var html;
    if (rq.phase === "question") {
      html = head + '<div class="quiz-options">' + it.options.map(function (o, n) {
        return '<button class="quiz-opt" data-rq-pick="' + n + '">' + esc(o.zh) + "</button>";
      }).join("") + "</div>";
    } else if (rq.phase === "note") {
      // Same screen whether the answer was right or wrong: no correct answer, no ✓/✗ until they answer.
      html = head + '<p class="rq-mine">你選了：<b>' + esc(it.options[it.picked].zh) + "</b></p>" +
        '<p class="rq-note-q">剛剛這題，你是怎麼選的？</p><div class="quiz-options">' + RQ_REASONS.map(function (r) {
          return '<button class="quiz-opt' + (rq.other && r[0] === "lookalike" ? " picked" : "") + '" data-rq-reason="' + r[0] + '"' + (rq.other ? " disabled" : "") + ">" + r[1] + "</button>";
        }).join("") + "</div>" +
        (rq.other ? '<div class="rq-other"><input id="rqOther" type="text" maxlength="30" placeholder="是哪個字？（可不填）" aria-label="是哪個字？（可不填）" autocomplete="off" autocapitalize="off"><button class="post-btn small" data-rq-send>送出</button></div>' : "") +
        '<div class="rq-small"><button data-rq-reason="misclick">按錯了</button><button data-rq-skip>略過</button></div>';
    } else {
      var ok = rq.answers[rq.answers.length - 1].result === "correct";
      html = head + '<div class="quiz-options">' + it.options.map(function (o, n) {
        return '<button class="quiz-opt' + (o.t === "answer" ? " correct" : n === it.picked ? " wrong" : "") + '" disabled>' + esc(o.zh) + "</button>";
      }).join("") + "</div>" +
        '<div class="quiz-result">' + (ok ? '<b class="ok">' + T("Correct!", "答對了！") + "</b>" : '<b class="bad">' + T("Not quite.", "不對喔。") + "</b>") +
        "<div><b>" + esc(C.label(it.key)) + "</b> " + kkHtml(it.key) + " " + esc(v.pos + " " + v.zh) + ' <button class="link" data-speak="' + it.key + '">🔊</button></div>' +
        '<div class="muted small">' + esc(v.ex) + "<br>" + esc(v.exZh) + "</div></div>" +
        '<div class="flash-buttons"><button class="btn-got" data-rq-next>' + (rq.i + 1 >= rq.items.length ? T("See results", "看結果") : T("Next", "下一題")) + " →</button></div>";
    }
    body.innerHTML = '<div class="flash-wrap rq">' + html + "</div>";
    if (rq.phase === "note" && rq.other) { var inp = $("#rqOther"); if (inp) inp.focus(); }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && rq) { if (rq.phase === "question") rq.hid = true; rqSave(); }
  });

  function reviewWord(key, correct) {
    var w = st().words[key];
    if (w) st().words[key] = C.review(w, correct);
  }

  // ---------- Badges ----------
  function myPostCount() {
    return communityPosts().filter(isMine).length;
  }

  function checkBadges() {
    var s = st(), x = C.badgeStats(s, myPostCount()), fresh = [];
    C.BADGES.forEach(function (b) {
      if (!s.badges[b.id] && b.test(x)) { s.badges[b.id] = Date.now(); fresh.push(b); }
    });
    if (fresh.length) {
      S.save();
      setTimeout(function () { toast(fresh[0].icon + " New badge: " + fresh[0].name + "!", 3000); }, 900);
    }
  }

  // ---------- Profile ----------
  var editingProfile = false;
  var profileTab = "threads";
  var profileSettings = false;

  function profileTabPosts() {
    var s = st();
    if (profileTab === "threads") return communityPosts().filter(isMine);
    if (profileTab === "reposts") {
      communityPosts();
      return Object.keys(s.reposted).sort(function (a, b) { return s.reposted[b] - s.reposted[a]; }).map(findPost).filter(Boolean);
    }
    var ids = Object.keys(profileTab === "liked" ? s.liked : s.bookmarked);
    communityPosts();
    return ids.map(findPost).filter(Boolean).sort(function (a, b) {
      return (a.kind === "user" ? -a.ts : a.order) - (b.kind === "user" ? -b.ts : b.order);
    });
  }

  function renderProfile() {
    var s = st(), p = s.profile;
    var bstats = C.badgeStats(s, myPostCount());

    var html = '<div class="profile-head"><div><h2>' + esc(p.name) + '</h2><div class="handle">@' + esc(p.handle) + "</div></div>" +
      avatarHtml(p, "lg") + "</div>" +
      (p.bio ? '<p class="profile-bio">' + esc(p.bio) + "</p>" : "") +
      (p.target ? '<p class="profile-bio muted">🎯 Target: <b>' + p.target + "</b></p>" : "");

    html += '<div class="profile-stats"><span><b>' + bstats.posts + "</b> threads</span><span><b>" +
      Object.keys(s.following).length + "</b> following</span><span><b>🔥 " + bstats.streak + "</b> day streak</span>" +
      (quizBestVocab() != null
        ? '<a class="stat-link" href="quiz/?from=profile"><b>📏 ' + quizBestVocab().toLocaleString() + "</b> words</a>"
        : '<a class="stat-link" href="quiz/?from=profile">📏 ' + T("Test vocabulary size", "測單字量") + "</a>") + "</div>";

    if (editingProfile) {
      html += editFormHtml();
    } else if (profileSettings) {
      html += settingsHtml();
    } else {
      html += '<div class="profile-edit"><button class="outline-btn" data-edit-profile>' + T("Edit profile", "編輯") + '</button><button class="outline-btn" data-share-app>' + T("Invite friends", "邀請朋友") + '</button><button class="outline-btn icon-only" data-settings aria-label="Settings">⚙️</button></div>';
      if (S.mode === "cloud" && !S.user) {
        html += '<div class="card account"><span>Sign in to save your progress to your account and post threads everyone can see.</span><button class="primary-btn" data-signin>Sign in with Google</button></div>';
      }
      html += profileTabsHtml(bstats);
    }
    $("#profileBody").innerHTML = html;
  }

  // Threads / Liked / Saved / Badges tabs
  function profileTabsHtml(bstats) {
    var s = st();
    var unlocked = C.BADGES.filter(function (b) { return s.badges[b.id]; }).length;
    var counts = { threads: bstats.posts, replies: myReplies ? myReplies.length : "", reposts: Object.keys(s.reposted).length, liked: Object.keys(s.liked).length, saved: Object.keys(s.bookmarked).length, badges: unlocked };
    var html = '<div class="feed-tabs profile-tabs" role="tablist">' + [["threads", "Threads", "串文"], ["replies", "Replies", "回覆"], ["reposts", "Reposts", "轉發"], ["liked", "Liked", "按讚"], ["saved", "Saved", "收藏"], ["badges", "Badges", "徽章"]].map(function (t) {
      return '<button class="feed-tab' + (profileTab === t[0] ? " active" : "") + '" data-ptab="' + t[0] + '" role="tab">' + t[1] + ' <span class="muted">' + counts[t[0]] + "</span>" + (bilingual() ? zhSub(t[2]) : "") + "</button>";
    }).join("") + "</div>";
    if (profileTab === "badges") {
      return html + '<div id="profileList"><div class="badges">' + C.BADGES.map(function (b) {
        var on = !!s.badges[b.id];
        return '<div class="badge-item' + (on ? " on" : "") + '"><span class="b-icon">' + (on ? b.icon : "🔒") + '</span><b>' + esc(b.name) + '</b><span class="muted">' + esc(b.desc) + "</span></div>";
      }).join("") + "</div></div>";
    }
    if (profileTab === "replies") {
      setTimeout(loadMyReplies, 0);
      return html + '<div id="profileList">' + (myReplies ? repliesListHtml(myReplies) : '<div class="empty small">Loading…</div>') + "</div>";
    }
    var list = profileTabPosts();
    var empty = {
      threads: "You haven't posted yet.<br>Tap <b>＋</b> below and try the word challenge!",
      reposts: "Threads you repost will show up here.<br>Tap 🔁 on any thread.",
      liked: "Threads you like will show up here.<br>Tap ♡ on any thread.",
      saved: "Threads you save will show up here.<br>Tap the bookmark on any thread."
    }[profileTab];
    return html + '<div id="profileList">' + (list.length ? list.map(function (x) { return renderPost(x, profileTab === "reposts" ? { repostedBy: "You" } : null); }).join("") : '<div class="empty">' + tofuSvg(64) + "<br>" + empty + "</div>") + "</div>";
  }

  // Everything that isn't the profile itself lives behind the Settings button.
  function settingsHtml() {
    var s = st(), d = s.daily;
    var today = d.log[C.dayKey()] || 0;
    var days = C.lastDays(d, 7);
    var max = Math.max(d.goal, Math.max.apply(null, days.map(function (x) { return x.value; })));
    var html = '<div class="settings-top"><button class="link" data-settings-close>‹ ' + T("Back to profile", "返回") + "</button><b>" + T("Settings", "設定") + "</b></div>";

    if (S.mode === "cloud" && S.user) {
      html += '<div class="card account"><span>✅ Signed in as <b>' + esc(S.user.name) + '</b>. Your likes, words and threads are saved to your account.</span><button class="link" data-signout>Sign out</button></div>';
    } else if (S.mode === "cloud") {
      html += '<div class="card account"><span>Sign in to save your progress to your account and post threads everyone can see.</span><button class="primary-btn" data-signin>Sign in with Google</button></div>';
    } else {
      html += '<div class="card account muted small">📱 Saved on this device only.</div>';
    }

    html += '<div class="card"><div class="goal-top"><b>' + T("Your feed", "動態牆") + '</b></div><p class="muted small">Choose your level, word lists and the topics you want to see.</p><button class="outline-btn" data-edit-prefs>' + T("Feed preferences", "偏好設定") + "</button></div>";
    html += '<div class="card" id="langCard"><div class="goal-top"><b>' + T("Interface language", "介面語言") + '</b></div><div class="goal-pick">' +
      [["en", "English"], ["bi", "English + 中文"]].map(function (l) {
        return '<button class="chip' + ((s.settings.lang || "en") === l[0] ? " active" : "") + '" data-lang="' + l[0] + '">' + l[1] + "</button>";
      }).join("") + '</div><p class="muted small">Threads stay in English either way. 串文內容一律維持英文。</p></div>';

    html += '<div class="card goal-card" id="goalCard"><div class="goal-top"><b>' + T("Daily goal", "每日目標") + '</b><span class="muted">' + today + " / " + d.goal + " today</span></div>" +
      '<div class="goal-bar"><i style="width:' + Math.min(100, Math.round(today / d.goal * 100)) + '%"></i></div>' +
      '<div class="bars">' + days.map(function (x) {
        return '<div class="bar-col"><div class="bar' + (d.met[x.key] ? " met" : "") + '" style="height:' + Math.max(4, Math.round(x.value / max * 60)) + 'px" title="' + x.value + '"></div><span>' + x.label + "</span></div>";
      }).join("") + "</div>" +
      '<div class="goal-pick"><span class="muted small">Goal:</span>' + [5, 10, 20].map(function (g) {
        return '<button class="chip' + (d.goal === g ? " active" : "") + '" data-goal="' + g + '">' + g + " / day</button>";
      }).join("") + '</div><p class="muted small">Each new saved word, correct quiz answer and "Got it" flashcard counts as 1.</p></div>';

    html += '<div class="card"><div class="goal-top"><b>' + T("Read-aloud speed", "朗讀速度") + '</b></div><div class="goal-pick">' +
      [[1, "Normal"], [0.8, "Slow"], [0.6, "Very slow"]].map(function (r) {
        return '<button class="chip' + (s.settings.rate === r[0] ? " active" : "") + '" data-rate="' + r[0] + '">' + r[1] + "</button>";
      }).join("") + "</div></div>";

    html += notificationsCardHtml() + installCardHtml(false);

    html += '<div class="card"><div class="goal-top"><b>' + T("About toEfu", "關於") + '</b></div>' +
      '<p class="muted small"><a class="link" href="privacy.html">Privacy policy</a> · <a class="link" href="terms.html">Terms &amp; community rules</a></p>' +
      '<button class="link danger" data-delete-account>' + (S.mode === "cloud" && S.user ? "Delete my account" : "Delete data on this device") + "</button></div>";

    var followKeys = Object.keys(s.following);
    html += '<div class="section-title">' + T("Following", "追蹤中") + " · " + followKeys.length + "</div>";
    html += followKeys.length ? '<div class="following-strip">' + followKeys.map(function (k) {
      var c = CHARACTERS[k];
      var info = c || userInfoCache[k.slice(4)] || { avatar: "🙂", name: "User" };
      return '<button class="mini-person" data-person="' + esc(k) + '">' + avatarHtml({ avatar: info.avatar, color: c && c.color }) + "<span>" + esc(info.name.split(" ")[0]) + "</span></button>";
    }).join("") + "</div>" : '<div class="empty small">Not following anyone yet.</div>';
    return html;
  }

  // ---------- Edit profile ----------
  var draft = null;   // photo/avatar being edited

  function editFormHtml() {
    var p = st().profile;
    draft = draft || { photo: p.photo || "", avatar: p.avatar };
    return '<div class="edit-form">' +
      '<div class="photo-row"><div id="editPreview">' + avatarHtml(draft, "lg") + "</div>" +
        '<div class="photo-actions"><label class="outline-btn file-btn">📷 Upload photo<input type="file" accept="image/*" id="photoInput" hidden></label>' +
        (draft.photo ? '<button class="link danger" data-remove-photo>Remove photo</button>' : '<span class="muted small">Or pick an emoji below</span>') + "</div></div>" +
      '<label>Name<input id="editName" maxlength="40" value="' + esc(p.name) + '"></label>' +
      '<label>Username<input id="editHandle" maxlength="24" autocapitalize="off" value="' + esc(p.handle) + '"></label>' +
      '<label>Bio <span class="muted" id="bioCount">' + (p.bio || "").length + '/160</span><textarea id="editBio" maxlength="160" rows="3" placeholder="e.g. Aiming for 100+ this summer! Loves cats and boba.">' + esc(p.bio || "") + "</textarea></label>" +
      ((st().prefs.packs || ["toefl"]).indexOf("toefl") < 0 && !p.target ? "" : '<label>TOEFL target score (optional)<select id="editTarget">' + TARGETS.map(function (t) {
        return '<option value="' + t + '"' + ((p.target || 0) === t ? " selected" : "") + ">" + (t ? t + "+" : "Not set") + "</option>";
      }).join("") + "</select></label>") +
      '<label>Emoji avatar<div class="emoji-picks">' + AVATARS.map(function (a) {
        return '<button class="emoji-pick' + (!draft.photo && a === draft.avatar ? " active" : "") + '" data-avatar="' + a + '">' + a + "</button>";
      }).join("") + "</div></label>" +
      '<div class="profile-edit flush"><button class="outline-btn" data-cancel-edit>Cancel</button><button class="primary-btn" data-save-profile>Save profile</button></div></div>';
  }

  function refreshDraftPreview() {
    var box = $("#editPreview");
    if (box) box.innerHTML = avatarHtml(draft, "lg");
    $all(".emoji-pick").forEach(function (b) { b.classList.toggle("active", !draft.photo && b.dataset.avatar === draft.avatar); });
    var actions = $(".photo-actions");
    if (actions) actions.lastElementChild.outerHTML = draft.photo ? '<button class="link danger" data-remove-photo>Remove photo</button>' : '<span class="muted small">Or pick an emoji below</span>';
  }

  // Crop to a square and shrink so it fits comfortably in the database (< 55 KB).
  function processPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var size = 192, c = document.createElement("canvas");
        c.width = c.height = size;
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        var q = 0.82, data = c.toDataURL("image/jpeg", q);
        while (data.length > 55000 && q > 0.3) { q -= 0.12; data = c.toDataURL("image/jpeg", q); }
        URL.revokeObjectURL(url);
        resolve(data);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }

  function saveProfileForm() {
    var old = st().profile;
    var next = {
      name: $("#editName").value.trim().slice(0, 40) || "You",
      handle: $("#editHandle").value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24) || old.handle || "toefu_learner",
      bio: $("#editBio").value.trim().slice(0, 160),
      target: $("#editTarget") ? parseInt($("#editTarget").value, 10) || 0 : old.target || 0,
      avatar: draft.avatar || "🙂",
      photo: draft.photo || ""
    };
    editingProfile = false;
    draft = null;
    S.saveProfile(next).then(function () { toast("Profile updated ✨"); }, function (e) {
      console.error(e);
      toast("Saved on this phone — couldn't update your public profile");
    });
    renderProfile();
    buildFeed();
  }

  // ---------- Notifications ----------
  // What to do when turning notifications on fails, by step.
  var PUSH_HELP = {
    permission: '<p class="muted small">Allow notifications for this site: tap the 🔒 or ⓘ icon next to the address → <b>Permissions</b> (網站設定) → <b>Notifications</b> → Allow. On an app added to your Home Screen: Android Settings → Apps → toEfu → Notifications → On.</p>',
    sw: '<p class="muted small">The app\'s background helper isn\'t ready yet. Reload the page once and try again.</p>',
    token: '<p class="muted small">Your phone couldn\'t register with the notification service. Check your connection, reload the page and try again. If you use a battery saver or a privacy browser, try Chrome.</p>',
    save: '<p class="muted small">Notifications were allowed, but we couldn\'t save them to your account. Reload the page and try again.</p>'
  };

  function pushErrorHtml(err) {
    var stage = PUSH_HELP[err.stage] ? err.stage : "token";
    var title = { permission: "Notifications aren't allowed", sw: "Couldn't start notifications", token: "Couldn't register this phone", save: "Couldn't save to your account" }[stage];
    return '<div class="push-error"><b>⚠️ ' + title + "</b>" + PUSH_HELP[stage] +
      (err.detail ? '<code class="push-code">' + esc(stage + " · " + String(err.detail).slice(0, 160)) + "</code>" : "") + "</div>";
  }

  function notificationsCardHtml() {
    var status = S.pushStatus(), info = S.pushInfo();
    var body = "";
    if (status === "ios-needs-install") {
      body = '<p class="muted small">On iPhone, notifications work after you add toEfu to your Home Screen and open it from there.</p><button class="outline-btn" data-install-guide>Show me how</button>';
    } else if (status === "unsupported") {
      body = '<p class="muted small">This browser doesn\'t support notifications. Try Chrome or Safari.</p>';
    } else if (status === "needs-setup") {
      body = '<p class="muted small">Notifications are coming soon.</p>';
    } else if (status === "needs-signin") {
      body = '<p class="muted small">Sign in to get notified when people reply to or like your threads.</p><button class="outline-btn" data-signin>Sign in with Google</button>';
    } else if (status === "denied") {
      body = '<p class="muted small">Notifications are blocked for this site.</p>' + PUSH_HELP.permission;
    } else if (!info.enabled) {
      body = '<p class="muted small">Get a notification when someone replies to your thread, a daily summary of new likes, and a reminder when words are due for review.</p>' +
        (info.error ? pushErrorHtml(info.error) : "") +
        '<button class="primary-btn" data-push-on>🔔 ' + (info.error ? "Try again" : "Turn on notifications") + "</button>";
    } else {
      body = '<div class="toggle-list">' + [["replies", T("Replies to my threads", "有人回覆我的串文")], ["likes", T("Daily summary of likes (8 pm)", "每晚 8 點按讚摘要")], ["review", T("Daily review reminder (9 am)", "每天早上 9 點複習提醒")]].map(function (x) {
        return '<label class="toggle"><span>' + x[1] + '</span><input type="checkbox" data-push-pref="' + x[0] + '"' + (info.prefs[x[0]] !== false ? " checked" : "") + "></label>";
      }).join("") + '</div><div class="push-actions"><button class="outline-btn small" data-push-test>Send a test notification</button><button class="link danger" data-push-off>Turn off notifications</button></div>';
    }
    return '<div class="card" id="notifCard"><div class="goal-top"><b>🔔 ' + T("Notifications", "通知") + '</b>' + (info.enabled && status === "ready" ? '<span class="muted small">On</span>' : "") + "</div>" + body + "</div>";
  }

  function turnOnPush() {
    var info = S.pushInfo();
    var btn = $("[data-push-on]");
    if (btn) { btn.disabled = true; btn.textContent = "Turning on…"; }
    S.enablePush(info.prefs).then(function () {
      toast("Notifications on 🔔");
      S.testNotification().catch(function (e) { console.error(e); });
    }, function (e) {
      console.error(e);
      toast(e && e.stage === "permission" ? "Notifications were not allowed" : "Couldn't turn on notifications — see the details below");
    }).then(function () { if (route.name === "profile") renderProfile(); });
  }

  // ---------- Install (PWA) ----------
  var installPrompt = null;
  var INSTALL_DISMISS_KEY = "toeflThreads.installDismissed";

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  }
  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function canInstall() {
    if (isStandalone() || inAppBrowser()) return false;
    return !!installPrompt || isIOS();
  }

  function installCardHtml(dismissible) {
    if (!canInstall()) return "";
    return '<div class="card install-card">' + tofuSvg(44) +
      '<div class="install-text"><b>Get the toEfu app</b><span class="muted small">Add it to your Home Screen: opens full-screen, stays signed in' + (isIOS() ? ", and can send notifications" : "") + ".</span></div>" +
      '<button class="post-btn small" data-install>' + (installPrompt ? "Install" : "How?") + "</button>" +
      (dismissible ? '<button class="notice-x" data-install-dismiss aria-label="Not now">✕</button>' : "") + "</div>";
  }

  function renderInstallSlot() {
    var slot = $("#installSlot");
    if (!slot) return;
    var dismissed = 0;
    try { dismissed = parseInt(localStorage.getItem(INSTALL_DISMISS_KEY), 10) || 0; } catch (e) { /* ignore */ }
    var show = st().prefs.onboarded && Date.now() - dismissed > 7 * 86400000;
    slot.innerHTML = show ? installCardHtml(true) : "";
  }

  function startInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then(function (choice) {
        if (choice.outcome === "accepted") toast("Installing toEfu 🧈");
        installPrompt = null;
        renderInstallSlot();
        if (route.name === "profile") renderProfile();
      });
    } else {
      openInstallGuide();
    }
  }

  function openInstallGuide() {
    var chrome = /CriOS/.test(navigator.userAgent);
    var shareIcon = '<svg class="share-ico" viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
    $("#installGuide").innerHTML = '<div class="sheet-handle"></div><h2>Add to Home Screen</h2>' +
      '<p class="muted">toEfu works like an app: full-screen, stays signed in, and on iPhone it can send notifications.</p>' +
      '<ol class="steps">' +
        "<li>Tap the <b>Share</b> button " + shareIcon + (chrome ? " at the top right, next to the address bar." : " at the bottom of Safari.") + ' <span class="muted">（分享）</span></li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b> <span class="muted">（加入主畫面）</span></li>' +
        '<li>Tap <b>Add</b> <span class="muted">（新增）</span>, then open toEfu from the tofu icon on your Home Screen.</li>' +
      "</ol>" +
      '<p class="muted small">You may need to sign in once more inside the Home Screen app.</p>' +
      '<button class="primary-btn" data-close-guide>Got it</button>';
    $("#sheetOverlay").hidden = false;
    $("#installGuide").hidden = false;
  }

  function closeInstallGuide() {
    $("#installGuide").hidden = true;
    if ($("#wordSheet").hidden) $("#sheetOverlay").hidden = true;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installPrompt = e;
    renderInstallSlot();
    if (route.name === "profile") renderProfile();
  });
  window.addEventListener("appinstalled", function () {
    installPrompt = null;
    renderInstallSlot();
    toast("toEfu installed 🎉");
  });

  // ---------- Onboarding / preferences ----------
  var ob = null;
  var booted = false;          // first render done
  var joinedFromShare = false; // started from a shared thread's Join button

  function openOnboarding(editing) {
    var p = st().prefs;
    ob = { step: 0, editing: editing, levels: (p.levels || [2]).slice(), packs: (p.packs && p.packs.length ? p.packs : ["toefl"]).slice(), topics: (p.topics || []).slice(), follow: {} };
    Object.keys(st().following).forEach(function (k) { ob.follow[k] = true; });
    if (!editing) ob.levels = [2];
    ob.login = !editing && S.mode === "cloud" && !S.user;
    if (ob.login) ob.step = -1;
    $("#onboard").hidden = false;
    document.body.style.overflow = "hidden";
    renderOnboarding();
  }

  function renderOnboarding() {
    var body = $("#onboardBody");
    var steps = ob.login ? [-1, 0, 1, 2] : [0, 1, 2];
    var dots = '<div class="ob-dots">' + steps.map(function (i) { return "<i" + (i === ob.step ? ' class="on"' : "") + "></i>"; }).join("") + "</div>";
    var html = "";
    if (ob.step === -1) {
      var app = inAppBrowser();
      body.innerHTML = dots + '<div class="ob-content"><div class="ob-hero">' + tofuSvg(120) + "</div><h2>" + B("Welcome to toEfu", "歡迎來到 toEfu") + "</h2>" +
        '<p class="muted">Learn English words from funny threads. Sign in first so your level, likes, saved words and streak are kept in your account — on every phone, every time you open the app.</p>' +
        '<p class="muted small">從好笑的串文學英文單字。先登入，你的程度、按讚、收藏單字和連續天數都會存在帳號裡，換手機也不會不見。</p>' +
        (app ? '<div class="notice"><div class="notice-text"><b>You\'re in the ' + app + ' app\'s browser.</b> Google sign-in doesn\'t work here. Tap <b>⋯</b> and choose <b>Open in browser</b>（在瀏覽器開啟）.</div></div>' : "") +
        '</div><div class="ob-nav ob-nav-col"><button class="primary-btn google-btn" data-ob-signin>' +
        '<svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
        '<span>Sign in with Google · 用 Google 登入</span></button><button class="text-btn small muted-link" data-ob-skip-signin>Continue without an account · 先不登入</button>' +
        '<p class="muted small ob-legal">By continuing you agree to the <a class="link" href="terms.html">Terms</a> and <a class="link" href="privacy.html">Privacy policy</a>.</p></div>';
      body.scrollTop = 0;
      return;
    }
    if (ob.step === 0) {
      var lang = st().settings.lang || "en";
      html = '<div class="ob-hero">' + tofuSvg(120) + '</div><h2>' + (ob.editing ? B("Your level", "你的程度") : B("Welcome to toEfu", "歡迎來到 toEfu")) + "</h2>" +
        (ob.editing ? "" : '<div class="ob-lang"><span class="muted small">Interface · 介面語言</span><div class="goal-pick">' +
          [["en", "English"], ["bi", "English + 中文"]].map(function (l) {
            return '<button class="chip' + (lang === l[0] ? " active" : "") + '" data-lang="' + l[0] + '">' + l[1] + "</button>";
          }).join("") + "</div></div>") +
        '<p class="muted">Funny characters post every day — packed with real English vocabulary. What level do you want to see?</p>' +
        '<p class="muted small">角色們每天用真正的英文單字發文。你想看哪個程度？</p>' +
        '<div class="ob-options">' + [[1, "Soy Milk · 豆漿", "Everyday words · 常見好入口的字"], [2, "Tofu · 豆腐", "Core words · 核心字"], [3, "Natto · 納豆", "Advanced words · 進階字，要多嚼幾次"]].map(function (x) {
          var on = ob.levels.indexOf(x[0]) >= 0;
          return '<button class="ob-opt' + (on ? " on" : "") + '" data-ob-level="' + x[0] + '"><b>' + x[1] + "</b><span>" + x[2] + "</span></button>";
        }).join("") + '</div><p class="muted small">Pick one or more. · 可以複選。</p>' +
        '<h3 class="ob-sub">' + B("What are you studying for?", "你想學哪一類單字？") + '</h3><div class="topic-grid">' +
        C.PACK_META.map(function (m) {
          return '<button class="chip' + (ob.packs.indexOf(m.id) >= 0 ? " active" : "") + '" data-ob-pack="' + m.id + '">' + esc(m.name) + ' <span class="zh-sub">' + esc(m.zh) + " · " + m.count.toLocaleString() + "</span></button>";
        }).join("") + '</div><p class="muted small">Word lists feed the Word of the Day, quizzes and flashcards. 單字表會用在每日一字、測驗和閃卡。</p>';
    } else if (ob.step === 1) {
      html = "<h2>" + B("What do you like?", "你喜歡什麼題材？") + "</h2><p class=\"muted\">We'll show these topics more often. You'll still see a mix.</p><p class=\"muted small\">這些題材會比較常出現，但你還是會看到各種內容。</p><div class=\"topic-grid\">" +
        TOPICS.map(function (t) { return '<button class="chip' + (ob.topics.indexOf(t) >= 0 ? " active" : "") + '" data-ob-topic="' + esc(t) + '">#' + esc(t) + (TOPIC_ZH[t] ? ' <span class="zh-sub">' + TOPIC_ZH[t] + "</span>" : "") + "</button>"; }).join("") + "</div>";
    } else {
      var keys = Object.keys(CHARACTERS).sort(function (a, b) { return topicScore(b, ob.topics) - topicScore(a, ob.topics); });
      if (!ob.editing && !Object.keys(ob.follow).length) keys.slice(0, 3).forEach(function (k) { ob.follow[k] = true; });
      html = "<h2>" + B("Follow some characters", "追蹤幾個角色") + "</h2><p class=\"muted\">Their threads show up in your <b>Following</b> tab. You'll still see everyone in <b>For you</b>.</p><p class=\"muted small\">他們的串文會出現在 Following 分頁；For you 仍然會看到所有人。</p><div class=\"ob-people\">" + keys.map(function (k) {
        var c = CHARACTERS[k], on = !!ob.follow[k];
        return '<button class="ob-person' + (on ? " on" : "") + '" data-ob-follow="' + k + '">' + avatarHtml(c) + '<span class="person-info"><b>' + esc(c.name) + '</b><span class="bio">' + esc(c.bio) + '</span></span><span class="ob-check">' + (on ? "✓" : "+") + "</span></button>";
      }).join("") + "</div>";
    }
    var next = ob.step < 2 ? B("Next", "下一步") : ob.editing ? B("Save", "儲存") : B("Start scrolling", "開始滑");
    body.innerHTML = dots + '<div class="ob-content">' + html + "</div>" +
      '<div class="ob-nav">' + (ob.step > 0 || (ob.step === 0 && ob.login && !S.user) ? '<button class="outline-btn" data-ob-back>' + B("Back", "上一步") + "</button>" : ob.editing ? '<button class="outline-btn" data-ob-close>' + B("Cancel", "取消") + '</button>' : "<span></span>") +
      '<button class="primary-btn" data-ob-next' + (ob.step === 0 && !ob.levels.length ? " disabled" : "") + ">" + next + "</button></div>";
    body.scrollTop = 0;
  }

  function finishOnboarding() {
    var s = st();
    s.prefs = { levels: ob.levels.sort(), packs: ob.packs.slice(), topics: ob.topics, onboarded: true };
    s.following = {};
    Object.keys(ob.follow).forEach(function (k) { if (ob.follow[k]) s.following[k] = true; });
    S.save();
    closeOnboarding();
    C.loadPacks(s.prefs.packs, function () { buildFeed(); refreshWordMarks(); if (route.name !== "t") handleRoute(); });
    buildFeed();
    renderInstallSlot();
    window.scrollTo(0, 0);
    if (route.name === "profile") renderProfile();
    if (route.name === "t") renderThread(route.param);
    toast("Your feed is ready ✨");
    // Came from a friend's link: next, show how to keep toEfu on the Home Screen.
    if (joinedFromShare && canInstall() && isIOS()) setTimeout(openInstallGuide, 900);
    joinedFromShare = false;
  }

  function closeOnboarding() {
    $("#onboard").hidden = true;
    document.body.style.overflow = "";
    ob = null;
  }

  // ---------- Composer ----------
  var challenge = [];

  function pickChallenge() {
    var pool = loadedWordKeys();
    if (pool.length < 3) {
      pool = C.activePool(st().prefs);
    }
    challenge = C.shuffle(pool).slice(0, 3);
  }

  function renderChallenge() {
    var used = C.detectWords($("#composerText").value);
    $("#challengeWords").innerHTML = challenge.map(function (k) {
      return '<button class="challenge-word' + (used.indexOf(k) >= 0 ? " used" : "") + '" data-insert="' + k + '">' + esc(C.label(k)) + "<small>" + esc(VOCAB[k].zh.split("；")[0]) + "</small></button>";
    }).join("");
  }

  function updateComposer() {
    var text = $("#composerText").value;
    $("#composerCount").textContent = text.length + " / 500";
    $("#composerPost").disabled = !text.trim();
    var used = C.detectWords(text);
    $("#composerDetect").textContent = used.length ? "Words found: " + used.join(", ") : "";
    renderChallenge();
  }

  var composerQuote = null;

  function openComposer(quoteId) {
    if (!requireAccount("post a thread")) return;
    composerQuote = typeof quoteId === "string" ? findPost(quoteId) : null;
    $("#composerQuote").innerHTML = composerQuote ? quoteCardHtml(composerQuote, composerQuote.id) : "";
    $("#composerTitle").innerHTML = composerQuote ? T("Quote", "引用") : T("New thread", "新串文");
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
    var quoted = composerQuote;
    S.createPost(text, quoted).then(function () {
      $("#composerText").value = "";
      composerQuote = null;
      closeComposer();
      feedMode = "foryou";
      scrollMemory["home/"] = 0;
      buildFeed();
      go("#/home");
      window.scrollTo(0, 0);
      var n = C.detectWords(text).length;
      if (quoted) refreshCounts();
      toast(n ? "Posted! You used " + n + " word" + (n > 1 ? "s" : "") + " 🎉" : "Posted!");
      setTimeout(checkBadges, 1500);
    }).catch(function (e) {
      console.error(e);
      toast("Couldn't post — you can post one thread every 30 seconds. Try again in a moment.");
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
    if (liked) checkBadges();
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
    var t = e.target.closest("button, a[href], [data-open], [data-action], [data-person]");
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
      t.innerHTML = tr.hidden ? T("Translate", "翻譯") : T("Hide translation", "隱藏翻譯");
    } else if (d.soon) toast(d.soon + " are coming in the next version");
    else if (d.read) readPost(d.read);
    else if (d.share) sharePost(d.share);
    else if (d.repost) openRepostSheet(d.repost);
    else if (d.repostDo !== undefined) toggleRepost();
    else if (d.quote !== undefined) startQuote();
    else if (d.repostCancel !== undefined) closeRepostSheet();
    else if (d.reportPost) openReportSheet("post", findPost(d.reportPost), d.reportPost);
    else if (d.reportComment) openReportSheet("comment", threadComments[d.reportComment], threadPost && threadPost.id);
    else if (d.reportReason) sendReport(d.reportReason);
    else if (d.deleteAccount !== undefined) deleteAccount();
    else if (d.shareApp !== undefined) shareApp();
    else if (d.join !== undefined) { joinedFromShare = true; openOnboarding(false); }
    else if (d.noticeClose !== undefined) hideNotice();
    else if (d.openBrowser !== undefined) openInBrowser();
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
    else if (d.mode) {
      if (reviewMode === "quiz" && d.mode !== "quiz") rqSave();
      if (d.mode === "quiz" && (!rq || rq.phase === "done" || rq.phase === "empty")) rq = null;
      reviewMode = d.mode; practiceAll = false; if (reviewMode === "cards") startDeck(); renderReview(); window.scrollTo(0, 0);
    }
    else if (d.rqPick !== undefined) rqPick(+d.rqPick);
    else if (d.rqReason) { if (d.rqReason === "lookalike") { rq.other = true; renderReview(); } else rqReason(d.rqReason); }
    else if (d.rqSend !== undefined) { var other = ($("#rqOther") || {}).value; rqReason("lookalike", (other || "").trim().slice(0, 30)); }
    else if (d.rqSkip !== undefined) rqReason(null);
    else if (d.rqNext !== undefined) rqNext();
    else if (d.rqRestart !== undefined) { rq = null; renderReview(); window.scrollTo(0, 0); }
    else if (d.rqAll !== undefined) { practiceAll = true; rq = null; renderReview(); }
    else if (d.practiceAll !== undefined) { practiceAll = true; startDeck(); renderReview(); }
    else if (d.toggleWord) { openWord = openWord === d.toggleWord ? null : d.toggleWord; renderReview(); }
    else if (d.speak) speak(C.label(d.speak));
    else if (d.removeWord) {
      delete st().words[d.removeWord];
      S.save(); refreshWordMarks(); renderReview();
      toast("Removed from Review");
    } else if (d.flip !== undefined) { flipped = !flipped; renderReview(); if (flipped) speak(C.label(deck[deckIndex])); }
    else if (d.again !== undefined) {
      reviewWord(deck[deckIndex], false); S.save(); refreshWordMarks();
      deck.push(deck.splice(deckIndex, 1)[0]); flipped = false; renderReview();
    } else if (d.got !== undefined) {
      reviewWord(deck[deckIndex], true);
      st().stats.cards = (st().stats.cards || 0) + 1;
      knownCount++; deckIndex++; flipped = false; addActivity(1); refreshWordMarks(); renderReview();
    }
    else if (d.restart !== undefined) { startDeck(); renderReview(); }
    // Profile
    else if (d.editProfile !== undefined) { editingProfile = true; profileSettings = false; draft = null; renderProfile(); var f = $(".edit-form"); if (f) window.scrollTo(0, f.offsetTop - 70); }
    else if (d.editPrefs !== undefined) openOnboarding(true);
    else if (d.settings !== undefined) { profileSettings = true; editingProfile = false; renderProfile(); window.scrollTo(0, 0); }
    else if (d.settingsClose !== undefined) { profileSettings = false; renderProfile(); window.scrollTo(0, 0); }
    else if (d.ptab) { profileTab = d.ptab; renderProfile(); var tabs = $(".profile-tabs"); if (tabs) window.scrollTo(0, tabs.offsetTop - 60); }
    else if (d.rate) { st().settings.rate = parseFloat(d.rate); S.save(); renderProfile(); speak("This is how fast I will read."); }
    else if (d.avatar) { draft.avatar = d.avatar; draft.photo = ""; refreshDraftPreview(); }
    else if (d.saveProfile !== undefined) saveProfileForm();
    else if (d.cancelEdit !== undefined) { editingProfile = false; draft = null; renderProfile(); }
    else if (d.removePhoto !== undefined) { draft.photo = ""; refreshDraftPreview(); }
    else if (d.lang) setLang(d.lang);
    else if (d.wotdHide !== undefined) { try { localStorage.setItem(WOTD_KEY, C.dayKey()); } catch (e) { /* ignore */ } renderWordOfDay(); }
    else if (d.packsOpen !== undefined) { packsOpen = !packsOpen; renderWordOfDay(); }
    else if (d.wotdShow !== undefined) { try { localStorage.removeItem(WOTD_KEY); } catch (e) { /* ignore */ } renderWordOfDay(); }
    else if (d.wotdSave) { addWord(d.wotdSave, null); S.save(); refreshWordMarks(); renderWordOfDay(); toast("Added to Review 📚"); }
    else if (d.pushOn !== undefined) turnOnPush();
    else if (d.pushTest !== undefined) S.testNotification().then(function () { toast("Test notification sent 🔔"); }, function (e) { console.error(e); toast("Couldn't show a notification on this device"); });
    else if (d.pushOff !== undefined) { S.disablePush().then(function () { toast("Notifications off"); renderProfile(); }); }
    else if (d.install !== undefined) startInstall();
    else if (d.installGuide !== undefined) openInstallGuide();
    else if (d.closeGuide !== undefined) closeInstallGuide();
    else if (d.installDismiss !== undefined) {
      try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (e2) { /* ignore */ }
      renderInstallSlot();
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
      }).then(function () { myReplies = null; refreshCounts(); loadReplies(); });
    }
    // Composer
    else if (d.insert) insertWord(C.label(d.insert));
    // Onboarding
    else if (d.obLevel) {
      var lv = parseInt(d.obLevel, 10), i = ob.levels.indexOf(lv);
      if (i >= 0) ob.levels.splice(i, 1); else ob.levels.push(lv);
      renderOnboarding();
    } else if (d.packToggle) {
      togglePack(d.packToggle);
    } else if (d.obPack) {
      var pi = ob.packs.indexOf(d.obPack);
      if (pi >= 0) { if (ob.packs.length > 1) ob.packs.splice(pi, 1); } else ob.packs.push(d.obPack);
      renderOnboarding();
    } else if (d.obTopic) {
      var j = ob.topics.indexOf(d.obTopic);
      if (j >= 0) ob.topics.splice(j, 1); else ob.topics.push(d.obTopic);
      renderOnboarding();
    } else if (d.obFollow) { ob.follow[d.obFollow] = !ob.follow[d.obFollow]; renderOnboarding(); }
    else if (d.obNext !== undefined) { if (ob.step < 2) { ob.step++; renderOnboarding(); } else finishOnboarding(); }
    else if (d.obBack !== undefined) { ob.step--; renderOnboarding(); }
    else if (d.obSignin !== undefined) signIn();
    else if (d.obSkipSignin !== undefined) { ob.step = 0; renderOnboarding(); }
    else if (d.obClose !== undefined) closeOnboarding();
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "photoInput" && t.files && t.files[0]) {
      processPhoto(t.files[0]).then(function (data) { draft.photo = data; refreshDraftPreview(); }, function () { toast("Couldn't read that photo"); });
    } else if (t.dataset && t.dataset.pushPref) {
      var info = S.pushInfo();
      info.prefs[t.dataset.pushPref] = t.checked;
      S.updatePushPrefs(info.prefs);
    }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "editBio") $("#bioCount").textContent = e.target.value.length + "/160";
  });

  // Word sheet
  $("#sheetOverlay").addEventListener("click", function () { closeSheet(); closeInstallGuide(); closeRepostSheet(); });
  $("#speakBtn").addEventListener("click", function () { if (sheetKey) speak(C.label(sheetKey)); });
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
    } else if (kind && kind.type === "push") {
      toast("🔔 " + (kind.title || "") + (kind.body ? " — " + kind.body : ""), 4000);
    } else if (kind === "profiles") {
      refreshProfiles();
      if (route.name === "u") renderPerson(route.param);
    } else if (kind === "stats") {
      refreshCounts();
    } else if (kind === "reposts") {
      refreshCounts();
      if (feedMode === "following") { if (route.name === "home" && window.scrollY < 300) buildFeed(); else feedDirty = true; }
    } else if (kind === "auth") {
      editingProfile = false;
      myReplies = null;
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
    } else if (kind === "error:load") {
      toast("Couldn't reach your account — showing the copy saved on this phone");
    } else if (kind === "error:signin") {
      toast("Sign-in problem — using this device only");
    }
  });

  // ---------- Notices (in-app browsers, signed out) ----------
  function inAppBrowser() {
    var ua = navigator.userAgent || "";
    if (/\bLine\//i.test(ua)) return "LINE";
    if (/FBAN|FBAV|FB_IAB|FBIOS/.test(ua)) return "Facebook";
    if (/Instagram/i.test(ua)) return "Instagram";
    if (/MicroMessenger/i.test(ua)) return "WeChat";
    if (/KAKAOTALK/i.test(ua)) return "KakaoTalk";
    if (/Barcelona/i.test(ua)) return "Threads";
    return null;
  }

  function isAndroid() { return /Android/i.test(navigator.userAgent || ""); }

  // Web pages can't force the phone's browser open. Android lets an intent:// link hand the page to Chrome;
  // on iPhone the best we can do is copy the link so it can be pasted into Safari.
  function openInBrowser() {
    if (isAndroid()) {
      var url = location.href;
      var rest = url.replace(/^https?:\/\//, "");
      location.href = "intent://" + rest + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
    } else {
      copyLink(location.href.split("#")[0] + location.hash);
    }
  }

  function showNotice(html, kind) {
    var n = $("#notice");
    if (!n) {
      $("main").insertAdjacentHTML("afterbegin", '<div class="notice" id="notice"></div>');
      n = $("#notice");
    }
    n.dataset.kind = kind;
    n.innerHTML = '<div class="notice-text">' + html + '</div><button class="notice-x" data-notice-close aria-label="Close">✕</button>';
    n.hidden = false;
  }

  function hideNotice() {
    var n = $("#notice");
    if (n) n.hidden = true;
  }

  function updateNotices() {
    var app = inAppBrowser();
    if (app) {
      showNotice("<b>You're in the " + app + " app's browser.</b> You can look around here, but Google sign-in and saved progress need your phone's real browser.<br><button class=\"primary-btn\" data-open-browser>" + (isAndroid() ? "Open in Chrome（用瀏覽器開啟）" : "Copy link（複製連結）") + "</button>" + (isAndroid() ? "" : " <span class=\"muted small\">then paste it in Safari</span>"), "inapp");
    } else if (S.wasSignedOut()) {
      showNotice("You've been signed out on this browser. <button class=\"link\" data-signin>Sign in again</button>", "signedout");
    } else {
      hideNotice();
    }
  }

  function renderAll() {
    applyLang();
    updateNotices();
    renderInstallSlot();
    S.refreshPush();
    renderGoalChip();
    refreshWordMarks();
    buildFeed();
    handleRoute();
    booted = true;
    if (!st().prefs.onboarded) {
      // A shared thread opens straight away; the welcome screens wait until they tap Join or leave the thread.
      if (route.name !== "t" && (!ob || !ob.editing)) openOnboarding(false);
    } else if (ob && !ob.editing) {
      closeOnboarding();
    }
  }

  // ---------- Init ----------
  // LINE supports ?openExternalBrowser=1 to jump straight to the phone's real browser.
  if (inAppBrowser() === "LINE" && !/openExternalBrowser=1/.test(location.search)) {
    location.replace(location.origin + location.pathname + (location.search ? location.search + "&" : "?") + "openExternalBrowser=1" + location.hash);
  }
  // Android in-app browsers (Threads, Instagram, Facebook…): try once to jump to Chrome automatically.
  if (inAppBrowser() && inAppBrowser() !== "LINE" && isAndroid()) {
    var tried = false;
    try { tried = sessionStorage.getItem("toefu-ext-tried") === "1"; sessionStorage.setItem("toefu-ext-tried", "1"); } catch (e) { tried = true; }
    if (!tried) openInBrowser();
  }
  setupInfiniteScroll();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("Service worker not registered", e); });
  }
  S.init().then(function () {
    renderAll();
    // Packs the reader picked earlier load in the background, then the word cards refresh.
    var wanted = (st().prefs.packs || []).filter(function (id) { return id !== "toefl"; });
    if (wanted.length) C.loadPacks(wanted, function () { buildFeed(); refreshWordMarks(); handleRoute(); });
    importQuizWords();
  });

  // The /quiz page links here with ?from=quiz&words=a,b,c: the words the visitor missed go into Review
  // (saved on this device when signed out, and merged into the account when they sign in).
  // Those words may live in a word list that isn't loaded, so load the lists first.
  function importQuizWords() {
    var q = null;
    try { q = new URLSearchParams(location.search); } catch (e) { /* old browser */ }
    var incoming = [];
    if (q && q.get("from") === "quiz") {
      incoming = (q.get("words") || "").split(",").filter(function (k) { return /^[a-z_]+$/.test(k); }).slice(0, 40);
      try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) { /* ignore */ }
    }
    var allLists = C.PACK_META.map(function (m) { return m.id; }).filter(function (id) { return id !== "toefl"; });
    var needLists = incoming.concat(Object.keys(st().words)).some(function (k) { return !VOCAB[k]; });
    function add() {
      var added = incoming.filter(function (k) { return VOCAB[k] && addWord(k, null); }).length;
      if (added) { S.save(); refreshWordMarks(); toast(added + " word" + (added > 1 ? "s" : "") + " added to Review 📚"); }
      if (needLists) { buildFeed(); refreshWordMarks(); handleRoute(); }
    }
    if (needLists) C.loadPacks(allLists, add); else add();
  }
})();
