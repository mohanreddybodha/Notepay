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

  function getCleanUrl(url) {
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:";
    if (!isLocal && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" && window.location.protocol !== "file:") {
      const u = new URL(url, window.location.href);
      u.pathname = u.pathname.replace(/\.html$/, "");
      return u.pathname + u.search + u.hash;
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
