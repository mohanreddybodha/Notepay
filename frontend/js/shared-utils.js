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

    // Reverse tab segment map for localhost query params
    const segToTab = { 'collections': 'don', 'expenses': 'exp', 'summary': 'sum' };
    const dashTabIds = { 'my-events': '1', 'shared': '2', 'visited': '3' };

    if (isLocal) {
      // Localhost: use .html files with query params — visible in URL bar as-is
      const pageToHtml = {
        'dashboard':    'dashboard.html',
        'event':        'event.html',
        'edit-event':   'create-event.html',
        'create-event': 'create-event.html',
        'join':         'join-event.html',
        'donate':       'donate.html',
        'profile':      'profile.html',
        'profile/edit': 'edit-profile.html',
        'profile/setup':'profile-setup.html',
        'login':        'login.html',
        'admin':        'admin.html',
        'guide':        'guide.html',
        'privacy':      'privacy.html',
        'terms':        'terms.html',
      };
      const html = pageToHtml[page] || (page + '.html');

      // dashboard.html?tab=N
      if (page === 'dashboard' && segments[0]) {
        return html + '?tab=' + (dashTabIds[segments[0]] || '0');
      }
      // event.html?id=ABCD123[&tab=don][&chat=1]
      if (page === 'event' && segments[0]) {
        let url = html + '?id=' + encodeURIComponent(segments[0]);
        if (segments[1] === 'chat') {
          url += '&chat=1';
        } else if (segments[1]) {
          const tab = segToTab[segments[1]] || segments[1];
          url += '&tab=' + tab;
        }
        return url;
      }
      // create-event.html?edit=ABCD123
      if (page === 'edit-event' && segments[0]) {
        return html + '?edit=' + encodeURIComponent(segments[0]);
      }
      // donate.html?event_id=ABCD123
      if (page === 'donate' && segments[0]) {
        return html + '?event_id=' + encodeURIComponent(segments[0]);
      }
      // join-event.html?code=ABCD
      if (page === 'join' && segments[0]) {
        return html + '?code=' + encodeURIComponent(segments[0]);
      }
      return html;
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
   *   /dashboard/my-events       → { page: "dashboard", id: null, sub: null, tab: 1 }
   *   /donate/ABCD123            → { page: "donate", id: "ABCD123", sub: null, tab: null }
   *   /join/ABCD                 → { page: "join", id: "ABCD", sub: null, tab: null }
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

    const dashTabMap = { 'my-events': 1, 'shared': 2, 'visited': 3 };
    let tab = sub ? (EVENT_SEGMENT_TABS[sub] || null) : null;
    
    if (page === 'dashboard') {
      if (id && dashTabMap[id]) {
        tab = dashTabMap[id];
        id = null;
      }
    }

    // Backward compatibility: if no id in path, check ?id= or ?code= query param
    if (!id || id === 'undefined') {
      const p = new URLSearchParams(search);
      id = p.get('id') || p.get('eventId') || p.get('event_id') || p.get('edit') || p.get('code') || null;
    }
    // Backward compatibility: if no tab in path, check ?tab= query param
    if (!tab) {
      const p = new URLSearchParams(search);
      const t = p.get('tab');
      if (t && EVENT_TAB_SEGMENTS[t]) {
        tab = t;
        sub = EVENT_TAB_SEGMENTS[t];
      } else if (t) {
        tab = parseInt(t) || 0;
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

  function showGlobalConfirmModal({ title, desc, iconSvg, iconTone = 'red', confirmText = 'Confirm', confirmColor = 'var(--red)', onConfirm, cancelText = 'Cancel' }) {
    const existing = document.getElementById("np-global-confirm-modal");
    if (existing) existing.remove();
    
    const modal = document.createElement("div");
    modal.className = "popup-modal";
    modal.id = "np-global-confirm-modal";
    
    let iconClass = iconTone === 'red' ? 'pi-red' : (iconTone === 'amber' ? 'pi-amber' : 'pi-teal');
    if (!iconSvg) {
      if (iconTone === 'red') iconSvg = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
      else if (iconTone === 'amber') iconSvg = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
      else iconSvg = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }
    
    modal.innerHTML = `
      <div class="popup-content">
        <div class="popup-icon ${iconClass}">${iconSvg}</div>
        <div class="popup-title">${escapeHtml(title)}</div>
        <div class="popup-desc" style="margin-bottom:16px;">${desc}</div>
        <div style="display:flex;gap:8px;width:100%;">
          <button class="popup-btn pbc" id="ngcm-cancel" style="flex:1;">${escapeHtml(cancelText)}</button>
          <button class="popup-btn" id="ngcm-confirm" style="flex:1; background:${confirmColor}; color:white; border:none; border-radius:20px; font-weight:700;">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    modal.offsetHeight; // Force reflow
    modal.classList.add("open");
    
    const closeModal = () => {
      modal.classList.remove("open");
      setTimeout(() => modal.remove(), 200);
    };
    
    document.getElementById("ngcm-cancel").onclick = closeModal;
    document.getElementById("ngcm-confirm").onclick = () => {
      closeModal();
      if (onConfirm) onConfirm();
    };
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
    showToast,
    showGlobalConfirmModal
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
  global.showGlobalConfirmModal = showGlobalConfirmModal;
  global.escHtml = escapeHtml;
  global.goBack = function () { window.history.back(); };

  // NPThemeManager: Centralized theme manager
  const NPThemeManager = {
    init() {
      const isDark = localStorage.getItem("np_dark") === "1" || localStorage.getItem("np_dark") === "true" || localStorage.getItem("np_dark") === "yes";
      if (isDark) {
        document.documentElement.classList.add("dark-mode");
        if (document.body) document.body.classList.add("dark-mode");
        else window.addEventListener('DOMContentLoaded', () => document.body.classList.add("dark-mode"));
      } else {
        document.documentElement.classList.remove("dark-mode");
        if (document.body) document.body.classList.remove("dark-mode");
      }
    },
    toggle(enable) {
      const isDark = enable !== undefined ? enable : !document.documentElement.classList.contains("dark-mode");
      localStorage.setItem("np_dark", isDark ? "1" : "0");
      if (isDark) {
        document.documentElement.classList.add("dark-mode");
        if (document.body) document.body.classList.add("dark-mode");
      } else {
        document.documentElement.classList.remove("dark-mode");
        if (document.body) document.body.classList.remove("dark-mode");
      }
      return isDark;
    },
    isDark() {
      return document.documentElement.classList.contains("dark-mode");
    }
  };
  NPThemeManager.init();
  global.NPThemeManager = NPThemeManager;
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
