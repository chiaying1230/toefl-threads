// toEfu service worker: offline cache (cache first, refreshed in the background) + push notifications.
/* global importScripts, firebase */
// Bump on every deploy: the new worker then downloads the whole new version at once.
var CACHE = "toefu-v24";
var SHELL = [
  "./", "index.html", "css/style.css", "js/core.js", "js/store.js", "js/app.js", "js/firebase-config.js",
  "js/data/base.js",
  "quiz/", "quiz/index.html", "quiz/quiz.css", "quiz/quiz.js", "js/data/quiz-questions.js", "js/data/quiz-data.js",
  "privacy.html", "terms.html", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.json"
];

self.addEventListener("install", function (event) {
  // cache: "reload" skips the browser's HTTP cache, so a new version never starts from files up to 10 minutes old.
  var fresh = SHELL.map(function (url) { return new Request(url, { cache: "reload" }); });
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(fresh); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Cache first: open instantly from the saved copy, then fetch the latest copy in the background for next time.
// (Updates show up on the next launch; a deploy with a new CACHE name replaces everything at once.)
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  var update = fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  });
  event.respondWith(caches.match(req).then(function (hit) {
    if (hit) {
      event.waitUntil(update.catch(function () { /* offline: keep the saved copy */ }));
      return hit;
    }
    return update.catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (old) {
        return old || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    });
  }));
});

// ---------- Push notifications ----------
// Firebase shows "notification" messages sent while the app is in the background.
self.window = self;
try {
  importScripts("js/firebase-config.js");
  if (self.FIREBASE_CONFIG && self.FIREBASE_VAPID_KEY) {
    importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
    firebase.initializeApp(self.FIREBASE_CONFIG);
    firebase.messaging();
  }
} catch (e) {
  // Notifications unavailable (offline on first install, or not set up); caching still works.
}

self.addEventListener("notificationclick", function (event) {
  var link = (event.notification.data && (event.notification.data.link || (event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.fcmOptions && event.notification.data.FCM_MSG.fcmOptions.link))) || "./";
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("focus" in list[i]) { list[i].navigate(link); return list[i].focus(); }
    }
    return self.clients.openWindow(link);
  }));
});
