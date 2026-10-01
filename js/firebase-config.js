// Firebase web app config for toEfu (Firebase project id: toefl-threads).
// These values are public by design; access is controlled by firestore.rules.
// Set this to null to go back to "saved on this device only" mode.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyArWsxTrNrByzk1vLk5bbHk86bZd_KYjAs",
  authDomain: "toefl-threads.firebaseapp.com",
  projectId: "toefl-threads",
  storageBucket: "toefl-threads.firebasestorage.app",
  messagingSenderId: "2509579521",
  appId: "1:2509579521:web:637cdea53ff21b045de700",
  measurementId: "G-HCED9G88HN"
};

// Web Push certificate (VAPID key) for notifications.
// Firebase console → Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
window.FIREBASE_VAPID_KEY = "BDopcUnlgiD1VPJ1MrdLZ3uFEbe9JkHwMkhIlw99_INl679dLrtigkbfZLmqJy-PCCWGsnzRNLBcfO8RHrq_E6Y";

// App Check: blocks requests that don't come from this website.
// Firebase console → App Check → Apps → the web app's reCAPTCHA SITE key (public, safe to publish).
// Set to null to turn App Check off.
window.FIREBASE_APPCHECK_KEY = "6LeCx9gtAAAAAJEKFcMypneWKN6qChyBtER4bviy";
// Which reCAPTCHA the key belongs to: "enterprise" (reCAPTCHA Enterprise) or "v3" (classic reCAPTCHA v3).
window.FIREBASE_APPCHECK_PROVIDER = "enterprise";
