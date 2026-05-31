// ══════════════════════════════════════════════
//  NotePay — Firebase Configuration
//  Project: notepay-de2b0
// ══════════════════════════════════════════════

// Firebase compat SDK (loaded via CDN in each HTML page)
const firebaseConfig = {
  apiKey: "AIzaSyCXoO0BrquatMswZQxPmZj8zFmK94V9aBs",
  authDomain: "notepay-de2b0.firebaseapp.com",
  projectId: "notepay-de2b0",
  storageBucket: "notepay-de2b0.firebasestorage.app",
  messagingSenderId: "1058046259638",
  appId: "1:1058046259638:android:f39f0e070087e146b3d117"
};

// Initialize Firebase (guard against double-init on page reloads)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);

  // Initialize Firebase App Check
  if (typeof firebase.appCheck === 'function') {
    const appCheck = firebase.appCheck();
    appCheck.activate(
      '6Lc0XwUtAAAAACjgZWnte4AkFEkHpfuGY933wjSx',
      true
    );
  }
}

const auth = firebase.auth();

// ── Get a fresh Firebase ID token (cached for 50 min to avoid repeated calls) ──
let _cachedToken = null;
let _tokenExpiry = 0;

async function getIdToken() {
  // Return cached token if still valid (50 min window; tokens expire at 60 min)
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const user = auth.currentUser;
  if (!user) return null;
  try {
    _cachedToken = await user.getIdToken(/* forceRefresh = */ false);
    _tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 minutes
    return _cachedToken;
  } catch (e) {
    console.error("getIdToken error:", e);
    _cachedToken = null;
    _tokenExpiry = 0;
    return null;
  }
}

// ── Check if user is currently logged in ──
function isLoggedIn() {
  return !!auth.currentUser;
}

let authReadyPromise = null;
let _authHasSettled = false; // true once the first onAuthStateChanged fires

/** Wait for Firebase to restore session (returns Promise<User|null>) */
function waitForAuthReady() {
  if (authReadyPromise) return authReadyPromise;

  authReadyPromise = new Promise(resolve => {
    const timer = setTimeout(() => {
      console.warn("Firebase Auth timed out. Proceeding as unauthenticated.");
      _authHasSettled = true;
      resolve(null);
    }, 15000); // 15s — handles slow cold-start DB auth

    const unsub = auth.onAuthStateChanged(user => {
      clearTimeout(timer);
      unsub();
      _authHasSettled = true;
      resolve(user);
    }, err => {
      clearTimeout(timer);
      console.error("Firebase Auth Error:", err);
      _authHasSettled = true;
      resolve(null);
    });
  });
  return authReadyPromise;
}

/** Reset memoized auth promise so the next waitForAuthReady() is fresh. */
function resetAuthCache() {
  authReadyPromise = null;
  _authHasSettled = false;
  _cachedToken = null;
  _tokenExpiry = 0;
}

/** Alias used by logout / login flows. */
function clearAuthCache() {
  resetAuthCache();
}

// When signed out, drop cached promise — but ONLY after auth has already settled
// (the first onAuthStateChanged fires null briefly on page load before Firebase
// restores the session; we must NOT reset the cache at that point).
auth.onAuthStateChanged(user => {
  if (!user && _authHasSettled) resetAuthCache();
});
