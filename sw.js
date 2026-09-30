// Toefl-Tofu service worker: offline cache (network first) + push notifications.
/* global importScripts, firebase */
var CACHE = "toefl-tofu-v1";
var SHELL = [
  "./", "index.html", "css/style.css", "js/core.js", "js/store.js", "js/app.js", "js/firebase-config.js",
  "js/data/characters.js", "js/data/batch-1.js", "js/data/batch-2.js", "js/data/batch-3.js", "js/data/batch-4.js", "js/data/batch-5.js",
  "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Always try the network first so updates show up right away; fall back to the cache offline.
self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
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
