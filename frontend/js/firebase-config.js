// ══════════════════════════════════════════════
//  NotePay — Firebase Configuration
//  Project: notepay-de2b0
// ══════════════════════════════════════════════

// Firebase compat SDK (loaded via CDN in each HTML page)
const firebaseConfig = {
  apiKey:            "AIzaSyCXoO0BrquatMswZQxPmZj8zFmK94V9aBs",
  authDomain:        "notepay-de2b0.firebaseapp.com",
  projectId:         "notepay-de2b0",
  storageBucket:     "notepay-de2b0.firebasestorage.app",
  messagingSenderId: "1058046259638",
  appId:             "1:1058046259638:android:f39f0e070087e146b3d117"
};

// Initialize Firebase (guard against double-init on page reloads)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();

// ── Get a fresh Firebase ID token (auto-refreshes if expired) ──
async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(/* forceRefresh = */ false);
  } catch (e) {
    console.error("getIdToken error:", e);
    return null;
  }
}

// ── Check if user is currently logged in ──
function isLoggedIn() {
  return !!auth.currentUser;
}

let authReadyPromise = null;

/** Wait for Firebase to restore session (returns Promise<User|null>) */
function waitForAuthReady() {
  if (authReadyPromise) return authReadyPromise;
  
  // Waiting for Firebase Auth...
  authReadyPromise = new Promise(resolve => {
    // Safety timeout: resolve with null if Firebase takes too long
    const timer = setTimeout(() => {
      console.warn("Firebase Auth timed out. Proceeding as unauthenticated.");
      resolve(null);
    }, 10000);

    const unsub = auth.onAuthStateChanged(user => {
      clearTimeout(timer);
      // Firebase Auth Ready
      unsub();
      resolve(user);
    }, err => {
      clearTimeout(timer);
      console.error("Firebase Auth Error:", err);
      resolve(null);
    });
  });
  return authReadyPromise;
}
