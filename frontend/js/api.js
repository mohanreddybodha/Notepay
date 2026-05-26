// ══════════════════════════════════════════════
//  NotePay — API Client
//  Connects to FastAPI backend at localhost:8000
// ══════════════════════════════════════════════

// Determine API and WebSocket addresses based on environment
let API_BASE = "";
let WS_BASE = "";
let IS_PRODUCTION = false;

const hostname = window.location.hostname;
// Check if running locally or on a local network IP (e.g., 192.168.x.x)
if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.match(/^[0-9.]+$/)) {
  API_BASE = `http://${hostname}:8000`;
  WS_BASE = `ws://${hostname}:8000`;
} else {
  IS_PRODUCTION = true;
  // REPLACE THESE with your actual AWS Function URL and API Gateway WebSocket URL after deployment:
  API_BASE = "https://replace-with-your-function-url.aws.dev".replace(/\/$/, "");
  WS_BASE = "wss://replace-with-your-websocket-api.execute-api.ap-south-1.amazonaws.com/prod".replace(/\/$/, "");
}

// ── Core fetch wrapper — attaches Bearer token automatically ──
// ── Core fetch wrapper — attaches Bearer token automatically ──
async function apiFetch(method, path, body = null) {
  const isWrite = method === "POST" || method === "PUT" || method === "DELETE";

  // 1. Intercept edits or deletes on temporary offline entries (indicated by a negative ID)
  if ((method === "PUT" || method === "DELETE") && path.match(/\/-?\d+$/)) {
    const tempId = parseInt(path.split("/").pop());
    if (tempId < 0) {
      const queue = JSON.parse(localStorage.getItem("np_offline_queue") || "[]");
      if (method === "PUT") {
        const idx = queue.findIndex(item => item.id === tempId);
        if (idx !== -1) {
          queue[idx].body = { ...queue[idx].body, ...body };
          localStorage.setItem("np_offline_queue", JSON.stringify(queue));
          showToast("Offline update queued locally!", "warning");
          return {
            id: tempId,
            event_id: queue[idx].body.event_id || path.split("/")[2],
            donor_name: queue[idx].body.donor_name || body.donor_name || "",
            description: queue[idx].body.description || body.description || "",
            amount: queue[idx].body.amount || body.amount || null,
            collected_by: parseInt(sessionStorage.getItem("np_my_id")) || 0,
            collected_by_name: sessionStorage.getItem("np_my_name") || "You (Offline)",
            collected_at: new Date().toISOString(),
            custom_fields: queue[idx].body.custom_fields || body.custom_fields || null,
            is_offline: true
          };
        }
      } else if (method === "DELETE") {
        const filtered = queue.filter(item => item.id !== tempId);
        localStorage.setItem("np_offline_queue", JSON.stringify(filtered));
        showToast("Offline entry removed locally!", "warning");
        return { message: "Deleted offline entry" };
      }
    }
  }

  // 2. Intercept write mutations optimistically if navigator is explicitly offline
  if (isWrite && !navigator.onLine) {
    return handleOfflineWrite(method, path, body);
  }

  const token = await getIdToken();
  if (!token) {
    window.location.href = "login.html";
    throw new Error("Not authenticated");
  }
  
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  let res;
  let isNetworkError = false;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (e) {
    if (isWrite) {
      isNetworkError = true;
    } else if (method === "GET") {
      // Offline cached GET fallback
      const cached = localStorage.getItem("cache:" + path);
      if (cached) {
        showToast("Displaying offline cached data", "warning");
        return JSON.parse(cached);
      }
    }
    if (!isNetworkError) throw e;
  }

  // 3. Fallback optimistically if request failed due to a network connection error
  if (isWrite && isNetworkError) {
    return handleOfflineWrite(method, path, body);
  }

  if (res.status === 401) {
    window.location.href = "login.html";
    throw new Error("Session expired");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok && res.status !== 304) {
    const msg = data?.detail || `HTTP ${res.status}`;
    if (res.status === 404 && msg.includes("User not registered")) {
      window.location.replace("profile-setup.html");
      throw new Error("Redirecting to profile setup...");
    }
    throw new Error(msg);
  }

  // Cache successful GET data for offline retrieval
  if (method === "GET" && data) {
    try {
      localStorage.setItem("cache:" + path, JSON.stringify(data));
    } catch (e) {
      console.warn("Storage quota exceeded, unable to cache GET request");
    }
  }

  return data;
}

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
  return {
    id: mockId,
    event_id: eventId,
    donor_name: body?.donor_name || "",
    description: body?.description || "",
    amount: body?.amount || null,
    collected_by: parseInt(sessionStorage.getItem("np_my_id")) || 0,
    collected_by_name: sessionStorage.getItem("np_my_name") || "You (Offline)",
    collected_at: new Date().toISOString(),
    custom_fields: body?.custom_fields || null,
    is_offline: true
  };
}

// ── Unauthenticated fetch (for registration check) ──
async function apiFetchWithToken(method, path, token, body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    sessionStorage.removeItem("np_token_tmp");
    window.location.href = "login.html";
    throw new Error("Session expired");
  }

  const data = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : null;

  return { status: res.status, data };
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
async function createEvent(name, description, eventDate, showDonations = true, showExpenses = true) {
  return apiFetch("POST", "/events", {
    name,
    description,
    event_date: new Date(eventDate).toISOString(),
    show_donations: showDonations,
    show_expenses: showExpenses
  });
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
async function addDonation(eventId, donorName, amount = null, customFields = null) {
  const body = { donor_name: donorName };
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
//  UTILITIES
// ══════════════════════════════════════════════

/** Format Indian currency */
function formatINR(amount) {
  if (amount === null || amount === undefined || amount === "") return "—";
  return "₹ " + Number(amount).toLocaleString("en-IN");
}

/** Format date for display */
function formatDate(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric"
  });
}

/** Format date-time for display */
function formatDateTime(isoString) {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

/** Show a toast notification */
function showToast(msg, type = "default") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = document.createElement("div");
  t.className = "toast" + (type === "error" ? " toast-error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2300);
}

/** Get initials from a full name */
function getInitials(name = "") {
  return name.trim().split(" ").slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

// ══════════════════════════════════════════════
//  THEME INITIALIZATION
// ══════════════════════════════════════════════
if (localStorage.getItem("np_dark")) {
  document.documentElement.classList.add("dark-mode");
  if (document.body) document.body.classList.add("dark-mode");
}

// ══════════════════════════════════════════════
//  OFFLINE QUEUE SYNCHRONIZER
// ══════════════════════════════════════════════

let isSyncing = false;
async function syncOfflineQueue() {
  if (isSyncing || !navigator.onLine) return;
  const queue = JSON.parse(localStorage.getItem("np_offline_queue") || "[]");
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
        // Discard permanent client failures (4xx errors, except 401 and 429)
        if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) {
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

  localStorage.setItem("np_offline_queue", JSON.stringify(remaining));
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
