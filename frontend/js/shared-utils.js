(function (global) {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function formatINR(amount) {
    if (amount === null || amount === undefined || amount === "") return "—";
    return "₹ " + Number(amount).toLocaleString("en-IN");
  }

  function formatDate(isoString) {
    if (!isoString) return "—";
    return new Date(isoString).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function formatDateTime(isoString) {
    if (!isoString) return "—";
    return new Date(isoString).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function getInitials(name = "") {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() || "")
      .join("") || "??";
  }

  function getAvatarColor(name = "") {
    const colors = ["#A855F7", "#3b82f6", "#14b8a6", "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#8b5cf6"];
    let hash = 0;
    for (let i = 0; i < String(name || "").length; i++) {
      hash = String(name || "").charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  function applyAvatar(el, name = "") {
    if (!el) return;
    el.textContent = getInitials(name);
    el.style.background = getAvatarColor(name);
  }

  // ── URL Helpers ──────────────────────────────────────────────────────────
  // Tab name → URL segment mapping for event pages
  const EVENT_TAB_SEGMENTS = { don: 'collections', exp: 'expenses', sum: 'summary' };
  // URL segment → tab name reverse map
  const EVENT_SEGMENT_TABS = { collections: 'don', expenses: 'exp', summary: 'sum' };

  /**
   * buildUrl(page, ...segments) — builds a clean absolute path.
   * On localhost/.html environment: returns legacy .html?param URL for compatibility.
   * On production: returns clean /path/segments URL.
   *
   * Examples:
   *   buildUrl("dashboard")                      → "/dashboard"
   *   buildUrl("event", "ABCD123")               → "/event/ABCD123"
   *   buildUrl("event", "ABCD123", "collections")→ "/event/ABCD123/collections"
   *   buildUrl("edit-event", "ABCD123")          → "/edit-event/ABCD123"
   *   buildUrl("donate", "ABCD123")              → "/donate/ABCD123"
   *   buildUrl("join")                           → "/join"
   *   buildUrl("login")                          → "/login"
   */
  function buildUrl(page, ...segments) {
    const isLocal = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.protocol === 'file:';

    // Legacy HTML filenames for pages that need ?param style on localhost
    const pageToHtml = {
      'dashboard':   'dashboard.html',
      'event':       'event.html',
      'edit-event':  'create-event.html',
      'create-event':'create-event.html',
      'join':        'join-event.html',
      'donate':      'donate.html',
      'profile':     'profile.html',
      'profile/edit':'edit-profile.html',
      'profile/setup':'profile-setup.html',
      'login':       'login.html',
      'admin':       'admin.html',
      'guide':       'guide.html',
      'privacy':     'privacy.html',
      'terms':       'terms.html',
    };

    if (isLocal) {
      // On localhost, use the upgraded serve_frontend.py clean routing
      // Build clean path — the dev server now handles all clean paths
      const parts = [page, ...segments.filter(Boolean)];
      return '/' + parts.join('/');
    }

    // Production: clean path segments
    const parts = [page, ...segments.filter(Boolean)];
    return '/' + parts.join('/');
  }

  /**
   * parseCurrentPath() — extracts structured context from window.location.pathname.
   *
   * Examples:
   *   /event/ABCD123/collections → { page: "event", id: "ABCD123", sub: "collections", tab: "don" }
   *   /edit-event/ABCD123        → { page: "edit-event", id: "ABCD123", sub: null, tab: null }
   *   /dashboard                 → { page: "dashboard", id: null, sub: null, tab: null }
   *   /donate/ABCD123            → { page: "donate", id: "ABCD123", sub: null, tab: null }
   *
   * Also handles legacy .html?param URLs for backward compatibility:
   *   /event.html?id=ABCD123&tab=don → { page: "event", id: "ABCD123", sub: "collections", tab: "don" }
   */
  function parseCurrentPath() {
    const pathname = window.location.pathname;
    const search   = window.location.search;

    // Normalize: strip leading slash, strip .html suffix
    let clean = pathname.replace(/^\//, '').replace(/\.html$/, '');
    const parts = clean.split('/').filter(Boolean);

    let page = parts[0] || '';
    let id   = parts[1] || null;
    let sub  = parts[2] || null;

    // Normalize page aliases
    if (page === 'join-event') page = 'join';
    if (page === 'create-event' && id) { page = 'edit-event'; }
    if (page === 'edit-profile') { page = 'profile'; sub = 'edit'; id = null; }
    if (page === 'profile-setup') { page = 'profile'; sub = 'setup'; id = null; }

    // Derive tab name from sub segment
    let tab = sub ? (EVENT_SEGMENT_TABS[sub] || null) : null;

    // Backward compatibility: if no id in path, check ?id= query param
    if (!id || id === 'undefined') {
      const p = new URLSearchParams(search);
      id = p.get('id') || p.get('eventId') || p.get('event_id') || p.get('edit') || null;
    }
    // Backward compatibility: if no tab in path, check ?tab= query param
    if (!tab) {
      const p = new URLSearchParams(search);
      const t = p.get('tab');
      if (t && EVENT_TAB_SEGMENTS[t]) {
        tab = t;
        sub = EVENT_TAB_SEGMENTS[t];
      }
    }

    return { page, id, sub, tab };
  }

  /**
   * getCleanUrl(url) — legacy alias kept for backward compatibility.
   * Strips .html extensions on production. Existing call sites work unchanged.
   */
  function getCleanUrl(url) {
    const isLocal = window.location.hostname === 'localhost' ||
                    window.location.hostname === '127.0.0.1' ||
                    window.location.protocol === 'file:';
    if (!isLocal) {
      try {
        const u = new URL(url, window.location.href);
        u.pathname = u.pathname.replace(/\.html$/, '');
        return u.pathname + u.search + u.hash;
      } catch (e) { /* ignore bad URLs */ }
    }
    return url;
  }


  function showToast(msg, type = "default") {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    if (type === "error") toast.classList.add("toast-error");
    else if (type === "warning") toast.classList.add("toast-warning");
    else if (type === "success") toast.classList.add("toast-success");
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2300);
  }

  const utils = {
    escapeHtml,
    formatINR,
    formatDate,
    formatDateTime,
    getInitials,
    getAvatarColor,
    applyAvatar,
    buildUrl,
    parseCurrentPath,
    getCleanUrl,
    showToast
  };

  global.NPUtils = utils;
  global.escapeHtml = escapeHtml;
  global.formatINR = formatINR;
  global.formatDate = formatDate;
  global.formatDateTime = formatDateTime;
  global.getInitials = getInitials;
  global.getAvatarColor = getAvatarColor;
  global.applyAvatar = applyAvatar;
  global.buildUrl = buildUrl;
  global.parseCurrentPath = parseCurrentPath;
  global.getCleanUrl = getCleanUrl;
  global.showToast = showToast;
  // escHtml: short alias used throughout dashboard.js and event-main.js
  global.escHtml = escapeHtml;
  // goBack: shared navigation helper (duplicated in 8 locations previously)
  global.goBack = function () { window.history.back(); };
})(window);

// Improve responsiveness: default certain high-frequency events to passive
// to avoid browser warnings and improve scroll performance. This sets
// `passive: true` when listeners are added without explicit options.
(function () {
  try {
    const orig = EventTarget.prototype.addEventListener;
    const passiveEvents = new Set(['touchstart', 'touchmove', 'wheel', 'scroll']);
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      try {
        if (passiveEvents.has(type)) {
          if (options === undefined || options === false) {
            options = { passive: true };
          } else if (typeof options === 'object' && options.passive === undefined) {
            options = Object.assign({}, options, { passive: true });
          }
        }
      } catch (e) { /* ignore and fall back */ }
      return orig.call(this, type, listener, options);
    };
  } catch (e) { /* older browsers: silently skip */ }
})();
