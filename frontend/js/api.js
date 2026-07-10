// ══════════════════════════════════════════════
//  NotePay — API Client
//  Connects to FastAPI backend at localhost:8000
// ══════════════════════════════════════════════

// Determine API and WebSocket addresses based on environment
let API_BASE = "";
let WS_BASE = "";
let IS_PRODUCTION = false;

const _hostname = window.location.hostname;
if (_hostname === 'localhost' || _hostname === '127.0.0.1' || _hostname.match(/^[0-9.]+$/)) {
  API_BASE = `http://${_hostname}:8000`;
  WS_BASE = `ws://${_hostname}:8000`;
} else {
  IS_PRODUCTION = true;
  API_BASE = "API_PLACEHOLDER".replace(/\/$/, "");
  WS_BASE = "WSS_PLACEHOLDER".replace(/\/$/, "");
}

// Core fetch wrapper — attaches Bearer token automatically
async function apiFetch(method, path, body = null, silent = true) {
  const isWrite = method === 'POST' || method === 'PUT' || method === 'DELETE';

  // If offline and writing, queue the action
  if (isWrite && !navigator.onLine) {
    return handleOfflineWrite(method, path, body);
  }

  const token = (typeof getIdToken === 'function') ? await getIdToken() : null;
  if (!token) {
    try { if (typeof auth !== 'undefined') auth.signOut(); } catch (e) {}
    localStorage.removeItem('np_token_tmp');
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = (typeof getCleanUrl === 'function') ? getCleanUrl(`login.html?return=${returnUrl}`) : `login.html?return=${returnUrl}`;
    throw new Error('Not authenticated');
  }

  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } };
  if (method === 'GET') {
    opts.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    opts.headers['Pragma'] = 'no-cache';
    opts.headers['Expires'] = '0';
  }
  if (body) opts.body = JSON.stringify(body);

  try {
    const controller = new AbortController();
    opts.signal = controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    let url = `${API_BASE}${path}`;
    if (method === 'GET') {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}_=${Date.now()}`;
    }
    const res = await fetch(url, opts);
    clearTimeout(timeoutId);

    if (res.status === 401) {
      try { if (typeof auth !== 'undefined') await auth.signOut(); } catch (e) {}
      localStorage.removeItem('np_token_tmp');
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = (typeof getCleanUrl === 'function') ? getCleanUrl(`login.html?return=${returnUrl}`) : `login.html?return=${returnUrl}`;
      throw new Error('Session expired');
    }

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : null;

    if (!res.ok && res.status !== 304) {
      const msg = data?.detail || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.isHttpError = true;
      throw err;
    }

    if (method === 'GET' && data) {
      try { localStorage.setItem('cache:' + path, JSON.stringify(data)); } catch (e) {}
    }

    return data;
  } catch (e) {
    // If write failed due to network (not a 4xx/5xx HTTP error), queue it
    if (isWrite && !e.isHttpError) return handleOfflineWrite(method, path, body);
    throw e;
  }
}

// (Duplicate response-handling removed)

// ── Helper to queue writes and return optimistic results ──
function handleOfflineWrite(method, path, body) {
  const queue = JSON.parse(localStorage.getItem("np_offline_queue") || "[]");
  let mockId = null;

  if (method === "POST") {
    mockId = -Date.now();
  } else {
    mockId = parseInt(path.split("/").pop()) || null;
  }

  queue.push({
    id: mockId,
    method,
    path,
    body,
    timestamp: Date.now()
  });
  localStorage.setItem("np_offline_queue", JSON.stringify(queue));
  showToast("Offline mode: Action queued locally!", "warning");

  if (method === "DELETE") {
    return { message: "Deleted" };
  }

  const eventId = path.split("/")[2] || "";
  
  if (path.endsWith("/chat")) {
    return {
      id: mockId,
      event_id: eventId,
      user_id: parseInt(localStorage.getItem('np_my_id')) || 0,
      sender_name: localStorage.getItem('np_my_name') || 'You (Offline)',
      message: body?.message || "",
      reply_to_id: body?.reply_to_id || null,
      reactions: {},
      sent_at: new Date().toISOString(),
      is_pending: true,
      delivered_to: [],
      read_by: []
    };
  }

  return {
    id: mockId,
    event_id: eventId,
    donor_name: body?.donor_name || "",
    description: body?.description || "",
    amount: body?.amount || null,
    collected_by: parseInt(localStorage.getItem("np_my_id")) || 0,
    collected_by_name: localStorage.getItem("np_my_name") || "You (Offline)",
    collected_at: new Date().toISOString(),
    custom_fields: body?.custom_fields || null,
    is_offline: true
  };
}

// ── Unauthenticated fetch (for registration check) ──
async function apiFetchWithToken(method, path, token, body = null, silent = false) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  opts.signal = controller.signal;

  try {
    const res = await fetch(`${API_BASE}${path}`, opts);
    clearTimeout(timeoutId);
    if (res.status === 401) {
      try { if (typeof auth !== "undefined") await auth.signOut(); } catch (e) {}
      localStorage.removeItem("np_token_tmp");
      const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(getCleanUrl(`login.html?return=${returnUrl}`));
      throw new Error("Session expired");
    }

    const data = res.headers.get("content-type")?.includes("application/json")
      ? await res.json()
      : null;

    return { status: res.status, data };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ══════════════════════════════════════════════
//  USER / PROFILE
// ══════════════════════════════════════════════

/** Register new user. Token passed explicitly (just logged in, currentUser may not be set yet) */
async function registerUser(token, fullName, gender, phoneNumber) {
  return apiFetchWithToken("POST", "/users", token, {
    full_name: fullName,
    gender: gender,
    phone_number: phoneNumber
  });
}

/** Get own profile */
async function getMyProfile() {
  return apiFetch("GET", "/users/me");
}

/** Update name / gender */
async function updateProfile(data) {
  return apiFetch("PUT", "/users/me", data);
}

// ══════════════════════════════════════════════
//  EVENTS
// ══════════════════════════════════════════════

/** My Events tab — events where user is Organizer */
async function getMyEvents() {
  return apiFetch("GET", "/events/my");
}

/** Shared Events tab — events joined as Collector */
async function getSharedEvents() {
  return apiFetch("GET", "/events/shared");
}

/** Create a new event */
async function createEvent(name, description, eventDate, showDonations = true, showExpenses = true, goalAmount = 0) {
  return apiFetch("POST", "/events", {
    name,
    description,
    event_date: new Date(eventDate).toISOString(),
    show_donations: showDonations,
    show_expenses: showExpenses,
    goal_amount: goalAmount
  });
}

/** Preview event details by code */
async function previewEventCode(code) {
  return apiFetch("GET", `/events/preview-code?invite_code=${encodeURIComponent(code)}`);
}

/** Join event by invite code */
async function joinEvent(code) {
  return apiFetch("POST", `/events/join?invite_code=${encodeURIComponent(code)}`);
}

/** Rename / update event details */
async function updateEvent(eventId, data) {
  return apiFetch("PUT", `/events/${eventId}`, data);
}

/** Delete event permanently */
async function deleteEvent(eventId) {
  return apiFetch("DELETE", `/events/${eventId}`);
}

/** Deactivate event — locks collectors out */
async function deactivateEvent(eventId) {
  return apiFetch("PUT", `/events/${eventId}/deactivate`);
}

/** Reactivate event */
async function reactivateEvent(eventId) {
  return apiFetch("PUT", `/events/${eventId}/reactivate`);
}

/** Generate a new invite code (old one becomes permanently invalid) */
async function generateCode(eventId) {
  return apiFetch("POST", `/events/${eventId}/generate_code`);
}

/** Fetch a single event's details */
async function getEvent(eventId) {
  return apiFetch("GET", `/events/${eventId}`);
}

/** Update event privacy (Public/Private) */
async function updateEventPrivacy(eventId, isPublic) {
  return apiFetch("PATCH", `/events/${eventId}/privacy?is_public=${isPublic}`);
}

/** Get public events recently viewed (Discover tab) */
async function getWatchedEvents() {
  return apiFetch("GET", "/events/watched");
}

/** Remove event from watched history (Discover tab) */
async function unwatchEvent(eventId) {
  return apiFetch("DELETE", `/events/${eventId}/watched`);
}

// ══════════════════════════════════════════════
//  MEMBERS
// ══════════════════════════════════════════════

/** List all members of an event */
async function getMembers(eventId) {
  return apiFetch("GET", `/events/${eventId}/members`);
}

/** Phone contact for a member (1:1 call) — same-event members only */
async function getMemberContact(eventId, userId) {
  return apiFetch("GET", `/events/${eventId}/members/${userId}/contact`);
}

/** Restrict a collector */
async function restrictMember(eventId, userId) {
  return apiFetch("PUT", `/events/${eventId}/members/${userId}/restrict`);
}

/** Unrestrict a collector */
async function unrestrictMember(eventId, userId) {
  return apiFetch("PUT", `/events/${eventId}/members/${userId}/unrestrict`);
}

// ══════════════════════════════════════════════
//  DONATIONS
// ══════════════════════════════════════════════

/** Get all donations for an event */
async function getDonations(eventId) {
  return apiFetch("GET", `/events/${eventId}/donations`);
}

/** Add a new donation row */
async function addDonation(eventId, donorName, amount = null, customFields = null, paymentReceived = true) {
  const body = { donor_name: donorName, payment_received: paymentReceived };
  if (amount !== null && amount !== "") body.amount = parseFloat(amount);
  if (customFields) body.custom_fields = customFields;
  return apiFetch("POST", `/events/${eventId}/donations`, body);
}

/** Update a donation row */
async function updateDonation(eventId, donationId, data) {
  return apiFetch("PUT", `/events/${eventId}/donations/${donationId}`, data);
}

/** Delete a donation row */
async function deleteDonation(eventId, donationId) {
  return apiFetch("DELETE", `/events/${eventId}/donations/${donationId}`);
}

// ══════════════════════════════════════════════
//  EXPENSES
// ══════════════════════════════════════════════

/** Get all expenses for an event */
async function getExpenses(eventId) {
  return apiFetch("GET", `/events/${eventId}/expenses`);
}

/** Add a new expense row */
async function addExpense(eventId, description, amount = null, customFields = null) {
  const body = { description };
  if (amount !== null && amount !== "") body.amount = parseFloat(amount);
  if (customFields) body.custom_fields = customFields;
  return apiFetch("POST", `/events/${eventId}/expenses`, body);
}

/** Update an expense row */
async function updateExpense(eventId, expenseId, data) {
  return apiFetch("PUT", `/events/${eventId}/expenses/${expenseId}`, data);
}

/** Delete an expense row */
async function deleteExpense(eventId, expenseId) {
  return apiFetch("DELETE", `/events/${eventId}/expenses/${expenseId}`);
}

// ══════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════

/** Get event financial summary */
async function getSummary(eventId) {
  return apiFetch("GET", `/events/${eventId}/summary`);
}

// ══════════════════════════════════════════════
//  UTILITIES (use shared-utils when available)
// ═════════════════════════════════════════════=

if (typeof window.formatINR !== 'function') {
  window.formatINR = function(amount) {
    if (amount === null || amount === undefined || amount === "") return "—";
    return "₹ " + Number(amount).toLocaleString("en-IN");
  };
}

if (typeof window.formatDate !== 'function') {
  window.formatDate = function(isoString) {
    if (!isoString) return "—";
    return new Date(isoString).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric"
    });
  };
}

if (typeof window.formatDateTime !== 'function') {
  window.formatDateTime = function(isoString) {
    if (!isoString) return "—";
    return new Date(isoString).toLocaleString("en-IN", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });
  };
}

if (typeof window.showToast !== 'function') {
  window.showToast = function(msg, type = "default") {
    if (typeof window.NPUtils?.showToast === 'function') {
      return window.NPUtils.showToast(msg, type);
    }
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const t = document.createElement("div");
    t.className = "toast";
    if (type === "error") t.classList.add("toast-error");
    else if (type === "warning") t.classList.add("toast-warning");
    else if (type === "success") t.classList.add("toast-success");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2300);
  };
}

if (typeof window.getInitials !== 'function') {
  window.getInitials = function(name = "") {
    if (typeof window.NPUtils?.getInitials === 'function') return window.NPUtils.getInitials(name);
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "??";
  };
}

if (typeof window.getAvatarColor !== 'function') {
  window.getAvatarColor = function(name = "") {
    if (typeof window.NPUtils?.getAvatarColor === 'function') return window.NPUtils.getAvatarColor(name);
    const colors = ["#A855F7", "#3b82f6", "#14b8a6", "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#8b5cf6"];
    let hash = 0;
    for (let i = 0; i < String(name || "").length; i++) {
      hash = String(name || "").charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };
}

if (typeof window.applyAvatar !== 'function') {
  window.applyAvatar = function(el, name = "") {
    if (!el) return;
    if (typeof window.NPUtils?.applyAvatar === 'function') {
      window.NPUtils.applyAvatar(el, name);
      return;
    }
    el.textContent = window.getInitials(name);
    el.style.background = window.getAvatarColor(name);
  };
}

let _spinnerActiveCount = 0;
// Ensure functions provided by shared-utils are used when available
if (typeof window.NPUtils === 'object') {
  try {
    if (typeof window.NPUtils.showToast === 'function') window.showToast = window.NPUtils.showToast;
    if (typeof window.NPUtils.getCleanUrl === 'function') window.getCleanUrl = window.NPUtils.getCleanUrl;
  } catch (e) {
    // ignore
  }
}
function injectSpinnerCSS() {
  if (typeof document === "undefined" || !document.head) return;
  let st = document.getElementById("np-spinner-css");
  if (!st) {
    st = document.createElement("style");
    st.id = "np-spinner-css";
    st.textContent = `
      #np-circle-spinner {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        opacity: 1;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #np-circle-spinner.hidden {
        opacity: 0;
        pointer-events: none;
      }
      @media (min-width: 900px) {
        #np-circle-spinner {
          left: 236px;
          width: calc(100vw - 236px);
        }
      }
      .np-designed-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid rgba(26, 78, 140, 0.08);
        border-top-color: var(--primary, #1A4E8C);
        border-left-color: var(--primary, #1A4E8C);
        border-radius: 50%;
        animation: npSpinUnique 1.2s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
        box-shadow: 0 0 8px rgba(26, 78, 140, 0.15);
      }
      body.dark-mode .np-designed-spinner {
        border-color: rgba(96, 165, 250, 0.08);
        border-top-color: var(--primary);
        border-left-color: var(--primary);
        box-shadow: 0 0 8px rgba(96, 165, 250, 0.25);
      }
      @keyframes npSpinUnique {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    `;
    document.head.appendChild(st);
  }
}
if (typeof document !== "undefined") injectSpinnerCSS();

/** Compact Designed Loading Spinner (Single Circle) */
function showCircleLoading() {
  _spinnerActiveCount++;
  const oldBar = document.getElementById("np-top-progress");
  if (oldBar) oldBar.remove();

  injectSpinnerCSS();

  let spinner = document.getElementById("np-circle-spinner");
  if (!spinner) {
    spinner = document.createElement("div");
    spinner.id = "np-circle-spinner";
    spinner.innerHTML = `
      <div class="np-designed-spinner"></div>
    `;
    if (document.body) document.body.appendChild(spinner);
  }
  if (spinner) {
    spinner.style.display = "flex";
    spinner.style.opacity = "1";
  }
}

function hideCircleLoading(force = false) {
  if (force) _spinnerActiveCount = 0;
  else _spinnerActiveCount = Math.max(0, _spinnerActiveCount - 1);

  if (_spinnerActiveCount <= 0) {
    _spinnerActiveCount = 0;
    const spinner = document.getElementById("np-circle-spinner");
    if (spinner) {
      spinner.style.opacity = "0";
      spinner.style.display = "none"; // Hide instantly
    }
    const splash = document.getElementById("app-splash");
    if (splash) {
      splash.style.opacity = "0";
      splash.style.display = "none";
    }
  }
}

if (typeof window !== "undefined") {
  // We no longer hide the spinner automatically on DOMContentLoaded or load.
  // The individual pages (dashboard.html, event-main.js, etc.) are responsible
  // for explicitly calling hideCircleLoading() once they finish fetching their initial data.
  // This prevents the spinner from disappearing while auth-guard.js is redirecting.
}

function showTopLoadingBar() { showCircleLoading(); }
function hideTopLoadingBar() { hideCircleLoading(); }

// ══════════════════════════════════════════════
//  THEME INITIALIZATION
// ══════════════════════════════════════════════
if (window.NPThemeManager) {
  window.NPThemeManager.init();
} else if (localStorage.getItem("np_dark")) {
  document.documentElement.classList.add("dark-mode");
  if (document.body) document.body.classList.add("dark-mode");
}

// ══════════════════════════════════════════════
//  OFFLINE QUEUE SYNCHRONIZER
// ══════════════════════════════════════════════

let isSyncing = false;
async function syncOfflineQueue() {
  if (isSyncing || !navigator.onLine) return;
  let queue = JSON.parse(localStorage.getItem("np_offline_queue") || "[]");
  
  // Purge any stuck AI messages from older versions
  const originalLength = queue.length;
  queue = queue.filter(item => !(item.path.endsWith("/chat") && item.body?.message?.toLowerCase().startsWith("@ai ")));
  if (queue.length !== originalLength) {
    localStorage.setItem("np_offline_queue", JSON.stringify(queue));
  }

  if (!queue.length) return;

  isSyncing = true;
  showToast(`Syncing ${queue.length} offline entries...`, "default");

  const remaining = [];
  let token = await getIdToken();
  if (!token) {
    isSyncing = false;
    return;
  }

  for (const item of queue) {
    try {
      const opts = {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        }
      };
      if (item.body) opts.body = JSON.stringify(item.body);
      
      const res = await fetch(`${API_BASE}${item.path}`, opts);
      if (!res.ok) {
        // Discard permanent client failures (4xx errors, except 401)
        if (res.status >= 400 && res.status < 500 && res.status !== 401) {
          console.error(`Permanent client error (${res.status}) for item ${item.id}. Discarding from sync queue.`);
          continue; // Discard from the queue
        }
        throw new Error(`HTTP ${res.status}`);
      }
      console.log(`Synced offline item ${item.id} successfully`);
    } catch (e) {
      console.error(`Failed to sync offline item ${item.id}:`, e);
      remaining.push(item);
    }
  }

  // Merge remaining with any NEW items that were added during the sync
  const currentQueue = JSON.parse(localStorage.getItem("np_offline_queue") || "[]");
  const newItems = currentQueue.filter(newItem => !queue.some(oldItem => oldItem.id === newItem.id));
  
  localStorage.setItem("np_offline_queue", JSON.stringify([...remaining, ...newItems]));
  isSyncing = false;

  if (remaining.length === 0) {
    showToast("Offline data successfully synced!", "success");
    // Reload local state to fetch actual server IDs
    if (typeof loadAll === "function") {
      loadAll();
    } else if (typeof loadDashboard === "function") {
      loadDashboard();
    } else {
      window.location.reload();
    }
  } else {
    showToast(`Failed to sync ${remaining.length} entries. Retrying soon.`, "error");
  }
}

// Watch network status
window.addEventListener("online", () => {
  syncOfflineQueue();
});

// Periodic sync check every 15 seconds
setInterval(() => {
  if (navigator.onLine) {
    syncOfflineQueue();
  }
}, 15000);

// Run initial sync on load after a brief delay
setTimeout(() => {
  if (navigator.onLine) {
    syncOfflineQueue();
  }
}, 1500);
