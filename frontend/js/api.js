// ══════════════════════════════════════════════
//  NotePay — API Client
//  Connects to FastAPI backend at localhost:8000
// ══════════════════════════════════════════════

// Determine API address: Use current hostname (to support mobile access over network)
const API_BASE = `http://${window.location.hostname}:8000`;

// ── Core fetch wrapper — attaches Bearer token automatically ──
async function apiFetch(method, path, body = null) {
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

  const res = await fetch(`${API_BASE}${path}`, opts);

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

  return data;
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
