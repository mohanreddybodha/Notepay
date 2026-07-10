// ══════════════════════════════════════════════
//  NotePay — Auth Guard (Optimized Loading Overlay)
//  Add to every protected page. Redirects to
//  login.html if Firebase session is not active.
// ══════════════════════════════════════════════

(function initLoadingOverlay() {
  let isDark = false;
  if (window.NPThemeManager) {
    window.NPThemeManager.init();
    isDark = document.documentElement.classList.contains("dark") || document.documentElement.classList.contains("dark-mode");
  } else {
    isDark = localStorage.getItem("np_dark") || localStorage.getItem("np_admin_theme") === "dark";
    if (isDark) {
      document.documentElement.classList.add("dark-mode", "dark");
    } else {
      document.documentElement.classList.remove("dark-mode", "dark");
    }
  }

  const isInternalNav = (document.referrer && document.referrer.includes(window.location.host)) || sessionStorage.getItem('np_session_active') === 'true';

  if (!isInternalNav) {
    // Inject style block to set html hidden and style custom splash spinner
    const style = document.createElement('style');
    style.id = 'auth-guard-splash-style';
    style.textContent = `
      html { visibility: hidden !important; }
      #auth-guard-splash {
        visibility: visible !important;
        position: fixed;
        inset: 0;
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${isDark ? '#09090b' : '#ffffff'};
        opacity: 1;
        transition: opacity 0.2s ease;
      }
      #auth-guard-splash .np-designed-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid ${isDark ? 'rgba(96, 165, 250, 0.08)' : 'rgba(26, 78, 140, 0.08)'};
        border-top-color: ${isDark ? '#60a5fa' : '#1A4E8C'};
        border-left-color: ${isDark ? '#60a5fa' : '#1A4E8C'};
        border-radius: 50%;
        animation: npSpinUnique 1.2s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
        box-shadow: 0 0 8px ${isDark ? 'rgba(96, 165, 250, 0.25)' : 'rgba(26, 78, 140, 0.15)'};
      }
      @keyframes npSpinUnique {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    // Inject loader overlay element
    function injectSplash() {
      if (document.getElementById('auth-guard-splash')) return;
      const splash = document.createElement('div');
      splash.id = 'auth-guard-splash';
      splash.innerHTML = '<div class="np-designed-spinner"></div>';
      if (document.body) {
        document.body.insertBefore(splash, document.body.firstChild);
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          document.body.insertBefore(splash, document.body.firstChild);
        });
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectSplash);
    } else {
      injectSplash();
    }
  }
})();

(async function authGuard() {
  const user = await waitForAuthReady();
  if (!user) {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`login.html?return=${returnUrl}`);
  } else {
    sessionStorage.setItem('np_session_active', 'true');
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

    // Hide overlay smoothly unless on auto-join flow (clean path /join or legacy join-event.html with ?code=)
    const path = window.location.pathname;
    const isAutoJoin = (path.includes("join") || path.includes("join-event.html")) && window.location.search.includes("code=");
    
    if (!isAutoJoin) {
      const splash = document.getElementById('auth-guard-splash');
      if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => {
          splash.remove();
          const style = document.getElementById('auth-guard-splash-style');
          if (style) style.remove();
        }, 200);
      } else {
        const style = document.getElementById('auth-guard-splash-style');
        if (style) style.remove();
      }
    }
  }
})();
