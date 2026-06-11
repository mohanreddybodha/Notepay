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
  } catch (e) {
    console.error("Failed to load users:", e);
    tbody.innerHTML = `<tr><td colspan='7' style="color:var(--admin-danger);">Error loading users: ${e.message}</td></tr>`;
  }
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
        html += `<div class="result-card clickable" onclick="navigateToSearch('users', '${u.phone_number || u.full_name}')"><div><strong>${u.full_name}</strong> (${u.phone_number})</div></div>`;
      });
    }
    if (res.events.length) {
      html += `<h4>Events Found</h4>`;
      res.events.forEach(e => {
        html += `<div class="result-card clickable" onclick="navigateToSearch('events', '${e.id}')"><div><strong>${e.name}</strong> (ID: ${e.id})</div></div>`;
      });
    }
    area.innerHTML = html || "No results found.";
  } catch (e) {
    console.error("Global search failed:", e);
    area.innerHTML = `<div style="color:var(--admin-danger);">Search error: ${e.message}</div>`;
  }
}

function navigateToSearch(tabId, query) {
  const nth = tabId === 'users' ? 3 : 4;
  switchTab(tabId, document.querySelector(`.nav-links li:nth-child(${nth})`));
  if (tabId === 'users') {
    document.getElementById('user-search').value = query;
    loadUsers();
  } else if (tabId === 'events') {
    document.getElementById('event-search').value = query;
    loadEvents();
  }
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
    tbody.innerHTML = logs.map(l => {
      let detailsTxt = '';
      if (l.details && l.details.reason) {
        detailsTxt = `<strong>Reason:</strong> ${l.details.reason}`;
      } else if (l.details) {
        detailsTxt = JSON.stringify(l.details);
      }
      return `
        <tr>
          <td>${new Date(l.created_at).toLocaleString()}</td>
          <td>Admin ${l.admin_id}</td>
          <td><span class="badge badge-primary">${l.action}</span></td>
          <td>${l.target_type}/${l.target_id}</td>
          <td>${detailsTxt}</td>
        </tr>
      `;
    }).join("");
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

function getReason(idPrefix) {
  const inp = document.getElementById(`${idPrefix}-reason`);
  const err = document.getElementById(`${idPrefix}-error`);
  if (!inp.value.trim()) {
    err.style.display = 'block';
    return null;
  }
  err.style.display = 'none';
  return inp.value.trim();
}

function promptBanUser(id, name) {
  showModal(`
    <div class="modal-title">Ban User: ${name}</div>
    <input type="text" id="ban-reason" placeholder="Reason for ban (Mandatory)" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc; margin-bottom:5px;">
    <div id="ban-error" style="color:var(--admin-danger); font-size:12px; display:none; margin-bottom:10px;">A reason is required to ban a user.</div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeBan(${id})">Confirm Ban</button>
    </div>
  `);
}

async function executeBan(id) {
  const reason = getReason('ban');
  if (!reason) return;
  await apiCall(`/users/${id}/ban`, 'POST', { reason });
  hideModal();
  loadUsers();
}

function unbanUser(id) {
  showModal(`
    <div class="modal-title">Unban User</div>
    <input type="text" id="unban-reason" placeholder="Reason for unban (Mandatory)" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc; margin-bottom:5px;">
    <div id="unban-error" style="color:var(--admin-danger); font-size:12px; display:none; margin-bottom:10px;">A reason is required to unban a user.</div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-primary);" onclick="executeUnban(${id})">Confirm Unban</button>
    </div>
  `);
}

async function executeUnban(id) {
  const reason = getReason('unban');
  if (!reason) return;
  await apiCall(`/users/${id}/unban`, 'POST', { reason });
  hideModal();
  loadUsers();
}

function promptDeleteUser(id, name) {
  showModal(`
    <div class="modal-title">Delete User: ${name}</div>
    <p style="color:var(--admin-danger); font-weight:bold; margin-bottom:10px;">Warning: This completely deletes the user and their events.</p>
    <input type="text" id="deluser-reason" placeholder="Reason for deletion (Mandatory)" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc; margin-bottom:5px;">
    <div id="deluser-error" style="color:var(--admin-danger); font-size:12px; display:none; margin-bottom:10px;">A reason is required to delete a user.</div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeDeleteUser(${id})">Delete Forever</button>
    </div>
  `);
}
async function executeDeleteUser(id) {
  const reason = getReason('deluser');
  if (!reason) return;
  await apiCall(`/users/${id}`, 'DELETE', { reason });
  hideModal();
  loadUsers();
}

function toggleEventStatus(id) {
  showModal(`
    <div class="modal-title">Toggle Event Status</div>
    <p style="margin-bottom:10px;">Are you sure you want to change the active status of this event?</p>
    <input type="text" id="tglevent-reason" placeholder="Reason for status change (Mandatory)" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc; margin-bottom:5px;">
    <div id="tglevent-error" style="color:var(--admin-danger); font-size:12px; display:none; margin-bottom:10px;">A reason is required to toggle event status.</div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-warning);" onclick="executeToggleEventStatus('${id}')">Confirm Change</button>
    </div>
  `);
}

async function executeToggleEventStatus(id) {
  const reason = getReason('tglevent');
  if (!reason) return;
  await apiCall(`/events/${id}/deactivate`, 'POST', { reason });
  hideModal();
  loadEvents();
}

function promptDeleteEvent(id, name) {
  showModal(`
    <div class="modal-title">Delete Event: ${name}</div>
    <p style="color:var(--admin-danger); font-weight:bold; margin-bottom:10px;">Warning: This deletes all data for this event permanently.</p>
    <input type="text" id="delevent-reason" placeholder="Reason for deletion (Mandatory)" style="width:100%; padding:10px; border-radius:4px; border:1px solid #ccc; margin-bottom:5px;">
    <div id="delevent-error" style="color:var(--admin-danger); font-size:12px; display:none; margin-bottom:10px;">A reason is required to delete an event.</div>
    <div class="modal-actions">
      <button class="btn-outline" onclick="hideModal()">Cancel</button>
      <button class="btn" style="background:var(--admin-danger);" onclick="executeDeleteEvent('${id}')">Delete Event</button>
    </div>
  `);
}
async function executeDeleteEvent(id) {
  const reason = getReason('delevent');
  if (!reason) return;
  await apiCall(`/events/${id}`, 'DELETE', { reason });
  hideModal();
  loadEvents();
}
