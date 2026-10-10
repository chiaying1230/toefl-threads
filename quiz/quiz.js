// /quiz page logic. The adaptive scoring (nextLevel, thetaOf, vocabOf, estimate), pick()/SEEN, TITLES and prefixOf() are the confirmed prototype's: do not change their constants.
(function () {
  var TOTAL = 11000, N = 15, LIMIT = 10000;   // 詞庫去重後 11,050 個不重複單字，十級各約 1,100
  // 從脆、LINE 等內建瀏覽器進來：套用主站做好的跳轉（和 js/app.js 的 inAppBrowser / openInBrowser 一致）
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
  // LINE 支援 ?openExternalBrowser=1，直接跳到手機的瀏覽器；其他內建瀏覽器在 Android 上用 intent:// 交給 Chrome，每個分頁只試一次
  if (inAppBrowser() === "LINE" && !/openExternalBrowser=1/.test(location.search)) {
    location.replace(location.origin + location.pathname + (location.search ? location.search + "&" : "?") + "openExternalBrowser=1" + location.hash);
    return;
  }
  if (inAppBrowser() && inAppBrowser() !== "LINE" && isAndroid()) {
    var tried = false;
    try { tried = sessionStorage.getItem("toefu-ext-tried") === "1"; sessionStorage.setItem("toefu-ext-tried", "1"); } catch (e) { tried = true; }
    if (!tried) {
      location.href = "intent://" + location.href.replace(/^https?:\/\//, "") + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(location.href) + ";end";
    }
  }

  var D = window.QUIZ_DATA, STEMS = window.QUIZ_QUESTIONS, postById = {};
  // same rules toEfu's core.js uses for built-in posts: age by feed order, likes fall back to a hash of the id
  function formatAge(m) { return m < 60 ? Math.floor(m) + "m" : m < 1440 ? Math.floor(m / 60) + "h" : m < 10080 ? Math.floor(m / 1440) + "d" : Math.floor(m / 10080) + "w"; }
  D.P.forEach(function (p, i) {
    var h = 0; for (var j = 0; j < p.id.length; j++) h = (h * 31 + p.id.charCodeAt(j)) >>> 0;
    p.t = formatAge(Math.round(2 + 25 * Math.pow(i, 1.3)));
    p.l = p.l || 300 + (h % 4200);
    p.r = p.r || Math.round(p.l / 14);
    postById[p.id] = p;
  });

  var LEVEL_NAMES = { 1: "Soy Milk", 2: "Tofu", 3: "Natto" };   // 與網站新的三級名稱一致
  var TAGS = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  var AGES = ["2m", "5m", "9m", "14m", "21m", "33m", "48m", "1h"];
  function label(k) { return (D.V[k] && D.V[k][5]) || String(k).replace(/_/g, " "); }

  // 題庫：一句話題幹 + 固定四個選項（js/data/quiz-questions.js）。
  var POOL = [];
  STEMS.forEach(function (q, n) {
    var k = q[0], m = q[3].match(/\{([^}]+)\}/), post = null;
    if (D.V[k]) { for (var i = 0; i < D.P.length && !post; i++) if (D.P[i].x.indexOf("[[" + k + "]]") >= 0 || D.P[i].x.indexOf("[[" + k + "|") >= 0) post = D.P[i]; }
    POOL.push({ k: k, lv: q[1], a: q[2], pos: q[4], z: q[5], opts: q.slice(5, 9), shown: m[1],
      before: q[3].slice(0, m.index), after: q[3].slice(m.index + m[0].length), post: post, t: AGES[n % AGES.length] });
  });

  var TITLES = [
    [["英文課都在睡覺", "認得最基本的字，國中程度的單字還有不少沒印象。"], ["菜單只看圖片點餐", "看到整排英文會先找圖片，認得的以最日常的字為主。"],
     ["出國全靠比手畫腳", "單字量還不夠組成句子，但肢體語言應該很強。"], ["翻譯軟體重度用戶", "大部分英文要靠翻譯軟體，自己認得的多是最常見的字。"],
     ["只會 How are you", "打招呼沒問題，再往下聊就需要更多單字。"], ["單字都還給老師了", "以前背過的字大多忘了，現在大約是國中前段的量。"]],
    [["會考倖存者", "國中單字大致都在，高中程度的字開始吃力。"], ["看美劇要開中文字幕", "日常對話的字認得一部分，劇情還是要靠中文字幕。"],
     ["出國點餐沒問題", "旅遊和日常用字夠用，遇到新聞或文章會卡住。"], ["學測戰士", "單字量落在高中程度，學測閱讀的基本盤有了。"],
     ["聽得懂但講不出來", "認得的字不少，但還沒熟到能自己用出來。"], ["英文歌只會唱副歌", "常見的字都認得，稍微少見一點就要用猜的。"]],
    [["辦公室英文擔當", "高中單字很完整，一般工作信件和文件的用字大多認得。"], ["英文信都找你回", "職場常用字夠用，同事會把英文信轉給你。"],
     ["看美劇開英文字幕", "開英文字幕能跟上大部分劇情，偶爾要暫停查字。"], ["朋友出國都帶你", "旅遊、生活和簡單工作場合的用字都能應付。"],
     ["隱藏版英文小老師", "單字量比多數人多，足夠教朋友，只是你平常不說。"], ["開會敢舉手發問", "一般英文會議的用字你認得，也有足夠的字可以發問。"]],
    [["人體翻譯機", "學術和商業用字都認得不少，朋友遇到英文會先問你。"], ["不開字幕看美劇", "一般影集的用字幾乎都認得，不靠字幕也跟得上。"],
     ["外國客戶都丟給你", "商業和正式場合的用字夠用，可以自己應對。"], ["吵架可以用英文", "單字多到情緒上來也找得到字。"],
     ["作夢都講英文", "接近留學程度的單字量，英文已經住在你腦袋裡。"], ["留學生誤認你是同學", "托福、雅思程度的學術單字你大多認得。"]],
    [["行走的字典", "連少見的學術單字都認得，幾乎不用查字典。"], ["字典本人", "這份詞庫裡的字你幾乎全認得。"],
     ["單字界天花板", "已經到這個測驗的上限附近。"], ["莎士比亞的筆友", "連文學和正式文體才會出現的字都難不倒你。"],
     ["母語人士都要問你", "有些字連母語人士都不一定認得，你卻答得出來。"], ["你是不是偷看答案", "最難的幾級都答對了，高到讓人懷疑。"]]
  ];
  var TIER_RANGE = ["2,200 字以下", "2,200 到 5,500 字", "5,500 到 7,700 字", "7,700 到 9,900 字", "9,900 字以上"];
  var IDLE_PREFIX = [["深藏不露的", "這次作答沒有特別的習慣，隨機抽到的。"], ["低調的", "這次作答沒有特別的習慣，隨機抽到的。"], ["剛睡醒的", "這次作答沒有特別的習慣，隨機抽到的。"]];
  var ICON = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z"/></svg>',
    repost: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>'
  };
  var TOFU = document.querySelector(".brand svg").outerHTML;
  var HOST = { n: "toEfu", h: "toefu", svg: TOFU, c: "#FFF6E0" };

  var feed = document.getElementById("feed"), barStat = document.getElementById("barStat");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var NOTE_RATE = 1;   // 問「你是怎麼選的」的裝置比例：目前每個裝置都問（小於 1 時用 device 決定，同一裝置固定出現或固定不出現）
  var QV = typeof window.QUIZ_QV === "string" ? window.QUIZ_QV.slice(0, 20) : null;
  var S = null, ticker = null, qTimer = null, lastResult = null, history = [];
  // 這個裝置累計的挑戰次數和歷史最佳，存在 localStorage（讀不到就退回只存在記憶體，行為和以前一樣）
  function loadPlays() { try { var n = parseInt(localStorage.getItem("quizPlays"), 10); return n > 0 ? n : 0; } catch (e) { return 0; } }
  function loadBest() {
    try { var b = JSON.parse(localStorage.getItem("quizBest")); if (b && isFinite(b.v) && isFinite(b.ms)) return { v: +b.v, ms: +b.ms }; } catch (e) {}
    return null;
  }
  var plays = loadPlays(), best = loadBest(), sessionPlays = 0;   // sessionPlays：這次開啟頁面後的第幾次，只用來區分 quiz_start 和 retry_start
  function savePlays() { try { localStorage.setItem("quizPlays", String(plays)); } catch (e) {} }
  function saveBest() { try { localStorage.setItem("quizBest", JSON.stringify(best)); } catch (e) {} }

  function rnd(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function count(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n); }
  function clock(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function spoken(ms) { var s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? m + "分" + (s % 60) + "秒" : s + "秒"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function show(node, where) { node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: where || "center" }); }
  function add(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); var n = t.content.firstChild; feed.appendChild(n); return n; }

  function avatar(a, sm) {
    return '<div class="avatar' + (sm ? " sm" : "") + '"' + (a.c ? ' style="background:' + a.c + '"' : "") + ">" + (a.svg || esc(a.a || "🙂")) + "</div>";
  }
  function postShell(a, time, right, inner, cls) {
    return '<article class="post slide' + (cls ? " " + cls : "") + '"><div class="post-left">' + avatar(a) + '<div class="thread-line"></div></div>' +
      '<div class="post-main"><div class="post-head"><span class="post-name">' + esc(a.n) + '</span><span class="post-handle">@' + esc(a.h) +
      '</span><span class="post-time">· ' + esc(time) + "</span>" + (right ? '<span class="q-count">' + right + "</span>" : "") + "</div>" + inner + "</div></article>";
  }

  // ---- 挑戰連結、自我估計、紀錄 ----
  // 挑戰連結：toefu.app/quiz?vs=單字量-秒數
  var GUESS_HINT = "左右拖曳圓點，或按 − ＋ 來猜；也可以不猜";
  // 刻度上的對照：國中基本字彙約 1,200 字（教育部），高中參考詞彙約 7,000 字（大考中心）
  var GUESS_MARKS = [[1200, "1,200", "國中"], [7000, "7,000", "高中"]];
  function guessText(g) { return g >= TOTAL ? fmt(TOTAL) + " 以上" : "約 " + fmt(g); }
  var rival = null, guess = null, RUN = null;   // RUN：每次完成會產生的那一筆紀錄，接上資料庫後寫入 Firestore（docs/quiz-db-spec.md）
  (function () { var m = /^(\d{3,5})-(\d{1,4})$/.exec(new URLSearchParams(location.search).get("vs") || ""); if (m) rival = { v: +m[1], sec: +m[2] }; })();
  function sp(v) { return v >= TOTAL ? " " : ""; }
  function vocabText(v) { return v >= TOTAL ? fmt(TOTAL) + "+ 字" : v <= 500 ? "不到 500 字" : "約 " + fmt(v) + " 字"; }
  // 漏斗事件送到 Firebase Analytics，事件名稱照 docs/quiz-db-spec.md。SDK 載入完成前先排隊；載入失敗就丟掉，不影響測驗。
  var EVENT_NAME = { view: "quiz_view", start: "quiz_start", retry_start: "quiz_start", abandon: "quiz_abandon", complete: "quiz_complete" };
  var analytics = null, queued = [], db = null, SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
  function flushEvents() { if (!analytics) return; while (queued.length) { var e = queued.shift(); try { analytics.logEvent(e[0], e[1]); } catch (err) {} } }
  function loadScript(src) {
    return new Promise(function (ok, fail) { var el = document.createElement("script"); el.src = src; el.async = true; el.onload = ok; el.onerror = fail; document.head.appendChild(el); });
  }
  // Firebase（Analytics + Firestore，主站同一個專案），App Check 用和主站相同的金鑰。載入失敗時測驗照常進行，只是沒有排名也不記錄。
  var fbReady = null;
  function firebaseReady() {
    if (fbReady) return fbReady;
    var cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId) return (fbReady = Promise.reject(new Error("no firebase config")));
    fbReady = loadScript(SDK + "firebase-app-compat.js").then(function () {
      var libs = ["firebase-firestore-compat.js"];
      if (cfg.measurementId) libs.push("firebase-analytics-compat.js");
      if (window.FIREBASE_APPCHECK_KEY) libs.push("firebase-app-check-compat.js");
      return Promise.all(libs.map(function (f) { return loadScript(SDK + f).catch(function () {}); }));
    }).then(function () {
      firebase.initializeApp(cfg);
      if (window.FIREBASE_APPCHECK_KEY && firebase.appCheck) {
        try {
          var Provider = window.FIREBASE_APPCHECK_PROVIDER === "enterprise" ? firebase.appCheck.ReCaptchaEnterpriseProvider : firebase.appCheck.ReCaptchaV3Provider;
          firebase.appCheck().activate(Provider ? new Provider(window.FIREBASE_APPCHECK_KEY) : window.FIREBASE_APPCHECK_KEY, true);
        } catch (e) {}
      }
      try { if (cfg.measurementId && firebase.analytics) { analytics = firebase.analytics(); flushEvents(); } } catch (e) { queued.length = 0; }
      db = firebase.firestore();
    });
    fbReady.catch(function () { queued.length = 0; });
    return fbReady;
  }
  function startFirebase() { firebaseReady().catch(function () {}); }
  function track(ev, data) {
    var params = {};
    Object.keys(data || {}).forEach(function (k) { var v = data[k]; if (v != null) params[k] = typeof v === "boolean" ? (v ? 1 : 0) : v; });
    if (ev === "start" || ev === "retry_start") params.attempt_no = plays;
    queued.push([EVENT_NAME[ev] || ev, params]); flushEvents();
  }

  function intro() {
    feed.innerHTML = ""; barStat.textContent = "15 題"; guess = null;
    leaveBar.hidden = true;
    var p = add(postShell(HOST, "now", "",
      '<div class="post-text">15 題，測出你的英文單字量。</div>' +
      (rival ? '<div class="duel"><p class="verdict">朋友向你下戰帖</p><p>對方' + sp(rival.v) + vocabText(rival.v) + "・" + spoken(rival.sec * 1000) + "。答完就知道誰贏。</p></div>" : "") +
      '<ul class="rules"><li>看貼文裡藍色的字，選出它的中文意思</li><li>每題 10 秒，答對會變難，答錯會變簡單</li><li>答完才公布成績</li></ul>' +
      '<div class="guess"><div class="guess-row"><label class="label" for="guessRange">先猜猜看，你有多少單字量？</label>' +
        '<output class="guess-val unset" id="guessVal" for="guessRange">' + GUESS_HINT + "</output></div>" +
        '<div class="guess-ctl"><button class="guess-step" type="button" data-step="-1" aria-label="少 500 字">−</button>' +
          '<div class="guess-track"><input type="range" id="guessRange" min="500" max="' + TOTAL + '" step="500" value="5500">' +
          '<span class="guess-nudge" aria-hidden="true">← 拖曳 →</span></div>' +
          '<button class="guess-step" type="button" data-step="1" aria-label="多 500 字">＋</button></div>' +
        '<div class="guess-scale">' + GUESS_MARKS.map(function (m) {
          return '<span style="left:' + ((m[0] - 500) / (TOTAL - 500) * 100).toFixed(1) + '%"><b>' + m[1] + "</b><i>" + m[2] + "</i></span>";
        }).join("") + '<span class="end r"><b>' + fmt(TOTAL) + "+</b></span></div>" +
        '<button class="guess-clear" id="guessClear" type="button" hidden>不猜了</button></div>' +
      '<button class="post-btn" id="startBtn" type="button">開始挑戰</button><p class="muted small">按下後開始計時</p>'));
    p.classList.remove("slide");
    var range = p.querySelector("#guessRange"), out = p.querySelector("#guessVal"), clr = p.querySelector("#guessClear"), guessBox = p.querySelector(".guess");
    function paintGuess() {
      range.classList.toggle("set", guess != null); out.classList.toggle("unset", guess == null); clr.hidden = guess == null;
      guessBox.classList.toggle("touched", guess != null);
      out.textContent = guess == null ? GUESS_HINT : guess >= TOTAL ? fmt(TOTAL) + " 字以上" : guessText(guess) + " 字";
    }
    p.querySelectorAll(".guess-step").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = (guess == null ? +range.value : guess) + 500 * +b.dataset.step;
        guess = Math.max(500, Math.min(TOTAL, v)); range.value = guess; paintGuess();
      });
    });
    range.addEventListener("input", function () { guess = +range.value; paintGuess(); });
    range.addEventListener("change", function () { guess = +range.value; paintGuess(); });
    clr.addEventListener("click", function () { guess = null; range.value = 5500; paintGuess(); });
    p.querySelector("#startBtn").addEventListener("click", start);
  }

  function start() {
    plays = Math.max(plays, loadPlays()) + 1; sessionPlays++; savePlays();   // 重新讀一次，另一個分頁也玩過的話不會重複編號
    S = { used: {}, ans: [], t0: performance.now(), cur: null, locked: false, guess: guess, rival: rival };
    RUN = null; track(sessionPlays > 1 ? "retry_start" : "start", { self_estimate: guess, challenge: !!rival });
    feed.innerHTML = ""; closeSheet(); leaveBar.hidden = true;
    add(postShell(HOST, "now", "", '<div class="post-text">計時開始。15 題，每題 10 秒。</div>', "done"));
    clearInterval(ticker); ticker = setInterval(tick, 200); tick();
    ask();
  }
  function tick() { if (S) barStat.textContent = Math.min(S.ans.length + 1, N) + "/" + N + " · " + clock(performance.now() - S.t0); }

  // 左上角的 ✕：離開測驗，回到 App。作答中先問一次（避免誤觸），其他時候直接離開。
  var restartBtn = document.getElementById("restartBtn"), leaveBar = document.getElementById("leaveBar");

  // Aa：字體大小 標準 → 大 → 特大，和 App 的「設定 → Text size」共用 localStorage "toefu.textSize"（"std"、"l"、"xl"）
  var TEXT_SIZES = [["std", "標準"], ["l", "大"], ["xl", "特大"]], textSizeBtn = document.getElementById("textSizeBtn");
  function textSizeNow() { var v = null; try { v = localStorage.getItem("toefu.textSize"); } catch (e) {} return v === "l" || v === "xl" ? v : "std"; }
  function paintTextSize(flash) {
    var v = textSizeNow(), name = TEXT_SIZES.filter(function (x) { return x[0] === v; })[0][1];
    if (v === "std") document.documentElement.removeAttribute("data-text"); else document.documentElement.setAttribute("data-text", v);
    textSizeBtn.setAttribute("aria-label", "字體大小：" + name);
    if (flash) {
      textSizeBtn.textContent = name; textSizeBtn.classList.add("flash");
      clearTimeout(paintTextSize.t);
      paintTextSize.t = setTimeout(function () { textSizeBtn.textContent = "Aa"; textSizeBtn.classList.remove("flash"); }, 1200);
    }
  }
  textSizeBtn.addEventListener("click", function () {
    var i = TEXT_SIZES.map(function (x) { return x[0]; }).indexOf(textSizeNow());
    try { localStorage.setItem("toefu.textSize", TEXT_SIZES[(i + 1) % TEXT_SIZES.length][0]); } catch (e) {}
    paintTextSize(true);
  });
  paintTextSize(false);
  function inRound() { return !!(S && !S.total); }
  function leave() {
    var ref = null;
    try { ref = document.referrer ? new URL(document.referrer) : null; } catch (e) {}
    // 從 App 點進來的就回上一頁（App 會停在原本的位置），其他情況（分享連結、直接打開）到首頁
    if (ref && ref.origin === location.origin && !/\/quiz\//.test(ref.pathname) && window.history.length > 1) window.history.back();
    else location.href = "../";
  }
  restartBtn.addEventListener("click", function (e) {
    e.preventDefault();   // it's a link to "../" only so it still works before this script runs
    if (!inRound()) return leave();
    leaveBar.hidden = !leaveBar.hidden;
    if (!leaveBar.hidden) document.getElementById("leaveStay").focus();
  });
  document.getElementById("leaveStay").addEventListener("click", function () { leaveBar.hidden = true; });
  document.getElementById("leaveGo").addEventListener("click", function () {
    if (inRound()) {
      var n = S.ans.length;
      track("abandon", { at_question: n + 1 });
      if (n < 3) { plays = Math.max(0, plays - 1); sessionPlays--; savePlays(); }                    // 前 3 題內放棄不算一次挑戰（只影響「第幾次挑戰」的編號）
      S = null; clearInterval(ticker); clearTimeout(qTimer);
    }
    leaveBar.hidden = true;
    leave();
  });

  // 出過的題目記在這台裝置上，整個題庫都出過一輪之前不會重複
  var SEEN = {};
  try { JSON.parse(localStorage.getItem("quizSeen") || "[]").forEach(function (k) { SEEN[k] = 1; }); } catch (e) {}
  function saveSeen() { try { localStorage.setItem("quizSeen", JSON.stringify(Object.keys(SEEN))); } catch (e) {} }
  function pick(level) {
    for (var pass = 0; pass < 2; pass++) {
      var order = [level];
      for (var d = 1; d < 10; d++) { order.push(level - d); order.push(level + d); }
      for (var i = 0; i < order.length; i++) {
        var L = order[i]; if (L < 1 || L > 10) continue;
        var pool = POOL.filter(function (w) { return w.lv === L && !S.used[w.k] && !SEEN[w.k]; });
        if (pool.length) return pool[rnd(pool.length)];
      }
      SEEN = {};                                   // 題庫全部出過了，才從頭開始
    }
    return POOL[rnd(POOL.length)];
  }
  // ---- 適性出題與估計（3PL + EAP，修正版）----
  var IRT_A = 1.35, IRT_C = 0.25, GRID = [], PRIOR = [];
  for (var g = -45; g <= 45; g++) { GRID.push(g / 10); PRIOR.push(-0.5 * Math.pow(g / 10 / 1.6, 2)); }
  function pKnow(th, L) { return 1 / (1 + Math.exp(-1.7 * IRT_A * (th - (L - 5.5) / 1.8))); }
  function thetaOf(ans) {
    if (!ans.length) return 0;
    var num = 0, den = 0;
    GRID.forEach(function (th, i) {
      var ll = PRIOR[i];
      ans.forEach(function (a) {
        var k = pKnow(th, a.level), p = IRT_C + (1 - IRT_C) * k;
        if (a.kind !== "pick") ll += Math.log(Math.max(1e-7, 1 - k));           // 不認識或逾時：確定不會，沒有猜
        else ll += (a.rt < 1 ? 0.3 : 1) * Math.log(Math.max(1e-7, a.ok ? p : 1 - p));
      });
      var w = Math.exp(ll); num += th * w; den += w;
    });
    return num / den;
  }
  function vocabOf(th) { var sum = 0; for (var L = 1; L <= 10; L++) sum += TOTAL / 10 * pKnow(th, L); return sum; }
  function nextLevel() {
    var h = S.ans, n = h.length;
    if (n === 0) return S.guess == null ? 3 : clamp(Math.round(S.guess / (TOTAL / 10)) - 1, 1, 10);   // 開場從偏簡單的題目起跳          // 自我估計只用來決定第一題，不影響計分
    if (n === 1) return clamp(h[0].level + (h[0].ok ? 2 : -2), 1, 10);
    if (n === 2) return clamp(h[1].level + (h[1].ok ? 2 : -2), 1, 10);
    return clamp(Math.round(1.8 * thetaOf(h) + 5.5 - 0.5), 1, 10);   // 瞄準比估計程度簡單半級的題目：答對率約七成，資訊量不減
  }

  function ask() {
    var i = S.ans.length;
    if (i >= N) return finish();
    var w = pick(nextLevel()); S.used[w.k] = true; SEEN[w.k] = 1; saveSeen();
    S.cur = { w: w, level: w.lv, t: performance.now(), options: shuffle(w.opts), hid: !!document.hidden }; S.locked = false;
    var opts = S.cur.options.map(function (z) { return '<button class="quiz-opt" type="button" data-z="' + esc(z) + '">' + esc(z) + "</button>"; }).join("");
    var p = add(postShell(D.CH[w.a], w.t, (i + 1) + "/" + N + (i === N - 1 ? " · 最後一題" : ""),
      (w.tp ? '<div class="post-tags"><span class="tag">#' + esc(w.tp) + "</span></div>" : "") +
      '<div class="post-text" lang="en">' + esc(w.before) + '<span class="vocab target">' + esc(w.shown) + "</span>" + esc(w.after) + "</div>" +
      '<div class="q-ui"><div class="clock"><i></i></div><div class="quiz-options">' + opts + '</div><button class="idk" type="button">我不認識這個字</button></div>', "live" + (i === N - 1 ? " final" : "")));
    p.dataset.k = w.k;
    S.cur.node = p;
    p.querySelectorAll(".quiz-opt").forEach(function (b) { b.addEventListener("click", function () { answer("pick", b.dataset.z); }); });
    p.querySelector(".idk").addEventListener("click", function () { answer("skip", ""); });
    show(p);
    clearTimeout(qTimer);
    qTimer = setTimeout(function () { answer("timeout", ""); }, LIMIT);
  }

  // 作答這題期間頁面曾被切到背景：這題的 ms 不可信，記在 answers[].hid
  document.addEventListener("visibilitychange", function () { if (document.hidden && S && S.cur && !S.locked) S.cur.hid = true; });

  // 作答中的題目不給長按選單（手機會跳出搜尋或查字典）
  feed.addEventListener("contextmenu", function (e) { if (e.target.closest(".post.live .post-text, .post.done .post-text")) e.preventDefault(); });

  function answer(kind, z) {
    if (!S || S.locked) return;
    S.locked = true; clearTimeout(qTimer);
    var c = S.cur, ok = kind === "pick" && z === c.w.z, i = S.ans.length;
    S.ans.push({ w: c.w, level: c.level, ok: ok, kind: kind, picked: z, options: c.options, hid: !!c.hid, rt: (performance.now() - c.t) / 1000 });
    var said = kind === "pick" ? z : kind === "skip" ? "不認識" : "時間到";
    c.node.querySelector(".q-ui").outerHTML = '<div class="my-reply">' + avatar({ a: "🙂" }, true) + "<span>你回覆：<b>" + esc(said) + "</b></span></div>";
    c.node.classList.remove("live"); c.node.classList.add("done");
    if (S.ans.length >= N) S.total = performance.now() - S.t0;
    setTimeout(ask, 260);
  }

  // ---- scoring ----
  function estimate(ans) {
    var est = vocabOf(thetaOf(ans));
    if (est >= TOTAL * 0.98) return TOTAL;                                      // 高到超出這份測驗量得到的範圍
    return clamp(Math.round(est / 100) * 100, 500, TOTAL - 100);
  }
  function tierOf(v) { return v < 2200 ? 0 : v < 5500 ? 1 : v < 7700 ? 2 : v < 9900 ? 3 : 4; }   // 對應第 2、5、7、9 級的上緣
  function prefixOf(ans, total) {
    var avg = total / ans.length / 1000, c = [];
    var skips = ans.filter(function (a) { return a.kind === "skip"; }).length;
    var run = 0, best = 0; ans.forEach(function (a) { run = a.ok ? run + 1 : 0; best = Math.max(best, run); });
    if (avg < 3) c.push(["快如閃電的", "平均每題不到 3 秒就作答。"]);
    if (avg > 6) c.push(["深思熟慮的", "平均每題想了超過 6 秒。"]);
    if (skips >= 3) c.push(["誠實的", "按了 " + skips + " 次「我不認識這個字」，沒有亂猜。"]);
    if (best >= 5) c.push(["手感發燙的", "曾經連續答對 " + best + " 題。"]);
    if (ans.slice(-3).every(function (a) { return a.ok; })) c.push(["倒吃甘蔗的", "最後 3 題全部答對。"]);
    if (!ans[0].ok) c.push(["慢熱型", "第 1 題就答錯，後面才進入狀況。"]);
    if (!c.length) c = IDLE_PREFIX;
    return c[rnd(c.length)];
  }
  function titleOf(v) {
    var pool = TITLES[tierOf(v)], last = null;
    try { last = localStorage.getItem("lastTitle"); } catch (e) {}
    var choices = pool.filter(function (t) { return t[0] !== last; }), t = choices[rnd(choices.length)];
    try { localStorage.setItem("lastTitle", t[0]); } catch (e) {}
    return t;
  }
  // ---- 排名與紀錄（Firestore，欄位設計見 docs/quiz-db-spec.md）----
  // 每一筆完成的挑戰都計入分布。分布欄位：v<單字量 / 100 的整數>_t<耗時 / 10 秒的整數，120 秒以上都算 12>
  function statField(v, ms) { return "v" + Math.floor(v / 100) + "_t" + (ms >= 120000 ? 12 : Math.floor(ms / 10000)); }
  // 同一份分布裡，排在 (v, ms) 前面的筆數：單字量較高，或單字量同一格而耗時較短。self=true 代表這一筆還沒計入。
  function rankAt(stats, v, ms, self) {
    var vb = Math.floor(v / 100), tb = ms >= 120000 ? 12 : Math.floor(ms / 10000), ahead = 0, n = stats && stats.n || 0;
    Object.keys(stats || {}).forEach(function (k) {
      var m = /^v(\d+)_t(\d+)$/.exec(k); if (!m) return;
      if (+m[1] > vb || (+m[1] === vb && +m[2] < tb)) ahead += stats[k];
    });
    var total = self ? n + 1 : Math.max(n, 1);
    return { rank: ahead + 1, total: total, beat: total - (self ? 1 : 0) - ahead };
  }
  function rankParts(R, all, day, best) {
    var a = rankAt(all, R.v, R.sec * 1000, true), mine = "";
    if (R.prev.length) {
      var b = rankAt(all, best.v, best.ms, false);
      mine = R.isBest ? "這是你目前的最佳成績。" : "你的最佳成績是" + vocabText(best.v) + "（第 " + fmt(b.rank) + " 名）。";
    }
    if (a.total < 200) return { hero: "這是第 <em>" + a.total + "</em> 筆挑戰成績", row: "<b>目前排第 " + a.rank + " 名</b>。" + mine, shareRank: "" };
    var pct = a.rank === 1 ? 100 : Math.min(99, Math.floor(a.beat / (a.total - 1) * 100));
    var d = rankAt(day, R.v, R.sec * 1000, true);
    return { hero: "贏過 <em>" + pct + "%</em> 的挑戰成績", row: "<b>第 " + fmt(a.rank) + " 名</b> / 共 " + fmt(a.total) + " 筆成績　今日第 " + fmt(d.rank) + " 名。" + mine,
      shareRank: "・贏過 " + pct + "% 的成績" };
  }
  function deviceId() {
    var id = null;
    try { id = localStorage.getItem("quizDevice"); } catch (e) {}
    if (!id) {
      var a = new Uint8Array(12);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < a.length; i++) a[i] = rnd(256);
      id = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      try { localStorage.setItem("quizDevice", id); } catch (e) {}
    }
    return id;
  }
  // 名次算好後存在 R.rp；成績卡片已經在畫面上就立刻顯示，還沒出現（還在回答作答方式）就等卡片出現後再顯示
  function applyRank(R) {
    var hero = document.getElementById("heroRank"), row = document.getElementById("rankRow");
    if (!R.rp || lastResult !== R || !hero || !row) return;
    R.shareRank = R.rp.shareRank;
    hero.innerHTML = R.rp.hero; hero.style.display = "";
    document.getElementById("rankDetail").innerHTML = R.rp.row; row.style.display = "";
    paintShare();
  }
  // 先讀分布、算出名次，再用同一個 batch 寫入成績和兩份計數。寫入失敗不影響成績；讀取失敗就不顯示排名。
  // 回傳 Promise：寫入成功時是這筆成績的文件 ID，否則是 null（作答方式的紀錄要等成績寫入成功才寫）。
  function saveAndRank(R, run) {
    var field = statField(run.vocab, run.total_ms), prevBest = best;
    return firebaseReady().then(function () {
      var allRef = db.doc("quizStats/all"), dayRef = db.doc("quizStats/day-" + run.date), runRef = db.collection("quizRuns").doc();
      return Promise.all([allRef.get(), dayRef.get()]).then(function (snaps) {
        var all = snaps[0].exists ? snaps[0].data() : {}, day = snaps[1].exists ? snaps[1].data() : {};
        R.rp = rankParts(R, all, day, prevBest);
        applyRank(R);
        var FV = firebase.firestore.FieldValue, b = db.batch(), bump = {};
        bump[field] = FV.increment(1); bump.n = FV.increment(1); bump.last = runRef.id;
        var doc = Object.assign({}, run, { createdAt: FV.serverTimestamp(), device: deviceId(), source: "web-v2" });
        b.set(runRef, doc);
        b.set(allRef, bump, { merge: true });
        b.set(dayRef, bump, { merge: true });
        return b.commit().then(function () { return runRef.id; }, function () { return null; });
      });
    }).catch(function () { return null; });
  }

  // ---- 作答方式回饋（quizNotes）：成績公布前，請作答者回想最多 2 題是怎麼選的 ----
  var NOTE_REASONS = [["sure", "我會，很確定"], ["torn", "在兩個答案之間猶豫"], ["lookalike", "想到另一個很像的字"], ["affix", "看字的一部分猜的"], ["forgot", "有印象，但想不起來"], ["guess", "用猜的"]];
  function noteArm() { return parseInt(deviceId().slice(0, 8), 16) / 4294967296 < NOTE_RATE; }
  // 答錯的題目優先（最多 2 題）；不足 2 題時補 1 題答對但明顯比較久（超過中位數 1.5 倍、頁面沒被切到背景）的題目。依題號排序，不洩漏對錯。
  function noteItems(ans) {
    var picks = ans.filter(function (a) { return a.kind === "pick"; }).map(function (a) { return a.rt; }).sort(function (x, y) { return x - y; });
    if (!picks.length) return [];
    var med = picks.length % 2 ? picks[(picks.length - 1) / 2] : (picks[picks.length / 2 - 1] + picks[picks.length / 2]) / 2;
    var all = ans.map(function (a, i) { return { a: a, n: i }; });
    var out = shuffle(all.filter(function (x) { return x.a.kind === "pick" && !x.a.ok; })).slice(0, 2);
    if (out.length < 2) {
      var slow = all.filter(function (x) { return x.a.ok && !x.a.hid && x.a.rt > 1.5 * med; }).sort(function (x, y) { return y.a.rt - x.a.rt; });
      if (slow.length) out.push(slow[0]);
    }
    return out.sort(function (x, y) { return x.n - y.n; });
  }
  // 兩題的畫面和選項完全一樣：只有單字、例句、他選的選項。不顯示正確答案，也不顯示對錯。
  function askNotes(items, savedRun, done) {
    var got = [], i = 0, finished = false;
    function end() {
      if (finished) return; finished = true;
      if (got.length) savedRun.then(function (runId) {
        if (!runId || !db) return;
        got.forEach(function (g) {
          var doc = { run: runId, device: deviceId(), word: g.word, picked: g.picked, result: g.result, ms: g.ms, reason: g.reason, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
          if (g.other) doc.other_word = g.other;
          try { db.collection("quizNotes").doc(runId + "_" + g.word).set(doc).catch(function () {}); } catch (e) {}
        });
      });
      done();
    }
    function next() {
      if (i >= items.length) return end();
      var it = items[i++], a = it.a, w = a.w, node, settled = false;
      var btns = NOTE_REASONS.map(function (r) { return '<button class="quiz-opt" type="button" data-r="' + r[0] + '">' + r[1] + "</button>"; }).join("");
      node = add(postShell(D.CH[w.a], w.t, i + "/" + items.length,
        '<div class="post-text" lang="en">' + esc(w.before) + '<span class="vocab target">' + esc(w.shown) + "</span>" + esc(w.after) + "</div>" +
        '<div class="my-reply">' + avatar({ a: "🙂" }, true) + "<span>你回覆：<b>" + esc(a.picked) + "</b></span></div>" +
        '<p class="note-q">剛剛這題，你是怎麼選的？</p><div class="quiz-options">' + btns + "</div>" +
        '<div class="note-other" hidden><input type="text" maxlength="30" placeholder="是哪個字？（可不填）" aria-label="是哪個字？（可不填）"><button class="outline-btn" type="button" data-send>送出</button></div>' +
        '<div class="note-small"><button type="button" data-r="misclick">按錯了</button><button type="button" data-skip>略過</button></div>', "note"));
      show(node);
      function lock(el) { node.querySelectorAll("button").forEach(function (b) { b.disabled = true; }); if (el) el.classList.add("picked"); }
      function record(reason, other) {
        if (settled) return; settled = true;
        var g = { word: w.k, picked: a.picked, result: a.ok ? "correct" : "wrong", ms: Math.round(a.rt * 1000), reason: reason };
        if (other) g.other = other;
        got.push(g); track("quiz_note_answer", { reason: reason });
        next();
      }
      track("quiz_note_shown", { n: i });
      node.addEventListener("click", function (e) {
        var skip = e.target.closest("[data-skip]"), r = e.target.closest("[data-r]"), send = e.target.closest("[data-send]");
        if (settled) return;
        if (skip) { settled = true; lock(skip); track("quiz_note_skip"); return next(); }
        if (send) { var v = node.querySelector(".note-other input").value.trim().slice(0, 30); lock(send); return record("lookalike", v); }
        if (!r) return;
        if (r.dataset.r === "lookalike") {
          var box = node.querySelector(".note-other"); box.hidden = false; r.classList.add("picked");
          node.querySelectorAll(".quiz-opt").forEach(function (b) { b.disabled = true; });
          var inp = box.querySelector("input"); inp.focus();
          inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); node.querySelector("[data-send]").click(); } });
          return;
        }
        lock(r); record(r.dataset.r);
      });
    }
    next();
  }

  function shareText(R) {
    return "我的英文單字量" + R.label + "字 📚\n" + R.title + "\n" + R.squares + "\n" +
      R.correct + "/" + N + "・" + spoken(R.ms) + R.shareRank + (R.humble ? "\n" + R.humble : "") +
      "\n你贏得過我嗎？👉 https://toefu.app/quiz?vs=" + R.v + "-" + Math.round(R.sec);
  }
  function countUp(el, to, text) {
    if (reduced || !window.requestAnimationFrame) return;
    var t0 = performance.now();
    (function frame(now) {
      var p = Math.min(1, (now - t0) / 950), e = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1 ? fmt(Math.round(to * e / 100) * 100) : text;
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }

  // ---- real toEfu posts after the result ----
  function tagged(text, hl) {
    return esc(text).replace(TAGS, function (_, k, shown) {
      var s = shown || label(k);
      return D.V[k] ? '<button class="vocab' + (k === hl ? " hl" : "") + '" type="button" data-w="' + k + '">' + s + "</button>" : s;
    });
  }
  function fullPost(p, hl) {
    var lv = 1; p.x.replace(TAGS, function (_, k) { if (D.V[k]) lv = Math.max(lv, D.V[k][2]); return ""; });
    return postShell(D.CH[p.a], p.t, "",
      '<div class="post-tags"><span class="level-tag lv' + lv + '">' + LEVEL_NAMES[lv] + '</span><span class="tag">#' + esc(p.tp) + "</span></div>" +
      '<div class="post-text" lang="en">' + tagged(p.x, hl) + "</div>" +
      '<button class="translate-btn" type="button" data-translate aria-expanded="false">Translate 翻譯</button><div class="translation" hidden>' + esc(p.z) + "</div>" +
      '<div class="actions"><button class="act" type="button" data-like aria-label="Like" aria-pressed="false">' + ICON.heart + "<span>" + count(p.l) + "</span></button>" +
      '<span class="act">' + ICON.reply + "<span>" + count(p.r) + '</span></span><span class="act">' + ICON.repost + "</span></div>");
  }
  function demoPost(w) {
    return postShell(D.CH[w.a], "now", "", '<div class="post-text" lang="en">' + esc(w.before) + '<button class="vocab hl" type="button" data-w="' + w.k + '">' + esc(w.shown) + "</button>" + esc(w.after) + "</div>");
  }

  function finish() {
    clearInterval(ticker); leaveBar.hidden = true;
    var ans = S.ans, ms = S.total, v = estimate(ans);
    var saved = loadBest(); if (saved && (!best || saved.v > best.v || (saved.v === best.v && saved.ms < best.ms))) best = saved;   // 另一個分頁可能刷新過最佳
    var isBest = !best || v > best.v || (v === best.v && ms < best.ms);
    if (isBest) { best = { v: v, ms: Math.round(ms) }; saveBest(); }
    var prev = history.slice(); history.push([v, ms / 1000]);                  // 舊成績都留著，也都算進排名
    var correct = ans.filter(function (a) { return a.ok; }).length;
    var pf = prefixOf(ans, ms), ti = titleOf(v);
    var R = lastResult = {
      v: v, ms: ms, sec: ms / 1000, correct: correct, isBest: isBest, prev: prev,
      label: v >= TOTAL ? fmt(TOTAL) + "+ " : v <= 500 ? "不到 500 " : "約 " + fmt(v) + " ",
      title: pf[0] + "・" + ti[0],
      squares: ans.map(function (a) { return a.ok ? "🟩" : "🟥"; }).join(""), shareRank: ""
    };
    barStat.textContent = "完成 · " + clock(ms);
    var num = v >= TOTAL ? fmt(TOTAL) + "+" : v <= 500 ? "500" : fmt(v), pre = v >= TOTAL ? "" : v <= 500 ? "不到" : "約";

    // 挑戰結果：先比單字量，一樣再比耗時
    var duel = "", rv = S.rival, won = null;
    if (rv) {
      var dv = v - rv.v, ds = Math.round(ms / 1000) - rv.sec;
      won = dv !== 0 ? dv > 0 : ds !== 0 ? ds < 0 : null;
      var verdict = dv > 0 ? "你贏了，多對方 " + fmt(dv) + " 字" : dv < 0 ? (dv >= -500 ? "差一點，少對方 " : "這次輸了，少對方 ") + fmt(-dv) + " 字"
        : ds < 0 ? "單字量一樣，你快 " + (-ds) + " 秒，你贏了" : ds > 0 ? "單字量一樣，對方快 " + ds + " 秒" : "完全平手";
      duel = '<div class="duel"><p class="verdict">' + verdict + "</p><p>你" + sp(v) + vocabText(v) + "・" + spoken(ms) + "</p><p>對方" + sp(rv.v) + vocabText(rv.v) + "・" + spoken(rv.sec * 1000) + "</p></div>";
    }
    // 自我估計和實測的落差
    var guessLine = "", g = S.guess;
    if (g != null) {
      var gap = Math.min(v, TOTAL) - g;
      var rel = gap >= 1000 ? "比你猜的多 " + fmt(gap) + " 字" : gap <= -1000 ? "比你猜的少 " + fmt(-gap) + " 字" : "你猜得很準";
      guessLine = '<div id="guessRow"><dt>自估</dt><dd><b>你猜自己 ' + (g >= TOTAL ? fmt(TOTAL) + " 以上" : fmt(g)) + " 字</b>　實際" + vocabText(v) + "，" + rel + "。</dd></div>";
      if (gap >= 1000) R.humble = "賽前我還以為只有 " + fmt(g);
    }
    RUN = {
      date: (function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })(new Date()),  // 使用者當地日期，每日排名用
      attempt_no: Math.min(plays, 999), is_best: isBest, self_estimate: g,
      challenge: rv ? { rival_vocab: rv.v, rival_sec: rv.sec, won: won } : null,
      vocab: v, theta: Math.round(thetaOf(ans) * 100) / 100, correct: correct, total_ms: Math.round(ms),
      answers: ans.map(function (a, n) { return { n: n + 1, word: a.w.k, level: a.level, result: a.ok ? "correct" : a.kind === "pick" ? "wrong" : a.kind, picked: a.picked || null, options: a.options, ms: Math.round(a.rt * 1000), hid: !!a.hid }; })
    };
    if (QV) RUN.qv = QV;
    track("complete", { vocab: v });
    var savedRun = saveAndRank(R, RUN), items = noteArm() ? noteItems(ans) : [];
    if (items.length) askNotes(items, savedRun, function () { showResult(); }); else showResult();

    function showResult() {
    var card = add('<section class="result slide reveal" aria-label="成績">' + duel +
      '<div class="hero">' +
        '<div class="hero-head">你的英文單字量</div>' +
        '<div class="vocab-line"><span class="dim">' + pre + '</span><span class="vocab-n">' + num + '</span><span class="dim">字</span></div>' +
        '<div class="title-chip">' + esc(R.title) + "</div>" +
        '<div class="hero-rank" id="heroRank" style="display:none"></div>' +
        '<div class="grid15" aria-label="每題對錯">' + ans.map(function (a, n) { return '<i class="' + (a.ok ? "ok" : "") + '" style="--i:' + n + '"></i>'; }).join("") + "</div>" +
        '<div class="hero-foot"><span>答對 ' + correct + "/" + N + "・正確率 " + Math.round(correct / N * 100) + "%・" + spoken(ms) + "</span><span>toefu.app/quiz</span></div>" +
      "</div>" +
      '<div class="btns"><a class="primary-btn" id="shareBtn" target="_blank" rel="noopener">分享到脆</a>' +
        '<p class="muted small" id="shareNote" style="margin:0;text-align:center" hidden>成績文字已複製。脆沒有自動帶入的話，直接貼上就可以。</p>' +
        '<div class="btn-row"><button class="outline-btn" id="moreBtn" type="button">分享到其他地方</button>' +
        '<button class="outline-btn" id="againBtn" type="button">再挑戰一次</button></div></div>' +
      '<dl class="about">' +
        "<div><dt>稱號</dt><dd><b>" + esc(ti[0]) + "</b>　" + TIER_RANGE[tierOf(v)] + "的稱號。" + esc(ti[1]) + "</dd></div>" +
        "<div><dt>前綴</dt><dd><b>" + esc(pf[0]) + "</b>　" + esc(pf[1]) + "</dd></div>" + guessLine +
        '<div id="rankRow" style="display:none"><dt>排名</dt><dd id="rankDetail"></dd></div>' +
        (prev.length ? "<div><dt>紀錄</dt><dd>" + prev.map(function (h, n) { return "第 " + (n + 1) + " 次 " + vocabText(h[0]).replace(" 字", ""); }).join("　") +
          "　<b>這次 " + vocabText(v).replace(" 字", "") + "</b></dd></div>" : "") +
      "</dl>" +
      '<details class="share-prev"><summary>預覽分享文字</summary>' +
        '<textarea class="share" id="shareText" readonly aria-label="會貼到脆上的文字"></textarea>' +
        '<button class="outline-btn" id="copyBtn" type="button">複製文字</button></details></section>');
    paintShare();
    applyRank(R);
    countUp(card.querySelector(".vocab-n"), Math.max(500, Math.min(v, TOTAL)), num);
    card.querySelector("#shareBtn").addEventListener("click", function () {
      // 保險：先把文字放進剪貼簿。有些手機環境打開脆時不會帶入預填文字，使用者可以直接貼上
      track("share_threads");
      var noteEl = card.querySelector("#shareNote");
      try { navigator.clipboard.writeText(document.getElementById("shareText").value).then(function () { noteEl.hidden = false; }).catch(function () {}); } catch (e) {}
    });
    card.querySelector("#moreBtn").addEventListener("click", function () {
      // 手機會跳出系統的分享選單；不支援時改成複製文字
      track("share_other");
      var b = this, ta = document.getElementById("shareText");
      function pick() { card.querySelector(".share-prev").open = true; ta.focus(); ta.select(); b.textContent = "請複製下方文字"; }
      function copy() { try { navigator.clipboard.writeText(ta.value).then(function () { b.textContent = "已複製文字"; }).catch(pick); } catch (e) { pick(); } }
      if (navigator.share) navigator.share({ text: ta.value }).catch(function (e) { if (!e || e.name !== "AbortError") copy(); });
      else copy();
    });
    card.querySelector("#againBtn").addEventListener("click", function () { start(); window.scrollTo(0, 0); });
    card.querySelector("#copyBtn").addEventListener("click", function () {
      track("copy_click");
      var ta = document.getElementById("shareText"), b = this;
      function done() { b.textContent = "已複製"; setTimeout(function () { b.textContent = "複製文字"; }, 1600); }
      try { navigator.clipboard.writeText(ta.value).then(done).catch(function () { ta.focus(); ta.select(); }); }
      catch (e) { ta.focus(); ta.select(); }
    });

    // 登入卡片的連結：帶著沒答對的字（和單字卡上按了加入複習的字），主站讀到後加進複習清單
    var missedKeys = ans.filter(function (a) { return !a.ok; }).map(function (a) { return a.w.k; });
    function loginHref() {
      var ks = missedKeys.slice();
      Object.keys(savedWords).forEach(function (k) { if (savedWords[k] && ks.indexOf(k) < 0) ks.push(k); });
      return "../?from=quiz" + (ks.length ? "&words=" + ks.map(encodeURIComponent).join(",") : "");
    }
    // 沒答對的字：只給三則，挑最接近他程度的（最學得起來的），目標字畫螢光筆
    var shown = {}, at = v / (TOTAL / 10);
    var missedAll = ans.filter(function (a) { return !a.ok; }).sort(function (x, y) { return Math.abs(x.level - at) - Math.abs(y.level - at); });
    var missed = missedAll.slice(0, 3);
    if (missed.length) {
      add('<div class="divider">剛剛沒答對的字 · 點螢光筆畫的字看意思</div>');
      missed.forEach(function (a) {
        if (a.w.post) { shown[a.w.post.id] = 1; add(fullPost(a.w.post, a.w.k)); }
        else add(demoPost(a.w));
      });
    }
    // 沒答錯或不滿三則：補上適合他程度的串文（略高於目前程度、這次沒考過的字）
    if (missed.length < 3) {
      var target = Math.min(10, at + 1);
      var recs = POOL.filter(function (w) { return w.post && !S.used[w.k] && !shown[w.post.id]; })
        .sort(function (x, y) { return Math.abs(x.lv - target) - Math.abs(y.lv - target); }).slice(0, 3 - missed.length);
      if (recs.length) add('<div class="divider">' + (missed.length ? "再推薦你幾則" : "15 題全對 · 推薦你這幾則") + " · 螢光筆是你可能還不熟的字</div>");
      recs.forEach(function (w) { shown[w.post.id] = 1; add(fullPost(w.post, w.k)); });
    }
    // 之後鎖起來，導向 toEfu
    var left = missedAll.length - missed.length;
    var teaser = missedAll.slice(3).filter(function (a) { return a.w.post && !shown[a.w.post.id]; }).map(function (a) { return a.w.post; })
      .concat(shuffle(D.P).filter(function (p) { return !shown[p.id]; })).slice(0, 2);
    var gate = add('<section class="gate"><div class="gate-posts" inert aria-hidden="true">' + teaser.map(function (p) { return fullPost(p); }).join("") + "</div>" +
      '<div class="gate-card"><p class="gate-title">' + (left > 0 ? "你還有 " + left + " 個字沒答對" : !missedAll.length ? "全對的人，這裡有更難的字" : "還有 " + D.stats.posts + " 則這樣的串文") + "</p>" +
      '<p class="muted">' + (missedAll.length ? "登入 toEfu，把沒答對的字存進複習清單，繼續往下滑。" : "toEfu 有 " + D.stats.posts + " 則串文、" + fmt(D.stats.words) + " 個單字，登入後繼續往下滑。") + '</p>' +
      '<a class="primary-btn" href="' + esc(loginHref()) + '" target="_blank" rel="noopener">登入 toEfu 繼續看</a></div></section>');
    gate.querySelector("a").addEventListener("click", function () { track("login_click"); this.href = loginHref(); });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { track("saw_three_posts"); io.disconnect(); } }, { threshold: 0.5 });
      io.observe(gate);
    }
    show(card, "start");
    }
  }
  function paintShare() {
    var text = shareText(lastResult);
    document.getElementById("shareText").value = text;
    document.getElementById("shareBtn").href = "https://www.threads.com/intent/post?text=" + encodeURIComponent(text);
  }

  // ---- word sheet ----
  var sheet = document.getElementById("wordSheet"), overlayEl = document.getElementById("sheetOverlay"), saveBtn = document.getElementById("sheetSave"), savedWords = {}, sheetKey = null;
  function $(id) { return document.getElementById(id); }
  function openSheet(k) {
    var v = D.V[k]; if (!v) return;
    sheetKey = k;
    $("sheetWord").textContent = label(k);
    $("sheetKK").textContent = D.KK[k] || "";
    $("sheetPos").textContent = v[0];
    var lv = $("sheetLevel"); lv.className = "level-tag lv" + v[2]; lv.textContent = LEVEL_NAMES[v[2]];
    $("sheetZh").textContent = v[1];
    var exEn = v[3], exZh = v[4];
    $("sheetExBox").hidden = !exEn;
    if (exEn) {
      $("sheetEx").innerHTML = esc(exEn).replace(new RegExp("\\b" + label(k).slice(0, Math.max(4, label(k).length - 2)) + "\\w*", "i"), "<strong>$&</strong>");
      $("sheetExZh").textContent = exZh;
    }
    paintSave();
    overlayEl.hidden = false; sheet.hidden = false; $("sheetClose").focus();
  }
  function paintSave() { var on = !!savedWords[sheetKey]; saveBtn.classList.toggle("done", on); saveBtn.textContent = on ? "✓ Saved to Review 已加入複習" : "+ Add to Review 加入複習"; }
  function closeSheet() { sheet.hidden = true; overlayEl.hidden = true; sheetKey = null; }
  saveBtn.addEventListener("click", function () { savedWords[sheetKey] = !savedWords[sheetKey]; paintSave(); });
  overlayEl.addEventListener("click", closeSheet);
  $("sheetClose").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

  feed.addEventListener("click", function (e) {
    var w = e.target.closest("[data-w]"); if (w) return openSheet(w.dataset.w);
    var t = e.target.closest("[data-translate]");
    if (t) { var box = t.nextElementSibling; box.hidden = !box.hidden; t.setAttribute("aria-expanded", String(!box.hidden)); return; }
    var l = e.target.closest("[data-like]");
    if (l) { var on = l.classList.toggle("liked"); l.setAttribute("aria-pressed", String(on)); }
  });

  intro();
  startFirebase();
  // 從 App 進來的連結帶 ?from=home|profile|review（App 裡的入口位置），只記在分析事件，不寫進成績
  var entry = null;
  try { entry = new URLSearchParams(location.search).get("from"); } catch (e) {}
  track("view", { challenge: !!rival, from: ["home", "profile", "review"].indexOf(entry) >= 0 ? "app_" + entry : null });
})();
