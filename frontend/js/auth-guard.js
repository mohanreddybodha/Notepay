// ══════════════════════════════════════════════
//  NotePay — Auth Guard
//  Add to every protected page. Redirects to
//  login.html if Firebase session is not active.
// ══════════════════════════════════════════════

(async function authGuard() {
  const user = await waitForAuthReady();
  if (!user) {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`login.html?return=${returnUrl}`);
  } else {
    // Hide splash screen if present, once auth state is verified
    const splash = document.getElementById("app-splash");
    if (splash) {
      const path = window.location.pathname;
      const isSelfLoaded = /(dashboard|event|profile|edit-profile)(\.html)?$/.test(path.split('?')[0]) && !/create-event|join-event/.test(path);
      if (!isSelfLoaded) {
        splash.classList.add("hidden");
        setTimeout(() => splash.style.display = "none", 400);
      }
    }
  }
})();
