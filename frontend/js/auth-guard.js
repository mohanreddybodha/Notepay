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
    const isNewUser = localStorage.getItem("np_new_user") === "true";
    const setupExpiry = localStorage.getItem("np_setup_expiry");

    if (isNewUser) {
      if (!setupExpiry || Date.now() > parseInt(setupExpiry, 10)) {
        try { if (typeof auth !== "undefined") await auth.signOut(); } catch (e) {}
        localStorage.clear();
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`login.html?return=${returnUrl}`);
        return;
      }
      if (!window.location.pathname.includes("profile-setup.html")) {
        window.location.replace("profile-setup.html");
        return;
      }
    }
    // Hide splash screen if present, once auth state is verified
    const splash = document.getElementById("app-splash");
    if (splash) {
      const path = window.location.pathname;
      const isSelfLoaded = /(dashboard|event|profile|edit-profile)(\.html)?$/.test(path.split('?')[0]) && !/create-event|join-event/.test(path);
      const isAutoJoin = path.includes("join-event") && window.location.search.includes("code=");
      if (!isSelfLoaded && !isAutoJoin) {
        splash.classList.add("hidden");
        setTimeout(() => splash.style.display = "none", 400);
      }
      if (typeof hideCircleLoading === 'function') hideCircleLoading(true);
    }
  }
})();
