// ══════════════════════════════════════════════
//  NotePay — Auth Guard
//  Add to every protected page. Redirects to
//  login.html if Firebase session is not active.
// ══════════════════════════════════════════════

(async function authGuard() {
  const user = await waitForAuthReady();
  if (!user) {
    window.location.replace("login.html");
  }
})();
