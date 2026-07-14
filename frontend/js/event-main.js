    if (localStorage.getItem("np_dark")) {
      document.documentElement.classList.add("dark-mode");
      window.addEventListener('DOMContentLoaded', () => document.body.classList.add("dark-mode"));
    }
    // ── State ──
    // fallbackDashTab: tab state is managed by localStorage only (not URL params)
    let fallbackDashTab = null;

    function getSmartDashTab() {
      if (fallbackDashTab !== null && fallbackDashTab !== undefined) {
        localStorage.setItem('np_dash_tab', fallbackDashTab);
        return fallbackDashTab;
      }
      const savedTab = localStorage.getItem('np_dash_tab');
      if (savedTab && ['0', '1', '2', '3'].includes(savedTab)) {
        return savedTab;
      }
      let tab = '0';
      if (typeof isOrganizer !== 'undefined' && isOrganizer) tab = '1';
      else if (typeof isVisitor !== 'undefined' && isVisitor) tab = '3';
      
      localStorage.setItem('np_dash_tab', tab);
      return tab;
    }

    // Extract eventId from clean path (/event/ABCD123) or legacy ?id= param
    const eventId = (typeof parseCurrentPath === 'function' ? parseCurrentPath().id : null)
      || new URLSearchParams(location.search).get('id')
      || new URLSearchParams(location.search).get('eventId')
      || new URLSearchParams(location.search).get('event_id');
    let eventData = null;
    let myUserId = null;
    let isOrganizer = false;
    let isActive = true;
    let donations = [];
    let expenses = [];
    let members = [];
// ── FINANCIALS MODULE (Delegated) ──
    function preserveInlineState(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.preserveInlineState === 'function') return window.EventFinancialsController.preserveInlineState(...args); }
    function captureInlineState(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.captureInlineState === 'function') return window.EventFinancialsController.captureInlineState(...args); }
    function restoreInlineState(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.restoreInlineState === 'function') return window.EventFinancialsController.restoreInlineState(...args); }
    function searchMatch(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.searchMatch === 'function') return window.EventFinancialsController.searchMatch(...args); }
    function renderDonations(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderDonations === 'function') return window.EventFinancialsController.renderDonations(...args); }
    function renderExpenses(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderExpenses === 'function') return window.EventFinancialsController.renderExpenses(...args); }
    function filterByDate(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.filterByDate === 'function') return window.EventFinancialsController.filterByDate(...args); }
    function jumpToTabAndSearch(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.jumpToTabAndSearch === 'function') return window.EventFinancialsController.jumpToTabAndSearch(...args); }
    async function renderSummary(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderSummary === 'function') return window.EventFinancialsController.renderSummary(...args); }
    function renderSummaryUI(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderSummaryUI === 'function') return window.EventFinancialsController.renderSummaryUI(...args); }
    function filterTable(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.filterTable === 'function') return window.EventFinancialsController.filterTable(...args); }
    function restoreNewRowBtn(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.restoreNewRowBtn === 'function') return window.EventFinancialsController.restoreNewRowBtn(...args); }
    function renderInlineEntryForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderInlineEntryForm === 'function') return window.EventFinancialsController.renderInlineEntryForm(...args); }
    async function submitInlineEntry(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.submitInlineEntry === 'function') return window.EventFinancialsController.submitInlineEntry(...args); }
    function renderInlineEditForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.renderInlineEditForm === 'function') return window.EventFinancialsController.renderInlineEditForm(...args); }
    function cancelInlineEdit(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.cancelInlineEdit === 'function') return window.EventFinancialsController.cancelInlineEdit(...args); }
    function cancelInlineEntry(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.cancelInlineEntry === 'function') return window.EventFinancialsController.cancelInlineEntry(...args); }
    async function submitInlineEdit(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.submitInlineEdit === 'function') return window.EventFinancialsController.submitInlineEdit(...args); }
    function openEntryForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openEntryForm === 'function') return window.EventFinancialsController.openEntryForm(...args); }
    function closeEntryForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeEntryForm === 'function') return window.EventFinancialsController.closeEntryForm(...args); }
    async function saveEntry(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.saveEntry === 'function') return window.EventFinancialsController.saveEntry(...args); }
    function openDupPop(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openDupPop === 'function') return window.EventFinancialsController.openDupPop(...args); }
    function closeDupPop(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeDupPop === 'function') return window.EventFinancialsController.closeDupPop(...args); }
    function openCtx(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openCtx === 'function') return window.EventFinancialsController.openCtx(...args); }
    function closeCtx(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeCtx === 'function') return window.EventFinancialsController.closeCtx(...args); }
    function openEditForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openEditForm === 'function') return window.EventFinancialsController.openEditForm(...args); }
    function closeEditForm(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeEditForm === 'function') return window.EventFinancialsController.closeEditForm(...args); }
    async function saveEdit(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.saveEdit === 'function') return window.EventFinancialsController.saveEdit(...args); }
    function openDelPop(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openDelPop === 'function') return window.EventFinancialsController.openDelPop(...args); }
    function openDelColPop(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openDelColPop === 'function') return window.EventFinancialsController.openDelColPop(...args); }
    function openDelDefColPop(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openDelDefColPop === 'function') return window.EventFinancialsController.openDelDefColPop(...args); }
    async function confirmDeleteColumn(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.confirmDeleteColumn === 'function') return window.EventFinancialsController.confirmDeleteColumn(...args); }
    async function confirmDelete(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.confirmDelete === 'function') return window.EventFinancialsController.confirmDelete(...args); }
    function isPinned(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.isPinned === 'function') return window.EventFinancialsController.isPinned(...args); }
    async function togglePin(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.togglePin === 'function') return window.EventFinancialsController.togglePin(...args); }
    function refreshTheaterTable(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.refreshTheaterTable === 'function') return window.EventFinancialsController.refreshTheaterTable(...args); }
    function openDD(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openDD === 'function') return window.EventFinancialsController.openDD(...args); }
    function closeDD(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeDD === 'function') return window.EventFinancialsController.closeDD(...args); }
    function openFilterModal(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openFilterModal === 'function') return window.EventFinancialsController.openFilterModal(...args); }
    function closeFilterModal(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeFilterModal === 'function') return window.EventFinancialsController.closeFilterModal(...args); }
    function syncEventFilterPills(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.syncEventFilterPills === 'function') return window.EventFinancialsController.syncEventFilterPills(...args); }
    function setEventSortPill(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.setEventSortPill === 'function') return window.EventFinancialsController.setEventSortPill(...args); }
    function setEventDatePill(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.setEventDatePill === 'function') return window.EventFinancialsController.setEventDatePill(...args); }
    function toggleEventFilterPill(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.toggleEventFilterPill === 'function') return window.EventFinancialsController.toggleEventFilterPill(...args); }
    function clearEventFilterMenu(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.clearEventFilterMenu === 'function') return window.EventFinancialsController.clearEventFilterMenu(...args); }
    function applyFilterSort(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.applyFilterSort === 'function') return window.EventFinancialsController.applyFilterSort(...args); }
    function updateFilterIconStyles(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.updateFilterIconStyles === 'function') return window.EventFinancialsController.updateFilterIconStyles(...args); }
    function openColDD(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openColDD === 'function') return window.EventFinancialsController.openColDD(...args); }
    function closeColDD(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeColDD === 'function') return window.EventFinancialsController.closeColDD(...args); }
    function triggerManualReceiptUpload(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.triggerManualReceiptUpload === 'function') return window.EventFinancialsController.triggerManualReceiptUpload(...args); }
    async function handleManualReceiptUpload(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.handleManualReceiptUpload === 'function') return window.EventFinancialsController.handleManualReceiptUpload(...args); }
    async function openReceiptModal(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.openReceiptModal === 'function') return window.EventFinancialsController.openReceiptModal(...args); }
    function closeReceiptModal(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.closeReceiptModal === 'function') return window.EventFinancialsController.closeReceiptModal(...args); }
    async function verifyReceiptDonation(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.verifyReceiptDonation === 'function') return window.EventFinancialsController.verifyReceiptDonation(...args); }
    async function rejectReceiptDonation(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.rejectReceiptDonation === 'function') return window.EventFinancialsController.rejectReceiptDonation(...args); }
    async function removeReceiptDonation(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.removeReceiptDonation === 'function') return window.EventFinancialsController.removeReceiptDonation(...args); }
    function toggleReceiptZoom(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.toggleReceiptZoom === 'function') return window.EventFinancialsController.toggleReceiptZoom(...args); }
    function triggerModalReceiptEdit(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.triggerModalReceiptEdit === 'function') return window.EventFinancialsController.triggerModalReceiptEdit(...args); }
    function getCustomFieldsObj(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.getCustomFieldsObj === 'function') return window.EventFinancialsController.getCustomFieldsObj(...args); }
    function applySortAndFilter(...args) { if (window.EventFinancialsController && typeof window.EventFinancialsController.applySortAndFilter === 'function') return window.EventFinancialsController.applySortAndFilter(...args); }

// Sort & Filter state
    let currentSort = 'time_asc'; // 'time_asc', 'time_desc', 'amt_desc', 'amt_asc', 'name_asc'
    let myEntriesOnly = false;
    let yetToBeCollected = false;
    let eventDateFilter = 'all';
    let eventDateStart = '';
    let eventDateEnd = '';
let currentTab = (typeof parseCurrentPath === 'function' ? parseCurrentPath().tab : null) || new URLSearchParams(location.search).get("tab") || "don";
    let ctxTarget = null; // { type:'don'|'exp', entry, row }
    let editTarget = null;
    let isVisitor = false;
    let isRestricted = false;
    let activeTheaterTab = new URLSearchParams(location.search).get("theater");
    let theaterRotation = 0;
    const tabRotations = { don: 0, exp: 0, sum: 0 };
    let summaryData = null; // Backend Summary data
    let ws = null; // WebSocket connection
    let wsAuthenticated = false;
    let vTxnsCount = 5; // Global activity count

    function showInvalidEventId() {
      console.error("Invalid or missing eventId:", new URLSearchParams(location.search).get("id"));
      const loader = document.getElementById("loading-pane");
      if (loader) {
        loader.style.display = "flex";
        loader.innerHTML = `
          <div style="text-align:center; padding:20px; max-width:380px;">
            <div style="font-size:48px; margin-bottom:20px;">❌</div>
            <div style="font-weight:900; font-size:22px; margin-bottom:10px;">Invalid event link</div>
            <div style="color:var(--text3); line-height:1.6; margin-bottom:20px;">This event could not be opened because the page URL is missing a valid event ID.</div>
            <button onclick="window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):getCleanUrl('dashboard.html'))" class="btn" 
                  style="margin-top:10px; padding:14px 40px; border-radius:18px; background:var(--primary); color:white; font-weight:900; box-shadow: 0 8px 20px rgba(0,0,0,0.1);">
                  ← Back to Dashboard
                </button>
          </div>
        `;
      }
    }

    if (!eventId || typeof eventId !== "string" || eventId.trim() === "") {
      showInvalidEventId();
    }

    async function init() {
      if (typeof showCircleLoading === "function") showCircleLoading();
      const user = await waitForAuthReady();
      if (!user) return; // auth-guard.js will handle redirect

      const loader = document.getElementById("loading-pane");
      const loadTimeout = setTimeout(() => {
        if (loader && loader.style.display !== "none") {
          loader.innerHTML = `<div style="text-align:center; padding:20px;"><div style="font-size:40px; margin-bottom:10px;">⏳</div><div style="font-weight:bold; margin-bottom:5px;">Taking longer than usual...</div><div style="font-size:12px; color:var(--text3); margin-bottom:20px;">Check your connection or try again.</div><button class="btn" onclick="location.reload()">Retry Now</button></div>`;
        }
      }, 10000);

      try {
        // PERF: Don't block page load waiting for the /me profile endpoint.
        const cachedMyId = localStorage.getItem("np_my_id");
        if (cachedMyId) {
          myUserId = cachedMyId;
          // Fetch silently in background to keep cache valid
          getMyProfile().then(p => localStorage.setItem("np_my_id", p.id)).catch(console.warn);
        } else {
          const profile = await getMyProfile();
          myUserId = profile.id;
          localStorage.setItem("np_my_id", myUserId);
        }

        setupWebSocket().catch(() => { });
        await loadAll();
      } catch (e) {
        console.error("Init failed:", e);
        const loader = document.getElementById("loading-pane");
        if (loader) {
          loader.innerHTML = `<div style="text-align:center; padding:20px;"><div style="font-size:40px; margin-bottom:10px;">❌</div><div style="font-weight:bold; margin-bottom:5px;">Load Failed</div><div style="font-size:12px; color:var(--text3); margin-bottom:20px;">${e.message || "Unknown error"}</div><button class="btn" onclick="location.reload()">Retry</button></div>`;
        }
      } finally {
        clearTimeout(loadTimeout);
      }
    }

    init().then(() => {
      // Auto-reopen chat if /chat path or ?chat=1 is in URL
      const pathCtx = (typeof parseCurrentPath === 'function') ? parseCurrentPath() : {};
      if (pathCtx.sub === 'chat' || new URLSearchParams(location.search).get("chat") === "1") {
        if (window.EventChatController && typeof window.EventChatController.openChat === 'function') {
          window.EventChatController.openChat();
        } else if (typeof openChat === 'function') {
          openChat();
        }
      }
    });

    // Re-check access every time user returns to this tab
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible") {
        // If data changed, force a FRESH fetch to avoid stale cache flickers
        loadAll(true, true);
      }
    });


    function applyData(res, preventRender = false) {
      eventData = res.event;
      isActive = eventData.is_active;
      donations = res.donations;
      expenses = res.expenses;
      summaryData = res.summary;
      members = res.members || [];

      const rawRole = (res.my_role || "visitor").toLowerCase();
      const myIdStr = localStorage.getItem("np_my_id");
      const myId = myIdStr ? parseInt(myIdStr) : -1;

      // Robust check: Ensure types match for comparison
      const orgId = parseInt(eventData.organizer_id);
      isOrganizer = (rawRole === "organizer") || (orgId === myId);
      EventChatController.isOrganizerGlobal = isOrganizer;
      isVisitor = (rawRole === "visitor") && !isOrganizer;
      isRestricted = res.is_restricted || false;

      // Ensure the left sidebar reflects the current context (match Dashboard look)
      try {
        const npSide = document.querySelector('np-sidebar');
        if (npSide) {
          // Clear any existing active markers
          npSide.querySelectorAll('.sb-item.active').forEach(el => el.classList.remove('active'));
          // Highlight the exact dashboard tab where the event was opened from (0, 1, 2, or 3)
          const activeTabNum = typeof getSmartDashTab === 'function' ? getSmartDashTab() : (localStorage.getItem('np_dash_tab') || '0');
          const el = npSide.querySelector('#sb-tab-' + activeTabNum);
          if (el) el.classList.add('active');
        }
      } catch (err) { /* non-fatal */ }

      // Gate access for Theater Mode: If restricted, deactivated, or private visitor, exit theater mode immediately to show lock screen
      if (activeTheaterTab) {
        const isEventActive = eventData.is_active;
        const canSeeData = isOrganizer || (isEventActive && !isRestricted && (eventData.is_public || !isVisitor));

        if (!canSeeData && !isOrganizer) {
          activeTheaterTab = null;
          const overlay = document.getElementById("rot-overlay");
          if (overlay) overlay.style.display = "none";

          let reason = "Your access to this event has been restricted.";
          if (!isEventActive) {
            reason = "This event has been deactivated by the organizer.";
          } else if (!eventData.is_public && isVisitor) {
            reason = "This event is now private.";
          }
          showToast(`⚠️ ${reason}`, "error");
        }
      }

      // Silently fetch chat history to calculate accurate unread count on page load
      if (!EventChatController.chatHistoryLoaded) {
        loadChatHistory(false, true);
      }
      updateChatFabVisibility();

      // Smooth Refresh for Theater Mode (PRIORITY)
      // Isolated at the end to ensure all state variables (roles, etc) are set first
      if (typeof activeTheaterTab !== 'undefined' && activeTheaterTab) {
        const overlay = document.getElementById("rot-overlay");
        // If not already visible, we must "Enter" it (initial load case)
        if (overlay && overlay.style.display !== "flex") {
          enterTheater(activeTheaterTab);
        } else {
          // ONLY refresh theater table without full page re-render to prevent scroll issues
          refreshTheaterTable();
          updateTheaterStats();
          const membersSheet = document.getElementById("members-sheet");
          if (membersSheet && membersSheet.style.display === "flex") {
            openMembersSheet();
          }
        }
        return;
      }
      
      if (preventRender) {
        updateTheaterStats();
        return;
      }
      
      renderPage();
    }

    let _isFetchingLoadAll = false;
    let _queueNextLoadAll = false;

    async function loadAll(isBackground = false, forceFresh = false, preventRender = false) {
      if (_isFetchingLoadAll) {
         if (isBackground) _queueNextLoadAll = true;
         return;
      }
      _isFetchingLoadAll = true;

      if (!isBackground && !forceFresh) {
        // RESET GLOBALS
        isOrganizer = false;
        EventChatController.isOrganizerGlobal = false;
        isVisitor = true;
        isRestricted = false;

        // PLACE 2: Hybrid Caching (Frontend)
        const cacheKey = "ev_cache_" + eventId;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const cData = JSON.parse(cached);
            // SAFETY VALVE: Only trust cache if it's ACTIVE. 
            // If it was deactivated/private, fetch fresh before showing anything to avoid "Ghost Lockout".
            if (cData.event && cData.event.is_active && (cData.event.is_public || cData.my_role !== 'visitor')) {
              // console.log("⚡️ Hydrating from Cache (Place 2)");
              applyData(cData);
            }
          } catch (e) { console.warn("Cache parse failed", e); }
        }
      }

      // console.log(isBackground ? "🔄 Background Refreshing..." : "🚀 Fetching Fresh Data");
      if (!isBackground && typeof showCircleLoading === "function") showCircleLoading();
      try {
        const res = await apiFetch("GET", `/events/${eventId}/full-details?_t=${Date.now()}`);
        if (!res) {
          if (!isBackground) renderPage();
          return;
        }

        // Update Cache
        localStorage.setItem("ev_cache_" + eventId, JSON.stringify(res));

        // Apply Fresh Data
        applyData(res, preventRender);
      } catch (e) {
        console.error("LoadAll failed", e);
        if (typeof hideCircleLoading === "function") hideCircleLoading(true);
        
        // Always show locked pane for any load error (403, 404, network error)
        // to prevent getting stuck on a blank/loading screen
        const loader = document.getElementById("loading-pane");
        if (loader) loader.style.display = "none";
        
        const mainPage = document.getElementById("main-page");
        if (mainPage) mainPage.style.display = "flex";
        
        const lp = document.getElementById("pane-locked");
        if (lp) {
          lp.style.display = "flex";
          lp.style.position = "fixed";
          lp.style.inset = "0";
          lp.style.zIndex = "9999";
          lp.style.background = "var(--surface)";
          lp.style.flexDirection = "column";
          lp.style.justifyContent = "center";
          lp.style.alignItems = "center";

          lp.innerHTML = `
            <div style="text-align:center; padding:20px;">
              <div style="font-size:72px; margin-bottom:20px;">🔒</div>
              <div style="font-family:'Nunito',sans-serif;font-size:24px;font-weight:900;color:var(--text);margin-bottom:8px;">Access Denied</div>
              <div style="font-size:15px;color:var(--text3);line-height:1.6;max-width:300px;margin:0 auto 24px;">This event is private or you do not have permission to view it.</div>
              <button onclick="window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):getCleanUrl('dashboard.html'))" class="btn" 
                style="margin-top:10px; padding:14px 40px; border-radius:18px; background:var(--primary); color:white; font-weight:900; box-shadow: 0 8px 20px rgba(0,0,0,0.1);">
                ← Back to Dashboard
              </button>
            </div>
          `;
        }
      } finally {
        const splash = document.getElementById('app-splash');
        if (splash) splash.classList.add('hidden');
        const orbitSpin = document.getElementById('np-circle-spinner');
        if (orbitSpin) orbitSpin.classList.add('hidden');
        
        _isFetchingLoadAll = false;
        if (_queueNextLoadAll) {
          _queueNextLoadAll = false;
          // Trigger a single background fetch to catch any missed updates
          setTimeout(() => loadAll(true, true, false), 100);
        }
      }
    }

    async function setupWebSocket() {
      if (ws || !eventId) return;
      const wsUrl = IS_PRODUCTION ? WS_BASE : `${WS_BASE}/ws/${eventId}`;
      ws = new WebSocket(wsUrl);
      wsAuthenticated = false;

      ws.onopen = async () => {
        try {
          const token = await getIdToken();
          if (!token) {
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: "AUTH", token: token, eventId: eventId }));

          // Ping heartbeat every 5 minutes (300000 ms) to keep AWS API Gateway connection alive
          setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(" "); // Empty string ping
            }
          }, 300000);
        } catch (e) {
          console.error("WebSocket auth failed:", e);
          ws.close();
        }
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "AUTH_OK") {
          wsAuthenticated = true;
          if (EventChatController.chatHistoryLoaded) {
            // Re-fetch latest messages so we don't miss anything sent while disconnected
            EventChatController.chatLoading = false;
            loadChatHistory(false, true);
          }
          return;
        }
        if (!wsAuthenticated) return;
        if (
          msg.type === "DATA_CHANGED" || 
          msg.type === "DONATION_ADDED" || 
          msg.type === "DONATION_UPDATED" || 
          msg.type === "DONATION_DELETED" || 
          msg.type === "EXPENSE_ADDED" || 
          msg.type === "EXPENSE_UPDATED" || 
          msg.type === "EXPENSE_DELETED"
        ) {
          console.log(`[debug] WS ${msg.type} received. activeInlineAddType=${activeInlineAddType}`);
          const weCausedIt = window._ignoreNextWsUpdate && (Date.now() - window._ignoreNextWsUpdate < 3000);
          loadAll(true, true, weCausedIt);
        }
        if (msg.type === "NEW_CHAT_MSG" && msg.data) {
          handleIncomingChatMsg(msg.data);
        }
        if (msg.type === "CHAT_REACTION" && msg.data) {
          handleIncomingChatReaction(msg.data);
        }
        if (msg.type === "CHAT_STATUS_UPDATE" && msg.data) {
          handleIncomingChatStatus(msg.data);
        }
        if (msg.type === "AI_TYPING") {
          window._aiLoadingShownAt = Date.now();
          showAITypingIndicator();
        }
      };

      ws.onclose = () => {
        ws = null;
        wsAuthenticated = false;
        setTimeout(() => setupWebSocket().catch(() => { }), 5000);
      };
    }

    function renderPage() {
      // Hide loader IMMEDIATELY to prevent stuck UI
      const loader = document.getElementById("loading-pane");
      if (loader) loader.style.display = "none";
      if (typeof hideCircleLoading === "function") hideCircleLoading(true);

      try {
        if (!eventData) {
          console.warn("renderPage called without eventData");
          return;
        }

        const tb = document.getElementById("tab-bar");
        const lp = document.getElementById("pane-locked");
        const deactLbl = document.getElementById("deact-lbl-dd");
        const deactBanner = document.getElementById("deact-banner");

        const isEventActive = eventData.is_active;
        if (deactLbl) deactLbl.textContent = isEventActive ? "Deactivate Event" : "Reactivate Event";

        // LOCKOUT LOGIC: (Highest Priority)
        let canSeeData = isOrganizer || (isEventActive && !isRestricted && (eventData.is_public || !isVisitor));

        // Header dots menu
        const dotsOrg = document.getElementById("dots-btn");
        const dotsCol = document.getElementById("dots-btn-col");
        const dotsVis = document.getElementById("dots-btn-vis");

        if (dotsOrg) dotsOrg.style.display = isOrganizer ? "flex" : "none";
        if (dotsCol) dotsCol.style.display = (!isOrganizer && !isVisitor) ? "flex" : "none";
        if (dotsVis) dotsVis.style.display = isVisitor ? "flex" : "none";

        // Basic info updates
        document.title = `Notepay — ${eventData.name}`;
        const ttl = document.getElementById("ev-title");
        if (ttl) ttl.textContent = eventData.name;
        const chatTitle = document.getElementById("chat-header-name");
        if (chatTitle) chatTitle.textContent = `${eventData.name} Chat`;
        const desc = document.getElementById("ev-desc");
        if (desc) desc.textContent = eventData.description || "";
        const date = document.getElementById("ev-date");
        if (date) date.innerHTML = npIcon("calendar", { size: 12, tone: "muted" }) + " " + formatDate(eventData.event_date);
        const ib = document.getElementById("info-bar");
        if (ib) ib.style.display = "flex";

        // Privacy Menu labels (legacy ones removed from HTML)
        const pdfBtn = document.getElementById("pdf-report-btn");
        const upiSetupBtn = document.getElementById("upi-setup-btn");
        if (pdfBtn) pdfBtn.style.display = "flex";
        if (upiSetupBtn) upiSetupBtn.style.display = isOrganizer ? "flex" : "none";

        // Hide member badges for non-organizers
        const memberBadges = document.querySelectorAll(".badge-members");
        memberBadges.forEach(badge => {
          if (isOrganizer) {
            badge.style.display = "flex";
          } else {
            badge.style.setProperty("display", "none", "important");
          }
        });

        // Table visibility labels
        const showDon = eventData.show_donations !== false;
        const showExp = eventData.show_expenses !== false;
        const donVisLbl = document.getElementById("don-vis-lbl");
        const expVisLbl = document.getElementById("exp-vis-lbl");
        if (donVisLbl) donVisLbl.textContent = showDon ? "Hide Collections Table" : "Show Collections Table";
        if (expVisLbl) expVisLbl.textContent = showExp ? "Hide Expenses Table" : "Show Expenses Table";
        const donVisBtn = document.getElementById("don-visibility-btn");
        const expVisBtn = document.getElementById("exp-visibility-btn");
        if (donVisBtn) donVisBtn.style.display = isOrganizer ? "flex" : "none";
        if (expVisBtn) expVisBtn.style.display = isOrganizer ? "flex" : "none";

        if (isOrganizer) {
          const deleteItem = document.getElementById("org-delete-event-item");
          const exitItem = document.getElementById("org-exit-event-item");
          if (eventData.organizer_id == myUserId) {
            if (deleteItem) deleteItem.style.display = "flex";
            if (exitItem) exitItem.style.display = "none";
          } else {
            if (deleteItem) deleteItem.style.display = "none";
            if (exitItem) exitItem.style.display = "flex";
          }
        }

        // Tab visibility based on organizer configuration
        const tabDon = document.getElementById("tab-don");
        const tabExp = document.getElementById("tab-exp");
        if (tabDon) tabDon.style.display = showDon ? "" : "none";
        if (tabExp) tabExp.style.display = showExp ? "" : "none";
        // Theater Mode tab visibility
        const rotTabDon = document.getElementById("rot-tab-don");
        const rotTabExp = document.getElementById("rot-tab-exp");
        if (rotTabDon) rotTabDon.style.display = showDon ? "" : "none";
        if (rotTabExp) rotTabExp.style.display = showExp ? "" : "none";

        if (!canSeeData && !isOrganizer) { // Organizer ALWAYS sees data
          // Hide data panes for visitors
          ["pane-don", "pane-exp", "pane-sum", "info-bar", "tab-bar", "deact-banner"].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = "none";
          });

          if (lp) {
            lp.style.display = "flex";
            lp.style.position = "fixed";
            lp.style.inset = "0";
            lp.style.zIndex = "9000"; // Keep below app-bar (usually 1000+) but above content
            lp.style.background = "var(--surface)";
            lp.style.flexDirection = "column";
            lp.style.justifyContent = "center";
            lp.style.alignItems = "center";

            const msg = isRestricted ? "Access Restricted" : (!isEventActive ? "Event Deactivated" : "Event is Private");
            const icon = isRestricted ? npIcon("ban", { size: 72, tone: "red" }) : npIcon("lock", { size: 72, tone: "amber" });
            const sub = isRestricted ? "You have been restricted by the organizer." : (!isEventActive ? "The organizer has deactivated this event." : "The organizer has turned off public access.");

            lp.innerHTML = `
              <div style="text-align:center; padding:20px;">
                <div style="margin-bottom:20px;">${icon}</div>
                <div style="font-family:'Nunito',sans-serif;font-size:24px;font-weight:900;color:var(--text);margin-bottom:8px;">${msg}</div>
                <div style="font-size:15px;color:var(--text3);line-height:1.6;max-width:300px;margin:0 auto 24px;">${sub}</div>
                <button onclick="window.location.href=getCleanUrl('dashboard.html?tab=' + getSmartDashTab())" class="btn" 
                  style="margin-top:10px; padding:14px 40px; border-radius:18px; background:var(--primary); color:white; font-weight:900; box-shadow: 0 8px 20px rgba(0,0,0,0.1);">
                  ← Back to Dashboard
                </button>
              </div>
            `;
          }
          return;
        } else {
          // ENSURE everything is visible for authorized users
          ["info-bar", "tab-bar"].forEach(id => {
            const el = document.getElementById(id); if (el) el.style.display = "flex";
          });
          if (lp) {
            lp.style.display = "none";
            lp.style.position = "static";
            lp.style.inset = "auto";
            lp.style.zIndex = "auto";
            lp.innerHTML = "";
          }
        }

        // ORGANIZER WARNING BANNER
        if (isOrganizer && !isEventActive) {
          if (deactBanner) {
            deactBanner.style.display = "flex";
            deactBanner.style.background = "var(--amber)";
            const dlbl = document.getElementById("deact-lbl-banner");
            if (dlbl) dlbl.textContent = "Event Deactivated · Collectors & Visitors locked out";
          }
        } else {
          if (deactBanner) deactBanner.style.display = "none";
        }

        // Members badge / Role Badge
        const mb = document.getElementById("members-badge");
        const expMb = document.querySelector("#pane-exp .badge-members");
        
        if (isOrganizer) {
          if (mb) {
            mb.style.display = "flex";
            mb.className = "flt-btn badge-members";
            mb.innerHTML = (typeof npIcon === 'function' ? npIcon("user", { size: 14 }) : "") + " Members";
            mb.onclick = openMembersSheet;
            mb.style.cursor = "pointer";
          }
          if (expMb) expMb.style.display = "flex";
        } else {
          if (mb) mb.style.setProperty("display", "none", "important");
          if (expMb) expMb.style.setProperty("display", "none", "important");
        }

        const colActionLbl = document.getElementById("col-action-lbl");
        const colActionItem = document.getElementById("col-action-item");
        if (colActionLbl && colActionItem) {
          if (isVisitor) {
            colActionLbl.textContent = "Remove Event";
            colActionItem.onclick = () => { closeColDD(); openRemovePop(); };
          } else {
            colActionLbl.textContent = "Exit Event";
            colActionItem.onclick = () => { closeColDD(); openExitPop(); };
          }
        }

        // Role visibility logic already handled at top.

        // Deactivation and visibility logic handled at top.

        const dnr = document.getElementById("don-new-row");
        const enr = document.getElementById("exp-new-row");
        if (dnr) dnr.style.display = isOrganizer ? "flex" : "none";
        if (enr) enr.style.display = isOrganizer ? "flex" : "none";

        const dacb = document.getElementById("don-add-col-btn");
        const eacb = document.getElementById("exp-add-col-btn");
        if (dacb) dacb.style.display = isOrganizer ? "block" : "none";
        if (eacb) eacb.style.display = isOrganizer ? "block" : "none";

        // Pick the correct default tab based on visibility
        const defaultTab = (currentTab && ((currentTab === 'don' && showDon) || (currentTab === 'exp' && showExp) || currentTab === 'sum')) ? currentTab : (showDon ? 'don' : (showExp ? 'exp' : 'sum'));
        switchTab(defaultTab, false, true);
        if (activeTheaterTab) {
          // If the active theater tab was just hidden, switch to the first available
          const theaterTabValid = (activeTheaterTab === 'don' && showDon) || (activeTheaterTab === 'exp' && showExp) || activeTheaterTab === 'sum';
          const safeTab = theaterTabValid ? activeTheaterTab : (showDon ? 'don' : (showExp ? 'exp' : 'sum'));
          enterTheater(safeTab);
        }

        // Chat FAB visibility (hide for visitors and in theater mode)
        updateChatFabVisibility();

        // Auto-open chat if URL parameter present
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('chat') && !EventChatController.chatOpen) {
          openChat();
        }
      } catch (e) {
        console.error("renderPage crashed:", e);
        const loader = document.getElementById("loading-pane");
        if (loader) loader.style.display = "none";
      }
    }

    function hideDeactPopAndShowData() {
      document.getElementById('deact-manage-pop').style.display = 'none';
      document.getElementById('pane-locked').style.display = 'none';
      document.getElementById('tab-bar').style.display = 'flex';
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;
      const fallback = showDon ? 'don' : (showExp ? 'exp' : 'sum');
      switchTab(currentTab || fallback);
    }

    // ── Tab switching ──
    function switchTab(tab, updateUrl = true, preserveInline = false) {
      // console.log(`[debug] switchTab: tab=${tab}, updateUrl=${updateUrl}, preserveInline=${preserveInline}, activeInlineAddType=${activeInlineAddType}`);
      if (!preserveInline) {
        activeInlineAddType = null;
        activeInlineEditType = null;
        activeInlineEditId = null;
      }
      currentTab = tab;
      if (updateUrl) {
        const tabSegment = { don: 'collections', exp: 'expenses', sum: 'summary' }[tab];
        if (eventId && tabSegment && typeof buildUrl === 'function') {
          // buildUrl handles localhost (.html?param) vs production (/path/segments) automatically
          history.replaceState(null, '', buildUrl('event', eventId, tabSegment));
        } else {
          // Fallback: update query param on old-style URL or when buildUrl not available
          const p = new URLSearchParams(window.location.search);
          p.set('tab', tab);
          history.replaceState(null, '', '?' + p.toString());
        }
      }
      ["don", "exp", "sum"].forEach(t => {
        const el = document.getElementById("tab-" + t);
        if (el) el.classList.toggle("active", t === tab);
      });

      // Animate Tab Indicator
      const activeTabEl = document.getElementById("tab-" + tab);
      
      const indicator = document.getElementById("tab-indicator");
      if (indicator && activeTabEl) {
        indicator.style.width = activeTabEl.offsetWidth + "px";
        indicator.style.transform = `translateX(${activeTabEl.offsetLeft}px)`;
      }

      if (activeTheaterTab) return;

      ["don", "exp", "sum"].forEach(t => {
        const p = document.getElementById("pane-" + t);
        if (p) p.style.display = t === tab ? (t === "sum" ? "block" : "flex") : "none";
        if (p && t !== "sum") p.style.flexDirection = "column";
      });
      if (tab === "don") renderDonations();
      if (tab === "exp") renderExpenses();
      if (tab === "sum") { vTxnsCount = 5; renderSummary(); }
      else vTxnsCount = 5;
    }

    // --- Seamless Inline State Preservation ---
    let _draftInlineData = null;
    let _preservedInlineFormNode = null;
// ── Donations ──
// ── Expenses ──
// ── Summary ──
    let sumDateFilter = 'all'; // all, month, week, today
    let sumLimits = { don: 5, exp: 5, col: 5 };
// ── Entry Form ──
    let entryType = "don";
    let activeInlineAddType = null;
    let activeInlineEditType = null;
    let activeInlineEditId = null;
// --- INLINE EDITING FOR THEATER MODE ---
// ── Context menu ──
    // Long press logic removed. Double tap works cleanly.

    let ctxEntry = null, ctxType = null;
let colToDeleteType = "custom";
// Perfect Silent Update: Adopts the exact Event Page strategy
function openExitPop() {
      showGlobalConfirmModal({
        title: "Exit Event",
        desc: "Are you sure you want to exit this event? Your entries will be preserved.",
        iconTone: "red",
        confirmText: "Exit",
        confirmColor: "var(--red)",
        onConfirm: confirmExit
      });
    }
    
    async function confirmExit() {
      const lp = document.getElementById("loading-pane");
      try {
        if (lp) lp.style.display = "flex";
        await apiFetch("POST", `/events/${eventId}/exit`);
        // Clear all cached state so user loses access immediately
        clearEventCache();
        localStorage.removeItem("ev_cache_" + eventId);
        window.location.replace("dashboard.html");
      } catch (e) {
        if (lp) lp.style.display = "none";
        showToast(e.message || "Error leaving event.", "error");
      }
    }

    function openRemovePop() {
      showGlobalConfirmModal({
        title: "Remove Event?",
        desc: `Do you want to remove event <strong>${escHtml(eventData ? eventData.name : "")}</strong> from your <strong>Visited Events</strong> tab? You will need to visit the link again to see it.`,
        iconTone: "red",
        confirmText: "Remove",
        confirmColor: "var(--red)",
        onConfirm: confirmRemove
      });
    }

    async function confirmRemove() {
      const lp = document.getElementById("loading-pane");
      try {
        if (lp) lp.style.display = "flex";
        // If user was promoted to member, exit properly first
        try { await apiFetch("POST", `/events/${eventId}/exit`); } catch (ex) { /* Not a member, that's fine */ }
        // Then remove from discover/watched tab
        try { await unwatchEvent(eventId); } catch (ex) { /* Not in watched, that's fine */ }
        // Clear all cached state
        clearEventCache();
        localStorage.removeItem("ev_cache_" + eventId);
        window.location.replace("dashboard.html");
      } catch (e) {
        if (lp) lp.style.display = "none";
        showToast(e.message || "Error removing event.", "error");
      }
    }

    function revokeCode() {
      document.getElementById('regenerate-code-pop').style.display = 'flex';
    }
    async function confirmRegenerateCode() {
      try {
        document.getElementById('regenerate-code-pop').style.display = 'none';
        const res = await apiFetch("POST", `/events/${eventId}/generate_code`);
        // Proactively update local state for instant sheet refresh
        if (res && res.invite_code) eventData.invite_code = res.invite_code;
        clearEventCache();
        await loadAll(false, true);
        openCodeSheet(); // Re-open the sheet so user can copy the new code
        showToast("Invite code regenerated!", "success");
      } catch (e) {
        showToast(e.message || "Failed to regenerate code.", "error");
      }
    }

    function clearEventCache() {
      const myId = localStorage.getItem("np_my_id") || "guest";
      localStorage.removeItem(`event_cache_${eventId}_u${myId}`);
      localStorage.removeItem("ev_cache_" + eventId);
    }


    function shareEventJoinCode() {
      const code = eventData.invite_code;
      if (!code) return;
      const cleanPath = typeof getCleanUrl === 'function' ? getCleanUrl('join-event.html') : 'join-event.html';
      const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
      const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
      const joinUrl = (typeof buildUrl === 'function')
        ? window.location.origin + buildUrl('join', code)
        : origin + path + '?code=' + code;
      const inviteMsg = `🤝 Invitation to Collaborate\n\nYou have been invited as a Collector for "${eventData.name}" on Notepay (Event Contributions & Expenses Tracker).\n\nManage contributions, log expenses, and maintain the event ledger in real time.\n\n🔑 Invite Code: ${code}\n\n👉 Click below to join as a Collector:`;
      shareMessageWithLogo({ title: `Notepay Invite — ${eventData.name}`, text: inviteMsg, url: joinUrl });
    }

    async function toggleTableVisibility(type) {
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;
      const newVal = type === 'don' ? !showDon : !showExp;
      // At least one table must remain visible
      if (type === 'don' && !newVal && !showExp) { showToast("At least one table must be enabled", "error"); return; }
      if (type === 'exp' && !newVal && !showDon) { showToast("At least one table must be enabled", "error"); return; }
      try {
        const data = type === 'don' ? { show_donations: newVal } : { show_expenses: newVal };
        await updateEvent(eventId, data);
        if (type === 'don') eventData.show_donations = newVal;
        else eventData.show_expenses = newVal;
        clearEventCache();
        renderPage();
        showToast(newVal ? `${type === 'don' ? 'Collections' : 'Expenses'} table is now visible` : `${type === 'don' ? 'Collections' : 'Expenses'} table hidden`, newVal ? "success" : "info");
      } catch (e) {
        showToast("Failed to update table visibility", "error");
      }
    }

    /** Robust copy to clipboard (handles non-secure contexts/HTTP) */
    function copyToClipboard(text, successMsg = "Copied!") {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast(successMsg)).catch(() => fallbackCopy(text, successMsg));
      } else {
        fallbackCopy(text, successMsg);
      }
    }

    function fallbackCopy(text, successMsg) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed"; // avoid scrolling to bottom
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        showToast(successMsg);
      } catch (err) {
        alert("Please copy this manually: " + text);
      }
      document.body.removeChild(textArea);
    }

    async function toggleDeactivate() {
      if (isActive) {
        // Only show confirmation when DEACTIVATING
        document.getElementById("deact-confirm-pop").style.display = "flex";
      } else {
        // Direct reactivation - NO POPUP, ONE CLICK
        try {
          await apiFetch("PUT", `/events/${eventId}/reactivate`);
          isActive = true;
          eventData.is_active = true;
          clearEventCache();
          renderPage();
          showToast("Event reactivated!", "success");
        } catch (e) { showToast(e.message || "Reactivate failed.", "error"); }
      }
    }

    async function confirmDeactivate() {
      try {
        await apiFetch("PUT", `/events/${eventId}/deactivate`);
        isActive = false;
        eventData.is_active = false;
        clearEventCache();
        document.getElementById("deact-confirm-pop").style.display = "none";
        renderPage();
        showToast("Event deactivated.");
      } catch (e) { showToast(e.message || "Deactivate failed.", "error"); }
    }

    function closeDeactPop() {
      document.getElementById("deact-manage-pop").style.display = "none";
    }

    function viewDataOnly() {
      window._viewDataMode = true;
      closeDeactPop();
      renderPage();
    }

    function showDelEventPop() {
      showGlobalConfirmModal({
        title: "Delete Event?",
        desc: `Are you sure you want to delete the event "<strong>${escHtml(eventData.name)}</strong>"? This will permanently remove all data and cannot be undone.`,
        iconTone: "red",
        confirmText: "Delete",
        confirmColor: "var(--red)",
        onConfirm: doDeleteEvent
      });
    }
    async function doDeleteEvent() {
      try { await deleteEvent(eventId); window.location.replace("dashboard.html"); }
      catch (e) { showToast(e.message || "Delete failed.", "error"); }
    }

    // ── Code Sheet ──

    function openCodeSheet() { document.getElementById("sheet-code").textContent = eventData.invite_code || "—"; document.getElementById("code-sheet").style.display = "flex"; }
    function closeCodeSheet() { document.getElementById("code-sheet").style.display = "none"; }
    function copyCode() {
      copyToClipboard(eventData.invite_code || "", "Code copied!");
      const btn = document.getElementById("sheet-copy-btn");
      if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          btn.innerHTML = originalHtml;
        }, 2000);
      }
    }
    // ── Members Sheet ──
    let memTarget = null;
    async function openMembersSheet() {
      document.getElementById("members-sheet").style.display = "flex";
      const list = document.getElementById("members-list");

      // Use cached members if available, otherwise fetch
      if (!members || members.length === 0) {
        list.innerHTML = `<div style="padding:14px;text-align:center;"><div class="loader" style="width:22px;height:22px;margin:0 auto;"></div></div>`;
        try {
          members = await getMembers(eventId);
        } catch (e) {
          list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red);">Failed to load.</div>`;
          return;
        }
      }

      const mCount = document.getElementById("members-count");
      if (mCount) mCount.textContent = members.length + " total";
      const sortedMembers = [...members].sort((a, b) => {
        const roleWeight = (m) => {
          if (m.user_id === eventData.organizer_id) return 0;
          if ((m.role || "").toLowerCase() === "organizer") return 1;
          return 2;
        };
        const wA = roleWeight(a);
        const wB = roleWeight(b);
        if (wA !== wB) return wA - wB;
        const nameA = (a.user?.full_name || "Unknown").toLowerCase();
        const nameB = (b.user?.full_name || "Unknown").toLowerCase();
        return nameA.localeCompare(nameB);
      });

      list.innerHTML = sortedMembers.map(m => {
        const uId = m.user_id;
        const uName = m.user?.full_name || "Unknown";
        const isMe = uId == myUserId;
        const roleStr = (m.role || "").toLowerCase();
        const isRes = m.is_restricted;
        const isCreator = uId == eventData.organizer_id;

        const roleTxt = isRes ? '<span style="color:var(--red);font-weight:800;">Restricted</span>' : (isCreator ? `<span style="color:var(--amber);font-weight:800;">${npIcon("crown", { size: 12, tone: "amber" })} Creator</span>` : (m.role === "Organizer" ? "Organizer" : "Collector"));

        return `<div class="mem-row">
        <div class="mem-av">${getInitials(uName)}</div>
        <div style="flex:1;">
          <div class="mem-name">${escHtml(uName)}${isMe ? " <span style='color:var(--teal);font-size:10px;font-weight:900;'>(You)</span>" : ""}</div>
          <div class="mem-sub">${roleTxt}</div>
        </div>
        ${isOrganizer && !isMe && !isCreator ? `
          <div class="mem-dots" onclick="openMCtx(event, ${uId}, '${escHtml(uName)}', '${roleStr}', ${isRes})">⋮</div>
        ` : ""}
      </div>`;
      }).join("");
    }
    function closeMembersSheet() { document.getElementById("members-sheet").style.display = "none"; }

    // ── Member Context Menu (MCtx) ──
    function openMCtx(ev, uId, uName, role, res) {
      ev.stopPropagation();
      memTarget = { id: uId, name: uName, role: role, res: res };
      const box = document.getElementById("mctx-box");
      const ov = document.getElementById("mctx-ov");

      // Update menu labels
      document.getElementById("mctx-promote").innerHTML = role.toLowerCase() === "organizer" ? "Demote to Collector" : npIcon("crown", { size: 14, tone: "amber" }) + " Make Organizer";
      document.getElementById("mctx-restrict").innerHTML = res ? npIcon("check", { size: 14, tone: "green" }) + " Unrestrict User" : npIcon("ban", { size: 14, tone: "red" }) + " Restrict User";

      ov.style.display = "block";
      ov.style.background = "transparent";

      // Position near the touch/click, clamped to stay inside the viewport
      const x = ev.clientX ?? ev.touches?.[0]?.clientX ?? window.innerWidth / 2;
      const y = ev.clientY ?? ev.touches?.[0]?.clientY ?? window.innerHeight / 2;
      const bw = 180;
      const bh = 88; // approx height of two menu items
      const clampedX = Math.max(8, Math.min(x - bw / 2, window.innerWidth - bw - 8));
      const clampedY = Math.max(8, Math.min(y + 4, window.innerHeight - bh - 8));
      box.style.left = clampedX + "px";
      box.style.top = clampedY + "px";
    }
    function closeMCtx() { document.getElementById("mctx-ov").style.display = "none"; }

    function openRestrictedPromotionPopup() {
      const popup = document.getElementById("restricted-promo-pop");
      if (!popup) return;
      popup.style.display = "flex";
    }

    function handlePromoteClick() {
      closeMCtx();
      if (memTarget.role.toLowerCase() === "organizer") {
        document.getElementById("demote-user-name").textContent = memTarget.name;
        document.getElementById("demote-pop").style.display = "flex";
      } else {
        if (memTarget.res) {
          openRestrictedPromotionPopup();
          return;
        }
        document.getElementById("promote-user-name").textContent = memTarget.name;
        document.getElementById("promote-pop").style.display = "flex";
      }
    }

    async function confirmDemote() {
      try {
        await apiFetch("PUT", `/events/${eventId}/members/${memTarget.id}/role`, { role: "Collector" });
        // Proactively update local members array
        if (members) {
          const m = members.find(x => x.user_id === memTarget.id);
          if (m) m.role = "Collector";
        }
        document.getElementById("demote-pop").style.display = "none";
        showToast(`${memTarget.name} is now a Collector.`);
        clearEventCache();
        // Broadcast to dashboard for instant update
        await loadAll(true, true);
        openMembersSheet();
        if (memTarget.id === myUserId) location.reload();
      } catch (e) {
        showToast(e.message || "Failed to demote.", "error");
      }
    }

    async function confirmPromote() {
      try {
        if (memTarget.res) {
          openRestrictedPromotionPopup();
          document.getElementById("promote-pop").style.display = "none";
          return;
        }
        await apiFetch("PUT", `/events/${eventId}/members/${memTarget.id}/role`, { role: "Organizer" });
        if (members) {
          const m = members.find(x => x.user_id === memTarget.id);
          if (m) m.role = "Organizer";
        }
        document.getElementById("promote-pop").style.display = "none";
        showToast(`${memTarget.name} is now an Organizer!`);
        clearEventCache();
        await loadAll(true, true);
        openMembersSheet();
      } catch (e) { showToast(e.message || "Promotion failed.", "error"); }
    }

    function handleRestrictClick() {
      closeMCtx();
      if (memTarget.res) {
        doUnrestrict(memTarget.id);
      } else {
        doRestrict(memTarget.id, memTarget.name);
      }
    }

    // ── Restrict Logic ──
    let restrictUserId = null;
    function closeRestrictPop() { document.getElementById("restrict-pop").style.display = "none"; }
    function doRestrict(uid, name) {
      restrictUserId = uid;
      const ns = document.getElementById("restrict-user-name");
      if (ns) ns.textContent = name;
      document.getElementById("restrict-pop").style.display = "flex";
    }
    async function confirmRestrict() {
      try {
        await restrictMember(eventId, restrictUserId);
        showToast("Member restricted.");
        // Proactively update local members array for instant UI
        if (members) {
          const m = members.find(x => x.user_id === restrictUserId);
          if (m) {
            m.is_restricted = true;
            m.role = "collector"; // Promotion logic in backend also demotes restricted orgs
          }
        }
        clearEventCache();
        // If restricted member was the current user, show restricted page
        if (restrictUserId === myUserId) {
          isRestricted = true;
          renderPage();
        } else {
          // Broadcast to other members' dashboards for instant update
          await loadAll(true, true);
        }
        closeRestrictPop();
        openMembersSheet(); // This will now use the updated 'members' array
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }
    async function doUnrestrict(uid) {
      try {
        await unrestrictMember(eventId, uid);
        showToast("Member restored.");
        // Proactively update local members array
        if (members) {
          const m = members.find(x => x.user_id === uid);
          if (m) m.is_restricted = false;
        }
        clearEventCache();
        // Broadcast to dashboard for instant update
        await loadAll(true, true);
        openMembersSheet();
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }

    function openRenameSheet() { 
      sessionStorage.setItem('np_edit_from', 'event');
      window.location.href = (typeof buildUrl === 'function') ? buildUrl('edit-event', eventId) : `create-event.html?edit=${eventId}`;
    }

    // ── Helpers ──
        function formatPrefixes(s) {
      if (!s) return "";
      let html = escHtml(s);
      
      // Keep old patterns just in case, but replace them with clean badges
      html = html.replace(/^\((M|AI|AI-P)\)\s*/i, '');
      
      // If it starts with AI (with or without parens)
      if (s.startsWith('AI ') || s.startsWith('(AI) ')) {
         html = html.replace(/^(AI\s*|\(AI\)\s*)/i, '<span style="background:var(--blue);color:white;padding:2px 4px;border-radius:4px;font-weight:700;font-size:10px;margin-right:6px;">AI</span>');
      } else if (s.startsWith('Manual ') || s.startsWith('(M) ')) {
         html = html.replace(/^(Manual\s*|\(M\)\s*)/i, '<span style="background:var(--red);color:white;padding:2px 4px;border-radius:4px;font-weight:700;font-size:10px;margin-right:6px;">MANUAL</span>');
      }
      return html;
    }
    function stripPrefixes(s) {
      if (!s) return "";
      return String(s).replace(/^\((M|AI|AI-P)\)\s*/i, '').trim().toLowerCase();
    }

    // ── Custom Column Management ──
    let activeColType = "don";
    let editingColName = null;

    function setCCSize(w) {
      document.getElementById("cc-width").value = w;
      document.querySelectorAll(".cc-size-chip").forEach(b => b.classList.remove("active"));
      if (w <= 100) document.getElementById("cc-size-s").classList.add("active");
      else if (w <= 200) document.getElementById("cc-size-m").classList.add("active");
      else document.getElementById("cc-size-l").classList.add("active");
    }

    // Legacy alias so openEditCol still works
    function setCCWidth(w) {
      // Map old pixel values to nearest chip
      const v = parseInt(w);
      if (v <= 100) setCCSize(80);
      else if (v <= 200) setCCSize(160);
      else setCCSize(260);
    }

    function renderHiddenColumns(type) {
      const key = type === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existing = eventData[key] || [];
      const hidden = existing.filter(c => c.hidden === true);
      
      const list = document.getElementById("hidden-cols-list");
      list.innerHTML = "";
      
      toggleHiddenCols(true);
      
      const btns = document.querySelectorAll(".toggle-hidden-cols-btn");
      if (hidden.length === 0) {
        btns.forEach(btn => btn.style.display = "none");
        return;
      }
      
      btns.forEach(btn => btn.style.display = "flex");
      hidden.forEach(c => {
        let name = typeof c === "string" ? c : c.n;
        let isSys = name.startsWith("_sys_");
        let dispName = name;
        if (isSys) {
          if (name.endsWith("date")) dispName = "Date";
          if (name.endsWith("colby")) dispName = type === "don" ? "Collected By" : "Added By";
        }
        
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "8px 12px";
        row.style.background = "var(--input-bg)";
        row.style.borderRadius = "8px";
        row.style.border = "1px solid var(--input-border)";
        
        row.innerHTML = `
          <div style="font-size:13px; font-weight:700; color:var(--text);">${escHtml(dispName)}</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button class="btn btn-solid-primary" style="padding: 0 12px; font-size: 11.5px; border-radius: 30px; height: 28px; white-space: nowrap; width: fit-content !important; flex: 0 0 auto; margin: 0;" onclick="restoreHiddenColumn('${name}')">Restore</button>
            ${isSys ? '' : `<button class="btn btn-solid-danger" style="padding: 0 12px; font-size: 11.5px; border-radius: 30px; height: 28px; white-space: nowrap; width: fit-content !important; flex: 0 0 auto; margin: 0;" onclick="deleteHiddenColumnPermanently('${name}')">Delete</button>`}
          </div>
        `;
        list.appendChild(row);
      });
    }

    function toggleHiddenCols(forceForm = false) {
      const formView = document.getElementById("cc-form-view");
      const hiddenView = document.getElementById("cc-hidden-view");
      const footer = document.getElementById("cc-footer");
      const subTitle = document.getElementById("cc-sheet-sub");
      const title = document.getElementById("cc-sheet-title");
      
      if (forceForm || formView.style.display === "none") {
        formView.style.display = "block";
        hiddenView.style.display = "none";
        footer.style.display = "block";
        title.textContent = editingColName ? "Update Column" : "Add Custom Column";
        subTitle.textContent = editingColName ? "Any changes made will reflect on the table for all participants." : "This column will be added to the end of the table for everyone.";
      } else {
        formView.style.display = "none";
        hiddenView.style.display = "block";
        footer.style.display = "none"; // Hide footer on hidden columns page
        title.textContent = "Hidden Columns";
        subTitle.textContent = "Restoring a column will make it visible to everyone again.";
      }
    }

    async function restoreHiddenColumn(name) {
      const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existing = eventData[key] || [];
      
      const updated = existing.map(c => {
        const n = typeof c === "string" ? c : c.n;
        if (n === name) {
          delete c.hidden;
        }
        return c;
      });

      try {
        const data = {}; data[key] = updated;
        const res = await updateEvent(eventId, data);
        eventData[key] = res[key];
        clearEventCache();
        window.schemaChanged = true;
        preserveInlineState();
        if (activeTheaterTab) {
          switchTheaterTab(activeTheaterTab, true);
        } else {
          if (activeColType === "don") renderDonations(); else renderExpenses();
        }
        renderHiddenColumns(activeColType);
        showToast("Column restored!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }

    async function deleteHiddenColumnPermanently(name) {
      showConfirmModal(
        "Delete Column Completely?",
        `Are you sure you want to completely delete '${escHtml(name)}'? <br><br><span style="color:var(--red);">Warning: This will permanently delete this column and all its values from the database for all entries. This cannot be undone.</span>`,
        "Delete",
        "var(--red)",
        async () => {
          const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
          const existing = eventData[key] || [];
          const updated = existing.filter(c => {
            const n = typeof c === "string" ? c : c.n;
            return n !== name;
          });

          try {
            const data = {}; data[key] = updated;
            const res = await updateEvent(eventId, data);
            eventData[key] = res[key];
            clearEventCache();
            window.schemaChanged = true;
            preserveInlineState();
            if (activeTheaterTab) {
              switchTheaterTab(activeTheaterTab, true);
            } else {
              if (activeColType === "don") renderDonations(); else renderExpenses();
            }
            renderHiddenColumns(activeColType);
            showToast("Column deleted completely.");
          } catch (e) { showToast(e.message || "Failed to delete.", "error"); }
        },
        "trash",
        "var(--red)"
      );
    }

    function updateCharCount(el) {
      const count = document.getElementById("cc-char-count");
      if (count) count.textContent = `${el.value.length}/25`;
    }

    function openAddCol(type) {
      activeColType = type;
      editingColName = null;
      document.getElementById("cc-sheet-title").textContent = "Add Custom Column";
      document.getElementById("cc-sheet-sub").textContent = "This column will be added to the end of the table for everyone.";
      const inp = document.getElementById("cc-name");
      inp.value = "";
      inp.removeAttribute("readonly");
      updateCharCount(inp);
      setCCSize(160); // default Medium
      document.getElementById("cc-add-btns").style.display = "flex";
      document.getElementById("cc-edit-btns").style.display = "none";
      document.getElementById("cc-error").style.display = "none";
      renderHiddenColumns(type);
      document.getElementById("custom-col-sheet").style.display = "flex";
      setTimeout(() => inp.focus(), 100);
    }

    function openEditCol(name, type) {
      activeColType = type;
      editingColName = name;
      document.getElementById("cc-sheet-title").textContent = "Update Column";
      document.getElementById("cc-sheet-sub").textContent = "Any changes made will reflect on the table for all participants.";
      const inp = document.getElementById("cc-name");
      inp.value = name;
      inp.setAttribute("readonly", "true");
      updateCharCount(inp);

      // Find current width
      const key = type === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const colObj = (eventData[key] || []).find(c => (typeof c === 'string' ? c : c.n) === name);
      const w = (colObj && typeof colObj === 'object') ? (colObj.w || 180) : 180;
      setCCWidth(w);

      document.getElementById("cc-add-btns").style.display = "none";
      document.getElementById("cc-edit-btns").style.display = "flex";
      document.getElementById("cc-error").style.display = "none";
      renderHiddenColumns(type);
      document.getElementById("custom-col-sheet").style.display = "flex";
    }


    function getColWidth(key, defaultWidth) {
      return localStorage.getItem('np_col_' + key) || defaultWidth;
    }
    function openDefaultColW(title, key, flex = false) {
      document.getElementById("def-col-title").textContent = title;
      document.getElementById("def-col-key").value = key;
      const curr = getColWidth(key, flex ? 'flex' : 130);
      setDefSize(curr === 'flex' ? 130 : parseInt(curr) || 130);
      
      const hideBtn = document.getElementById("def-col-hide-btn");
      if (key === 'don_date' || key === 'don_colby' || key === 'exp_date' || key === 'exp_colby') {
        hideBtn.style.display = 'block';
      } else {
        hideBtn.style.display = 'none'; // Cannot hide Name/Amount
      }

      document.getElementById("def-col-sheet").style.display = "flex";
    }
    function closeDefColSheet() { document.getElementById("def-col-sheet").style.display = "none"; }
    function setDefSize(w) {
      document.getElementById("def-col-width").value = w;
      ["s", "m", "l"].forEach(s => document.getElementById("def-size-" + s).classList.remove("active"));
      if (w <= 90) document.getElementById("def-size-s").classList.add("active");
      else if (w >= 180) document.getElementById("def-size-l").classList.add("active");
      else document.getElementById("def-size-m").classList.add("active");
    }
    function saveDefColWidth() {
      const key = document.getElementById("def-col-key").value;
      const w = document.getElementById("def-col-width").value;
      localStorage.setItem('np_col_' + key, w);
      closeDefColSheet();
      renderDonations();
      renderExpenses();
      if (activeTheaterTab) switchTheaterTab(activeTheaterTab, true);
    }

    async function hideDefCol() {
      const key = document.getElementById("def-col-key").value;
      const colArrKey = key.startsWith("don_") ? "donation_custom_columns" : "expense_custom_columns";
      const sysKey = "_sys_" + key;
      
      try {
        const existing = eventData[colArrKey] || [];
        // Remove any existing definition for this sys key
        const updated = existing.filter(c => (typeof c === "string" ? c : c.n) !== sysKey);
        // Push the hidden state
        updated.push({ n: sysKey, hidden: true });
        
        const data = {}; data[colArrKey] = updated;
        const res = await updateEvent(eventId, data);
        eventData[colArrKey] = res[colArrKey];
        clearEventCache();
        window.schemaChanged = true;
        preserveInlineState();
        closeDefColSheet();
        
        if (activeTheaterTab) {
          switchTheaterTab(activeTheaterTab, true);
        } else {
          renderDonations(); 
          renderExpenses();
        }
        showToast("Column hidden.");
      } catch (e) {
        showToast(e.message || "Failed to hide column.", "error");
      }
    }

    function closeCustomColSheet() {
      document.getElementById("custom-col-sheet").style.display = "none";
    }

    async function saveCustomColumn() {
      const newName = document.getElementById("cc-name").value.trim();
      const width = parseInt(document.getElementById("cc-width").value) || 180;
      const errorEl = document.getElementById("cc-error");
      if (!newName) {
        errorEl.textContent = "Column name is required.";
        errorEl.style.display = "block";
        document.getElementById("cc-name").focus();
        return;
      }

      const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existingRecords = eventData[key] || [];
      const existingNames = existingRecords.map(c => (typeof c === 'string' ? c : c.n).toLowerCase());

      if (existingNames.includes(newName.toLowerCase())) {
        errorEl.textContent = `A column named "${newName}" already exists in this table.`;
        errorEl.style.display = "block";
        document.getElementById("cc-name").focus();
        return;
      }

      const updated = [...existingRecords, { n: newName, w: width }];
      try {
        const data = {}; data[key] = updated;
        const res = await updateEvent(eventId, data);
        eventData[key] = res[key];
        clearEventCache();
        window.schemaChanged = true;
        preserveInlineState();
        if (activeTheaterTab) {
          switchTheaterTab(activeTheaterTab, true);
        } else {
          if (activeColType === "don") renderDonations(); else renderExpenses();
        }
        closeCustomColSheet();
        showToast("Column added!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }
    async function renameCustomColumn() {
      const newName = document.getElementById("cc-name").value.trim();
      const width = parseInt(document.getElementById("cc-width").value) || 180;
      const errorEl = document.getElementById("cc-error");
      if (!newName) {
        errorEl.textContent = "Column name is required.";
        errorEl.style.display = "block";
        document.getElementById("cc-name").focus();
        return;
      }
      if (!editingColName) return;

      const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existing = eventData[key] || [];

      if (existing.some(c => {
        const n = typeof c === "string" ? c : c.n;
        return n !== editingColName && n.toLowerCase() === newName.toLowerCase();
      })) {
        errorEl.textContent = "This column name is already in use.";
        errorEl.style.display = "block";
        return;
      }

      const updated = existing.map(c => {
        const n = typeof c === "string" ? c : c.n;
        if (n === editingColName) return { n: newName, w: width };
        return c;
      });

      try {
        const data = {}; data[key] = updated;
        // Send rename mapping so backend migrates existing data keys
        if (editingColName !== newName) {
          data.column_renames = {};
          data.column_renames[editingColName] = newName;
        }
        const res = await updateEvent(eventId, data);
        eventData[key] = res[key];
        clearEventCache();
        window.schemaChanged = true;
        preserveInlineState();
        if (activeTheaterTab) {
          switchTheaterTab(activeTheaterTab, true);
        } else {
          if (activeColType === "don") renderDonations(); else renderExpenses();
        }
        closeCustomColSheet();
        showToast("Column renamed!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }

    async function deleteCustomColumn() {
      openDelColPop();
    }

    function fillTableRows(container, type) {
      captureInlineState(container, type);
      container.innerHTML = "";
      if (!eventData) return; // Safety check
      const isTheater = container.parentElement ? container.parentElement.classList.contains("is-theater-table") : true;
      const role = isOrganizer ? "organizer" : (isVisitor ? "visitor" : "collector");
      const storageKey = `np_pinned_${eventId}_${type}`;
      const pList = JSON.parse(localStorage.getItem(storageKey) || "[]").map(id => String(id));
      const rawList = type === "don" ? donations : expenses;
      const q = (window.theaterSearchQuery || "");
      const filtered = q ? rawList.filter(x => searchMatch(x, q)) : rawList;

      let pinned = [];
      let unpinned = [];
      const sortedBase = applySortAndFilter(filtered, type);
      sortedBase.forEach(item => {
        const id = String(item.id || item._id);
        const idx = pList.indexOf(id);
        if (idx !== -1) pinned.push({ item, idx });
        else unpinned.push(item);
      });
      pinned.sort((a, b) => a.idx - b.idx);
      const list = [...pinned.map(p => p.item), ...unpinned];
      const customCols = type === "don" ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);
      const hideDate = customCols.some(c => (typeof c === 'string' ? c : c.n) === (type === 'don' ? '_sys_don_date' : '_sys_exp_date') && c.hidden);
      const hideColBy = customCols.some(c => (typeof c === 'string' ? c : c.n) === (type === 'don' ? '_sys_don_colby' : '_sys_exp_colby') && c.hidden);
      const visibleCustomCols = customCols.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });

      list.forEach((entry, i) => {
        const tr = document.createElement("div");
        tr.className = "tr" + (i % 2 !== 0 ? " alt" : "");
        tr.setAttribute('data-id', entry.id || entry._id);
        tr.onclick = (e) => openCtx(e, type, entry);

        const isPinned = pList.includes(String(entry.id || entry._id));
        const customCells = visibleCustomCols.map(c => {
          const n = typeof c === "string" ? c : c.n;
          const w = (typeof c === "string" ? 180 : c.w);
          const cf = getCustomFieldsObj(entry);
          const val = cf[n] || "-";
          return `<div class="sc" data-col="${escHtml(n)}" style="width:${w}px;">${escHtml(val)}</div>`;
        }).join("");

        let receiptHtml = entry.receipt_key ? `<button type="button" style="margin-left:auto; background:none; border:none; color:var(--primary); cursor:pointer; padding:6px; margin-right:-6px; display:inline-flex; align-items:center; justify-content:center; position:relative; z-index:10;" onclick="event.stopPropagation(); openReceiptModal('${entry.id || entry._id}', event, '${type}');" title="View Payment Proof">${npIcon("file-text", {size: 16, tone: "primary"})}</button>` : '';
        let versionHtml = (entry.version && entry.version > 1) ? `<span style="font-size:10px; color:var(--text3); margin-left:4px;">v${entry.version}</span>` : '';

        let rowHTML = `
          <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(type === "don" ? 'don_name' : 'exp_desc', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              ${isPinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
            </div>
            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${formatPrefixes(entry.donor_name || entry.description)}${versionHtml}</div>
          </div>
          <div class="sc" style="width:${getColWidth(type === "don" ? 'don_amt' : 'exp_amt', 90)}px; display:flex; align-items:center;">
            <span style="font-weight:800; color:${type === "don" ? "var(--green)" : "var(--red)"};">₹${(entry.amount || 0).toLocaleString()}</span>${receiptHtml}
          </div>`;
          
        if (!hideDate) {
          rowHTML += `<div class="sc" style="width:${getColWidth(type === "don" ? 'don_date' : 'exp_date', 100)}px;">${formatDate(entry.collected_at)}</div>`;
        }
        if (!hideColBy) {
          rowHTML += `<div class="sc" style="width:${getColWidth(type === "don" ? 'don_colby' : 'exp_colby', 130)}px;">${escHtml(entry.collected_by_name || "-")}</div>`;
        }
        if (type === "don") {
          const rcvd = entry.payment_received !== false;
          rowHTML += `<div class="sc" style="width:80px;"><span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; background:${rcvd ? 'rgba(72,187,120,0.15)' : 'rgba(245,158,11,0.15)'}; color:${rcvd ? 'var(--green)' : 'var(--amber)'}; border:1px solid ${rcvd ? 'rgba(72,187,120,0.3)' : 'rgba(245,158,11,0.3)'}; white-space:nowrap;">${rcvd ? '✓ Yes' : '⏳ No'}</span></div>`;
        }
        rowHTML += `${customCells}`;
        tr.innerHTML = rowHTML;
        container.appendChild(tr);
      });

      if (!isVisitor && (role === "organizer" || role === "collector")) {
        const nr = document.createElement("div");
        nr.className = "tr new-row";
        nr.onclick = () => openEntryForm(type);
        nr.style.cssText = "background:var(--row-new); border:none; width:max-content; min-width:100%; min-height:48px; cursor:pointer; display:flex; align-items:center;";
        nr.innerHTML = `<span style="position:sticky; left:16px; white-space:nowrap; z-index:10; font-weight:800; color:var(--teal); display:flex; align-items:center;"><span style="margin-right:12px; font-size:20px; font-weight:900;">+</span> New entry</span>`;
        container.appendChild(nr);
      }

      restoreInlineState(container);
      
    }


    function renderTable(type, isTheater = false) {
      const container = document.createElement("div");
      container.className = "tbl-inner" + (isTheater ? " is-theater-table" : "");
      const customCols = type === "don" ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);

      const hdrRow = document.createElement("div");
      hdrRow.className = "hdr-row";
      hdrRow.style.background = "var(--primary-dk)";
      if (isTheater) {
        hdrRow.style.position = "sticky";
        hdrRow.style.top = "0";
        hdrRow.style.zIndex = "2500";
      }

      const hideDate = customCols.some(c => (typeof c === 'string' ? c : c.n) === (type === 'don' ? '_sys_don_date' : '_sys_exp_date') && c.hidden);
      const hideColBy = customCols.some(c => (typeof c === 'string' ? c : c.n) === (type === 'don' ? '_sys_don_colby' : '_sys_exp_colby') && c.hidden);
      const visibleCustomCols = customCols.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });

      let hdrHTML = '';
      if (type === "don") {
        hdrHTML = `<div class="th sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('don_name', 140)}px;"><div style="width:14px; margin-right:4px; flex-shrink:0;"></div><div class="${isOrganizer ? 'sth-custom' : ''}" style="flex:1; text-align:left;" ${isOrganizer ? "onclick=\"openDefaultColW('Name', 'don_name')\"" : ''}>NAME</div></div>
                     <div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_amt', 90)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Amount', 'don_amt')\"" : ''}>AMOUNT</div>`;
        if (!hideDate) hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_date', 100)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Date', 'don_date')\"" : ''}>DATE</div>`;
        if (!hideColBy) hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_colby', 130)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Collected By', 'don_colby')\"" : ''}>COLLECTED BY</div>`;
        hdrHTML += `<div class="th" style="width:80px;">RECEIVED</div>`;
      } else {
        hdrHTML = `<div class="th sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('exp_desc', 140)}px;"><div style="width:14px; margin-right:4px; flex-shrink:0;"></div><div class="${isOrganizer ? 'sth-custom' : ''}" style="flex:1; text-align:left;" ${isOrganizer ? "onclick=\"openDefaultColW('Description', 'exp_desc')\"" : ''}>DESCRIPTION</div></div>
                     <div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_amt', 90)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Amount', 'exp_amt')\"" : ''}>AMOUNT</div>`;
        if (!hideDate) hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_date', 100)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Date', 'exp_date')\"" : ''}>DATE</div>`;
        if (!hideColBy) hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_colby', 130)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Added By', 'exp_colby')\"" : ''}>ADDED BY</div>`;
      }
      hdrRow.innerHTML = hdrHTML;

      visibleCustomCols.forEach((c) => {
        const th = document.createElement("div");
        th.className = "th" + (isOrganizer && !isVisitor ? " sth-custom" : "");
        const colName = typeof c === "string" ? c : c.n;
        if (isOrganizer && !isVisitor) {
          th.onclick = (e) => { e.stopPropagation(); openEditCol(colName, type); };
        }
        th.textContent = colName.toUpperCase();
        th.style.width = (typeof c === "string" ? 180 : c.w) + "px";
        hdrRow.appendChild(th);
      });
      container.appendChild(hdrRow);

      const rowsCont = document.createElement("div");
      rowsCont.className = "tbl-body-rows";
      fillTableRows(rowsCont, type);
      container.appendChild(rowsCont);

      if (typeof initIcons === 'function') initIcons();
      return container;
    }

    /** Open theater fullscreen (portrait only — use device rotation for landscape). */
    function cycleRotation(requestedTab) {
      const tab = requestedTab || activeTheaterTab;
      if (!tab) return;
      theaterRotation = 0;
      tabRotations[tab] = 0;
      document.body.classList.remove("is-rotated-90", "is-rotated-180", "is-rotated-270");
      if (!activeTheaterTab) {
        enterTheater(tab);
      }
    }

    function updateTheaterStats() {
      if (!activeTheaterTab) return;
      const tab = activeTheaterTab;
      const list = tab === "don" ? donations : expenses;
      const count = list.length;
      let total = 0;
      let infoHtml = "";
      const colorClass = tab === "don" ? "sum-g" : (tab === "exp" ? "sum-r" : "");
      const unit = tab === "don" ? "names" : (tab === "exp" ? "expenses" : "overview");

      if (tab === "don") {
        total = list.reduce((sum, item) => sum + (item.payment_received === false ? 0 : (parseFloat(item.amount) || 0)), 0);
        infoHtml = `<b>${count}</b> ${unit} | Total: <b class="${colorClass}">₹${total.toLocaleString()}</b>`;
      } else {
        total = list.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
        infoHtml = `<b>${count}</b> ${unit} | Total: <b class="${colorClass}">₹${total.toLocaleString()}</b>`;
      }

      document.getElementById("rot-stat-name").textContent = eventData ? eventData.name : "Notepay";
      if (tab === "sum") {
        document.getElementById("rot-stat-info").innerHTML = `<b>Financial Dashboard</b>`;
      } else {
        document.getElementById("rot-stat-info").innerHTML = infoHtml;
      }

      const roleEl = document.getElementById("rot-stat-role");
      roleEl.textContent = isOrganizer ? "Organizer" : (isVisitor ? "Visitor" : "Collector");
      roleEl.className = "rot-role " + (isOrganizer ? "org" : (isVisitor ? "vis" : "col"));

      document.getElementById("rot-tab-don").classList.toggle("active", tab === "don");
      document.getElementById("rot-tab-exp").classList.toggle("active", tab === "exp");
      document.getElementById("rot-tab-sum").classList.toggle("active", tab === "sum");
    }

    function applyTheaterLayout(main, body) {
      main.style.position = 'relative';
      main.style.left = '0';
      main.style.top = '0';
      main.style.width = '100%';
      main.style.height = '100%';
      main.style.transform = 'none';
      body.style.flex = '1';
      body.style.minHeight = '0';
      body.style.height = '';
      body.style.width = '100%';
    }

    function handleOrientationOrResizeChange() {
      // Simplified as unified inline editor handles transitions naturally within scroll layouts
    }

    function refreshTheaterLayout() {
      if (!activeTheaterTab) return;
      const main = document.getElementById('rot-main');
      const body = document.getElementById('rot-ov-body');
      if (main && body) {
        applyTheaterLayout(main, body);
        const compact = window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
        main.classList.toggle('theater-landscape', compact);
      }
      handleOrientationOrResizeChange();
    }

    function switchTheaterTab(tab, force = false) {
      if (!force) {
        activeInlineAddType = null;
        activeInlineEditType = null;
        activeInlineEditId = null;
      }
      if (!force && (!activeTheaterTab || activeTheaterTab === tab)) return;
      // Block switching to a hidden tab
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;
      if (tab === 'don' && !showDon) return;
      if (tab === 'exp' && !showExp) return;
      enterTheater(tab, force);
    }

    function enterTheater(tab, force = false) {
      if (!force) {
        activeInlineAddType = null;
        activeInlineEditType = null;
        activeInlineEditId = null;
      }
      activeTheaterTab = tab;
      // Hide chat FAB in theater mode
      const chatFab = document.getElementById('chat-fab');
      if (chatFab) chatFab.style.display = 'none';
      const up = new URLSearchParams(window.location.search);
      up.set("theater", tab);
      history.replaceState(null, "", "?" + up.toString());

      const overlay = document.getElementById("rot-overlay");
      const main = document.getElementById("rot-main");
      const body = document.getElementById("rot-ov-body");

      // Summary tab needs body-level scrolling; Tables have their own scroll areas.
      body.style.overflowY = (tab === "sum") ? "auto" : "hidden";

      // Remove any previous touch handlers
      if (body._scrollHandler) {
        body.removeEventListener('touchmove', body._scrollHandler);
        body._scrollHandler = null;
      }
      if (body._touchStartHandler) {
        body.removeEventListener('touchstart', body._touchStartHandler);
        body._touchStartHandler = null;
      }
      if (body._touchEndHandler) {
        body.removeEventListener('touchend', body._touchEndHandler);
        body._touchEndHandler = null;
      }

      overlay.style.display = "flex";
      body.innerHTML = ""; // Clear existing

      // Update theater tab button visibility
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;
      const rotTabDon = document.getElementById("rot-tab-don");
      const rotTabExp = document.getElementById("rot-tab-exp");
      if (rotTabDon) rotTabDon.style.display = showDon ? "" : "none";
      if (rotTabExp) rotTabExp.style.display = showExp ? "" : "none";

      theaterRotation = 0;
      let content;

      const searchWrap = document.getElementById("theater-search-wrap");
      if (searchWrap) {
        searchWrap.style.display = (tab === 'sum') ? 'none' : 'flex';
      }

      if (tab === "sum") {
        body.classList.add("sum-mode");
        const sumDiv = document.createElement("div");
        sumDiv.id = "sum-body-theater";
        sumDiv.style.cssText = "width:100%; min-height:100%; background:var(--surface);";
        body.appendChild(sumDiv);
        renderSummary(0, "sum-body-theater");
        content = sumDiv;
      } else {
        // Outer Wrapper for rounded corners and layout
        const theaterWrapper = document.createElement("div");
        theaterWrapper.style.cssText = "height:100%; width:100%; display:flex; flex-direction:column; border-radius:12px; overflow:hidden; border:1.5px solid var(--border2); background:var(--card); box-shadow:var(--shadow-lg);";

        // Scrollable table — native overflow (especially for mobile landscape layout)
        const tableContainer = document.createElement("div");
        tableContainer.className = "tbl-sc theater-scroll-area";
        tableContainer.style.cssText = 'flex:1; min-height:0; width:100%; overflow:auto; -webkit-overflow-scrolling:touch; margin:0; padding:0; touch-action:pan-x pan-y; overscroll-behavior:contain; position:relative;';

        const loaderDiv = document.createElement("div");
        loaderDiv.style.cssText = "position:absolute; inset:0; display:flex; align-items:center; justify-content:center;";
        loaderDiv.innerHTML = '<div class="spinner" style="display:block; border-top-color:var(--primary); width:32px; height:32px; border-width:4px;"></div>';
        tableContainer.appendChild(loaderDiv);

        setTimeout(() => {
          const table = renderTable(tab, true);
          loaderDiv.remove();
          tableContainer.appendChild(table);
          if (typeof initIcons === 'function') initIcons();
        }, 15);

        // Link the top bar search input to this table container
        const topSearch = document.getElementById("theater-top-search");
        
        if (topSearch) {
          topSearch.setAttribute("readonly", "true");
          topSearch.value = window.theaterSearchQuery || '';
          topSearch.oninput = (e) => {
            window.theaterSearchQuery = e.target.value;
            const oldTbl = tableContainer.querySelector(".tbl-inner");
            if (oldTbl) oldTbl.remove();
            tableContainer.appendChild(renderTable(tab, true));
            if (typeof initIcons === 'function') initIcons();
          };
        }

        theaterWrapper.appendChild(tableContainer);
        body.appendChild(theaterWrapper);
        content = theaterWrapper;
        body._touchEl = null;
      }
      main.classList.remove("rot-90", "rot-180", "rot-270");
      main.classList.add("rot-0", "is-theater");

      applyTheaterLayout(main, body);
      refreshTheaterLayout();

      updateTheaterStats();

      // Restore Add Column button
      const addBtn = document.getElementById("rot-add-col");
      if (isOrganizer && tab !== 'sum') {
        addBtn.style.display = "flex";
        addBtn.onclick = (e) => { e.stopPropagation(); openAddCol(tab); };
      } else {
        addBtn.style.display = "none";
      }

      const popups = ["entry-form-ov", "edit-form-ov", "duplicate-pop", "custom-col-sheet", "code-sheet", "members-sheet", "del-pop", "def-col-sheet"];
      popups.forEach(id => {
        const p = document.getElementById(id);
        if (p) overlay.appendChild(p);
      });

      // Request fullscreen to hide browser URL bar for maximum table visibility
      const fsEl = document.documentElement;
      try {
        if (fsEl.requestFullscreen) fsEl.requestFullscreen({ navigationUI: 'hide' });
        else if (fsEl.webkitRequestFullscreen) fsEl.webkitRequestFullscreen();
      } catch (e) { /* Fullscreen not supported or denied — silent fail */ }
    }

    window.addEventListener("resize", refreshTheaterLayout);
    window.addEventListener("orientationchange", () => {
      setTimeout(refreshTheaterLayout, 150);
    });
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener("change", () => {
        setTimeout(refreshTheaterLayout, 150);
      });
    }

    // If user exits fullscreen via hardware back button, also exit theater mode
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && activeTheaterTab) exitTheater();
    });
    document.addEventListener("webkitfullscreenchange", () => {
      if (!document.webkitFullscreenElement && activeTheaterTab) exitTheater();
    });

    function exitTheater() {
      activeInlineAddType = null;
      activeInlineEditType = null;
      activeInlineEditId = null;
      // Clear theater search state on exit
      window.theaterSearchQuery = "";
      if (document.getElementById("theater-top-search")) document.getElementById("theater-top-search").value = "";
      if (!activeTheaterTab) return;
      activeTheaterTab = null;
      const upEx = new URLSearchParams(window.location.search);
      upEx.delete("theater");
      history.replaceState(null, "", "?" + upEx.toString());

      // Exit fullscreen if active
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      } catch (e) { /* silent fail */ }

      const overlay = document.getElementById("rot-overlay");
      const main = document.getElementById("rot-main");
      const body = document.getElementById("rot-ov-body");

      // Reset rotation and body
      theaterRotation = 0;
      ["don", "exp", "sum"].forEach(t => tabRotations[t] = 0);
      document.body.classList.remove("is-rotated-90", "is-rotated-180", "is-rotated-270");

      main.classList.remove("is-theater", "rot-0", "rot-90", "rot-180", "rot-270");
      main.style.width = ""; main.style.height = ""; main.style.transform = "";

      // Move popups back
      const popups = ["entry-form-ov", "edit-form-ov", "duplicate-pop", "custom-col-sheet", "code-sheet", "members-sheet", "del-pop", "def-col-sheet"];
      popups.forEach(id => {
        const p = document.getElementById(id);
        if (p) document.getElementById("main-page").appendChild(p);
      });

      // Clean up touch handlers to prevent memory leaks
      // Listeners are now on theaterWrapper, not body — retrieve via stored ref
      const touchEl = body._touchEl || body;
      if (touchEl._scrollHandler) {
        touchEl.removeEventListener('touchmove', touchEl._scrollHandler);
        touchEl._scrollHandler = null;
      }
      if (touchEl._touchStartHandler) {
        touchEl.removeEventListener('touchstart', touchEl._touchStartHandler);
        touchEl._touchStartHandler = null;
      }
      if (touchEl._touchEndHandler) {
        touchEl.removeEventListener('touchend', touchEl._touchEndHandler);
        touchEl._touchEndHandler = null;
      }
      body._touchEl = null;

      body.innerHTML = "";
      overlay.style.display = "none";
      activeTheaterTab = null;

      // Re-render main page completely to restore entries
      renderPage();
      // Restore chat FAB after leaving theater
      updateChatFabVisibility();
    }

    async function exportPDF() {
      const { jsPDF } = window.jspdf;
      
      const donColsCount = (eventData.donation_custom_columns || []).length;
      const expColsCount = (eventData.expense_custom_columns || []).length;
      const maxCols = Math.max(donColsCount, expColsCount) + 4;
      const orientation = 'l'; // Always use Landscape for maximum width
      
      // Dynamic scaling for many columns to prevent bleeding
      const dynFontSize = maxCols > 12 ? 5 : (maxCols > 8 ? 6 : 7.5);
      const dynCellPad = maxCols > 12 ? 1 : (maxCols > 8 ? 1.5 : 2.5);

      const doc = new jsPDF(orientation, 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;

      const formatPDF_Amt = (amt) => {
        if (amt === null || amt === undefined || amt === "") return "0";
        return Number(amt).toLocaleString("en-IN", { minimumFractionDigits: 0 });
      };

      // --- COLORS & STYLES ---
      const PRIMARY_DK = [30, 41, 59]; // Slate 800
      const TEXT_MAIN = [51, 65, 85];  // Slate 600
      const GREEN = [21, 128, 61];    // Green 700
      const RED = [185, 28, 28];      // Red 700
      const BORDER = [226, 232, 240];  // Slate 200

      // --- HEADER ---
      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
      doc.text("Statement of Accounts", 15, 20);

      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.setFont("helvetica", "normal");
      doc.text("NotePay Financial Ledger", 15, 26);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
      doc.text("Notepay", pageWidth - 15, 20, { align: "right" });

      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.setLineWidth(0.5);
      doc.line(15, 32, pageWidth - 15, 32);

      // --- EVENT METADATA ---
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.setFont("helvetica", "bold");
      doc.text(eventData.name.toUpperCase(), 15, 45);

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(TEXT_MAIN[0], TEXT_MAIN[1], TEXT_MAIN[2]);
      doc.text(`DATE OF EVENT: ${formatDate(eventData.event_date).toUpperCase()}`, 15, 51);
      const creator = typeof members !== 'undefined' ? members.find(m => m.user_id === eventData.organizer_id) : null;
      const orgName = creator && creator.user ? creator.user.full_name : 'Creator of Event';
      doc.text(`ORGANIZER: ${(eventData.organizer_name || orgName).toUpperCase()}`, 15, 56);
      doc.text(`REPORT ISSUED: ${new Date().toLocaleString().toUpperCase()}`, pageWidth - 15, 51, { align: "right" });

      // --- FINANCIAL SUMMARY BOX ---
      const totalDon = donations.reduce((s, d) => s + (d.payment_received === false ? 0 : (d.amount || 0)), 0);
      const totalToCollect = donations.reduce((s, d) => s + (d.payment_received === false ? (d.amount || 0) : 0), 0);
      const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      const balance = totalDon - totalExp;

      doc.setFillColor(248, 250, 252); // Slate 50
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.roundedRect(15, 65, pageWidth - 30, 30, 2, 2, "FD");

      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.setFont("helvetica", "bold");
      doc.text("TOTAL CREDITS (RS.)", 25, 75);
      doc.text("TOTAL DEBITS (RS.)", pageWidth / 2, 75, { align: "center" });
      doc.text("NET SETTLEMENT (RS.)", pageWidth - 25, 75, { align: "right" });

      doc.setFontSize(14);
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.text(formatPDF_Amt(totalDon), 25, 85);
      if (totalToCollect > 0) {
        doc.setFontSize(8);
        doc.setTextColor(217, 119, 6);
        doc.text(`+${formatPDF_Amt(totalToCollect)} TO COLLECT`, 25, 90);
      }

      doc.setFontSize(14);
      doc.setTextColor(RED[0], RED[1], RED[2]);
      doc.text(formatPDF_Amt(totalExp), pageWidth / 2, 85, { align: "center" });

      const balColor = balance >= 0 ? GREEN : RED;
      doc.setTextColor(balColor[0], balColor[1], balColor[2]);
      doc.text(formatPDF_Amt(balance), pageWidth - 25, 85, { align: "right" });

      let currentY = 105;

      // --- DONATIONS TABLE (CREDITS) ---
      const donColsRaw = eventData.donation_custom_columns || [];
      const hideDonDate = donColsRaw.some(c => (typeof c === 'string' ? c : c.n) === '_sys_don_date' && c.hidden);
      const hideDonColBy = donColsRaw.some(c => (typeof c === 'string' ? c : c.n) === '_sys_don_colby' && c.hidden);
      const visibleDonCols = donColsRaw.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });
      
      const donHead = ['NAME', 'AMOUNT (RS.)'];
      if (!hideDonDate) donHead.push('DATE');
      if (!hideDonColBy) donHead.push('COLLECTED BY');
      donHead.push('RECEIVED');
      visibleDonCols.forEach(c => donHead.push((typeof c === 'string' ? c : c.n).toUpperCase()));
      
      const donBody = donations.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).map(d => {
        const row = [d.donor_name.toUpperCase(), formatPDF_Amt(d.amount)];
        if (!hideDonDate) row.push(formatDate(d.collected_at).toUpperCase());
        if (!hideDonColBy) row.push((d.collected_by_name || '-').toUpperCase());
        row.push(d.payment_received === false ? 'NO' : 'YES');
        const cf = getCustomFieldsObj(d);
        visibleDonCols.forEach(c => row.push((cf[typeof c === 'string' ? c : c.n] || '-').toUpperCase()));
        return row;
      });

      if (donBody.length > 0) {
        doc.setFontSize(11);
        doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
        doc.setFont("helvetica", "bold");
        doc.text("CREDIT LEDGER (DONATIONS)", 15, currentY);

        doc.autoTable({
          startY: currentY + 4,
          head: [donHead],
          body: donBody,
          theme: 'grid',
          styles: { fontSize: dynFontSize, cellPadding: dynCellPad, valign: 'middle', font: 'helvetica', lineColor: BORDER, lineWidth: 0.1, overflow: 'linebreak' },
          headStyles: { fillColor: PRIMARY_DK, textColor: 255, fontStyle: 'bold', fontSize: dynFontSize + 1, halign: 'center' },
          columnStyles: {
            0: { halign: 'left', fontStyle: 'bold' },
            1: { halign: 'right', fontStyle: 'bold', textColor: GREEN },
            2: { halign: 'center' },
            3: { halign: 'center' }
          },
          didParseCell: function (data) {
            if (data.section === 'body' && data.column.index > 3) {
              data.cell.styles.halign = 'center';
            }
          },
          margin: { left: 15, right: 15 }
        });
        currentY = doc.lastAutoTable.finalY + 15;
      }

      // Always print Expenses on a new page if Donations existed
      if (donBody.length > 0 && expenses.length > 0) { 
        doc.addPage(); 
        currentY = 20; 
      } else if (currentY > 240) { 
        doc.addPage(); 
        currentY = 20; 
      }

      // --- EXPENSES TABLE (DEBITS) ---
      const expColsRaw = eventData.expense_custom_columns || [];
      const hideExpDate = expColsRaw.some(c => (typeof c === 'string' ? c : c.n) === '_sys_exp_date' && c.hidden);
      const hideExpAddBy = expColsRaw.some(c => (typeof c === 'string' ? c : c.n) === '_sys_exp_colby' && c.hidden);
      const visibleExpCols = expColsRaw.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });

      const expHead = ['DESCRIPTION', 'AMOUNT (RS.)'];
      if (!hideExpDate) expHead.push('DATE');
      if (!hideExpAddBy) expHead.push('ADDED BY');
      visibleExpCols.forEach(c => expHead.push((typeof c === 'string' ? c : c.n).toUpperCase()));

      const expBody = expenses.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).map(e => {
        const row = [e.description.toUpperCase(), formatPDF_Amt(e.amount)];
        if (!hideExpDate) row.push(formatDate(e.collected_at).toUpperCase());
        if (!hideExpAddBy) row.push((e.collected_by_name || '-').toUpperCase());
        const cf = getCustomFieldsObj(e);
        visibleExpCols.forEach(c => row.push((cf[typeof c === 'string' ? c : c.n] || '-').toUpperCase()));
        return row;
      });

      if (expBody.length > 0) {
        doc.setFontSize(11);
        doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
        doc.setFont("helvetica", "bold");
        doc.text("DEBIT LEDGER (EXPENSES)", 15, currentY);

        doc.autoTable({
          startY: currentY + 4,
          head: [expHead],
          body: expBody,
          theme: 'grid',
          styles: { fontSize: dynFontSize, cellPadding: dynCellPad, valign: 'middle', font: 'helvetica', lineColor: BORDER, lineWidth: 0.1, overflow: 'linebreak' },
          headStyles: { fillColor: PRIMARY_DK, textColor: 255, fontStyle: 'bold', fontSize: dynFontSize + 1, halign: 'center' },
          columnStyles: {
            0: { halign: 'left', fontStyle: 'bold' },
            1: { halign: 'right', fontStyle: 'bold', textColor: RED },
            2: { halign: 'center' },
            3: { halign: 'center' }
          },
          didParseCell: function (data) {
            if (data.section === 'body' && data.column.index > 3) {
              data.cell.styles.halign = 'center';
            }
          },
          margin: { left: 15, right: 15 }
        });
        currentY = doc.lastAutoTable.finalY + 15;
      }

      // --- FOOTER ---
      if (currentY > 260) { doc.addPage(); currentY = 20; }

      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.setFont("helvetica", "italic");
      doc.text("This document is an electronically generated statement of accounts from NotePay.", 15, currentY);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(120);
      doc.text("VERIFY REAL-TIME DATA:", 15, currentY + 6);

      const cleanPath = getCleanUrl('event.html');
      const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
      const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
      const link = origin + path + '?id=' + eventId;
      doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
      doc.setFont("helvetica", "normal");
      doc.text(link, 15, currentY + 11);
      doc.link(15, currentY + 7, 180, 5, { url: link });

      doc.save(`${eventData.name}_Statement.pdf`);
    }

    function goBackToDashboard() {
      const fromAll = sessionStorage.getItem('np_from_all_tab') === 'true';
      if (fromAll) {
        localStorage.setItem('np_dash_tab', 0);
        window.location.href = (typeof buildUrl === 'function') ? buildUrl('dashboard') : getCleanUrl('dashboard.html');
        return;
      }

      let targetTab = 0;
      if (isOrganizer) targetTab = 1;
      else if (!isVisitor) targetTab = 2; // collector
      else targetTab = 3; // visitor

      localStorage.setItem('np_dash_tab', targetTab);
      
      let tabSegment = null;
      if (targetTab === 1) tabSegment = 'my-events';
      else if (targetTab === 2) tabSegment = 'shared';
      else if (targetTab === 3) tabSegment = 'visited';
      
      const cleanUrl = (typeof buildUrl === 'function') ? buildUrl('dashboard', tabSegment) : '/dashboard';
      window.location.href = cleanUrl;
    }
    // ── CHAT MODULE (Delegated) ──
    function autoResizeChatInput(...args) { if (window.EventChatController && typeof window.EventChatController.autoResizeChatInput === 'function') return window.EventChatController.autoResizeChatInput(...args); }
    function updateSendBtnVisibility(...args) { if (window.EventChatController && typeof window.EventChatController.updateSendBtnVisibility === 'function') return window.EventChatController.updateSendBtnVisibility(...args); }
    function setEmojiTrayOpen(...args) { if (window.EventChatController && typeof window.EventChatController.setEmojiTrayOpen === 'function') return window.EventChatController.setEmojiTrayOpen(...args); }
    function closeEmojiTray(...args) { if (window.EventChatController && typeof window.EventChatController.closeEmojiTray === 'function') return window.EventChatController.closeEmojiTray(...args); }
    function lockPageScrollForChat(...args) { if (window.EventChatController && typeof window.EventChatController.lockPageScrollForChat === 'function') return window.EventChatController.lockPageScrollForChat(...args); }
    function applyChatVisualViewport(...args) { if (window.EventChatController && typeof window.EventChatController.applyChatVisualViewport === 'function') return window.EventChatController.applyChatVisualViewport(...args); }
    function bindChatVisualViewport(...args) { if (window.EventChatController && typeof window.EventChatController.bindChatVisualViewport === 'function') return window.EventChatController.bindChatVisualViewport(...args); }
    function openChat(...args) { if (window.EventChatController && typeof window.EventChatController.openChat === 'function') return window.EventChatController.openChat(...args); }
    function markChatAsRead(...args) { if (window.EventChatController && typeof window.EventChatController.markChatAsRead === 'function') return window.EventChatController.markChatAsRead(...args); }
    function closeChat(...args) { if (window.EventChatController && typeof window.EventChatController.closeChat === 'function') return window.EventChatController.closeChat(...args); }
    function updateChatBadge(...args) { if (window.EventChatController && typeof window.EventChatController.updateChatBadge === 'function') return window.EventChatController.updateChatBadge(...args); }
    function loadChatHistory(...args) { if (window.EventChatController && typeof window.EventChatController.loadChatHistory === 'function') return window.EventChatController.loadChatHistory(...args); }
    function chatTimeExact(...args) { if (window.EventChatController && typeof window.EventChatController.chatTimeExact === 'function') return window.EventChatController.chatTimeExact(...args); }
    function chatDateLabel(...args) { if (window.EventChatController && typeof window.EventChatController.chatDateLabel === 'function') return window.EventChatController.chatDateLabel(...args); }
    function buildMessageHTML(...args) { if (window.EventChatController && typeof window.EventChatController.buildMessageHTML === 'function') return window.EventChatController.buildMessageHTML(...args); }
    function prependOlderMessages(...args) { if (window.EventChatController && typeof window.EventChatController.prependOlderMessages === 'function') return window.EventChatController.prependOlderMessages(...args); }
    function processStatusQueue(...args) { if (window.EventChatController && typeof window.EventChatController.processStatusQueue === 'function') return window.EventChatController.processStatusQueue(...args); }
    function setupChatObserver(...args) { if (window.EventChatController && typeof window.EventChatController.setupChatObserver === 'function') return window.EventChatController.setupChatObserver(...args); }
    function observeNewMessages(...args) { if (window.EventChatController && typeof window.EventChatController.observeNewMessages === 'function') return window.EventChatController.observeNewMessages(...args); }
    function renderChatMessages(...args) { if (window.EventChatController && typeof window.EventChatController.renderChatMessages === 'function') return window.EventChatController.renderChatMessages(...args); }
    function appendChatMessage(...args) { if (window.EventChatController && typeof window.EventChatController.appendChatMessage === 'function') return window.EventChatController.appendChatMessage(...args); }
    function updateMessageNode(...args) { if (window.EventChatController && typeof window.EventChatController.updateMessageNode === 'function') return window.EventChatController.updateMessageNode(...args); }
    function scrollChatToBottom(...args) { if (window.EventChatController && typeof window.EventChatController.scrollChatToBottom === 'function') return window.EventChatController.scrollChatToBottom(...args); }
    function startReply(...args) { if (window.EventChatController && typeof window.EventChatController.startReply === 'function') return window.EventChatController.startReply(...args); }
    function cancelReply(...args) { if (window.EventChatController && typeof window.EventChatController.cancelReply === 'function') return window.EventChatController.cancelReply(...args); }
    function applyChatReactionFromServer(...args) { if (window.EventChatController && typeof window.EventChatController.applyChatReactionFromServer === 'function') return window.EventChatController.applyChatReactionFromServer(...args); }
    function sendReactionInline(...args) { if (window.EventChatController && typeof window.EventChatController.sendReactionInline === 'function') return window.EventChatController.sendReactionInline(...args); }
    function openChatMsgCtx(...args) { if (window.EventChatController && typeof window.EventChatController.openChatMsgCtx === 'function') return window.EventChatController.openChatMsgCtx(...args); }
    function closeChatMsgCtx(...args) { if (window.EventChatController && typeof window.EventChatController.closeChatMsgCtx === 'function') return window.EventChatController.closeChatMsgCtx(...args); }
    function handleCtxReply(...args) { if (window.EventChatController && typeof window.EventChatController.handleCtxReply === 'function') return window.EventChatController.handleCtxReply(...args); }
    function handleCtxCopy(...args) { if (window.EventChatController && typeof window.EventChatController.handleCtxCopy === 'function') return window.EventChatController.handleCtxCopy(...args); }
    function handleCtxDelete(...args) { if (window.EventChatController && typeof window.EventChatController.handleCtxDelete === 'function') return window.EventChatController.handleCtxDelete(...args); }
    function sendReactionInlineCtx(...args) { if (window.EventChatController && typeof window.EventChatController.sendReactionInlineCtx === 'function') return window.EventChatController.sendReactionInlineCtx(...args); }
    function openFullEmojiPickerCtx(...args) { if (window.EventChatController && typeof window.EventChatController.openFullEmojiPickerCtx === 'function') return window.EventChatController.openFullEmojiPickerCtx(...args); }
    function scrollToMsg(...args) { if (window.EventChatController && typeof window.EventChatController.scrollToMsg === 'function') return window.EventChatController.scrollToMsg(...args); }
    function showAITypingIndicator(...args) { if (window.EventChatController && typeof window.EventChatController.showAITypingIndicator === 'function') return window.EventChatController.showAITypingIndicator(...args); }
    function hideAITypingIndicator(...args) { if (window.EventChatController && typeof window.EventChatController.hideAITypingIndicator === 'function') return window.EventChatController.hideAITypingIndicator(...args); }
    function processChatOutgoingQueue(...args) { if (window.EventChatController && typeof window.EventChatController.processChatOutgoingQueue === 'function') return window.EventChatController.processChatOutgoingQueue(...args); }
    function sendChatMessage(...args) { if (window.EventChatController && typeof window.EventChatController.sendChatMessage === 'function') return window.EventChatController.sendChatMessage(...args); }
    function keepChatInputFocused(...args) { if (window.EventChatController && typeof window.EventChatController.keepChatInputFocused === 'function') return window.EventChatController.keepChatInputFocused(...args); }
    function handleIncomingChatMsg(...args) { if (window.EventChatController && typeof window.EventChatController.handleIncomingChatMsg === 'function') return window.EventChatController.handleIncomingChatMsg(...args); }
    function handleIncomingChatReaction(...args) { if (window.EventChatController && typeof window.EventChatController.handleIncomingChatReaction === 'function') return window.EventChatController.handleIncomingChatReaction(...args); }
    function handleIncomingChatStatus(...args) { if (window.EventChatController && typeof window.EventChatController.handleIncomingChatStatus === 'function') return window.EventChatController.handleIncomingChatStatus(...args); }
    function handleCtxMenuOpen(...args) { if (window.EventChatController && typeof window.EventChatController.handleCtxMenuOpen === 'function') return window.EventChatController.handleCtxMenuOpen(...args); }
    function generateUniqueMeetUrl(...args) { if (window.EventChatController && typeof window.EventChatController.generateUniqueMeetUrl === 'function') return window.EventChatController.generateUniqueMeetUrl(...args); }
    function parseGroupCallUrl(...args) { if (window.EventChatController && typeof window.EventChatController.parseGroupCallUrl === 'function') return window.EventChatController.parseGroupCallUrl(...args); }
    function isGroupCallMessage(...args) { if (window.EventChatController && typeof window.EventChatController.isGroupCallMessage === 'function') return window.EventChatController.isGroupCallMessage(...args); }
    function formatChatMessageText(...args) { if (window.EventChatController && typeof window.EventChatController.formatChatMessageText === 'function') return window.EventChatController.formatChatMessageText(...args); }
    function getMemberRoleLabel(m) {
      if (!m) return 'Member';
      if (m.is_restricted) return 'Restricted';
      if (m.user_id === eventData?.organizer_id) return npIcon("crown", { size: 14, tone: "amber" }) + ' Creator';
      if ((m.role || '').toLowerCase() === 'organizer') return 'Organizer';
      return 'Collector';
    }

    function telHref(phone) {
      return 'tel:' + String(phone).replace(/[^\d+]/g, '');
    }

    async function showMemberProfile(userId) {
      let mem = members.find(x => x.user_id === userId);
      let name = mem?.user?.full_name || 'Unknown';
      let role = mem ? (mem.role === 'Organizer' ? 'Organizer' : 'Collector') : 'Member';
      if (mem?.is_restricted) role = 'Restricted';

      try {
        // Reset and show loader/partial data immediately
        document.getElementById('mp-avatar').textContent = name.charAt(0).toUpperCase();
        const hue = (name.charCodeAt(0) * 137) % 360;
        document.getElementById('mp-avatar').style.background = `hsl(${hue}, 60%, 45%)`;
        document.getElementById('mp-name').textContent = name;
        document.getElementById('mp-role').textContent = "Loading contact...";
        document.getElementById('mp-phone').textContent = "Fetching phone number...";
        document.getElementById('mp-call-btn').style.display = "none";
        document.getElementById('member-profile-modal').style.display = 'flex';

        const contact = await getMemberContact(eventId, userId);

        // Update with full data
        const finalName = contact.full_name || name;
        const phone = contact.phone_number || '';
        const roleLabel = getMemberRoleLabel(mem);

        document.getElementById('mp-avatar').textContent = getInitials(finalName);
        document.getElementById('mp-name').textContent = finalName;
        document.getElementById('mp-role').innerHTML = roleLabel;
        document.getElementById('mp-phone').textContent = phone || 'No phone number on file';

        const callBtn = document.getElementById('mp-call-btn');
        if (phone) {
          callBtn.href = `tel:${phone}`;
          callBtn.style.display = "flex";
          callBtn.classList.remove('mp-call-disabled');
          callBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg> Call`;
        } else {
          callBtn.style.display = "none";
        }
      } catch (e) {
        console.error("Profile load failed:", e);
        document.getElementById('mp-role').innerHTML = getMemberRoleLabel(mem);
        document.getElementById('mp-phone').textContent = "Contact info unavailable";
        document.getElementById('mp-call-btn').style.display = "none";
      }
    }

    function closeMemberProfile() {
      const modal = document.getElementById('member-profile-modal');
      if (modal) modal.style.display = 'none';
    }

    async function startGroupCall() {
      if (typeof isVisitor !== 'undefined' && isVisitor) return;

      const btn = document.getElementById('chat-group-call-btn');
      if (btn) btn.disabled = true;

      const meetUrl = generateUniqueMeetUrl();
      const msg = '[[GROUP_CALL]]' + meetUrl;

      try {
        await apiFetch('POST', `/events/${eventId}/chat`, { message: msg });
        showToast('Group call link sent to chat', 'success');
      } catch (e) {
        showToast('Failed to start group call', 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function updateChatHeaderActions() {
      const gcBtn = document.getElementById('chat-group-call-btn');
      if (!gcBtn) return;
      const canStartCall = typeof isVisitor !== 'undefined' ? !isVisitor : true;
      gcBtn.style.display = canStartCall ? 'flex' : 'none';
    }

    // Show/hide chat FAB based on role
    function updateChatFabVisibility() {
      const fab = document.getElementById('chat-fab');
      if (!fab) return;
      const show = typeof isVisitor !== 'undefined' ? !isVisitor : true;
      fab.style.display = (show && !activeTheaterTab) ? 'flex' : 'none';
      updateChatHeaderActions();
    }
    /* JS fallback: if CSS is still cached, force height via style attribute */
    document.addEventListener('DOMContentLoaded', function () {
      function enforceFieldHeight() {
        var isLandscape = window.innerHeight < 520;
        var h = isLandscape ? '36px' : '44px';
        document.querySelectorAll('.ef-input').forEach(function (el) {
          el.style.setProperty('height', h, 'important');
          el.style.setProperty('min-height', h, 'important');
          el.style.setProperty('max-height', h, 'important');
        });
      }
      enforceFieldHeight();
      /* Re-run whenever a sheet opens (new fields may be injected dynamically) */
      var observer = new MutationObserver(enforceFieldHeight);
      observer.observe(document.body, { childList: true, subtree: true });
    });

    async function shareReceipt(donorName, amount, dateStr, collectorName) {
      const eventName = typeof eventData !== 'undefined' && eventData ? eventData.name : 'Event';
      donorName = String(donorName).replace(/^\((M|AI|AI-P)\)\s*/i, '').trim();
      const formattedAmt = parseInt(amount).toLocaleString('en-IN');
      const formattedDate = formatDate(dateStr);
      
      const { jsPDF } = window.jspdf;
      // Use A6 size for a nice small receipt card (105x148 mm)
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [105, 148] });
      
      // Outer Border
      doc.setDrawColor(30, 30, 30);
      doc.setLineWidth(0.8);
      doc.rect(5, 5, 95, 138);
      
      // Header Background
      doc.setFillColor(245, 245, 245);
      doc.rect(7.5, 7.5, 90, 22, 'F');
      
      // Header Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(30, 30, 30);
      const titleText = eventName.toUpperCase() + " RECEIPT";
      // Auto-wrap title if it's too long
      const splitTitle = doc.splitTextToSize(titleText, 85);
      doc.text(splitTitle, 52.5, 16, { align: "center" });
      
      // Divider Line
      doc.setLineWidth(0.5);
      doc.line(7, 30, 98, 30);
      
      // Receipt Details
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("RECEIPT NO:", 12, 40);
      doc.setFont("helvetica", "normal");
      // Use timestamp as a fake receipt number
      const receiptNo = "REC-" + new Date(dateStr).getTime().toString().slice(-6);
      doc.text(receiptNo, 40, 40);
      
      doc.setFont("helvetica", "bold");
      doc.text("DATE:", 12, 50);
      doc.setFont("helvetica", "normal");
      doc.text(formattedDate, 40, 50);
      
      doc.setFont("helvetica", "bold");
      doc.text("RECEIVED FROM:", 12, 60);
      doc.setFont("helvetica", "normal");
      const splitName = doc.splitTextToSize(donorName.toUpperCase(), 50);
      doc.text(splitName, 45, 60);
      
      // Amount Box
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(12, 75, 81, 18, 'FD');
      
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("AMOUNT RECEIVED:", 16, 86);
      doc.setFontSize(14);
      doc.setTextColor(0, 100, 0); // Dark Green
      // Added extra space after Rs. and pushed X coordinate further right
      doc.text("Rs.   " + formattedAmt, 60, 86);
      doc.setTextColor(30, 30, 30);
      
      // Signature Section
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Authorized Signature:", 12, 115);
      
      // Place the collector's name boldly ON the line
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(collectorName.toUpperCase(), 69, 114, { align: "center" });
      
      // Signature line underneath the name
      doc.setDrawColor(50, 50, 50);
      doc.line(48, 116, 90, 116);
      
      // Footer
      doc.line(7, 130, 98, 130);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Thank you for your generous contribution!", 52.5, 136, { align: "center" });
      
      const filename = `Receipt_${donorName.replace(/\s+/g, '_')}.pdf`;
      
      try {
        const pdfBlob = doc.output('blob');
        const file = new File([pdfBlob], filename, { type: 'application/pdf' });
        
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Donation Receipt',
            files: [file]
          });
        } else {
          doc.save(filename);
        }
      } catch (err) {
        console.error('Error sharing PDF:', err);
        doc.save(filename);
      }
    }



// --- PUBLIC DONATION PORTAL ---
function openUpiSheet() {
  document.getElementById('upi-sheet').style.display = 'flex';
  document.getElementById('upi-id-input').value = eventData.upi_id || '';
  document.getElementById('upi-owner-name-input').value = eventData.upi_owner_name || '';

  // Render Custom Columns for Donor
  const donCols = eventData.donation_custom_columns || [];
  const reqColsContainer = document.getElementById('upi-donor-req-cols-container');
  const reqColsList = document.getElementById('upi-donor-req-cols-list');
  
  if (donCols.length > 0) {
    let hasCustom = false;
    reqColsList.innerHTML = '';
    donCols.forEach(col => {
      const colName = typeof col === 'string' ? col : col.n;
      if (colName.startsWith('_sys_')) return; // Skip internal sys columns
      const isHidden = typeof col === 'object' ? col.hidden === true : false;
      if (isHidden) return; // Skip hidden columns
      
      hasCustom = true;
      const isReq = typeof col === 'object' ? col.reqByDonor : false;
      
      const lbl = document.createElement('label');
      lbl.className = 'upi-col-checkbox-label';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'donor-req-cb';
      cb.value = colName;
      cb.checked = isReq;
      
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(colName));
      reqColsList.appendChild(lbl);
    });
    
    if(hasCustom) {
      reqColsContainer.style.display = 'block';
    } else {
      reqColsContainer.style.display = 'block';
      reqColsList.innerHTML = '<div class="upi-cols-help-text" style="margin-top: 0;">No custom columns added yet. Add columns to the Collections table first.</div>';
    }
  } else {
    reqColsContainer.style.display = 'block';
    reqColsList.innerHTML = '<div class="upi-cols-help-text" style="margin-top: 0;">No custom columns added yet. Add columns to the Collections table first.</div>';
  }

  if (eventData.upi_id && eventData.upi_owner_name) {
    const cleanPath = getCleanUrl('donate.html');
    const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
    const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
    const link = origin + path + '?event_id=' + eventId;
    document.getElementById('upi-link-text').innerText = link;
    document.getElementById('upi-share-section').style.display = 'block';
    document.getElementById('btn-upi-save').style.display = '';
    document.getElementById('btn-upi-cancel').innerText = 'Close';
  } else {
    document.getElementById('upi-share-section').style.display = 'none';
    document.getElementById('btn-upi-save').style.display = '';
    document.getElementById('btn-upi-cancel').innerText = 'Cancel';
  }
}

// ==========================================
// RECEIPT MODAL & UPLOAD
// ==========================================
let activeModalDonationId = null;

let activeModalEntryType = 'don';
// Global Loading State Dummies
function showLoading(msg) {
  // If you have a real spinner, you can show it here
  console.log('Loading:', msg);
}
function hideLoading() {
  console.log('Finished loading');
}

// Custom Confirm Modal
function showConfirmModal(title, message, btnText, btnColor, onConfirm, iconName = null, titleColor = "var(--t1)") {
  let modal = document.getElementById("np-confirm-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "np-confirm-modal";
    modal.className = "popup-modal";
    modal.style.zIndex = "100050";
    modal.innerHTML = `
      <div class="popup-content" id="np-confirm-content" style="background:var(--card, var(--surface)); border-radius:20px; padding:24px; max-width:340px; width:90%; box-shadow:var(--shadow-modal);">
        <div id="np-confirm-ic-box" class="popup-icon" style="display:none;"></div>
        <div id="np-confirm-title" class="popup-title" style="font-size:18px; font-weight:800; margin-bottom:8px;"></div>
        <div id="np-confirm-msg" class="popup-desc" style="font-size:13.5px; color:var(--text2, var(--t2)); line-height:1.5; margin-bottom:20px;"></div>
        <div style="display:flex; gap:10px; width:100%;">
          <button class="popup-btn" style="background:var(--surface-2, var(--surface)); color:var(--text); border:1px solid var(--border); border-radius:12px !important; padding:12px; font-size:14px; font-weight:700; cursor:pointer; flex:1;" id="np-confirm-cancel">Cancel</button>
          <button class="popup-btn" id="np-confirm-ok" style="border:none; border-radius:12px !important; padding:12px; font-size:14px; font-weight:700; cursor:pointer; flex:1; display:flex; align-items:center; justify-content:center; gap:6px;"></button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("np-confirm-cancel").onclick = () => { modal.classList.remove("open"); };
  }
  
  const titleEl = document.getElementById("np-confirm-title");
  titleEl.innerText = title;
  
  const isDanger = (btnColor === "#ef4444" || btnColor === "var(--red)" || btnColor === "var(--np-red)");
  if (isDanger) {
    titleEl.style.color = "var(--red, #ef4444)";
  } else if (titleColor && titleColor !== "var(--t1)") {
    titleEl.style.color = titleColor;
  } else if (btnColor === "#10b981" || btnColor === "green" || btnColor === "var(--green)") {
    titleEl.style.color = "#10b981";
  } else {
    titleEl.style.color = "var(--text, var(--t1))";
  }

  document.getElementById("np-confirm-msg").innerHTML = message;
  
  const okBtn = document.getElementById("np-confirm-ok");
  okBtn.innerText = btnText;
  
  const contentBox = document.getElementById("np-confirm-content");
  contentBox.style.background = "var(--card, var(--surface))";
  
  if (isDanger) {
    okBtn.style.background = "var(--red, #ef4444)";
    okBtn.style.color = "white";
    contentBox.style.border = "2px solid var(--red, #ef4444)";
  } else if (btnColor === "#10b981" || btnColor === "green" || btnColor === "var(--green)") {
    okBtn.style.background = "#10b981";
    okBtn.style.color = "white";
    contentBox.style.border = "2px solid #10b981";
  } else {
    okBtn.style.background = btnColor || "var(--primary)";
    okBtn.style.color = "white";
    contentBox.style.border = "1px solid var(--border)";
  }
  
  const icBox = document.getElementById("np-confirm-ic-box");
  if (iconName) {
    icBox.className = "popup-icon " + (isDanger ? "pi-red" : "pi-amber");
    if (!isDanger && (btnColor === "#10b981" || btnColor === "green" || btnColor === "var(--green)")) {
      icBox.style.background = "rgba(16, 185, 129, 0.15)";
      icBox.style.color = "#10b981";
    } else {
      icBox.style.background = "";
      icBox.style.color = "";
    }
    icBox.innerHTML = `<span data-np-icon="${iconName}" data-np-size="24"></span>`;
    icBox.style.display = "flex";
    if (typeof initIcons === 'function') initIcons();
  } else {
    icBox.style.display = "none";
  }
  
  okBtn.onclick = () => {
    modal.classList.remove("open");
    if (onConfirm) onConfirm();
  };
  
  modal.classList.add("open");
}
let pendingReceiptDonationId = null;
let pendingReceiptEntryType = 'don';
function closeUpiSheet() {
  document.getElementById('upi-sheet').style.display = 'none';
}

async function saveUpiId() {
  const upiId = document.getElementById('upi-id-input').value.trim();
  const upiOwnerName = document.getElementById('upi-owner-name-input').value.trim();

  const idError = document.getElementById('upi-id-error');
  const nameError = document.getElementById('upi-name-error');
  idError.style.display = 'none';
  nameError.style.display = 'none';

  if (upiId || upiOwnerName) {
    let hasError = false;
    if (!upiId) {
      idError.innerText = 'Please enter your UPI ID';
      idError.style.display = 'block';
      hasError = true;
    }
    if (!upiOwnerName) {
      nameError.innerText = 'Please enter the Payment Receiver Name';
      nameError.style.display = 'block';
      hasError = true;
    }
    if (hasError) return;
  }

    const reqCols = [];
    document.querySelectorAll('.donor-req-cb:checked').forEach(cb => {
      reqCols.push(cb.value);
    });
    
    const updatedDonCols = (eventData.donation_custom_columns || []).map(c => {
      const isObj = typeof c === 'object';
      const name = isObj ? c.n : c;
      const req = reqCols.includes(name);
      if(isObj) {
        return { ...c, reqByDonor: req };
      } else {
        return { n: name, w: 180, hidden: false, reqByDonor: req };
      }
    });

  try {
    const payload = { 
      upi_id: upiId, 
      upi_owner_name: upiOwnerName,
      donation_custom_columns: updatedDonCols
    };
    const res = await apiFetch('PUT', '/events/' + eventId, payload);
    eventData.upi_id = res.upi_id || '';
    eventData.upi_owner_name = res.upi_owner_name || '';
    eventData.donation_custom_columns = res.donation_custom_columns || updatedDonCols;
    
    if (eventData.upi_id && eventData.upi_owner_name) {
      const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
      const link = origin + (typeof buildUrl === 'function' ? buildUrl('donate', eventId) : '/donate.html?event_id=' + eventId);
      document.getElementById('upi-link-text').innerText = link;
      document.getElementById('upi-share-section').style.display = 'block';
      document.getElementById('btn-upi-save').style.display = '';
      document.getElementById('btn-upi-cancel').innerText = 'Close';
      showToast('UPI ID saved! Donation link is ready.');
    } else {
      document.getElementById('upi-share-section').style.display = 'none';
      document.getElementById('btn-upi-save').style.display = '';
      document.getElementById('btn-upi-cancel').innerText = 'Cancel';
      showToast('UPI ID removed.');
    }
  } catch (err) {
    alert(err.message);
  }
}

function shareDonationLink() {
  const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
  const link = origin + (typeof buildUrl === 'function' ? buildUrl('donate', eventId) : '/donate.html?event_id=' + eventId);
  if (navigator.share) {
    navigator.share({
      title: 'Contribution for ' + (eventData.name || 'our event'),
      text: `Please help us make ${eventData.name || 'our event'} a success! Your support means a lot to us. You can easily contribute here:\n\n`,
      url: link
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(link);
    showToast('Donation link copied to clipboard!');
  }
}

function copyDonationLink(btnElement) {
  const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
  const link = origin + (typeof buildUrl === 'function' ? buildUrl('donate', eventId) : '/donate.html?event_id=' + eventId);
  navigator.clipboard.writeText(link);
  
  if (btnElement) {
    btnElement.innerHTML = '<span data-np-icon="check" data-np-size="18" data-np-tone="green"></span>';
    if (typeof window.initIcons !== 'undefined') window.initIcons();
    showToast('Link copied');
    setTimeout(() => {
      btnElement.innerHTML = '<span data-np-icon="copy" data-np-size="18"></span>';
      if (typeof window.initIcons !== 'undefined') window.initIcons();
    }, 3000);
  } else {
    showToast('Link copied');
  }
}

function resetUpiUI() {
  document.getElementById('upi-share-section').style.display = 'none';
  document.getElementById('btn-upi-save').style.display = '';
  document.getElementById('btn-upi-cancel').innerText = 'Cancel';
}
const upiIdInput = document.getElementById('upi-id-input');
if (upiIdInput) upiIdInput.addEventListener('input', resetUpiUI);
const upiOwnerInput = document.getElementById('upi-owner-name-input');
if (upiOwnerInput) upiOwnerInput.addEventListener('input', resetUpiUI);

// Hide Chat FAB when any bottom sheet (.sov) is open
document.addEventListener('DOMContentLoaded', () => {
  const sovObserver = new MutationObserver(() => {
    const anySovOpen = Array.from(document.querySelectorAll('.sov')).some(el => el.style.display && el.style.display !== 'none');
    const fab = document.getElementById('chat-fab');
    if (fab) {
      fab.style.visibility = anySovOpen ? 'hidden' : 'visible';
    }
  });
  document.querySelectorAll('.sov').forEach(el => sovObserver.observe(el, { attributes: true, attributeFilter: ['style'] }));
});

// Expose all event filter, sort, receipt, and modal handlers globally to window for reliable HTML onclick/oninput invocation
window.openFilterModal = typeof openFilterModal !== 'undefined' ? openFilterModal : null;
window.closeFilterModal = typeof closeFilterModal !== 'undefined' ? closeFilterModal : null;
window.syncEventFilterPills = typeof syncEventFilterPills !== 'undefined' ? syncEventFilterPills : null;
window.setEventSortPill = typeof setEventSortPill !== 'undefined' ? setEventSortPill : null;
window.setEventDatePill = typeof setEventDatePill !== 'undefined' ? setEventDatePill : null;
window.toggleEventFilterPill = typeof toggleEventFilterPill !== 'undefined' ? toggleEventFilterPill : null;
window.clearEventFilterMenu = typeof clearEventFilterMenu !== 'undefined' ? clearEventFilterMenu : null;
window.applyFilterSort = typeof applyFilterSort !== 'undefined' ? applyFilterSort : null;
window.openReceiptModal = typeof openReceiptModal !== 'undefined' ? openReceiptModal : null;
window.closeReceiptModal = typeof closeReceiptModal !== 'undefined' ? closeReceiptModal : null;
window.verifyReceiptDonation = typeof verifyReceiptDonation !== 'undefined' ? verifyReceiptDonation : null;
window.rejectReceiptDonation = typeof rejectReceiptDonation !== 'undefined' ? rejectReceiptDonation : null;
window.removeReceiptDonation = typeof removeReceiptDonation !== 'undefined' ? removeReceiptDonation : null;
window.toggleReceiptZoom = typeof toggleReceiptZoom !== 'undefined' ? toggleReceiptZoom : null;
window.triggerModalReceiptEdit = typeof triggerModalReceiptEdit !== 'undefined' ? triggerModalReceiptEdit : null;
window.triggerManualReceiptUpload = typeof triggerManualReceiptUpload !== 'undefined' ? triggerManualReceiptUpload : null;
window.handleManualReceiptUpload = typeof handleManualReceiptUpload !== 'undefined' ? handleManualReceiptUpload : null;
