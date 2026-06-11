const API_BASE = "API_PLACEHOLDER".replace(/\/$/, "") + "/api/v1";
const ADMIN_API = `${API_BASE}/admin`;

let adminToken = localStorage.getItem('np_admin_token');

// Init
document.addEventListener('DOMContentLoaded', () => {
  if (!adminToken) {
    document.getElementById('login-screen').style.display = 'flex';
  } else {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    loadDashboard();
  }
});

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Authorization': `Bearer ${adminToken}` };
  if (body) headers['Content-Type'] = 'application/json';
  
  const res = await fetch(`${ADMIN_API}${endpoint}`, {
    method, headers, body: body ? JSON.stringify(body) : null
  });
  
  if (res.status === 401) {
    logout();
    throw new Error("Unauthorized");
  }
  return res.json();
}

// Auth
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('admin-email').value;
  const password = document.getElementById('admin-password').value;
  const btn = document.getElementById('login-submit-btn');
  const err = document.getElementById('login-error');
  
  btn.innerText = "Verifying...";
  err.innerText = "";
  
  try {
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);
    
    const res = await fetch(`${ADMIN_API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });
    
    if (!res.ok) throw new Error("Invalid credentials");
    
    const data = await res.json();
    adminToken = data.access_token;
    localStorage.setItem('np_admin_token', adminToken);
    
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    loadDashboard();
  } catch (error) {
    err.innerText = error.message;
  } finally {
    btn.innerText = "Login to Dashboard";
  }
}

function logout() {
  localStorage.removeItem('np_admin_token');
  adminToken = null;
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// Navigation
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function switchTab(tabId, el) {
  document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
  if(el) el.classList.add('active');
  
  document.querySelectorAll('.tab-pane').forEach(tab => tab.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
  
  const titles = {
    'dashboard': 'Dashboard',
    'search': 'Global Search',
    'users': 'User Management',
    'events': 'Event Management',
    'errors': 'System Errors',
    'audit': 'Audit Logs'
  };
  document.getElementById('page-title').innerText = titles[tabId];
  
  if(window.innerWidth <= 768) toggleSidebar();
  
  // Load data
  if (tabId === 'dashboard') loadDashboard();
  else if (tabId === 'users') loadUsers();
  else if (tabId === 'events') loadEvents();
  else if (tabId === 'errors') loadErrors();
  else if (tabId === 'audit') loadAudit();
}

// Dashboard
async function loadDashboard() {
  try {
    const stats = await apiCall('/dashboard/stats');
    document.getElementById('stat-users').innerText = stats.total_users;
    document.getElementById('stat-events').innerText = stats.total_events;
    document.getElementById('stat-new-users').innerText = stats.new_users_today;
    document.getElementById('stat-money').innerText = `₹${stats.total_donations_collected.toLocaleString()}`;
    
    // New stats
    document.getElementById('stat-expenses').innerText = `₹${(stats.total_expenses_tracked || 0).toLocaleString()}`;
    document.getElementById('stat-active-events').innerText = stats.active_events || 0;
    document.getElementById('stat-banned-users').innerText = stats.banned_users || 0;
    document.getElementById('stat-errors-today').innerText = stats.errors_today || 0;
  } catch (e) {
    console.error("Dashboard load failed:", e);
  }
}

// Users
async function loadUsers() {
  const q = document.getElementById('user-search').value;
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = "<tr><td colspan='7'>Loading...</td></tr>";
  try {
    const users = await apiCall(`/users?search=${encodeURIComponent(q)}`);
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td>${u.full_name}</td>
        <td>${u.phone_number}</td>
        <td><span class="badge badge-primary">${u.events_count} events</span></td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td>${u.is_banned ? `<span class="badge badge-danger">Banned</span>` : `<span class="badge badge-success">Active</span>`}</td>
        <td>
          ${u.is_banned 
            ? `<button class="action-btn btn-unban" onclick="unbanUser(${u.id})">Unban</button>`
            : `<button class="action-btn btn-ban" onclick="promptBanUser(${u.id}, '${u.full_name}')">Ban</button>`
          }
          <button class="action-btn btn-del" onclick="promptDeleteUser(${u.id}, '${u.full_name}')">Delete</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {}
}

// Events
async function loadEvents() {
  const q = document.getElementById('event-search').value;
  const tbody = document.getElementById('events-tbody');
  tbody.innerHTML = "<tr><td colspan='6'>Loading...</td></tr>";
  try {
    const events = await apiCall(`/events?search=${encodeURIComponent(q)}`);
    tbody.innerHTML = events.map(e => `
      <tr>
        <td>${e.id}</td>
        <td>${e.name}</td>
        <td>${e.organizer_name}</td>
        <td>${new Date(e.created_at).toLocaleDateString()}</td>
        <td>${e.is_active ? `<span class="badge badge-success">Active</span>` : `<span class="badge badge-danger">Inactive</span>`}</td>
        <td>
          <button class="action-btn btn-warning" onclick="toggleEventStatus('${e.id}')">${e.is_active ? 'Deactivate' : 'Reactivate'}</button>
          <button class="action-btn btn-del" onclick="promptDeleteEvent('${e.id}', '${e.name}')">Delete</button>
        </td>
      </tr>
    `).join("");
  } catch (e) {}
}

// Global Search
async function performGlobalSearch() {
  const q = document.getElementById('global-search-input').value;
  if(q.length < 3) return;
  const area = document.getElementById('search-results');
  area.innerHTML = "Searching...";
  try {
    const res = await apiCall(`/search?q=${encodeURIComponent(q)}`);
    let html = "";
    if (res.users.length) {
      html += `<h4>Users Found</h4>`;
      res.users.forEach(u => {
        html += `<div class="result-card"><div><strong>${u.full_name}</strong> (${u.phone_number})</div></div>`;
      });
    }
    if (res.events.length) {
      html += `<h4>Events Found</h4>`;
      res.events.forEach(e => {
        html += `<div class="result-card"><div><strong>${e.name}</strong> (ID: ${e.id})</div></div>`;
      });
    }
    area.innerHTML = html || "No results found.";
  } catch (e) {}
}
function handleGlobalSearch(e) {
  if(e.key === 'Enter') performGlobalSearch();
}

// Errors & Audit
async function loadErrors() {
  const area = document.getElementById('error-feed');
  area.innerHTML = "Loading...";
  try {
    const errors = await apiCall('/errors');
    area.innerHTML = errors.map(e => `
      <div class="error-item">
        <div class="error-time">${new Date(e.created_at).toLocaleString()}</div>
        <div class="error-ep">${e.endpoint}</div>
        <div class="error-msg">${e.error_message}</div>
      </div>
    `).join("") || "No errors logged.";
  } catch (e) {}
}

async function loadAudit() {
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
  try {
    const logs = await apiCall('/audit-logs');
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${new Date(l.created_at).toLocaleString()}</td>
        <td>Admin ${l.admin_id}</td>
        <td><span class="badge badge-primary">${l.action}</span></td>
        <td>${l.target_type}/${l.target_id}</td>
        <td>${l.details ? JSON.stringify(l.details) : ''}</td>
      </tr>
    `).join("");
  } catch (e) {}
}

// Modal Actions
function showModal(html) {
  document.getElementById('modal-content-area').innerHTML = html;
  document.getElementById('admin-modal').style.display = 'flex';
}
function hideModal() {
  document.getElementById('admin-modal').style.display = 'none';
}

function promptBanUser(id, name) {
  showModal(`
    <div class="modal-title">Ban User: ${name}</div>
    <input type="text" id="ban-reason" placeholder="Reason for ban" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc;">
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeBan(${id})">Confirm Ban</button>
    </div>
  `);
}

async function executeBan(id) {
  const reason = document.getElementById('ban-reason').value || "Violation of terms";
  await apiCall(`/users/${id}/ban`, 'POST', { reason });
  hideModal();
  loadUsers();
}

async function unbanUser(id) {
  if(confirm("Are you sure you want to unban this user?")) {
    await apiCall(`/users/${id}/unban`, 'POST');
    loadUsers();
  }
}

function promptDeleteUser(id, name) {
  showModal(`
    <div class="modal-title">Delete User: ${name}</div>
    <p style="color:var(--admin-danger); font-weight:bold;">Warning: This completely deletes the user and their events.</p>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeDeleteUser(${id})">Delete Forever</button>
    </div>
  `);
}
async function executeDeleteUser(id) {
  await apiCall(`/users/${id}`, 'DELETE');
  hideModal();
  loadUsers();
}

async function toggleEventStatus(id) {
  await apiCall(`/events/${id}/deactivate`, 'POST');
  loadEvents();
}

function promptDeleteEvent(id, name) {
  showModal(`
    <div class="modal-title">Delete Event: ${name}</div>
    <p style="color:var(--admin-danger); font-weight:bold;">Warning: This deletes all data for this event permanently.</p>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeDeleteEvent('${id}')">Delete Event</button>
    </div>
  `);
}
async function executeDeleteEvent(id) {
  await apiCall(`/events/${id}`, 'DELETE');
  hideModal();
  loadEvents();
}
