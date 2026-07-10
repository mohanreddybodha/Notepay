let myEvents = [], sharedEvents = [], watchedEvents = [];
let currentTab = 0;
let isFirstLoad = true;
let filterState = { q: '', sort: 'newest', status: 'all', privacy: 'all', pin: 'all', date: 'all', dStart: '', dEnd: '' };

    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab') || urlParams.get('dbtab') || urlParams.get('from_tab');
    if (tabParam !== null) {
      currentTab = parseInt(tabParam) || 0;
    } else {
      const savedTab = localStorage.getItem('np_dash_tab');
      if (savedTab !== null) {
        currentTab = parseInt(savedTab) || 0;
      }
    }

    // Set tab immediately on load to prevent visual flashing
    switchTab(currentTab, true);
    const viewParam = urlParams.get('view');
    if (viewParam === 'create') {
      switchSPAView('create');
    } else if (viewParam === 'join') {
      switchSPAView('join');
    }

    const msgParam = urlParams.get('msg');
    if (msgParam) {
      window.addEventListener('DOMContentLoaded', () => {
        // Small toast simulation for redirect messages
        if (msgParam === 'private') alert("This event is now private");
        if (msgParam === 'deactivated') alert("This event has been deactivated");
        if (msgParam === 'restricted') alert("Your access to that event was restricted");
        window.history.replaceState({}, document.title, window.location.pathname);
      });
    }

    function toggleCode(id) {
      const el = document.getElementById('code-val-' + id);
      if (!el) return;
      if (el.textContent.includes('•')) {
        el.textContent = el.getAttribute('data-code');
      } else {
        el.textContent = '••••-••••-••••';
      }
    }

    function copyText(text) {
      navigator.clipboard.writeText(text);
    }

    function toggleCodeVis(el, code) {
      const span = el ? (typeof el === 'string' ? document.getElementById('cct-' + el) : el.querySelector('span')) : null;
      if (span) {
        if (span.textContent.includes('•')) {
          span.textContent = code;
        } else {
          span.textContent = '••••••••';
        }
      }
    }

    function copyCodeToast(code, target) {
      copyText(code);
      showToast("Event code copied");
      const svg = typeof target === 'string' ? document.getElementById(target) : (target ? target.querySelector('svg') : null);
      if (svg) {
        svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
        svg.style.color = 'var(--np-green)';
        setTimeout(() => {
          svg.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
          svg.style.color = '';
        }, 2000);
      }
    }

    async function shareMessageWithLogo({ title, text, url }) {
      if (navigator.share) {
        navigator.share({ title, text, url }).catch(() => {});
      } else {
        copyText(`${text}\n${url}`);
        showToast("Professional invite message copied to clipboard");
      }
    }

    function shareCode(code, eventName) {
      const cleanPath = getCleanUrl('join-event.html');
      const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
      const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
      const joinUrl = origin + path + '?code=' + code;
      const inviteMsg = `🤝 Invitation to Collaborate\n\nYou have been invited as a Collector for "${eventName}" on Notepay (Event Contributions & Expenses Tracker).\n\nManage contributions, log expenses, and maintain the event ledger in real time.\n\n🔑 Invite Code: ${code}\n\n👉 Click below to join as a Collector:`;
      shareMessageWithLogo({ title: `Notepay Invite — ${eventName}`, text: inviteMsg, url: joinUrl });
    }

    // ── 0ms Instant Synchronous Render from Cache ──
    try {
      const cachedDash = localStorage.getItem("np_dash_cache");
      const cachedProf = localStorage.getItem("np_profile");
      const profileObj = cachedDash ? JSON.parse(cachedDash).profile : (cachedProf ? JSON.parse(cachedProf) : null);
      if (profileObj?.full_name) {
        applyAvatar(document.getElementById("av-btn"), profileObj.full_name);
        applyAvatar(document.getElementById("av-btn-side"), profileObj.full_name);
        const nameSide = document.getElementById("user-name-side");
        if (nameSide) nameSide.textContent = profileObj.full_name;
      }
      if (cachedDash) {
        const c = JSON.parse(cachedDash);
        if (c.watched_events) watchedEvents = c.watched_events.map(w => w.event);
        if (c.my_events) myEvents = c.my_events;
        if (c.shared_events) sharedEvents = c.shared_events;
        handleSearchFilter();
      }
    } catch(e) {}

    // ── Auth & WS ──
    if (typeof showCircleLoading === "function") showCircleLoading();
    waitForAuthReady().then(user => {
      if (user) {
        refreshDashboard();
        setupDashboardWS().catch(() => { });
      }
    });

    let dashboardWs = null;
    let dashboardWsReady = false;

    async function setupDashboardWS() {
      if (dashboardWs) return;
      const wsUrl = IS_PRODUCTION ? WS_BASE : `${WS_BASE}/ws/dashboard`;
      dashboardWs = new WebSocket(wsUrl);

      dashboardWs.onopen = async () => {
        try {
          const token = await getIdToken();
          if (!token) return;
          dashboardWs.send(JSON.stringify({ type: "AUTH", token: token, dashboard: true }));
          setInterval(() => {
            if (dashboardWs && dashboardWs.readyState === WebSocket.OPEN) {
              dashboardWs.send(" ");
            }
          }, 300000);
        } catch (e) {
          dashboardWs.close();
        }
      };

      dashboardWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "AUTH_OK") {
          dashboardWsReady = true;
          document.getElementById('live-badge').classList.add('v');
          return;
        }
        if (!dashboardWsReady) return;
        if (msg.type === "DASHBOARD_UPDATE") {
          refreshDashboard(true);
        }
      };

      dashboardWs.onclose = () => {
        dashboardWs = null;
        dashboardWsReady = false;
        document.getElementById('live-badge').classList.remove('v');
        setTimeout(() => setupDashboardWS().catch(() => { }), 5000);
      };
    }

    async function refreshDashboard() {
      try {
        const res = await apiFetch("GET", "/users/me/full-dashboard");
        localStorage.setItem("np_dash_cache", JSON.stringify(res));
        const profile = res.profile;
        watchedEvents = res.watched_events.map(w => w.event);
        myEvents = res.my_events;
        sharedEvents = res.shared_events;

        localStorage.setItem("np_my_id", profile.id);
        localStorage.setItem("np_profile", JSON.stringify(profile));

        applyAvatar(document.getElementById("av-btn"), profile.full_name);
        applyAvatar(document.getElementById("av-btn-side"), profile.full_name);

        const nameSide = document.getElementById("user-name-side");
        if (nameSide) nameSide.textContent = profile.full_name;

        handleSearchFilter();
      } catch (err) {
        console.error("Dashboard refresh failed:", err);
      } finally {
        hideCircleLoading(true);
        if (!window._isAutoJoiningEvent) {
          const splash = document.getElementById('app-splash');
          if (splash) splash.style.opacity = '0';
          setTimeout(() => { if (splash) splash.style.display = 'none'; }, 200);
        }
      }
    }


    // ── Filter & Search Logic ──
    /* filterState declaration moved to top */

    function setFilterPill(targetId, val, btnEl) {
      document.getElementById(targetId).value = val;
      const container = btnEl.closest('.flt-pills');
      if (container) {
        container.querySelectorAll('.flt-pill').forEach(b => b.classList.remove('active'));
      }
      btnEl.classList.add('active');
      if (targetId === 'flt-date') toggleCustomDate();
    }

    function syncFilterPills() {
      ['flt-sort', 'flt-status', 'flt-privacy', 'flt-pin', 'flt-date'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const val = el.value;
        const pills = document.querySelector(`.flt-pills[data-target="${id}"]`);
        if (pills) {
          pills.querySelectorAll('.flt-pill').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-val') === val);
          });
        }
      });
    }

    function toggleFilterMenu() {
      const menu = document.getElementById('flt-menu');
      const isOpening = !menu.classList.contains('open');
      menu.classList.toggle('open');
      document.getElementById('flt-toggle').classList.toggle('active');
      if (isOpening) {
        document.getElementById('flt-sort').value = filterState.sort || 'newest';
        document.getElementById('flt-status').value = filterState.status || 'all';
        document.getElementById('flt-privacy').value = filterState.privacy || 'all';
        if (document.getElementById('flt-pin')) document.getElementById('flt-pin').value = filterState.pin || 'all';
        document.getElementById('flt-date').value = filterState.date || 'all';
        document.getElementById('flt-date-start').value = filterState.dStart || '';
        document.getElementById('flt-date-end').value = filterState.dEnd || '';
        toggleCustomDate();
        syncFilterPills();
      }
    }
    function toggleCustomDate() {
      const v = document.getElementById('flt-date').value;
      const row = document.getElementById('custom-date-row');
      if (row) {
        row.classList.toggle('hidden', v !== 'custom');
        row.style.display = (v === 'custom') ? 'flex' : 'none';
      }
    }

    function applyFilterMenu() {
      filterState.sort = document.getElementById('flt-sort').value;
      filterState.status = document.getElementById('flt-status').value;
      filterState.privacy = document.getElementById('flt-privacy').value;
      if (document.getElementById('flt-pin')) filterState.pin = document.getElementById('flt-pin').value;
      filterState.date = document.getElementById('flt-date').value;
      if (filterState.date === 'custom') {
        filterState.dStart = document.getElementById('flt-date-start').value;
        filterState.dEnd = document.getElementById('flt-date-end').value;
      }
      document.getElementById('flt-menu').classList.remove('open');
      document.getElementById('flt-toggle').classList.remove('active');
      const isActive = filterState.sort !== 'newest' || filterState.status !== 'all' || filterState.privacy !== 'all' || filterState.pin !== 'all' || filterState.date !== 'all';
      const fltBtn = document.getElementById('flt-toggle');
      if (fltBtn) fltBtn.classList.toggle('applied', isActive);
      renderEvents();
    }

    function cancelFilterMenu() {
      document.getElementById('flt-menu').classList.remove('open');
      document.getElementById('flt-toggle').classList.remove('active');
    }

    function clearFilterMenu() {
      document.getElementById('flt-sort').value = 'newest';
      document.getElementById('flt-status').value = 'all';
      document.getElementById('flt-privacy').value = 'all';
      if (document.getElementById('flt-pin')) document.getElementById('flt-pin').value = 'all';
      document.getElementById('flt-date').value = 'all';
      document.getElementById('flt-date-start').value = '';
      document.getElementById('flt-date-end').value = '';
      const row = document.getElementById('custom-date-row');
      if (row) {
        row.style.display = 'none';
        row.classList.add('hidden');
      }
      syncFilterPills();
      applyFilterMenu();
    }

    function handleSearchFilter() {
      filterState.q = document.getElementById('search-input').value.toLowerCase();
      document.getElementById('clear-btn').classList.toggle('v', filterState.q.length > 0);
      const isActive = filterState.sort !== 'newest' || filterState.status !== 'all' || filterState.privacy !== 'all' || filterState.pin !== 'all' || filterState.date !== 'all';
      const fltBtn = document.getElementById('flt-toggle');
      if (fltBtn) {
        fltBtn.classList.toggle('applied', isActive);
      }
      renderEvents();
    }

    function clearSearch() {
      const i = document.getElementById('search-input');
      i.value = '';
      handleSearchFilter();
      i.focus();
    }

    function isEventPinned(eventId) {
      try {
        const pinned = JSON.parse(localStorage.getItem("np_pinned_events") || "[]");
        return pinned.includes(String(eventId));
      } catch(e) { return false; }
    }

    function togglePinEvent(eventId) {
      try {
        let pinned = JSON.parse(localStorage.getItem("np_pinned_events") || "[]");
        const sid = String(eventId);
        if (pinned.includes(sid)) {
          pinned = pinned.filter(id => id !== sid);
          showToast("Event unpinned from top");
        } else {
          pinned.push(sid);
          showToast("Event pinned to top");
        }
        localStorage.setItem("np_pinned_events", JSON.stringify(pinned));
        renderEvents();
      } catch(e) {}
    }

    // ── Rendering Engine ──
    function renderEvents() {
      const fMy = myEvents || [];
      const fShared = sharedEvents || [];
      const fWatched = watchedEvents ? watchedEvents.map(w => ({ ...w, my_role: 'visitor' })) : [];

      // Merge watched into ALL tab
      let fAll = [];
      const seenIds = new Set();
      const allSources = [...fMy, ...fShared, ...fWatched];
      allSources.forEach(e => {
        if (!seenIds.has(e.id)) {
          seenIds.add(e.id);
          fAll.push(e);
        }
      });

      const applyFilters = (list) => {
        let res = list.filter(e => {
          // 1. Search Query
          if (filterState.q && !e.name.toLowerCase().includes(filterState.q)) return false;

          // 2. Status
          if (filterState.status === 'active' && !e.is_active) return false;
          if (filterState.status === 'deactivated' && e.is_active) return false;

          // 3. Privacy
          if (filterState.privacy === 'public' && !e.is_public) return false;
          if (filterState.privacy === 'private' && e.is_public) return false;

          // 4. Pin Status
          const isP = isEventPinned(e.id);
          if (filterState.pin === 'pinned' && !isP) return false;
          if (filterState.pin === 'unpinned' && isP) return false;

          // 5. Date
          if (filterState.date === '30days') {
            const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            if (new Date(e.event_date) < thirtyDaysAgo) return false;
          } else if (filterState.date === 'custom' && filterState.dStart && filterState.dEnd) {
            const d = new Date(e.event_date);
            if (d < new Date(filterState.dStart) || d > new Date(filterState.dEnd)) return false;
          }

          return true;
        });

        // 5. Sort
        res.sort((a, b) => {
          const pa = isEventPinned(a.id) ? 1 : 0;
          const pb = isEventPinned(b.id) ? 1 : 0;
          if (pa !== pb) return pb - pa;
          const da = new Date(a.created_at).getTime();
          const db = new Date(b.created_at).getTime();
          return filterState.sort === 'newest' ? db - da : da - db;
        });

        return res;
      };

      const finalAll = applyFilters(fAll);
      const finalMy = applyFilters(fMy);
      const finalShared = applyFilters(fShared);
      const finalWatched = applyFilters(fWatched);

      // Update Counts
      const counts = [finalAll.length, finalMy.length, finalShared.length, finalWatched.length];
      for (let i = 0; i < 4; i++) {
        document.getElementById(`mob-count-${i}`).textContent = counts[i];
        document.getElementById(`sb-count-${i}`).textContent = counts[i];
      }
      localStorage.setItem("np_event_counts", JSON.stringify(counts));

      // Render active tab content
      if (currentTab === 0) document.getElementById("p0").innerHTML = renderList(finalAll, "");
      if (currentTab === 1) document.getElementById("p1").innerHTML = renderList(finalMy, "organizer");
      if (currentTab === 2) document.getElementById("p2").innerHTML = renderList(finalShared, "collector");
      if (currentTab === 3) document.getElementById("p3").innerHTML = renderList(finalWatched, "visitor");
    }

    function renderList(events, explicitRole) {
      if (!events.length) {
        // New premium interactive empty states
        const ctaHtml = `
        <div class="empty-acts">
          <a href="create-event.html" class="btn btn-primary">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create Event
          </a>
          <a href="join-event.html" class="btn btn-sec">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Join Event
          </a>
        </div>
      `;

        if (currentTab === 0) return `<div class="empty"><div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></div><div class="empty-title">Welcome to Notepay</div><div class="empty-desc">Track contributions and expenses for your community events seamlessly.</div>${ctaHtml}</div>`;
        if (currentTab === 1) return `<div class="empty"><div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="empty-title">No events created</div><div class="empty-desc">You are not organizing any events yet. Create one to start collecting.</div>${ctaHtml}</div>`;
        if (currentTab === 2) return `<div class="empty"><div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div><div class="empty-title">No shared events</div><div class="empty-desc">Join an event using an invite code provided by an organizer.</div>${ctaHtml}</div>`;
        if (currentTab === 3) return `<div class="empty"><div class="empty-icon"><svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div><div class="empty-title">No visited events</div><div class="empty-desc">Public events that you view via shared links or QR codes will automatically appear here for easy tracking.</div>${ctaHtml}</div>`;
      }

      return events.map(e => {
        // Determine Role if not explicitly provided (used for All tab)
        let role = explicitRole;
        if (!role) {
          if (myEvents.some(m => m.id === e.id)) role = "organizer";
          else if (sharedEvents.some(s => s.id === e.id)) role = "collector";
          else role = "visitor";
        }
        return renderCard(e, role);
      }).join("");
    }

    function renderCard(e, role) {
      const isPublic = e.is_public;
      const isRestricted = e.is_restricted;
      const isActive = e.is_active;
      const eventUrl = getCleanUrl(`event.html?id=${e.id}&dbtab=${currentTab}`);
      const code = (role === 'organizer') ? (e.invite_code || "") : "";

      let canClick = role === "organizer" || (role === "visitor" && isPublic !== false) || role === "collector";
      let stripClass = "s-active";
      let statusBanner = "";
      let hideActions = false;

      if (isRestricted) {
        stripClass = "s-restricted";
        hideActions = true;
        if (role !== "organizer") canClick = false;
        statusBanner = `
        <div class="card-banner ban-rest">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Restricted · You no longer have access
        </div>`;
      } else if (!isActive) {
        stripClass = "s-deactivated";
        hideActions = true;
        if (role !== "organizer") canClick = false;
        statusBanner = `
        <div class="card-banner ban-deact">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${role === 'organizer' ? 'Deactivated · Tap to manage' : 'Event Deactivated'}
        </div>`;
      } else if (role === "visitor" && isPublic === false) {
        stripClass = "s-deactivated";
        hideActions = true;
        canClick = false;
        statusBanner = `
        <div class="card-banner" style="background:var(--border); color:var(--t3);">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Private Event · Access restricted
        </div>`;
      }

      let clickAction = "";
      if (canClick) {
        clickAction = `onclick="window.location.href='${eventUrl}'"`;
      } else {
        let blockTitle = "";
        let blockReason = "";
        let iconClass = "pi-amber";
        let iconSvg = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

        if (isRestricted) {
          blockTitle = "Access Restricted";
          blockReason = "You have been restricted from accessing this event by the organizer.";
          iconClass = "pi-red";
          iconSvg = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        } else if (!isActive) {
          blockTitle = "Event Deactivated";
          blockReason = "This event is currently deactivated and cannot be accessed.";
        } else if (role === "visitor" && isPublic === false) {
          blockTitle = "Private Event";
          blockReason = "Public access to this event has been restricted by the organizer.";
        }
        clickAction = `onclick="showPopupModal('${blockTitle}', '${blockReason}', '${iconClass}', '${encodeURIComponent(iconSvg)}')"`;
      }

      const cardClass = canClick ? "ev-card" : "ev-card static";

      // Role Badge
      const rbMap = {
        "organizer": `<div class="role-badge rb-org">Organizer</div>`,
        "collector": `<div class="role-badge rb-col">Collector</div>`,
        "visitor": `<div class="role-badge rb-vis">Visitor</div>`
      };

      // Financials
      const goal = e.goal_amount || 0;
      const col = e.total_collections || 0;
      let goalRingHtml = "";

      if (goal > 0) {
        const pct = Math.min(Math.round((col / goal) * 100), 999);
        const circ = 2 * Math.PI * 14;
        const offset = circ - (Math.min(pct, 100) / 100) * circ;
        goalRingHtml = `
        <div class="goal-ring">
          <svg width="44" height="44" viewBox="0 0 36 36"><circle cx="18" cy="18" r="14" fill="none" stroke="var(--border)" stroke-width="3"/><circle cx="18" cy="18" r="14" fill="none" stroke="var(--np-teal)" stroke-width="3" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 18 18)"/></svg>
          <div class="gr-inner"><div class="gr-lbl">Goal</div><div class="gr-pct">${pct}%</div></div>
        </div>`;
      }

      let finHtml = "";
      if (e.show_donations || e.show_expenses) {
        finHtml = `<div class="card-fin">`;
        if (e.show_donations) {
          finHtml += `
          <div class="fin-col">
            <div class="fin-lbl">Collected</div>
            <div class="fin-val g">₹${col.toLocaleString('en-IN')}</div>
          </div>`;
        }
        if (e.show_expenses) {
          const exp = e.total_expenses || 0;
          finHtml += `
          <div class="fin-col">
            <div class="fin-lbl">Expenses</div>
            <div class="fin-val r">₹${exp.toLocaleString('en-IN')}</div>
          </div>`;
        }
        if (e.show_donations && e.show_expenses) {
          const bal = (e.balance !== undefined) ? e.balance : (col - (e.total_expenses || 0));
          finHtml += `
          <div class="fin-col">
            <div class="fin-lbl">Net Balance</div>
            <div class="fin-val n">₹${bal.toLocaleString('en-IN')}</div>
          </div>`;
        }
        finHtml += `</div>`;
      }

      let actRow = "";
      if (!hideActions) {
        actRow = `<div class="card-acts" onclick="event.stopPropagation()">`;
        const pinned = isEventPinned(e.id);
        if (pinned) {
          actRow += `<button class="ca-btn act-pin" style="color: var(--amber); font-weight: 800; border-radius: 4px; margin: 0 4px;" onclick="event.stopPropagation();togglePinEvent('${e.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Unpin</button>`;
        } else {
          actRow += `<button class="ca-btn act-pin" onclick="event.stopPropagation();togglePinEvent('${e.id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg> Pin</button>`;
        }

        if (role === 'organizer') {
          actRow += `<button class="ca-btn act-edit" onclick="event.stopPropagation();window.location.href='create-event.html?edit=${e.id}&from=dashboard&dbtab=${currentTab}'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Manage Event</button>`;
          actRow += `<button class="ca-btn act-summary" onclick="event.stopPropagation();window.location.href='${eventUrl}&tab=sum'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Summary</button>`;
        } else if (role === 'collector') {
          actRow += `<button class="ca-btn act-summary" onclick="event.stopPropagation();window.location.href='${eventUrl}&tab=sum'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Summary</button>`;
          actRow += `<button class="ca-btn" style="color:var(--np-red); font-weight:700;" onclick="event.stopPropagation();confirmExitEvent('${e.id}', false)"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Exit Event</button>`;
        } else {
          // visitor
          actRow += `<button class="ca-btn act-summary" onclick="event.stopPropagation();window.location.href='${eventUrl}&tab=sum'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg> Summary</button>`;
          actRow += `<button class="ca-btn" style="color:var(--np-red); font-weight:700;" onclick="event.stopPropagation();confirmExitEvent('${e.id}', true)"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Remove Event</button>`;
        }

        actRow += `</div>`;
      } else {
        if (role !== 'organizer') {
          actRow = `<div class="card-acts" onclick="event.stopPropagation()">`;
          const isVis = (role === 'visitor');
          const btnTxt = isVis ? 'Remove Event' : 'Exit Event';
          actRow += `<button class="ca-btn" style="color:var(--np-red); font-weight:700;" onclick="event.stopPropagation();confirmExitEvent('${e.id}', ${isVis})"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ${btnTxt}</button>`;
          actRow += `</div>`;
        }
      }

      const mcount = e.member_count || 0;
      const pinnedIcon = isEventPinned(e.id) ? `<span style="color:var(--amber); margin-left:6px; display:inline-flex; align-items:center;" title="Pinned to top"><svg width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg></span>` : '';

      const metaItemsHtml = `
        <div class="meta-item"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formatDate(e.event_date)}</div>
        ${role !== 'visitor' ? `<div class="meta-item"><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ${mcount} Member${mcount !== 1 ? 's' : ''}</div>` : ''}
        ${code ? `
        <div class="code-chip" onclick="event.stopPropagation();toggleCodeVis(this, '${code}')">
          <span>••••••••</span>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="padding: 2px; cursor: pointer; display: flex; align-items: center;" onclick="event.stopPropagation();copyCodeToast('${code}', this)" title="Copy Code">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </div>
            <div style="padding: 2px; cursor: pointer; display: flex; align-items: center; color: var(--np-teal);" onclick="event.stopPropagation();shareCode('${code}', '${escHtml(e.name).replace(/'/g, "\\'")}')" title="Share Code">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </div>
          </div>
        </div>` : ''}`;

      let cardTopHtml = "";
      if (goal > 0) {
        cardTopHtml = `
          <div class="card-top">
            <div class="card-info">
              <div class="card-name" style="display:flex; align-items:center;">${escHtml(e.name)}${pinnedIcon}</div>
              ${e.description ? `<div class="card-desc">${escHtml(e.description)}</div>` : ''}
              <div class="card-meta">
                ${metaItemsHtml}
              </div>
            </div>
            <div class="card-right">
              ${rbMap[role]}
              ${goalRingHtml}
            </div>
          </div>`;
      } else {
        cardTopHtml = `
          <div class="card-top" style="align-items: flex-start; margin-bottom: 4px;">
            <div class="card-info">
              <div class="card-name" style="display:flex; align-items:center;">${escHtml(e.name)}${pinnedIcon}</div>
              ${e.description ? `<div class="card-desc">${escHtml(e.description)}</div>` : ''}
            </div>
            <div class="card-right" style="min-width: auto;">
              ${rbMap[role]}
            </div>
          </div>
          <div class="card-meta" style="margin-top: 0; width: 100%;">
            ${metaItemsHtml}
          </div>`;
      }

      return `
      <div class="${cardClass}" ${clickAction}>
        <div class="ev-strip ${stripClass}"></div>
        <div class="card-body">
          ${cardTopHtml}
          ${finHtml}
        </div>
        ${statusBanner ? statusBanner : '<div class="card-banner hidden"></div>'}
        ${actRow}
      </div>`;
    }

    // ── Tabs Logic ──
    function switchTab(idx, noRender = false) {
      // Do NOT auto-close SPA views here — that causes the tab flash before navigating.
      // SPA views are closed by user explicitly clicking back or a tab.
      currentTab = idx;

      // URL state and persistence
      const u = new URLSearchParams(window.location.search);
      u.set('tab', idx);
      window.history.replaceState({}, '', getCleanUrl(`${window.location.pathname}?${u}`));
      localStorage.setItem('np_dash_tab', idx);

      // Set tab description
      const descEl = document.getElementById('tab-desc');
      if (descEl) {
        if (idx === 0) descEl.textContent = "Showing all events you have access to";
        else if (idx === 1) descEl.textContent = "Showing events you have organized";
        else if (idx === 2) descEl.textContent = "Showing events you have joined as a collector";
        else if (idx === 3) descEl.textContent = "Showing public events you have viewed as a visitor";
      }
      const tabNames = ["All Events", "My Events", "Shared Events", "Visited Events"];
      const crView = document.getElementById('spa-view-create');
      const jnView = document.getElementById('spa-view-join');
      if (crView && jnView && crView.style.display === 'none' && jnView.style.display === 'none') {
        if (document.querySelector('.tb-title')) {
          document.querySelector('.tb-title').textContent = window.innerWidth >= 900 ? tabNames[idx] : '';
        }
      }

      // Update CSS classes
      [0, 1, 2, 3].forEach(x => {
        document.getElementById('mob-tab-' + x).classList.toggle('active', x === idx);
        document.getElementById('sb-tab-' + x).classList.toggle('active', x === idx);
        document.getElementById('p' + x).classList.toggle('hidden', x !== idx);
      });

      // Clear filters on tab switch
      if (!noRender) {
        document.getElementById('search-input').value = '';
        document.getElementById('flt-sort').value = 'newest';
        document.getElementById('flt-status').value = 'all';
        document.getElementById('flt-privacy').value = 'all';
        if (document.getElementById('flt-pin')) document.getElementById('flt-pin').value = 'all';
        document.getElementById('flt-date').value = 'all';
        document.getElementById('flt-date-start').value = '';
        document.getElementById('flt-date-end').value = '';
        document.getElementById('custom-date-row').classList.add('hidden');
        filterState = { q: '', sort: 'newest', status: 'all', privacy: 'all', pin: 'all', date: 'all', dStart: '', dEnd: '' };
        handleSearchFilter();
      }
    }

    let sx = 0;
    document.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', e => {
      const crView = document.getElementById('spa-view-create');
      const jnView = document.getElementById('spa-view-join');
      if (crView && crView.style.display !== 'none') return;
      if (jnView && jnView.style.display !== 'none') return;

      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 55) {
        if (dx < 0 && currentTab < 3) switchTab(currentTab + 1);
        else if (dx > 0 && currentTab > 0) switchTab(currentTab - 1);
      }
    }, { passive: true });

    // ── Overlays ──
    function openSheet() { document.getElementById('sheet-add').classList.remove('hidden'); document.getElementById('ov').classList.add('open'); }
    function closeSheet() { document.getElementById('sheet-add').classList.add('hidden'); document.getElementById('ov').classList.remove('open'); }

    function showPopupModal(title, desc, iconClass, iconSvg) {
      document.getElementById('bm-title').textContent = title;
      document.getElementById('bm-desc').textContent = desc;
      const iconEl = document.getElementById('bm-icon');
      iconEl.className = 'popup-icon ' + iconClass;
      iconEl.innerHTML = decodeURIComponent(iconSvg);
      document.getElementById('blocked-modal').classList.add('open');
      document.getElementById('ov').classList.add('open');
    }

    function closePopupModal() {
      document.getElementById('blocked-modal').classList.remove('open');
      document.getElementById('ov').classList.remove('open');
    }

    let pendingExitEventId = null;
    let pendingIsVisitor = false;
    function confirmExitEvent(eventId, isVisitor = false) {
      pendingExitEventId = eventId;
      pendingIsVisitor = isVisitor;
      const titleEl = document.querySelector('#exit-modal .popup-title');
      const descEl = document.querySelector('#exit-modal .popup-desc');
      const btnEl = document.querySelector('#exit-modal .popup-btn[style*="var(--np-red)"]');
      if (isVisitor) {
        if (titleEl) titleEl.textContent = 'Remove Event';
        if (descEl) descEl.textContent = 'Are you sure you want to remove this event from your visited list?';
        if (btnEl) btnEl.textContent = 'Remove';
      } else {
        if (titleEl) titleEl.textContent = 'Exit Event';
        if (descEl) descEl.textContent = 'Are you sure you want to exit this event? Your entries will be preserved.';
        if (btnEl) btnEl.textContent = 'Exit';
      }
      document.getElementById('exit-modal').classList.add('open');
      document.getElementById('ov').classList.add('open');
    }

    function closeExitModal() {
      pendingExitEventId = null;
      document.getElementById('exit-modal').classList.remove('open');
      document.getElementById('ov').classList.remove('open');
    }

    async function executeExitEvent() {
      if (!pendingExitEventId) return;
      const eventId = pendingExitEventId;
      const isVisitor = pendingIsVisitor;
      closeExitModal();

      try {
        if (isVisitor) {
          await apiFetch("DELETE", `/events/${eventId}/watched`);
          showToast("Removed from visited events");
        } else {
          await apiFetch("POST", `/events/${eventId}/exit`);
          showToast("You have exited the event");
        }
        refreshDashboard();
      } catch (e) {
        showToast(e.message || "Failed to exit/remove event", "error");
      }
    }

    // ── Instant SPA Navigation Controller ──
    function openSPAHelpModal() {
      if (document.getElementById('spa-view-create')?.style.display === 'flex') {
        document.getElementById('tips-modal')?.classList.add('open');
      } else if (document.getElementById('spa-view-join')?.style.display === 'flex') {
        document.getElementById('help-modal')?.classList.add('open');
      }
    }

    function spaGoBack() {
      if (window.history.length > 1) {
        history.back();
      } else {
        switchSPAView('overview');
      }
    }

    function switchSPAView(viewName) {
      const cr = document.getElementById('spa-view-create');
      const overviewEls = document.querySelectorAll('.page-hdr, .tab-bar, .search-row, .tab-desc, .scroll-area, .fab');
      const mainTopbar = document.querySelector('.topbar');
      const spaHeader = document.getElementById('spa-pg-header');
      const spaTitle = document.getElementById('spa-pg-title');

      if (!cr) return;

      closeSheet();

      document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));

      if (viewName === 'create') {
        overviewEls.forEach(el => el.style.display = 'none');
        cr.style.display = 'flex';
        if (mainTopbar) mainTopbar.style.display = 'none';
        if (spaHeader) {
          spaHeader.style.display = 'flex';
          if (spaTitle) spaTitle.textContent = 'Create Event';
        }
        document.querySelector('a[href="create-event.html"]')?.classList.add('active');
        const qsTab = '?tab=' + (typeof currentTab !== 'undefined' ? currentTab : 0);
        if (window.location.pathname.indexOf('create-event') === -1) {
          if (window.location.search.includes('view=create')) {
            history.replaceState({spa: 'create'}, '', getCleanUrl('create-event.html' + qsTab));
          } else {
            history.pushState({spa: 'create'}, '', getCleanUrl('create-event.html' + qsTab));
          }
        }
        const dateInput = document.getElementById("spa-ev-date");
        if (dateInput && !dateInput.value) dateInput.valueAsDate = new Date();
      } else if (viewName === 'join') {
        // Removed SPA join view. Navigates to standalone join-event.html
        window.location.href = getCleanUrl('join-event.html');

      } else {
        cr.style.display = 'none';
        if (mainTopbar) mainTopbar.style.display = 'flex';
        if (spaHeader) spaHeader.style.display = 'none';
        if (document.querySelector('.page-hdr')) document.querySelector('.page-hdr').style.display = '';
        if (document.querySelector('.search-row')) document.querySelector('.search-row').style.display = '';
        if (document.querySelector('.tab-bar')) document.querySelector('.tab-bar').style.display = '';
        if (document.querySelector('.scroll-area')) document.querySelector('.scroll-area').style.display = 'block';
        if (document.querySelector('.fab')) document.querySelector('.fab').style.display = 'flex';
        const tabNames = ["All Events", "My Events", "Shared Events", "Visited Events"];
        if (document.querySelector('.tb-title')) document.querySelector('.tb-title').textContent = window.innerWidth >= 900 ? (tabNames[typeof currentTab !== 'undefined' ? currentTab : 0]) : '';
        document.getElementById('sb-tab-' + (typeof currentTab !== 'undefined' ? currentTab : 0))?.classList.add('active');
        if (window.location.pathname.indexOf('dashboard') === -1 && window.location.pathname !== '/' && !window.location.pathname.endsWith('/')) {
          history.pushState({spa: 'overview'}, '', getCleanUrl('dashboard.html?tab=' + (typeof currentTab !== 'undefined' ? currentTab : 0)));
        }
      }
      window.scrollTo(0, 0);
    }
    


    window.addEventListener('resize', () => {
      const crView = document.getElementById('spa-view-create');
      if (crView && crView.style.display === 'none') {
        const tabNames = ["All Events", "My Events", "Shared Events", "Visited Events"];
        if (document.querySelector('.tb-title')) {
          document.querySelector('.tb-title').textContent = window.innerWidth >= 900 ? (tabNames[typeof currentTab !== 'undefined' ? currentTab : 0]) : '';
        }
      }
    });

    window.addEventListener('popstate', () => {
      const path = window.location.pathname;
      if (path.includes('create-event')) switchSPAView('create');
      else switchSPAView('overview');
    });

    // Intercept SPA links across dashboard
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      const href = link.getAttribute('href');
      if (href === 'create-event.html') {
        e.preventDefault();
        switchSPAView('create');
      } else if (href === 'dashboard.html') {
        e.preventDefault();
        switchSPAView('overview');
      } else if (href && (href.startsWith('profile.html') || href.startsWith('edit-profile.html') || href.startsWith('admin.html'))) {
        e.preventDefault();
        const qs = href.includes('?') ? '&' : '?';
        window.location.href = getCleanUrl(href + qs + 'dbtab=' + (typeof currentTab !== 'undefined' ? currentTab : 0));
      }
    });

    function updateSPALivePreview() {
      const name = document.getElementById("spa-ev-name").value.trim();
      const desc = document.getElementById("spa-ev-desc").value.trim();
      const date = document.getElementById("spa-ev-date").value;
      const goal = document.getElementById("spa-ev-goal").value.trim();

      document.getElementById("spa-pv-card-name").textContent = name || "My New Event";
      document.getElementById("spa-pv-card-desc").textContent = desc || "No description yet";
      
      if (date) {
        document.getElementById("spa-pv-card-date").textContent = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        document.getElementById("spa-pv-card-date").textContent = "Today";
      }

      const ring = document.getElementById("spa-pv-card-ring");
      if (goal && parseInt(goal, 10) > 0) {
        ring.style.display = "flex";
      } else {
        ring.style.display = "none";
      }
    }

    // SPA Form Handlers
    document.getElementById("spa-ev-name")?.addEventListener("input", function() {
      document.getElementById("spa-ev-name-cnt").textContent = this.value.length + "/50";
      document.getElementById("spa-ev-name-error").classList.remove("visible");
      document.getElementById("spa-name-field").style.borderColor = "var(--border-str)";
      updateSPALivePreview();
    });
    document.getElementById("spa-ev-desc")?.addEventListener("input", () => {
      document.getElementById("spa-ev-desc-error")?.classList.remove("visible");
      document.getElementById("spa-desc-field").style.borderColor = "var(--border-str)";
      updateSPALivePreview();
    });
    document.getElementById("spa-ev-date")?.addEventListener("change", () => {
      document.getElementById("spa-ev-date-error").classList.remove("visible");
      document.getElementById("spa-date-field").style.borderColor = "var(--border-str)";
      updateSPALivePreview();
    });
    document.getElementById("spa-ev-goal")?.addEventListener("input", () => {
      document.getElementById("spa-ev-goal-error").classList.remove("visible");
      document.getElementById("spa-goal-field").style.borderColor = "var(--border-str)";
      updateSPALivePreview();
    });

    document.getElementById("spa-create-btn")?.addEventListener("click", async () => {
      const name  = document.getElementById("spa-ev-name").value.trim();
      const desc  = document.getElementById("spa-ev-desc").value.trim();
      const date  = document.getElementById("spa-ev-date").value;
      const goal  = document.getElementById("spa-ev-goal").value.trim();
      const btn   = document.getElementById("spa-create-btn");
      const mainErr = document.getElementById("spa-main-error");
      const mainErrTxt = document.getElementById("spa-main-err-txt");

      mainErr.style.display = "none";

      if (!name) {
        const err = document.getElementById("spa-ev-name-error");
        err.querySelector("span").textContent = "Event name is required.";
        err.classList.add("visible");
        document.getElementById("spa-name-field").style.borderColor = "var(--np-red)";
        document.getElementById("spa-ev-name").focus();
        return;
      }

      if (!date) {
        const err = document.getElementById("spa-ev-date-error");
        err.querySelector("span").textContent = "Event date is required.";
        err.classList.add("visible");
        document.getElementById("spa-date-field").style.borderColor = "var(--np-red)";
        document.getElementById("spa-ev-date").focus();
        return;
      }

      btn.disabled = true; btn.style.opacity = "0.7";
      try {
        const goalAmount = goal ? parseInt(goal, 10) : 0;
        await createEvent(name, desc, date, true, true, goalAmount);
        showToast("Event created successfully!");
        document.getElementById("spa-ev-name").value = "";
        document.getElementById("spa-ev-desc").value = "";
        document.getElementById("spa-ev-goal").value = "";
        switchSPAView('overview');
        refreshDashboard();
      } catch(err) {
        mainErrTxt.textContent = err.message || "Failed to create event.";
        mainErr.style.display = "flex";
      } finally {
        btn.disabled = false; btn.style.opacity = "1";
      }
    });