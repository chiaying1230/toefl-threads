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

// App Check (reCAPTCHA v3 site key). Blocks requests that don't come from this website.
// Firebase console → App Check → Apps → register the web app with reCAPTCHA v3 → paste the SITE key here.
// Leave as null until then.
window.FIREBASE_APPCHECK_KEY = null;
