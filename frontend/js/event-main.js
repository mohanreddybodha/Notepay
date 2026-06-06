    if (localStorage.getItem("np_dark")) {
      document.documentElement.classList.add("dark-mode");
      window.addEventListener('DOMContentLoaded', () => document.body.classList.add("dark-mode"));
    }
    // ── State ──
    const params = new URLSearchParams(location.search);

    const eventId = params.get("id") || params.get("eventId");
    let eventData = null;
    let myUserId = null;
    let isOrganizer = false;
    let isActive = true;
    let donations = [];
    let expenses = [];
    let members = [];
    
    // Sort & Filter state
    let currentSort = 'time_asc'; // 'time_asc', 'time_desc', 'amt_desc', 'amt_asc', 'name_asc'
    let myEntriesOnly = false;

    function applySortAndFilter(list, type) {
      let res = [...list];
      if (myEntriesOnly && myUserId) {
        if (type === 'don') res = res.filter(d => d.collected_by === myUserId);
        else res = res.filter(e => e.spent_by === myUserId);
      }
      res.sort((a, b) => {
        if (currentSort === 'time_asc') return new Date(a.collected_at) - new Date(b.collected_at);
        if (currentSort === 'time_desc') return new Date(b.collected_at) - new Date(a.collected_at);
        if (currentSort === 'amt_desc') return (b.amount || 0) - (a.amount || 0);
        if (currentSort === 'amt_asc') return (a.amount || 0) - (b.amount || 0);
        if (currentSort === 'name_asc') {
          const nameA = ((type === 'don' ? a.donor_name : a.description) || '').toLowerCase();
          const nameB = ((type === 'don' ? b.donor_name : b.description) || '').toLowerCase();
          return nameA.localeCompare(nameB);
        }
        return 0;
      });
      return res;
    }
    let currentTab = params.get("tab") || "don";
    let ctxTarget = null; // { type:'don'|'exp', entry, row }
    let editTarget = null;
    let isVisitor = false;
    let isRestricted = false;
    let activeTheaterTab = params.get("theater");
    let theaterRotation = 0;
    const tabRotations = { don: 0, exp: 0, sum: 0 };
    let summaryData = null; // Backend Summary data
    let ws = null; // WebSocket connection
    let wsAuthenticated = false;
    let vTxnsCount = 5; // Global activity count

    function showInvalidEventId() {
      console.error("Invalid or missing eventId:", params.get("id"));
      const loader = document.getElementById("loading-pane");
      if (loader) {
        loader.style.display = "flex";
        loader.innerHTML = `
          <div style="text-align:center; padding:20px; max-width:380px;">
            <div style="font-size:48px; margin-bottom:20px;">❌</div>
            <div style="font-weight:900; font-size:22px; margin-bottom:10px;">Invalid event link</div>
            <div style="color:var(--text3); line-height:1.6; margin-bottom:20px;">This event could not be opened because the page URL is missing a valid event ID.</div>
            <button class="btn" onclick="window.location.href='dashboard.html'" style="padding:12px 28px; border-radius:14px;">Back to Dashboard</button>
          </div>
        `;
      }
    }

    if (!eventId || typeof eventId !== "string" || eventId.trim() === "") {
      showInvalidEventId();
    }

    async function init() {
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
      // Auto-reopen chat if ?chat=1 is in URL
      if (params.get("chat") === "1") {
        openChat();
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
      isOrganizerGlobal = isOrganizer;
      isVisitor = (rawRole === "visitor") && !isOrganizer;
      isRestricted = res.is_restricted || false;

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
      if (!chatHistoryLoaded) {
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
        isOrganizerGlobal = false;
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
              console.log("⚡️ Hydrating from Cache (Place 2)");
              applyData(cData);
            }
          } catch (e) { console.warn("Cache parse failed", e); }
        }
      }

      console.log(isBackground ? "🔄 Background Refreshing..." : "🚀 Fetching Fresh Data");
      try {
        const res = await apiFetch("GET", `/events/${eventId}/full-details`);
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
        const msg = (e.message || "").toLowerCase();
        if (msg.includes("not a member") || msg.includes("403") || msg.includes("forbidden")) {
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
                <div style="font-family:'Nunito',sans-serif;font-size:24px;font-weight:900;color:var(--text);margin-bottom:8px;">Event is Private</div>
                <div style="font-size:15px;color:var(--text3);line-height:1.6;max-width:300px;margin:0 auto 24px;">The organizer has turned off public access.</div>
                <button onclick="window.location.href='dashboard.html'" class="btn" 
                  style="margin-top:10px; padding:14px 40px; border-radius:18px; background:var(--primary); color:white; font-weight:900; box-shadow: 0 8px 20px rgba(0,0,0,0.1);">
                  ← Back to Dashboard
                </button>
              </div>
            `;
          }
        } else {
          renderPage();
        }
      } finally {
        const splash = document.getElementById('app-splash');
        if (splash) splash.classList.add('hidden');
        
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
          return;
        }
        if (!wsAuthenticated) return;
        if (msg.type === "DATA_CHANGED") {
          console.log(`[debug] WS DATA_CHANGED received. activeInlineAddType=${activeInlineAddType}`);
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
        if (desc) desc.textContent = eventData.description;
        const date = document.getElementById("ev-date");
        if (date) date.innerHTML = npIcon("calendar", { size: 12, tone: "muted" }) + " " + formatDate(eventData.event_date);
        const ib = document.getElementById("info-bar");
        if (ib) ib.style.display = "flex";

        // Privacy Menu labels
        const privLbl = document.getElementById("privacy-lbl");
        const shareBtn = document.getElementById("share-link-btn");
        const pdfBtn = document.getElementById("pdf-report-btn");
        if (privLbl) privLbl.textContent = eventData.is_public ? "Public Access: ON" : "Public Access: OFF";
        if (shareBtn) shareBtn.style.display = (isOrganizer && eventData.is_public) ? "flex" : "none";
        if (pdfBtn) pdfBtn.style.display = (eventData.is_public) ? "flex" : "none";

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
                <button onclick="window.location.href='dashboard.html'" class="btn" 
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
        if (mb) {
          mb.style.display = "flex";
          if (isOrganizer) {
            mb.className = "badge-members";
            mb.innerHTML = npIcon("user", { size: 14 }) + " Members";
            mb.onclick = openMembersSheet;
            mb.style.cursor = "pointer";
          } else {
            mb.className = "badge-col";
            mb.textContent = isVisitor ? "Visitor" : "Collector";
            mb.onclick = null;
            mb.style.cursor = "default";
          }
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
        if (urlParams.has('chat') && !chatOpen) {
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
      console.log(`[debug] switchTab: tab=${tab}, updateUrl=${updateUrl}, preserveInline=${preserveInline}, activeInlineAddType=${activeInlineAddType}`);
      if (!preserveInline) {
        activeInlineAddType = null;
        activeInlineEditType = null;
        activeInlineEditId = null;
      }
      currentTab = tab;
      if (updateUrl) {
        const p = new URLSearchParams(window.location.search);
        p.set("tab", tab);
        history.replaceState(null, "", "?" + p.toString());
      }
      ["don", "exp", "sum"].forEach(t => {
        const el = document.getElementById("tab-" + t);
        if (el) el.classList.toggle("active", t === tab);
      });

      // Animate Tab Indicator
      const tabs = Array.from(document.querySelectorAll("#tab-bar .tab-h")).filter(el => el.style.display !== "none");
      const activeIndex = tabs.findIndex(el => el.classList.contains("active"));
      const indicator = document.getElementById("tab-indicator");
      if (indicator && tabs.length > 0 && activeIndex >= 0) {
        indicator.style.width = `${100 / tabs.length}%`;
        indicator.style.transform = `translateX(${activeIndex * 100}%)`;
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

    function preserveInlineState() {
      document.querySelectorAll('.inline-entry-row, .inline-edit-row').forEach(r => r.remove());
      activeInlineEditId = null;
      activeInlineAddType = null;
      activeInlineEditType = null;
      _draftInlineData = null;
      _preservedInlineFormNode = null;
    }

    function captureInlineState(tblBody, type) {
      if (!tblBody) return;

      const formRow = tblBody.querySelector('.inline-entry-row') || tblBody.querySelector('.inline-edit-row');
      if (!formRow) return;

      // Reliable detection: Edit forms always have _origRow attached to the DOM node
      const isAdd = !formRow._origRow;

      const state = {
        type: isAdd ? 'add' : 'edit',
        formType: type,
        editId: isAdd ? null : activeInlineEditId,
        focusClass: null,
        strVal: '',
        amtVal: '',
        customVals: {}
      };

      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        state.focusClass = document.activeElement.className;
      }

      const strInput = formRow.querySelector('.inl-str-val');
      if (strInput) state.strVal = strInput.value;

      const amtInput = formRow.querySelector('.inl-amt-input');
      if (amtInput) state.amtVal = amtInput.value;

      const customInputs = formRow.querySelectorAll('.inl-custom');
      customInputs.forEach(inp => {
        const colName = inp.getAttribute('data-col');
        if (colName) state.customVals[colName] = inp.value;
      });

      _draftInlineData = state;
      _preservedInlineFormNode = formRow;
      formRow.remove();
    }

    function restoreInlineState(tblBody, forceRestore = false) {
      if (!_draftInlineData || !tblBody) return;

      const state = _draftInlineData;
      
      // If we're resuming a paused add form during an edit submit/cancel
      if (forceRestore && state.type === 'add') {
        activeInlineAddType = state.formType;
      }

      // SMART PATCH: Instead of discarding the node on schema change, dynamically update its custom columns to prevent cursor flash!
      if (window.schemaChanged && _preservedInlineFormNode) {
        const isDon = state.formType === 'don';
        const customCols = isDon ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);
        
        // Remove old custom cells
        const oldCustoms = _preservedInlineFormNode.querySelectorAll('.inl-custom');
        oldCustoms.forEach(inp => {
          const cell = inp.closest('.sc');
          if (cell) cell.remove();
        });

        const rightCol = _preservedInlineFormNode.querySelector('.sticky-col-right');

        // Add new custom cells
        customCols.forEach(col => {
          const colName = typeof col === "string" ? col : col.n;
          if (colName.startsWith("_sys_")) return;
          const colWidth = typeof col === "string" ? 180 : (col.w || 180);
          const isHidden = typeof col === "object" && col.hidden;
          const val = state.customVals[colName] || '';
          const cell = document.createElement('div');
          cell.className = 'sc';
          cell.style.cssText = `width:${colWidth}px; display:${isHidden ? 'none !important' : 'flex'}; align-items:center;`;
          // Use same HTML as renderInlineEntryForm
          cell.innerHTML = `<input type="search" class="inline-input inl-custom" data-col="${escHtml(colName)}" placeholder="${escHtml(colName)}" value="${escHtml(val)}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0; display:block;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text">`;
          
          if (rightCol) {
            _preservedInlineFormNode.insertBefore(cell, rightCol);
          } else {
            _preservedInlineFormNode.appendChild(cell);
          }
        });
        
        window.schemaChanged = false; // Successfully patched, skip rebuild!
      }

      // Always sync widths dynamically so resizing columns while form is open updates instantly
      if (_preservedInlineFormNode) {
        const isDon = state.formType === 'don';
        const customCols = isDon ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);
        const hideDate = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_date" : "_sys_exp_date") && c.hidden);
        const hideColBy = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_colby" : "_sys_exp_colby") && c.hidden);
        const hideAmt = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_amt" : "_sys_exp_amt") && c.hidden);

        const cells = Array.from(_preservedInlineFormNode.children);
        if (cells.length >= 4) {
          cells[0].style.width = getColWidth(isDon ? 'don_name' : 'exp_desc', 140) + 'px';
          cells[1].style.width = getColWidth(isDon ? 'don_amt' : 'exp_amt', 90) + 'px';
          if (hideAmt) { cells[1].style.setProperty('display', 'none', 'important'); } else { cells[1].style.display = 'flex'; }
          cells[2].style.width = getColWidth(isDon ? 'don_date' : 'exp_date', 100) + 'px';
          if (hideDate) { cells[2].style.setProperty('display', 'none', 'important'); } else { cells[2].style.display = 'flex'; }
          cells[3].style.width = getColWidth(isDon ? 'don_colby' : 'exp_colby', 130) + 'px';
          if (hideColBy) { cells[3].style.setProperty('display', 'none', 'important'); } else { cells[3].style.display = 'flex'; }
          
          let idx = 4;
          customCols.forEach(col => {
            const colName = typeof col === "string" ? col : col.n;
            if (colName.startsWith("_sys_")) return;
            if (cells[idx]) {
                const colWidth = typeof col === "string" ? 180 : (col.w || 180);
                const isHidden = typeof col === "object" && col.hidden;
                cells[idx].style.width = colWidth + 'px';
                if (isHidden) {
                  cells[idx].style.setProperty('display', 'none', 'important');
                } else {
                  cells[idx].style.display = 'flex';
                }
                idx++;
            }
          });
        }
      }

      if (window.schemaChanged || !_preservedInlineFormNode) {
        if (state.type === 'add') {
          renderInlineEntryForm(state.formType, false);
        } else if (state.type === 'edit' && state.editId) {
          const list = state.formType === 'don' ? donations : expenses;
          const entry = list.find(x => String(x.id || x._id) === state.editId);
          const origRow = tblBody.querySelector(`.tr[data-id="${state.editId}"]`);
          if (entry && origRow) {
            renderInlineEditForm(state.formType, entry, origRow);
          }
        }
      } else {
        // Reuse preserved node to avoid blink
        if (state.type === 'add') {
          const newRowBtn = tblBody.querySelector('.new-row');
          if (newRowBtn) {
            tblBody.insertBefore(_preservedInlineFormNode, newRowBtn);
            newRowBtn.onclick = null;
            newRowBtn.style.cursor = "default";
            newRowBtn.innerHTML = `<span style="position:sticky; left:50%; transform:translateX(-50%); white-space:nowrap; z-index:10; display:flex; gap:8px; align-items:center;">
                <button class="btn btn-text-secondary" onclick="event.stopPropagation(); cancelInlineEntry(this, '${state.formType}')" style="padding:4px 14px; font-size:12px; background:var(--surface); border:1px solid var(--border2); height:28px; white-space:nowrap;">Cancel</button>
                <button class="btn btn-solid-primary" onclick="event.stopPropagation(); submitInlineEntry('${state.formType}', this)" style="padding:4px 18px; font-size:12px; height:28px; box-shadow:0 4px 10px rgba(0,0,0,0.15); white-space:nowrap;">Save</button>
            </span>`;
          } else {
            tblBody.appendChild(_preservedInlineFormNode);
          }
        } else if (state.type === 'edit' && state.editId) {
          const origRow = tblBody.querySelector(`.tr[data-id="${state.editId}"]`);
          if (origRow) {
            origRow.style.display = 'none';
            const newRowBtn = tblBody.querySelector('.new-row');
            if (newRowBtn) {
              tblBody.insertBefore(_preservedInlineFormNode, newRowBtn);
            } else {
              tblBody.insertBefore(_preservedInlineFormNode, origRow.nextSibling);
            }
            if (newRowBtn) {
              newRowBtn.onclick = null;
              newRowBtn.style.cursor = "default";
              newRowBtn.innerHTML = `<span style="position:sticky; left:50%; transform:translateX(-50%); white-space:nowrap; z-index:10; display:flex; gap:8px; align-items:center;">
                  <button class="btn btn-text-secondary" onclick="event.stopPropagation(); cancelInlineEdit(this, '${state.formType}')" style="padding:4px 14px; font-size:12px; background:var(--surface); border:1px solid var(--border2); height:28px; white-space:nowrap;">Cancel</button>
                  <button class="btn btn-solid-primary" onclick="event.stopPropagation(); submitInlineEdit('${state.formType}', '${state.editId}', this)" style="padding:4px 18px; font-size:12px; height:28px; box-shadow:0 4px 10px rgba(0,0,0,0.15); white-space:nowrap;">Save</button>
              </span>`;
            }
          } else {
            tblBody.appendChild(_preservedInlineFormNode);
          }
        }
      }

      const newFormRow = tblBody.querySelector(state.type === 'add' ? '.inline-entry-row' : '.inline-edit-row');
      if (newFormRow) {
        const strInput = newFormRow.querySelector('.inl-str-val');
        if (strInput) strInput.value = state.strVal;

        const amtInput = newFormRow.querySelector('.inl-amt-input');
        if (amtInput) amtInput.value = state.amtVal;

        const customInputs = newFormRow.querySelectorAll('.inl-custom');
        customInputs.forEach(inp => {
          const colName = inp.getAttribute('data-col');
          if (colName && state.customVals[colName] !== undefined) {
            inp.value = state.customVals[colName];
          }
        });

        if (state.focusClass) {
          const inputs = newFormRow.querySelectorAll('input');
          for (let i = 0; i < inputs.length; i++) {
            if (inputs[i].className === state.focusClass) {
              setTimeout(() => { if (inputs[i]) inputs[i].focus(); }, 10);
              break;
            }
          }
        }
      }

      _draftInlineData = null;
      _preservedInlineFormNode = null;
      window.schemaChanged = false;
    }

    function searchMatch(obj, q) {
      if (!q) return true;
      const q2 = q.toLowerCase();
      let str = (obj.donor_name || obj.description || '') + ' ' + 
                (obj.amount || '') + ' ' + 
                (obj.collected_by_name || 'System') + ' ' +
                (obj.spent_by_name || 'System');
      if (obj.custom_fields) {
        str += ' ' + Object.values(obj.custom_fields).join(' ');
      }
      return str.toLowerCase().includes(q2);
    }

    // ── Donations ──
    function renderDonations(q = "") {
      const tblBody = document.getElementById("don-tbl-body");
      captureInlineState(tblBody, "don");
      const q2 = q.trim().toLowerCase();

      // Combined Pinned List (Local only)
      const storageKey = `np_pinned_${eventId}_don`;
      const pD = JSON.parse(localStorage.getItem(storageKey) || "[]").map(id => String(id));

      let pinned = [];
      let unpinned = [];
      const sortedBase = applySortAndFilter(donations, 'don');
      sortedBase.forEach(item => {
        const id = String(item.id || item._id);
        const idx = pD.indexOf(id);
        if (idx !== -1) pinned.push({ item, idx });
        else unpinned.push(item);
      });
      pinned.sort((a, b) => a.idx - b.idx);
      const sorted = [...pinned.map(p => p.item), ...unpinned];

      const filtered = q2 ? sorted.filter(d => searchMatch(d, q2)) : sorted;
      const total = donations.reduce((s, d) => s + (d.amount || 0), 0);
      document.getElementById("don-count").textContent = `${filtered.length} donor${filtered.length !== 1 ? "s" : ""}`;
      document.getElementById("don-total").innerHTML = `Total: <span class="sum-g">${formatINR(total)}</span>`;

      if (!tblBody) return;
      tblBody.innerHTML = "";
      const customCols = eventData.donation_custom_columns || [];
      const hideDonDate = customCols.some(c => (typeof c === 'string' ? c : c.n) === '_sys_don_date' && c.hidden);
      const hideDonColBy = customCols.some(c => (typeof c === 'string' ? c : c.n) === '_sys_don_colby' && c.hidden);
      const visibleCustomCols = customCols.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });

      // 1. Render Header Row
      const hdr = document.createElement("div");
      hdr.className = "tr hdr-row";
      
      let hdrHTML = `<div class="th sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('don_name', 140)}px;"><div style="width:14px; margin-right:4px; flex-shrink:0;"></div><div class="${isOrganizer ? 'sth-custom' : ''}" style="flex:1; text-align:left;" ${isOrganizer ? "onclick=\"openDefaultColW('Name', 'don_name')\"" : ''}>Name</div></div>
                   <div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_amt', 90)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Amount', 'don_amt')\"" : ''}>Amount</div>`;
                   
      if (!hideDonDate) {
        hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_date', 100)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Date', 'don_date')\"" : ''}>Date</div>`;
      }
      if (!hideDonColBy) {
        hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('don_colby', 130)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Collected By', 'don_colby')\"" : ''}>Collected By</div>`;
      }
      
      hdr.innerHTML = hdrHTML;

      visibleCustomCols.forEach(col => {
        const colName = typeof col === "string" ? col : col.n;
        const colWidth = typeof col === "string" ? 180 : (col.w || 180);
        const div = document.createElement("div");
        div.className = "th" + (isOrganizer ? " sth-custom" : "");
        div.style.width = colWidth + "px";
        div.textContent = colName;
        if (isOrganizer) div.onclick = () => openEditCol(colName, "don");
        hdr.appendChild(div);
      });
      tblBody.appendChild(hdr);

      // 2. Render Data Rows
      if (filtered.length) {
        document.getElementById("don-empty-msg").style.display = "none";
        document.getElementById("don-tbl-rot").closest('.scroll-list').classList.remove('is-empty');
        filtered.forEach((d, i) => {
          const row = document.createElement("div");
          row.className = "tr" + (i % 2 ? " alt" : "");
          row.setAttribute('data-id', d.id || d._id);

          const customCells = visibleCustomCols.map(col => {
            const colName = typeof col === "string" ? col : col.n;
            const colWidth = typeof col === "string" ? 180 : (col.w || 180);
            const val = (d.custom_fields && d.custom_fields[colName]) || "";
            return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
          }).join("");

          const pinned = isPinned("don", d.id || d._id);
          
          let rowHTML = `
        <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('don_name', 140)}px;">
          <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            ${pinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
          </div>
          <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${escHtml(d.donor_name)}</div>
        </div>
        <div class="sc" style="width:${getColWidth('don_amt', 90)}px;"><span class="cg">${d.amount ? formatINR(d.amount) : '₹0'}</span></div>`;
        
        if (!hideDonDate) {
          rowHTML += `<div class="sc" style="width:${getColWidth('don_date', 100)}px;font-size:11px;">${formatDate(d.collected_at)}</div>`;
        }
        if (!hideDonColBy) {
          rowHTML += `<div class="sc" style="width:${getColWidth('don_colby', 130)}px;font-size:11px;" title="${escHtml(d.collected_by_name || "—")}">${escHtml(d.collected_by_name || "—")}</div>`;
        }
        
        rowHTML += `${customCells}`;
        row.innerHTML = rowHTML;
          row.addEventListener("contextmenu", e => { e.preventDefault(); openCtx(e, "don", d); });
          row.addEventListener("dblclick", e => { openCtx(e, "don", d); });

          // Double tap simulation
          let lastTap = 0;
          row.addEventListener("touchend", e => {
            const now = Date.now();
            if (now - lastTap < 300) {
              e.preventDefault();
              const t = e.changedTouches[0];
              openCtx({ clientX: t.clientX, clientY: t.clientY }, "don", d);
            }
            lastTap = now;
          });
          tblBody.appendChild(row);
        });
      } else {
        const emptyMsg = document.getElementById("don-empty-msg");
        emptyMsg.style.display = "block";
        document.getElementById("don-tbl-rot").closest('.scroll-list').classList.add('is-empty');
        const btnHtml = isOrganizer && !q ? `<button class="btn btn-solid-primary" style="margin-top:12px; width:auto; padding:10px 24px;" onclick="openEntryForm('don')">+ Add First Donation</button>` : "";
        emptyMsg.innerHTML = `<div class="empty-state" style="padding:40px 24px;">
      <div class="es-icon" style="margin-bottom:8px;">${q ? npIcon("search", { size: 32, tone: "muted" }) : npIcon("file-text", { size: 32, tone: "muted" })}</div>
      <div class="es-title" style="font-size:15px; font-weight:900;">${q ? 'No results found' : 'No donations yet'}</div>
      <div class="es-sub" style="font-size:12px; opacity:0.7; max-width:220px; line-height:1.5;">${q ? 'Try a different search term.' : 'Start tracking now — add your first donation!'}</div>
      ${btnHtml}
    </div>`;
      }

      // 3. Render New Entry Row
      if (!isVisitor && (isOrganizer || (!isOrganizer && isActive))) {
        const nr = document.createElement("div");
        nr.className = "tr new-row";
        nr.onclick = () => openEntryForm("don");
        // Clear children column structure
        nr.innerHTML = `<span style="position:sticky; left:14px; white-space:nowrap; z-index:10; font-weight:800; color:var(--teal); font-family:'Nunito',sans-serif; display:flex; align-items:center; height:100%;"><span style="margin-right:8px; font-size:18px; font-weight:900;">+</span> New entry</span>`;
        nr.style.cssText = "background:var(--row-new); border:none; width:max-content; min-width:100%; min-height:46px; cursor:pointer;";
        tblBody.appendChild(nr);
      }

      // Auto-trigger active inline entry/edit states
      restoreInlineState(tblBody);
    }

    // ── Expenses ──
    function renderExpenses(q = "") {
      const tblBody = document.getElementById("exp-tbl-body");
      captureInlineState(tblBody, "exp");
      const q2 = q.trim().toLowerCase();

      const storageKey = `np_pinned_${eventId}_exp`;
      const pE = JSON.parse(localStorage.getItem(storageKey) || "[]").map(id => String(id));

      let pinned = [];
      let unpinned = [];
      const sortedBase = applySortAndFilter(expenses, 'exp');
      sortedBase.forEach(item => {
        const id = String(item.id || item._id);
        const idx = pE.indexOf(id);
        if (idx !== -1) pinned.push({ item, idx });
        else unpinned.push(item);
      });
      pinned.sort((a, b) => a.idx - b.idx);
      const sorted = [...pinned.map(p => p.item), ...unpinned];

      const filtered = q2 ? sorted.filter(e => searchMatch(e, q2)) : sorted;
      const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      document.getElementById("exp-count").textContent = `${filtered.length} expense${filtered.length !== 1 ? "s" : ""}`;
      document.getElementById("exp-total").innerHTML = `Total: <span class="sum-r">${formatINR(total)}</span>`;

      if (!tblBody) return;
      tblBody.innerHTML = "";
      const customCols = eventData.expense_custom_columns || [];
      const hideExpDate = customCols.some(c => (typeof c === 'string' ? c : c.n) === '_sys_exp_date' && c.hidden);
      const hideExpAddBy = customCols.some(c => (typeof c === 'string' ? c : c.n) === '_sys_exp_colby' && c.hidden);
      const visibleCustomCols = customCols.filter(c => {
        const n = typeof c === 'string' ? c : c.n;
        return !n.startsWith('_sys_') && !(c.hidden === true);
      });

      // 1. Render Header Row
      const hdr = document.createElement("div");
      hdr.className = "tr hdr-row";
      
      let hdrHTML = `<div class="th sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('exp_desc', 140)}px;"><div style="width:14px; margin-right:4px; flex-shrink:0;"></div><div class="${isOrganizer ? 'sth-custom' : ''}" style="flex:1; text-align:left;" ${isOrganizer ? "onclick=\"openDefaultColW('Description', 'exp_desc')\"" : ''}>Description</div></div>
                   <div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_amt', 90)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Amount', 'exp_amt')\"" : ''}>Amount</div>`;
                   
      if (!hideExpDate) {
        hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_date', 100)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Date', 'exp_date')\"" : ''}>Date</div>`;
      }
      if (!hideExpAddBy) {
        hdrHTML += `<div class="th ${isOrganizer ? 'sth-custom' : ''}" style="width:${getColWidth('exp_colby', 130)}px;" ${isOrganizer ? "onclick=\"openDefaultColW('Added By', 'exp_colby')\"" : ''}>Added By</div>`;
      }
      
      hdr.innerHTML = hdrHTML;

      visibleCustomCols.forEach(col => {
        const colName = typeof col === "string" ? col : col.n;
        const colWidth = typeof col === "string" ? 180 : (col.w || 180);
        const div = document.createElement("div");
        div.className = "th" + (isOrganizer ? " sth-custom" : "");
        div.style.width = colWidth + "px";
        div.textContent = colName;
        if (isOrganizer) div.onclick = () => openEditCol(colName, "exp");
        hdr.appendChild(div);
      });
      tblBody.appendChild(hdr);

      // 2. Render Data Rows
      if (filtered.length) {
        document.getElementById("exp-empty-msg").style.display = "none";
        document.getElementById("exp-tbl-rot").closest('.scroll-list').classList.remove('is-empty');
        filtered.forEach((e, i) => {
          const row = document.createElement("div");
          row.className = "tr" + (i % 2 ? " alt" : "");
          row.setAttribute('data-id', e.id || e._id);

          const customCells = visibleCustomCols.map(col => {
            const colName = typeof col === "string" ? col : col.n;
            const colWidth = typeof col === "string" ? 180 : (col.w || 180);
            const val = (e.custom_fields && e.custom_fields[colName]) || "";
            return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
          }).join("");

          const pinned = isPinned("exp", e.id || e._id);
          
          let rowHTML = `
        <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('exp_desc', 140)}px;">
          <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
            ${pinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
          </div>
          <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${escHtml(e.description)}</div>
        </div>
        <div class="sc" style="width:${getColWidth('exp_amt', 90)}px;"><span class="cr">${e.amount ? formatINR(e.amount) : '₹0'}</span></div>`;
        
        if (!hideExpDate) {
          rowHTML += `<div class="sc" style="width:${getColWidth('exp_date', 100)}px;font-size:11px;">${formatDate(e.collected_at)}</div>`;
        }
        if (!hideExpAddBy) {
          rowHTML += `<div class="sc" style="width:${getColWidth('exp_colby', 130)}px;font-size:11px;" title="${escHtml(e.collected_by_name || "—")}">${escHtml(e.collected_by_name || "—")}</div>`;
        }
        
        rowHTML += `${customCells}`;
        row.innerHTML = rowHTML;
          row.addEventListener("contextmenu", ev => { ev.preventDefault(); openCtx(ev, "exp", e); });
          row.addEventListener("dblclick", ev => { openCtx(ev, "exp", e); });

          // Double tap simulation
          let lastTap = 0;
          row.addEventListener("touchend", ev => {
            const now = Date.now();
            if (now - lastTap < 300) {
              ev.preventDefault();
              const t = ev.changedTouches[0];
              openCtx({ clientX: t.clientX, clientY: t.clientY }, "exp", e);
            }
            lastTap = now;
          });
          tblBody.appendChild(row);
        });
      } else {
        const emptyMsg = document.getElementById("exp-empty-msg");
        emptyMsg.style.display = "block";
        document.getElementById("exp-tbl-rot").closest('.scroll-list').classList.add('is-empty');
        const btnHtml = isOrganizer && !q ? `<button class="btn btn-solid-primary" style="margin-top:12px; width:auto; padding:10px 24px;" onclick="openEntryForm('exp')">+ Add First Expense</button>` : "";
        emptyMsg.innerHTML = `<div class="empty-state" style="padding:40px 24px;">
      <div class="es-icon" style="margin-bottom:8px;">${q ? npIcon("search", { size: 32, tone: "muted" }) : npIcon("wallet", { size: 32, tone: "muted" })}</div>
      <div class="es-title" style="font-size:15px; font-weight:900;">${q ? 'No results found' : 'No expenses yet'}</div>
      <div class="es-sub" style="font-size:12px; opacity:0.7; max-width:220px; line-height:1.5;">${q ? 'Try a different search term.' : 'Stay on top of spending — add your first expense!'}</div>
      ${btnHtml}
    </div>`;
      }

      // 3. Render New Entry Row
      if (!isVisitor && (isOrganizer || (!isOrganizer && isActive))) {
        const nr = document.createElement("div");
        nr.className = "tr new-row";
        nr.onclick = () => openEntryForm("exp");
        // Clear children column structure
        nr.innerHTML = `<span style="position:sticky; left:14px; white-space:nowrap; z-index:10; font-weight:800; color:var(--teal); font-family:'Nunito',sans-serif; display:flex; align-items:center; height:100%;"><span style="margin-right:8px; font-size:18px; font-weight:900;">+</span> New entry</span>`;
        nr.style.cssText = "background:var(--row-new); border:none; width:max-content; min-width:100%; min-height:46px; cursor:pointer;";
        tblBody.appendChild(nr);
      }

      // Auto-trigger active inline entry/edit states
      restoreInlineState(tblBody);
    }

    // ── Summary ──
    let sumDateFilter = 'all'; // all, month, week, today
    let sumLimits = { don: 5, exp: 5, col: 5 };

    function filterByDate(list, filterType) {
      if (filterType === 'all') return list;
      const now = new Date();
      return list.filter(item => {
        if (!item.collected_at) return true;
        const dt = new Date(item.collected_at);
        if (filterType === 'today') {
           return dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
        }
        if (filterType === 'week') {
           const diff = now - dt;
           return diff <= 7 * 24 * 60 * 60 * 1000;
        }
        if (filterType === 'month') {
           return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
        }
        return true;
      });
    }

    function jumpToTabAndSearch(tab, query) {
      if (activeTheaterTab) {
        window.theaterSearchQuery = query;
        switchTheaterTab(tab, true);
        const topSearch = document.getElementById("theater-top-search");
        if (topSearch) topSearch.value = query;
      } else {
        switchTab(tab);
        const searchInput = document.getElementById(tab === 'don' ? 'don-search' : 'exp-search');
        if (searchInput) {
          searchInput.value = query;
          filterTable(tab, query);
        }
      }
    }

    async function renderSummary(mode = 0, containerId = "sum-body") { // 1: More, -1: Less
      if (mode === 1) vTxnsCount += 5;
      else if (mode === -1) vTxnsCount = 5;

      const fDon = filterByDate(donations, sumDateFilter);
      const fExp = filterByDate(expenses, sumDateFilter);

      const totalDonations = fDon.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
      const totalExpenses = fExp.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
      
      const recent = [...fDon.map(d => ({ ...d, type: 'donation', title: d.donor_name })), ...fExp.map(e => ({ ...e, type: 'expense', title: e.description }))]
        .sort((a, b) => new Date(b.collected_at || 0) - new Date(a.collected_at || 0));

      const dynamicSummary = {
        total_donations: totalDonations,
        total_expenses: totalExpenses,
        balance: totalDonations - totalExpenses,
        donations_count: fDon.length,
        expenses_count: fExp.length,
        recent_transactions: recent,
        fDon,
        fExp
      };

      renderSummaryUI(dynamicSummary, false, containerId);
    }

    function renderSummaryUI(data, isTheater, containerId) {
      const body = document.getElementById(containerId || "sum-body");
      const s = data;
      const bal = s.balance;
      const fDon = s.fDon || donations;
      const fExp = s.fExp || expenses;

      // Top Donors (Ranked)
      const donorTotals = {};
      fDon.forEach(d => {
        const name = d.donor_name;
        if (!donorTotals[name]) donorTotals[name] = 0;
        donorTotals[name] += (d.amount || 0);
      });
      const topDonorsAll = Object.entries(donorTotals).sort((a, b) => b[1] - a[1]);
      const topDonors = topDonorsAll.slice(0, sumLimits.don);
      const maxDon = topDonorsAll.length ? topDonorsAll[0][1] : 0;

      // Top Expenses (Ranked)
      const topExpensesAll = [...fExp].sort((a, b) => (b.amount || 0) - (a.amount || 0));
      const topExpenses = topExpensesAll.slice(0, sumLimits.exp);
      const maxExp = topExpensesAll.length ? topExpensesAll[0].amount : 0;

      const spendRatio = s.total_donations > 0 ? (s.total_expenses / s.total_donations) * 100 : 0;

      // Top Collectors (Ranked)
      const collectorTotals = {};
      fDon.forEach(d => {
        const name = d.collected_by_name || 'System';
        if (!collectorTotals[name]) collectorTotals[name] = 0;
        collectorTotals[name] += (d.amount || 0);
      });
      const topCollectorsAll = Object.entries(collectorTotals).sort((a, b) => b[1] - a[1]);
      const topCollectors = topCollectorsAll.slice(0, sumLimits.col);
      const maxCol = topCollectorsAll.length ? topCollectorsAll[0][1] : 0;

      // Table visibility flags
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;

      const filterUI = `
        <div style="display:flex; justify-content:center; gap:8px; margin-bottom:15px; padding:0 10px;">
          ${['all', 'month', 'week', 'today'].map(f => `
            <button onclick="sumDateFilter='${f}'; renderSummary(0, '${containerId}');" 
              style="padding:6px 14px; border-radius:20px; border:1px solid ${sumDateFilter === f ? 'var(--primary)' : 'var(--border2)'}; 
              background:${sumDateFilter === f ? 'var(--primary)' : 'var(--surface)'}; 
              color:${sumDateFilter === f ? 'white' : 'var(--text2)'}; 
              font-size:11px; font-weight:800; cursor:pointer; text-transform:uppercase; transition:all 0.2s; box-shadow:${sumDateFilter === f ? '0 4px 10px rgba(0,0,0,0.1)' : 'none'};">
              ${f}
            </button>
          `).join("")}
        </div>
      `;

      const html = `
      <div style="padding: 10px; max-width: 500px; margin: 0 auto;">
        ${filterUI}
        <!-- Available Balance -->
        <div style="background:var(--primary-dk); border-radius:18px; padding:20px; margin-bottom:12px; color:white; box-shadow:0 10px 20px -5px rgba(0,0,0,0.3); text-align:center;">
          <div style="font-size:12px; font-weight:800; opacity:0.8; text-transform:uppercase; letter-spacing:1px;">Available Balance</div>
          <div style="font-size:32px; font-weight:900; margin:4px 0;">${formatINR(Math.abs(bal))}</div>
          <div style="font-size:11px; font-weight:700; opacity:0.9; display:flex; align-items:center; gap:4px; justify-content:center;">${bal >= 0 ? npIcon("check", { size: 12, tone: "green" }) + " SURPLUS STATUS" : npIcon("alert-triangle", { size: 12, tone: "red" }) + " DEFICIT ALERT"} · REAL-TIME</div>
        </div>

        <div class="stats" style="display:flex; gap:10px; margin-bottom:12px;">
          ${showDon ? `<div style="flex:1; background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:12px; text-align:center; position:relative; padding-bottom:18px;">
            <div style="font-size:11px; font-weight:800; color:var(--text3);">COLLECTED</div>
            <div style="font-size:16px; font-weight:900; color:var(--green);">${formatINR(s.total_donations)}</div>
            <div style="position:absolute; bottom:6px; left:12px; font-size:9px; font-weight:800; color:var(--text3); opacity:0.6;">${s.donations_count} donors</div>
          </div>` : ''}
          ${showExp ? `<div style="flex:1; background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:12px; text-align:center; position:relative; padding-bottom:18px;">
            <div style="font-size:11px; font-weight:800; color:var(--text3);">SPENT</div>
            <div style="font-size:16px; font-weight:900; color:var(--red);">${formatINR(s.total_expenses)}</div>
            <div style="position:absolute; bottom:6px; left:12px; font-size:9px; font-weight:800; color:var(--text3); opacity:0.6;">${s.expenses_count} expenses</div>
          </div>` : ''}
        </div>

        <div class="sum-grid" style="display:flex; flex-direction:column; gap:10px;">
          <!-- Spending Efficiency (only if both tables are visible) -->
          ${(showDon && showExp) ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">Spending Ratio</span>
              <span style="font-size:12px; font-weight:800; color:var(--primary);">${spendRatio.toFixed(1)}%</span>
            </div>
            <div style="height:8px; background:var(--surf-var); border-radius:10px; overflow:hidden;">
              <div style="height:100%; width:${Math.min(spendRatio, 100)}%; background:${spendRatio > 90 ? 'var(--red)' : spendRatio > 50 ? 'var(--amber)' : 'var(--green)'}; border-radius:10px;"></div>
            </div>
          </div>` : ''}

          <!-- Top Collectors (only if donations visible) -->
          ${showDon ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">Top Collectors</span>
              <span>${npIcon("users", { size: 14 })}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topCollectors.length ? topCollectors.map((c, i) => {
                const pct = maxCol ? (c[1]/maxCol)*100 : 0;
                return `
                <div onclick="jumpToTabAndSearch('don', '${escHtml(c[0]).replace(/'/g, "\\'")}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:linear-gradient(90deg, rgba(59, 130, 246, 0.15) ${pct}%, transparent ${pct}%); border-radius:10px; border:1px solid var(--border2); transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px; align-items:center;">
                    <span style="opacity:0.4; font-size:11px;">${i + 1}</span> <span>${escHtml(c[0])}</span>
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--primary);">${c[1] ? formatINR(c[1]) : '₹0'}</div>
                </div>
              `}).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No collections yet</div>'}
              ${topCollectorsAll.length > sumLimits.col ? `<div onclick="sumLimits.col+=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--primary); padding:8px; cursor:pointer;">Show More</div>` : ''}
              ${sumLimits.col > 5 ? `<div onclick="sumLimits.col=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--text3); padding:8px; cursor:pointer;">Show Less</div>` : ''}
            </div>
          </div>` : ''}

          <!-- Top Donors (only if donations visible) -->
          ${showDon ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">Top Donors</span>
              <span>${npIcon("heart", { size: 14 })}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topDonors.length ? topDonors.map((d, i) => {
                const pct = maxDon ? (d[1]/maxDon)*100 : 0;
                return `
                <div onclick="jumpToTabAndSearch('don', '${escHtml(d[0]).replace(/'/g, "\\'")}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:linear-gradient(90deg, rgba(16, 185, 129, 0.15) ${pct}%, transparent ${pct}%); border-radius:10px; border:1px solid var(--border2); transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px; align-items:center;">
                    <span style="opacity:0.4; font-size:11px;">${i + 1}</span> <span>${escHtml(d[0])}</span>
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--green);">${d[1] ? formatINR(d[1]) : '₹0'}</div>
                </div>
              `}).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No donations yet</div>'}
              ${topDonorsAll.length > sumLimits.don ? `<div onclick="sumLimits.don+=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--primary); padding:8px; cursor:pointer;">Show More</div>` : ''}
              ${sumLimits.don > 5 ? `<div onclick="sumLimits.don=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--text3); padding:8px; cursor:pointer;">Show Less</div>` : ''}
            </div>
          </div>` : ''}

          <!-- High Outflows (only if expenses visible) -->
          ${showExp ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">High Outflows</span>
              <span>${npIcon("wallet", { size: 14 })}</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topExpenses.length ? topExpenses.map((exp, i) => {
                const pct = maxExp ? (exp.amount/maxExp)*100 : 0;
                return `
                <div onclick="jumpToTabAndSearch('exp', '${escHtml(exp.description).replace(/'/g, "\\'")}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:linear-gradient(90deg, rgba(239, 68, 68, 0.15) ${pct}%, transparent ${pct}%); border-radius:10px; border:1px solid var(--border2); transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px; align-items:center;">
                    <span style="opacity:0.4; font-size:11px;">${i + 1}</span> <span>${escHtml(exp.description)}</span>
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--red);">${exp.amount ? formatINR(exp.amount) : '₹0'}</div>
                </div>
              `}).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No expenses yet</div>'}
              ${topExpensesAll.length > sumLimits.exp ? `<div onclick="sumLimits.exp+=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--primary); padding:8px; cursor:pointer;">Show More</div>` : ''}
              ${sumLimits.exp > 5 ? `<div onclick="sumLimits.exp=5; renderSummary(0, '${containerId}');" style="text-align:center; font-size:11px; font-weight:800; color:var(--text3); padding:8px; cursor:pointer;">Show Less</div>` : ''}
            </div>
          </div>` : ''}
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin:20px 0 10px; padding:0 4px;">
          <div style="font-size:15px; font-weight:900; color:var(--text);">Activity Feed</div>
          <div style="font-size:11px; font-weight:800; color:var(--text3);">LOG: ${s.recent_transactions.length} ITEMS</div>
        </div>

        <div style="background:var(--card); border:1.5px solid var(--border2); border-radius:20px; overflow:hidden; margin-bottom:15px; box-shadow:var(--shadow-sm);">
          ${s.recent_transactions.slice(0, vTxnsCount).map((t, i) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; border-bottom:1px solid var(--border2); background:${i % 2 ? 'var(--row-alt)' : 'transparent'}">
              <div style="display:flex; gap:12px; align-items:center;">
                <div style="width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:16px; background:${t.type === 'donation' ? 'var(--primary-lt)' : 'rgba(239, 68, 68, 0.1)'}; color:${t.type === 'donation' ? 'var(--primary-dk)' : 'var(--red)'};">
                  ${t.type === 'donation' ? '↓' : '↑'}
                </div>
                <div>
                  <div style="font-size:13.5px; font-weight:850; color:var(--text);">${escHtml(t.title)}</div>
                  <div style="font-size:10px; font-weight:700; color:var(--text3);">${formatDate(t.date).toUpperCase()} · ${escHtml(t.collected_by_name || 'SYSTEM')}</div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:14px; font-weight:900; color:${t.type === 'donation' ? 'var(--green)' : 'var(--red)'};">
                  ${t.type === 'donation' ? '+' : '-'}${t.amount ? formatINR(t.amount) : '₹0'}
                </div>
                <div style="font-size:9px; font-weight:800; color:var(--text3);">${t.type.toUpperCase()}</div>
              </div>
            </div>
          `).join("")}
          
          <div>
            ${s.recent_transactions.length > vTxnsCount ? `
              <div onclick="renderSummary(1, '${containerId}')" style="text-align:center; font-size:11px; font-weight:800; color:var(--primary); padding:8px; cursor:pointer;">Show More</div>
            ` : ""}
            ${vTxnsCount > 5 ? `
              <div onclick="renderSummary(-1, '${containerId}')" style="text-align:center; font-size:11px; font-weight:800; color:var(--text3); padding:8px; cursor:pointer;">Show Less</div>
            ` : ""}
          </div>
        </div>
        <div style="height:20px;"></div>
      </div>
    `;
      if (body) body.innerHTML = html;
    }


    function filterTable(type, q) { type === "don" ? renderDonations(q) : renderExpenses(q); }

    // ── Entry Form ──
    let entryType = "don";
    let activeInlineAddType = null;
    let activeInlineEditType = null;
    let activeInlineEditId = null;

    function restoreNewRowBtn(tblBody, type) {
      try {
        const nr = tblBody.querySelector('.new-row');
        if (nr) {
          nr.onclick = () => openEntryForm(type);
          nr.style.cursor = "pointer";
          nr.style.background = "var(--row-new)";
          nr.style.border = "none";
          nr.style.width = "max-content";
          nr.style.minWidth = "100%";
          nr.style.minHeight = "46px";
          nr.innerHTML = `<span style="position:sticky; left:14px; white-space:nowrap; z-index:10; font-weight:800; color:var(--teal); font-family:'Nunito',sans-serif; display:flex; align-items:center; height:100%;"><span style="margin-right:8px; font-size:18px; font-weight:900;">+</span> New entry</span>`;
        }
      } catch (e) {
        console.error("Error in restoreNewRowBtn:", e);
      }
    }

    // --- INLINE EDITING FOR THEATER MODE ---
    function renderInlineEntryForm(type, scroll = true) {
      console.log(`[debug] renderInlineEntryForm: type=${type}, scroll=${scroll}, activeInlineAddType=${activeInlineAddType}`);
      activeInlineAddType = type;
      const isDon = type === 'don';
      let tblBody;
      if (activeTheaterTab) {
        const rotContainer = document.getElementById('rot-ov-body');
        if (!rotContainer) return;
        tblBody = rotContainer.querySelector('.tbl-body-rows');
        if (!tblBody) return; // fail gracefully if table isn't fully rendered
      } else {
        tblBody = document.getElementById(isDon ? 'don-tbl-body' : 'exp-tbl-body');
      }
      if (!tblBody) return;

      // Hide empty state overlay when editing/adding inline
      const scrollList = tblBody.closest('.scroll-list');
      if (scrollList) {
        scrollList.classList.remove('is-empty');
        const emptyMsg = scrollList.querySelector(isDon ? '#don-empty-msg' : '#exp-empty-msg');
        if (emptyMsg) emptyMsg.style.display = 'none';
      }

      // Prevent duplicate inline forms
      if (tblBody.querySelector('.inline-entry-row')) {
        const existingInput = tblBody.querySelector('.inline-entry-row .inl-str-val');
        if (existingInput) existingInput.focus();
        return;
      }

      const customCols = isDon ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);

      const hideDate = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_date" : "_sys_exp_date") && c.hidden);
      const hideColBy = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_colby" : "_sys_exp_colby") && c.hidden);
      const hideAmt = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_amt" : "_sys_exp_amt") && c.hidden);

      const tr = document.createElement('div');
      tr.className = 'tr inline-entry-row';
      tr.style.background = 'var(--surf-var)';
      tr.style.position = 'relative';

      let html = `
          <div class="fc sticky-col" style="display:flex !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(isDon ? 'don_name' : 'exp_desc', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0;"></div>
            <div style="position:relative; width:100%; display:flex; align-items:center; height:100%;">
              <input type="search" name="notepay_entry_val1" class="inline-input inl-str-val" placeholder="${isDon ? 'Donor' : 'Description'}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 22px 0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0; display:block;" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" inputmode="text" readonly onfocus="this.removeAttribute('readonly');">
              <span style="position:absolute; right:6px; top:50%; transform:translateY(-50%); color:var(--red); font-weight:bold; pointer-events:none;">*</span>
            </div>
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_amt' : 'exp_amt', 90)}px; display:${hideAmt ? 'none !important' : 'flex'}; align-items:center;">
            <input type="search" class="inline-input inl-amt-input" placeholder="Amount" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0; display:block;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="decimal" readonly onfocus="this.removeAttribute('readonly');">
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_date' : 'exp_date', 100)}px; display:${hideDate ? 'none !important' : 'flex'}; align-items:center;">
            <span style="font-size:11px; opacity:0.5;">Auto</span>
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_colby' : 'exp_colby', 130)}px; display:${hideColBy ? 'none !important' : 'flex'}; align-items:center;">
            <span style="font-size:11px; opacity:0.5;">You</span>
          </div>
      `;

      customCols.forEach(col => {
        const colName = typeof col === "string" ? col : col.n;
        if (colName.startsWith("_sys_")) return;
        const colWidth = typeof col === "string" ? 180 : (col.w || 180);
        const isHidden = typeof col === "object" && col.hidden;
        html += `<div class="sc" style="width:${colWidth}px; display:${isHidden ? 'none !important' : 'flex'}; align-items:center;">
          <input type="search" class="inline-input inl-custom" data-col="${escHtml(colName)}" placeholder="${escHtml(colName)}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0; display:block;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text">
        </div>`;
      });

      tr.innerHTML = html;

      const newRowBtn = tblBody.querySelector('.new-row');
      if (newRowBtn) {
        tblBody.insertBefore(tr, newRowBtn);

        // Inject actions into the existing newRowBtn!
        newRowBtn.onclick = null;
        newRowBtn.style.cursor = "default";
        newRowBtn.innerHTML = `<span style="position:sticky; left:50%; transform:translateX(-50%); white-space:nowrap; z-index:10; display:flex; gap:8px; align-items:center;">
              <button class="btn btn-text-secondary" onclick="event.stopPropagation(); cancelInlineEntry(this, '${type}')" style="padding:4px 14px; font-size:12px; background:var(--surface); border:1px solid var(--border2); height:28px; white-space:nowrap;">Cancel</button>
              <button class="btn btn-solid-primary" onclick="event.stopPropagation(); submitInlineEntry('${type}', this)" style="padding:4px 18px; font-size:12px; height:28px; box-shadow:0 4px 10px rgba(0,0,0,0.15); white-space:nowrap;">Save</button>
          </span>`;
      } else {
        tblBody.appendChild(tr);
      }

      // Bind focus events to auto-scroll
      tr.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('focus', () => {
          setTimeout(() => {
            const target = newRowBtn || tr;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 350);
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (newRowBtn) {
              const saveBtn = newRowBtn.querySelector('.btn-solid-primary');
              if (saveBtn) {
                e.stopPropagation();
                submitInlineEntry(type, saveBtn);
              }
            }
          } else if (e.key === 'ArrowRight') {
            let atEnd = false;
            try { atEnd = (e.target.type === 'number') ? true : (e.target.selectionStart === e.target.value.length); } catch(err) { atEnd = true; }
            if (atEnd) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const idx = inputs.indexOf(e.target);
              if (idx > -1 && idx < inputs.length - 1) {
                e.preventDefault();
                inputs[idx + 1].focus();
              }
            }
          } else if (e.key === 'ArrowLeft') {
            let atStart = false;
            try { atStart = (e.target.type === 'number') ? true : (e.target.selectionStart === 0); } catch(err) { atStart = true; }
            if (atStart) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const idx = inputs.indexOf(e.target);
              if (idx > 0) {
                e.preventDefault();
                inputs[idx - 1].focus();
              }
            }
          }
        });
      });

      setTimeout(() => {
        const input = tr.querySelector('.inl-str-val');
        if (input) input.focus();
        
        if (scroll) {
          setTimeout(() => {
            const target = newRowBtn || tr;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 350);
        }
      }, 50);
    }

    async function submitInlineEntry(type, btn, skipDupCheck = false) {
      console.log(`[debug] submitInlineEntry: type=${type}, activeInlineAddType=${activeInlineAddType}`);
      const nr = btn.closest('.new-row');
      const tblBody = nr.parentElement;
      const row = tblBody.querySelector('.inline-entry-row');
      if (!row) return;

      const nameInput = row.querySelector('.inl-str-val');
      const amtInput = row.querySelector('.inl-amt-input');
      const name = nameInput.value.trim();
      const amt = amtInput.value;
      const isDon = type === 'don';

      if (!name) {
        nameInput.style.borderColor = 'var(--red)';
        return;
      }

      // Duplicate Check
      if (!skipDupCheck) {
        let existing = null;
        if (isDon) {
          existing = donations.find(d => d.donor_name.toLowerCase() === name.toLowerCase());
        } else {
          existing = expenses.find(e => e.description.toLowerCase() === name.toLowerCase());
        }
        if (existing) {
          const existingName = isDon ? existing.donor_name : existing.description;
          openDupPop(() => submitInlineEntry(type, btn, true), existingName, existing.amount, type);
          return;
        }
      }

      const customInputs = row.querySelectorAll('.inl-custom');
      const customFields = {};
      customInputs.forEach(inp => {
        if (inp.value.trim()) {
          customFields[inp.getAttribute('data-col')] = inp.value.trim();
        }
      });

      // CRITICAL: Focus the name input IMMEDIATELY (before await)
      // Mobile browsers only allow .focus() inside a synchronous user-gesture.
      // After await, the gesture context is lost and keyboard closes.
      nameInput.focus();

      btn.disabled = true;
      btn.textContent = 'Saving...';

      window._ignoreNextWsUpdate = Date.now();

      try {
        let newEntry;
        if (isDon) {
          newEntry = await addDonation(eventId, name, amt ? parseFloat(amt) : null, customFields);
          donations.push(newEntry);

          // Silent Update Totals & Counts
          const total = donations.reduce((s, d) => s + (d.amount || 0), 0);
          document.getElementById("don-count").textContent = `${donations.length} donor${donations.length !== 1 ? "s" : ""}`;
          document.getElementById("don-total").innerHTML = `Total: <span class="sum-g">${formatINR(total)}</span>`;
        } else {
          newEntry = await addExpense(eventId, name, amt ? parseFloat(amt) : null, customFields);
          expenses.push(newEntry);

          // Silent Update Totals & Counts
          const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
          document.getElementById("exp-count").textContent = `${expenses.length} expense${expenses.length !== 1 ? "s" : ""}`;
          document.getElementById("exp-total").innerHTML = `Total: <span class="sum-r">${formatINR(total)}</span>`;
        }

        // 1. Build and insert the new read-only row immediately above the input form row!
        const newRowDom = document.createElement("div");
        newRowDom.className = "tr" + ((isDon ? donations.length : expenses.length) % 2 ? " alt" : "");
        newRowDom.setAttribute('data-id', newEntry.id || newEntry._id);

        const customCols = isDon ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);
        const customCells = customCols.map(col => {
          const colName = typeof col === "string" ? col : col.n;
          const colWidth = typeof col === "string" ? 180 : (col.w || 180);
          const val = (newEntry.custom_fields && newEntry.custom_fields[colName]) || "";
          return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
        }).join("");

        newRowDom.innerHTML = `
            <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(isDon ? 'don_name' : 'exp_desc', 140)}px;">
              <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;"></div>
              <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${escHtml(isDon ? newEntry.donor_name : newEntry.description)}</div>
            </div>
            <div class="sc" style="width:${getColWidth(isDon ? 'don_amt' : 'exp_amt', 90)}px;"><span class="${isDon ? 'cg' : 'cr'}">${newEntry.amount ? formatINR(newEntry.amount) : '₹0'}</span></div>
            <div class="sc" style="width:${getColWidth(isDon ? 'don_date' : 'exp_date', 100)}px;font-size:11px;">${formatDate(newEntry.collected_at)}</div>
            <div class="sc" style="width:${getColWidth(isDon ? 'don_colby' : 'exp_colby', 130)}px;font-size:11px;" title="${escHtml(newEntry.collected_by_name || "—")}">${escHtml(newEntry.collected_by_name || "—")}</div>
            ${customCells}
          `;
        newRowDom.addEventListener("contextmenu", ev => { ev.preventDefault(); openCtx(ev, type, newEntry); });
        newRowDom.addEventListener("dblclick", ev => { openCtx(ev, type, newEntry); });

        let lastTap = 0;
        newRowDom.addEventListener("touchend", ev => {
          const now = Date.now();
          if (now - lastTap < 300) {
            ev.preventDefault();
            const t = ev.changedTouches[0];
            openCtx({ clientX: t.clientX, clientY: t.clientY }, type, newEntry);
          }
          lastTap = now;
        });

        // Insert directly above the input form row!
        tblBody.insertBefore(newRowDom, row);

        // 2. Clear inputs in the active row to prepare for next consecutive add
        nameInput.value = "";
        amtInput.value = "";
        customInputs.forEach(inp => inp.value = "");

        // 3. Re-enable Save button
        btn.disabled = false;
        btn.textContent = 'Save';

        // 4. The keyboard is already open (we focused before await).
        // Re-focus just in case the browser reset it during DOM updates.
        nameInput.focus();

        // 5. Invalidate caches (DATA_CHANGED websocket event will handle fetching fresh data)
        summaryData = null;
        updateTheaterStats();

      } catch (e) {
        alert("Error saving: " + e.message);
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    }

    function renderInlineEditForm(type, d, origRow) {
      activeInlineEditType = type;
      activeInlineEditId = String(d.id || d._id);
      const isDon = type === 'don';
      let tblBody;
      if (activeTheaterTab) {
        const rotContainer = document.getElementById('rot-ov-body');
        if (!rotContainer) return;
        tblBody = rotContainer.querySelector('.tbl-body-rows');
      } else {
        tblBody = document.getElementById(isDon ? 'don-tbl-body' : 'exp-tbl-body');
      }
      if (tblBody && tblBody.querySelector('.inline-entry-row')) {
        const existingInput = tblBody.querySelector('.inline-entry-row .inl-str-val');
        if (existingInput) existingInput.focus();
        return;
      }

      const customCols = isDon ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);

      const hideDate = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_date" : "_sys_exp_date") && c.hidden);
      const hideColBy = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_colby" : "_sys_exp_colby") && c.hidden);
      const hideAmt = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_amt" : "_sys_exp_amt") && c.hidden);

      const tr = document.createElement('div');
      tr.className = 'tr inline-entry-row';
      tr.style.background = 'var(--surf-var)';
      tr.style.position = 'relative';

      const nm = escHtml(isDon ? d.donor_name : d.description);
      const am = d.amount ? d.amount : '';

      let html = `
          <div class="fc sticky-col" style="display:flex !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(isDon ? 'don_name' : 'exp_desc', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0;"></div>
            <div style="position:relative; width:100%; display:flex; align-items:center; height:100%;">
              <input type="search" name="notepay_edit_val1" class="inline-input inl-str-val" value="${nm}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 22px 0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0;" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" inputmode="text" readonly onfocus="this.removeAttribute('readonly');">
              <span style="position:absolute; right:6px; top:50%; transform:translateY(-50%); color:var(--red); font-weight:bold; pointer-events:none;">*</span>
            </div>
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_amt' : 'exp_amt', 90)}px; display:${hideAmt ? 'none !important' : 'flex'}; align-items:center;">
            <input type="search" class="inline-input inl-amt-input" value="${am}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="decimal" readonly onfocus="this.removeAttribute('readonly');">
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_date' : 'exp_date', 100)}px; display:${hideDate ? 'none !important' : 'flex'}; align-items:center;">
            <span style="font-size:11px; opacity:0.5;">${formatDate(d.collected_at)}</span>
          </div>
          <div class="sc" style="width:${getColWidth(isDon ? 'don_colby' : 'exp_colby', 130)}px; display:${hideColBy ? 'none !important' : 'flex'}; align-items:center;">
            <span style="font-size:11px; opacity:0.5;">${escHtml(d.collected_by_name || '—')}</span>
          </div>
      `;

      customCols.forEach(col => {
        const colName = typeof col === "string" ? col : col.n;
        if (colName.startsWith("_sys_")) return;
        const colWidth = typeof col === "string" ? 180 : (col.w || 180);
        const isHidden = typeof col === "object" && col.hidden;
        const cv = (d.custom_fields && d.custom_fields[colName]) ? escHtml(d.custom_fields[colName]) : '';
        html += `<div class="sc" style="width:${colWidth}px; display:${isHidden ? 'none !important' : 'flex'}; align-items:center;">
          <input type="search" class="inline-input inl-custom" data-col="${escHtml(colName)}" value="${cv}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text">
        </div>`;
      });

      tr.innerHTML = html;

      origRow.style.display = 'none';
      tr._origRow = origRow;
      const newRowBtn = tblBody.querySelector('.new-row');
      if (newRowBtn) {
        tblBody.insertBefore(tr, newRowBtn);

        // Inject actions into newRowBtn!
        newRowBtn.onclick = null;
        newRowBtn.style.cursor = "default";
        newRowBtn.innerHTML = `<span style="position:sticky; left:50%; transform:translateX(-50%); white-space:nowrap; z-index:10; display:flex; gap:8px; align-items:center;">
              <button class="btn btn-text-secondary" onclick="event.stopPropagation(); cancelInlineEdit(this, '${type}')" style="padding:4px 14px; font-size:12px; background:var(--surface); border:1px solid var(--border2); height:28px; white-space:nowrap;">Cancel</button>
              <button class="btn btn-solid-primary" onclick="event.stopPropagation(); submitInlineEdit('${type}', '${String(d.id || d._id)}', this)" style="padding:4px 18px; font-size:12px; height:28px; box-shadow:0 4px 10px rgba(0,0,0,0.15); white-space:nowrap;">Save</button>
          </span>`;
      } else {
        tblBody.appendChild(tr);
      }

      // Bind focus events to auto-scroll
      tr.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('focus', () => {
          setTimeout(() => {
            const target = newRowBtn || tr;
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 350);
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (newRowBtn) {
              const saveBtn = newRowBtn.querySelector('.btn-solid-primary');
              if (saveBtn) {
                e.stopPropagation();
                submitInlineEdit(type, String(d.id || d._id), saveBtn);
              }
            }
          } else if (e.key === 'ArrowRight') {
            let atEnd = false;
            try { atEnd = (e.target.type === 'number') ? true : (e.target.selectionStart === e.target.value.length); } catch(err) { atEnd = true; }
            if (atEnd) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const idx = inputs.indexOf(e.target);
              if (idx > -1 && idx < inputs.length - 1) {
                e.preventDefault();
                inputs[idx + 1].focus();
              }
            }
          } else if (e.key === 'ArrowLeft') {
            let atStart = false;
            try { atStart = (e.target.type === 'number') ? true : (e.target.selectionStart === 0); } catch(err) { atStart = true; }
            if (atStart) {
              const inputs = Array.from(tr.querySelectorAll('input'));
              const idx = inputs.indexOf(e.target);
              if (idx > 0) {
                e.preventDefault();
                inputs[idx - 1].focus();
              }
            }
          }
        });
      });

      setTimeout(() => {
        const input = tr.querySelector('.inl-str-val');
        if (input) {
          input.focus();
          try {
            const len = input.value.length;
            input.setSelectionRange(len, len);
          } catch(e){}
        }
        setTimeout(() => {
          const target = newRowBtn || tr;
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 350);
      }, 50);
    }

    function cancelInlineEdit(btn, type) {
      try {
        // Find tblBody from btn OR from activeInlineEditType (robust fallback)
        let tblBody = null;
        if (btn) {
          const nr = btn.closest('.new-row');
          if (nr) tblBody = nr.parentElement;
        }
        if (!tblBody) {
          // Fallback: find by type
          if (activeTheaterTab) {
            const rc = document.getElementById('rot-ov-body');
            tblBody = rc ? rc.querySelector('.tbl-body-rows') : null;
          } else {
            tblBody = document.getElementById(type === 'don' ? 'don-tbl-body' : 'exp-tbl-body');
          }
        }
        if (tblBody) {
          const row = tblBody.querySelector('.inline-entry-row');
          if (row) {
            if (row._origRow) row._origRow.style.display = '';
            row.remove();
          }
          restoreNewRowBtn(tblBody, type);
        }
        activeInlineEditType = null;
        activeInlineEditId = null;
        if (tblBody) restoreInlineState(tblBody, true);
      } catch (e) {
        console.error("Error in cancelInlineEdit:", e);
      }
    }

    function cancelInlineEntry(btn, type) {
      try {
        // Find tblBody robustly from btn OR from type
        let tblBody = null;
        if (btn) {
          const nr = btn.closest('.new-row');
          if (nr) tblBody = nr.parentElement;
        }
        if (!tblBody) {
          if (activeTheaterTab) {
            const rc = document.getElementById('rot-ov-body');
            tblBody = rc ? rc.querySelector('.tbl-body-rows') : null;
          } else {
            tblBody = document.getElementById(type === 'don' ? 'don-tbl-body' : 'exp-tbl-body');
          }
        }
        if (tblBody) {
          const row = tblBody.querySelector('.inline-entry-row');
          if (row) row.remove();
          restoreNewRowBtn(tblBody, type);

          const isDon = type === 'don';
          const items = isDon ? donations : expenses;
          if (items.length === 0) {
            const scrollList = tblBody.closest('.scroll-list');
            if (scrollList) {
              scrollList.classList.add('is-empty');
              const emptyMsg = scrollList.querySelector(isDon ? '#don-empty-msg' : '#exp-empty-msg');
              if (emptyMsg) emptyMsg.style.display = 'block';
            }
          }
        }
        activeInlineAddType = null;
      } catch (e) {
        console.error("Error in cancelInlineEntry:", e);
      }
    }

    async function submitInlineEdit(type, id, btn, skipDupCheck = false) {
      // Find tblBody robustly — do NOT rely on btn.closest() which breaks with detached nodes
      let tblBody = null;
      if (btn) {
        const nr = btn.closest('.new-row');
        if (nr) tblBody = nr.parentElement;
      }
      if (!tblBody) {
        if (activeTheaterTab) {
          const rc = document.getElementById('rot-ov-body');
          tblBody = rc ? rc.querySelector('.tbl-body-rows') : null;
        } else {
          tblBody = document.getElementById(type === 'don' ? 'don-tbl-body' : 'exp-tbl-body');
        }
      }
      if (!tblBody) return;

      const row = tblBody.querySelector('.inline-entry-row');
      if (!row) return;
      const name = row.querySelector('.inl-str-val').value.trim();
      const amt = row.querySelector('.inl-amt-input').value;
      const isDon = type === 'don';

      if (!name) {
        row.querySelector('.inl-str-val').style.borderColor = 'var(--red)';
        return;
      }

      // Duplicate Check (excluding current entry)
      if (!skipDupCheck) {
        let existing = null;
        const currentIdStr = String(id);
        if (isDon) {
          existing = donations.find(d => String(d.id || d._id) !== currentIdStr && d.donor_name.toLowerCase().trim() === name.toLowerCase().trim());
        } else {
          existing = expenses.find(e => String(e.id || e._id) !== currentIdStr && e.description.toLowerCase().trim() === name.toLowerCase().trim());
        }
        if (existing) {
          const existingName = type === "don" ? existing.donor_name : existing.description;
          openDupPop(() => submitInlineEdit(type, id, btn, true), existingName, existing.amount, type);
          return;
        }
      }

      const customInputs = row.querySelectorAll('.inl-custom');
      const customFields = {};
      customInputs.forEach(inp => {
        if (inp.value.trim()) {
          customFields[inp.getAttribute('data-col')] = inp.value.trim();
        }
      });

      if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

      window._ignoreNextWsUpdate = Date.now();

      try {
        let updatedEntry = null;
        if (isDon) {
          updatedEntry = await updateDonation(eventId, id, { donor_name: name, amount: amt ? parseFloat(amt) : null, custom_fields: customFields });
          const idx = donations.findIndex(d => String(d.id || d._id) === id);
          if (idx !== -1) donations[idx] = updatedEntry;
        } else {
          updatedEntry = await updateExpense(eventId, id, { description: name, amount: amt ? parseFloat(amt) : null, custom_fields: customFields });
          const idx = expenses.findIndex(e => String(e.id || e._id) === id);
          if (idx !== -1) expenses[idx] = updatedEntry;
        }

        // 1. Restore the original row and update its DOM values locally to prevent blinking
        if (row._origRow) {
          const oRow = row._origRow;
          oRow.style.display = '';
          const nameEl = oRow.querySelector('.fc div:last-child');
          if (nameEl) nameEl.textContent = isDon ? updatedEntry.donor_name : updatedEntry.description;
          
          const amtEl = oRow.querySelector('.sc:nth-child(2) span');
          if (amtEl) {
            amtEl.className = isDon ? 'cg' : 'cr';
            amtEl.innerHTML = updatedEntry.amount ? formatINR(updatedEntry.amount) : '₹0';
          }
        }
        
        // 2. Remove the inline edit form row and restore the Add button
        row.remove();
        restoreNewRowBtn(tblBody, type);

        // 3. Clear edit state
        activeInlineEditType = null;
        activeInlineEditId = null;
        
        restoreInlineState(tblBody, true);

        // 4. Update the totals in Theater Mode locally
        summaryData = null;
        updateTheaterStats();

        // 5. The DATA_CHANGED websocket event will handle fetching fresh data automatically.

      } catch (e) {
        alert("Error saving: " + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      }
    }

    function openEntryForm(type) {
      renderInlineEntryForm(type);
    }
    function closeEntryForm() { document.getElementById("entry-form-ov").style.display = "none"; }

    async function saveEntry(skipDupCheck = false, keepOpen = false) {
      const name = document.getElementById("ef-name").value.trim();
      const amount = document.getElementById("ef-amount").value;
      const btn = keepOpen ? document.getElementById("ef-save-next-btn") : document.getElementById("ef-save-btn");
      if (!name) {
        const err = document.getElementById("ef-error");
        err.textContent = entryType === "don" ? "Donor name is required." : "Description is required.";
        err.style.display = "block";
        document.getElementById("ef-name").focus();
        return;
      }

      const customFields = {};
      document.querySelectorAll("#ef-custom-fields .dynamic-cf").forEach(inp => {
        customFields[inp.dataset.col] = inp.value.trim();
      });

      // Duplicate Check
      if (!skipDupCheck) {
        const amtVal = amount ? parseFloat(amount) : null;
        let existing = null;
        if (entryType === "don") {
          existing = donations.find(d => d.donor_name.toLowerCase() === name.toLowerCase());
        } else {
          existing = expenses.find(e => e.description.toLowerCase() === name.toLowerCase());
        }
        if (existing) {
          const existingName = entryType === "don" ? existing.donor_name : existing.description;
          openDupPop(() => saveEntry(true, keepOpen), existingName, existing.amount, entryType);
          return;
        }
      }

      btn.disabled = true; btn.textContent = "Saving…";
      try {
        if (entryType === "don") {
          const d = await addDonation(eventId, name, amount || null, customFields);
          donations.push(d);
          renderDonations();
        } else {
          const e = await addExpense(eventId, name, amount || null, customFields);
          expenses.push(e);
          renderExpenses();
        }
        summaryData = null; // Invalidate cache
        clearEventCache();
        updateTheaterStats();
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab, true);

        if (keepOpen) {
          // Clear inputs and keep focused
          document.getElementById("ef-name").value = "";
          document.getElementById("ef-amount").value = "";
          document.querySelectorAll("#ef-custom-fields .dynamic-cf").forEach(inp => inp.value = "");
          document.getElementById("ef-name").focus();
          showToast("Entry saved! Ready for next.", "success");
        } else {
          closeEntryForm();
          showToast("Saved!");
        }
      } catch (e) {
        showToast(e.message || "Failed to save.", "error");
      }
      btn.disabled = false; btn.textContent = keepOpen ? "Save & Next" : "Save";
    }

    function openDupPop(onConfirm, name, amount, type) {
      const msg = document.getElementById("dup-msg");
      const color = type === "don" ? "var(--green)" : "var(--red)";
      const label = type === "don" ? "donor" : "expense";
      const amtStr = `<span style="color:${color};font-weight:900;">₹${(amount || 0).toLocaleString()}</span>`;

      msg.innerHTML = `An Entry with the ${label} <strong>${escHtml(name)}</strong> and amount ${amtStr} already exist. Do you want to add it again?`;

      document.getElementById("duplicate-pop").style.display = "flex";
      document.getElementById("dup-confirm-btn").onclick = () => {
        closeDupPop();
        onConfirm();
      };
    }
    function closeDupPop() { document.getElementById("duplicate-pop").style.display = "none"; }

    // ── Context menu ──
    // Long press logic removed. Double tap works cleanly.

    let ctxEntry = null, ctxType = null;
    function openCtx(e, type, entry) {
      if (isVisitor) return;
      // SECURITY: Collector can only edit/delete their own entries. Organizer can do anything.
      if (!isOrganizer && entry.collected_by !== myUserId && !isVisitor) {
        // Collectors can see the menu even if they didn't collect it, but ONLY for pinning
        // Modify/Delete are still gated by ownership in openEditForm/openDelPop
      }

      ctxType = type;
      ctxEntry = entry;
      const ov = document.createElement("div");
      ov.className = "ctx-ov";
      ov.id = "ctx-ov";
      ov.onclick = closeCtx;
      const ctx = document.createElement("div");
      ctx.className = "ctx";
      const name = type === "don" ? entry.donor_name : entry.description;
      const pinned = isPinned(type, entry.id || entry._id);
      const canModify = isOrganizer || entry.collected_by === myUserId;

      ctx.innerHTML = `
        <div class="ctx-lbl">${escHtml(name)}</div>
        <div class="ctx-item" onclick="closeCtx();togglePin('${type}', '${ctxEntry.id || ctxEntry._id}')">
          <span data-np-icon="pin" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
          ${pinned ? 'Unpin Entry' : 'Pin Entry'}
        </div>
        ${canModify ? `
          ${type === 'don' ? `
          <div class="ctx-item" onclick="closeCtx();shareReceipt('${escHtml(entry.donor_name).replace(/'/g, "\\'")}', '${entry.amount}', '${entry.collected_at}', '${escHtml(entry.collected_by_name || 'System').replace(/'/g, "\\'")}')">
            <span data-np-icon="share-2" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
            Share Receipt
          </div>
          ` : ''}
          <div class="ctx-item" onclick="closeCtx();openEditForm()">
            <span data-np-icon="edit" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
            Modify
          </div>
          <div class="ctx-item dng" onclick="closeCtx();openDelPop()">
            <span data-np-icon="trash" data-np-size="16" data-np-tone="red" style="vertical-align:text-bottom;margin-right:8px;"></span>
            Delete
          </div>
        ` : ''}
      `;
      document.body.appendChild(ov);
      ov.appendChild(ctx);

      // Smart Positioning
      const menuWidth = 190;
      const menuHeight = ctx.offsetHeight || 160;
      let left = e.clientX;
      let top = e.clientY - 10;

      if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth - 10;
      if (top + menuHeight > window.innerHeight) top = e.clientY - menuHeight + 10;

      ctx.style.left = left + "px";
      ctx.style.top = top + "px";
    }
    function closeCtx() { const ov = document.getElementById("ctx-ov"); if (ov) ov.remove(); }

    function openEditForm() {
      const type = ctxType;
      const entry = ctxEntry;

      let tblBody;
      if (activeTheaterTab) {
        const rotContainer = document.getElementById('rot-ov-body');
        if (rotContainer) {
          tblBody = rotContainer.querySelector('.tbl-body-rows');
        }
      } else {
        tblBody = document.getElementById(type === 'don' ? 'don-tbl-body' : 'exp-tbl-body');
      }

      if (!tblBody) return;

      if (activeInlineAddType === type || activeInlineEditType === type) {
        captureInlineState(tblBody, type);
        if (activeInlineAddType === type) activeInlineAddType = null;
        if (activeInlineEditType === type) {
          activeInlineEditType = null;
          activeInlineEditId = null;
        }
        restoreNewRowBtn(tblBody, type);
      }

      const rowId = String(entry.id || entry._id);
      const origRow = tblBody.querySelector(`.tr[data-id="${rowId}"]`);
      if (origRow) {
        renderInlineEditForm(type, entry, origRow);
      }
      closeCtx();
    }
    function closeEditForm() { document.getElementById("edit-form-ov").style.display = "none"; }

    async function saveEdit(skipDupCheck = false) {
      const name = document.getElementById("edit-name").value.trim();
      const amount = document.getElementById("edit-amount").value;
      const btn = document.getElementById("edit-save-btn");
      if (!name) {
        const err = document.getElementById("edit-error");
        err.textContent = editTarget.type === "don" ? "Donor name is required." : "Description is required.";
        err.style.display = "block";
        document.getElementById("edit-name").focus();
        return;
      }

      const customFields = {};
      document.querySelectorAll("#edit-custom-fields .dynamic-edit-cf").forEach(inp => {
        customFields[inp.dataset.col] = inp.value.trim();
      });

      // Duplicate Check (excluding current entry)
      if (!skipDupCheck) {
        const amtVal = amount ? parseFloat(amount) : null;
        let existing = null;
        const currentIdStr = String(editTarget.entry.id || editTarget.entry._id);
        if (editTarget.type === "don") {
          existing = donations.find(d => String(d.id || d._id) !== currentIdStr && d.donor_name.toLowerCase().trim() === name.toLowerCase().trim());
        } else {
          existing = expenses.find(e => String(e.id || e._id) !== currentIdStr && e.description.toLowerCase().trim() === name.toLowerCase().trim());
        }
        if (existing) {
          const existingName = editTarget.type === "don" ? existing.donor_name : existing.description;
          openDupPop(() => saveEdit(true), existingName, existing.amount, editTarget.type);
          return;
        }
      }

      btn.disabled = true; btn.textContent = "Saving…";
      try {
        if (editTarget.type === "don") {
          const d = await updateDonation(eventId, editTarget.entry.id, {
            donor_name: name,
            amount: amount ? parseFloat(amount) : null,
            custom_fields: customFields
          });
          donations = donations.map(x => x.id === d.id ? d : x);
          renderDonations();
        } else {
          const e = await updateExpense(eventId, editTarget.entry.id, {
            description: name,
            amount: amount ? parseFloat(amount) : null,
            custom_fields: customFields
          });
          expenses = expenses.map(x => x.id === e.id ? e : x);
          renderExpenses();
        }
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab, true);
        clearEventCache();
        closeEditForm();
        showToast("Changes saved!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
      btn.disabled = false; btn.textContent = "Save Changes";
    }

    function openDelPop() {
      const name = ctxType === "don" ? ctxEntry.donor_name : ctxEntry.description;
      document.getElementById("del-nm").textContent = name;
      document.getElementById("del-pop").style.display = "flex";
    }
    function closeDelPop() { document.getElementById("del-pop").style.display = "none"; }

    let colToDeleteType = "custom";

    function openDelColPop() {
      if (!editingColName) return;
      colToDeleteType = "custom";
      document.getElementById("del-col-nm").textContent = editingColName;
      document.getElementById("del-col-pop").style.display = "flex";
    }
    
    function openDelDefColPop() {
      colToDeleteType = "default";
      const title = document.getElementById("def-col-title").textContent;
      document.getElementById("del-col-nm").textContent = title;
      document.getElementById("del-col-pop").style.display = "flex";
    }

    function closeDelColPop() { document.getElementById("del-col-pop").style.display = "none"; }

    async function confirmDeleteColumn() {
      if (colToDeleteType === "default") {
        document.getElementById("del-col-pop").style.display = "none";
        await hideDefCol();
        return;
      }

      try {
        const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
        const existing = eventData[key] || [];
        const updated = existing.map(c => {
          const n = typeof c === "string" ? c : c.n;
          if (n === editingColName) {
            return { n: n, w: c.w || 180, hidden: true };
          }
          return c;
        });

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
        closeDelColPop();
        showToast("Column hidden.");
      } catch (e) {
        showToast(e.message || "Failed.", "error");
        closeDelColPop();
      }
    }

    async function confirmDelete() {
      try {
        if (ctxType === "don") { await deleteDonation(eventId, ctxEntry.id); donations = donations.filter(d => d.id !== ctxEntry.id); renderDonations(); }
        else { await deleteExpense(eventId, ctxEntry.id); expenses = expenses.filter(e => e.id !== ctxEntry.id); renderExpenses(); }
        clearEventCache();
        summaryData = null; // Invalidate cache
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab, true);
        closeDelPop(); showToast("Entry deleted.");
      } catch (e) { showToast(e.message || "Failed.", "error"); closeDelPop(); }
    }

    function isPinned(type, id) {
      if (!id) return false;
      const sid = String(id);

      // Pinning is now strictly local and user-independent
      const storageKey = `np_pinned_${eventId}_${type}`;
      const local = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return local.map(x => String(x)).includes(sid);
    }

    async function togglePin(type, id) {
      if (!id) return;
      const sid = String(id);
      const storageKey = `np_pinned_${eventId}_${type}`;
      let pinned = JSON.parse(localStorage.getItem(storageKey) || "[]").map(x => String(x));

      if (pinned.includes(sid)) {
        pinned = pinned.filter(x => x !== sid);
      } else {
        pinned.push(sid);
      }

      // Save locally only
      localStorage.setItem(storageKey, JSON.stringify(pinned));

      // Re-render views
      if (type === "don") renderDonations(); else renderExpenses();
      if (activeTheaterTab) refreshTheaterTable();
      showToast(pinned.includes(sid) ? "Entry pinned to top" : "Entry unpinned");
    }

    // Perfect Silent Update: Adopts the exact Event Page strategy
    function refreshTheaterTable() {
      if (!activeTheaterTab) return;
      const body = document.getElementById("rot-ov-body");
      if (!body) return;

      if (activeTheaterTab === "sum") {
        renderSummary(0, "sum-body-theater");
        updateTheaterStats();
        return;
      }

      const tblSc = body.querySelector(".theater-scroll-area");
      if (!tblSc) return;

      const tblInner = tblSc.querySelector(".tbl-inner");
      if (!tblInner) {
        tblSc.appendChild(renderTable(activeTheaterTab, true));
        return;
      }

      const rowsCont = tblInner.querySelector(".tbl-body-rows");
      if (!rowsCont) {
        tblInner.appendChild(renderTable(activeTheaterTab, true).querySelector(".tbl-body-rows"));
        return;
      }

      // 1. Capture scroll state and "At Bottom" status
      const sX = tblSc.scrollLeft;
      const sY = tblSc.scrollTop;
      const isAtBottom = (tblSc.scrollTop + tblSc.clientHeight) >= (tblSc.scrollHeight - 20);

      // 2. Perform the exact Event Page strategy: Clear and Fill
      fillTableRows(rowsCont, activeTheaterTab);

      // 3. Restore scroll with "Sticky Bottom" intelligence
      if (isAtBottom) {
        // If user was at the bottom, lock them to the NEW bottom to prevent jitter
        tblSc.scrollTop = tblSc.scrollHeight;
      } else {
        tblSc.scrollTop = sY;
      }
      tblSc.scrollLeft = sX;

      updateTheaterStats();
    }
    function openDD() { document.getElementById("dd-ov").style.display = "block"; }
    function closeDD() { document.getElementById("dd-ov").style.display = "none"; }

    function openFilterModal() {
      document.getElementById("filter-sort-overlay").style.display = "flex";
      document.querySelector(`input[name="fs_sort"][value="${currentSort}"]`).checked = true;
      document.getElementById("fs_my_entries").checked = myEntriesOnly;
      if (!isVisitor) {
        document.getElementById("fs-filter-section").style.display = "block";
      } else {
        document.getElementById("fs-filter-section").style.display = "none";
      }
    }
    
    function closeFilterModal() {
      document.getElementById("filter-sort-overlay").style.display = "none";
    }

    function applyFilterSort() {
      currentSort = document.querySelector('input[name="fs_sort"]:checked').value;
      myEntriesOnly = document.getElementById("fs_my_entries").checked;
      
      updateFilterIconStyles();
      
      const qd = document.getElementById("don-search").value;
      const qe = document.getElementById("exp-search").value;
      renderDonations(qd);
      renderExpenses(qe);
      if (activeTheaterTab) {
        enterTheater(activeTheaterTab);
      }
    }

    function updateFilterIconStyles() {
      const icons = document.querySelectorAll('.filter-icon-btn');
      const isActive = currentSort !== 'time_asc' || myEntriesOnly;
      icons.forEach(btn => {
        if (isActive) {
          btn.style.color = "var(--primary)";
          btn.style.background = "var(--primary-lt)";
        } else {
          btn.style.color = "var(--text2)";
          btn.style.background = "transparent";
          if(btn.style.padding === "4px") btn.style.background = "var(--surface)"; // theater mode variant
        }
      });
    }

    function openColDD() { document.getElementById("dd-col-ov").style.display = "flex"; }
    function closeColDD() {
      document.getElementById("dd-col-ov").style.display = "none";
    }

    function openExitPop() {
      document.getElementById("exit-pop").style.display = "flex";
    }
    function closeExitPop() {
      document.getElementById("exit-pop").style.display = "none";
    }
    async function confirmExit() {
      const lp = document.getElementById("loading-pane");
      try {
        if (lp) lp.style.display = "flex";
        document.getElementById("exit-pop").style.display = "none";
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
      document.getElementById("remove-event-name").textContent = eventData ? eventData.name : "";
      document.getElementById("remove-pop").style.display = "flex";
    }
    function closeRemovePop() {
      document.getElementById("remove-pop").style.display = "none";
    }
    async function confirmRemove() {
      const lp = document.getElementById("loading-pane");
      try {
        if (lp) lp.style.display = "flex";
        document.getElementById("remove-pop").style.display = "none";
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
        await loadAll();
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

    // ── Privacy / Public Access ──
    function handlePrivacyToggleClick() {
      closeDD();
      if (eventData.is_public) {
        // If turning OFF, do it immediately
        togglePrivacy(false);
      } else {
        // If turning ON, show confirmation
        document.getElementById("privacy-event-name").textContent = eventData.name;
        document.getElementById("privacy-pop").style.display = "flex";
      }
    }
    function closePrivacyPop() { document.getElementById("privacy-pop").style.display = "none"; }
    async function confirmPrivacyToggle() {
      closePrivacyPop();
      await togglePrivacy(true);
    }
    async function togglePrivacy(val) {
      try {
        await updateEventPrivacy(eventId, val);
        eventData.is_public = val;
        clearEventCache();
        renderPage();
        showToast(val ? "Public access enabled — share the visitor link!" : "Event is now private", val ? "success" : "info");
      } catch (e) {
        showToast("Failed to update privacy settings", "error");
      }
    }
    function sharePublicLink() {
      const url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: `Notepay — ${eventData.name}`, url: url }).catch(() => { });
      } else {
        copyToClipboard(url, "Link copied to clipboard!");
      }
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
      document.getElementById("del-ev-msg").innerHTML = `Are you sure you want to delete the event "<strong>${escHtml(eventData.name)}</strong>"? This will permanently remove all data and cannot be undone.`;
      document.getElementById("del-ev-pop").style.display = "flex";
    }
    async function doDeleteEvent() {
      try { await deleteEvent(eventId); window.location.replace("dashboard.html"); }
      catch (e) { showToast(e.message || "Delete failed.", "error"); document.getElementById("del-ev-pop").style.display = "none"; }
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

    function openRenameSheet() { window.location.href = `create-event.html?edit=${eventId}`; }

    // ── Helpers ──
    function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function getInitials(n) { return n.split(" ").map(x => x[0]).join("").toUpperCase().slice(0, 2); }

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
        row.style.background = "var(--row-bg)";
        row.style.borderRadius = "8px";
        row.style.border = "1px solid var(--border)";
        
        row.innerHTML = `
          <div style="font-size:13px; font-weight:700; color:var(--text1);">${escHtml(dispName)}</div>
          <button class="btn btn-solid-primary" style="padding: 0 12px; font-size: 11.5px; border-radius: 30px; height: 28px; white-space: nowrap; width: fit-content !important; flex: 0 0 auto; margin: 0;" onclick="restoreHiddenColumn('${name}')">Restore</button>
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
          const val = (entry.custom_fields && entry.custom_fields[n]) || "-";
          return `<div class="sc" style="width:${w}px;">${escHtml(val)}</div>`;
        }).join("");

        let rowHTML = `
          <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(type === "don" ? 'don_name' : 'exp_desc', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              ${isPinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
            </div>
            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${escHtml(entry.donor_name || entry.description)}</div>
          </div>
          <div class="sc" style="width:${getColWidth(type === "don" ? 'don_amt' : 'exp_amt', 90)}px;">
            <span style="font-weight:800; color:${type === "don" ? "var(--green)" : "var(--red)"};">₹${(entry.amount || 0).toLocaleString()}</span>
          </div>`;
          
        if (!hideDate) {
          rowHTML += `<div class="sc" style="width:${getColWidth(type === "don" ? 'don_date' : 'exp_date', 100)}px;">${formatDate(entry.collected_at)}</div>`;
        }
        if (!hideColBy) {
          rowHTML += `<div class="sc" style="width:${getColWidth(type === "don" ? 'don_colby' : 'exp_colby', 130)}px;">${escHtml(entry.collected_by_name || "-")}</div>`;
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
      const total = list.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const colorClass = tab === "don" ? "sum-g" : (tab === "exp" ? "sum-r" : "");
      const unit = tab === "don" ? "names" : (tab === "exp" ? "expenses" : "overview");

      document.getElementById("rot-stat-name").textContent = eventData ? eventData.name : "Notepay";
      if (tab === "sum") {
        document.getElementById("rot-stat-info").innerHTML = `<b>Financial Dashboard</b>`;
      } else {
        document.getElementById("rot-stat-info").innerHTML = `<b>${count}</b> ${unit} | Total: <b class="${colorClass}">₹${total.toLocaleString()}</b>`;
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
      doc.text(`ORGANIZER: ${(eventData.organizer_name || 'System').toUpperCase()}`, 15, 56);
      doc.text(`REPORT ISSUED: ${new Date().toLocaleString().toUpperCase()}`, pageWidth - 15, 51, { align: "right" });

      // --- FINANCIAL SUMMARY BOX ---
      const totalDon = donations.reduce((s, d) => s + (d.amount || 0), 0);
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
      visibleDonCols.forEach(c => donHead.push((typeof c === 'string' ? c : c.n).toUpperCase()));
      
      const donBody = donations.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).map(d => {
        const row = [d.donor_name.toUpperCase(), formatPDF_Amt(d.amount)];
        if (!hideDonDate) row.push(formatDate(d.collected_at).toUpperCase());
        if (!hideDonColBy) row.push((d.collected_by_name || '-').toUpperCase());
        visibleDonCols.forEach(c => row.push((d.custom_fields ? (d.custom_fields[typeof c === 'string' ? c : c.n] || '-') : '-').toUpperCase()));
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
        visibleExpCols.forEach(c => row.push((e.custom_fields ? (e.custom_fields[typeof c === 'string' ? c : c.n] || '-') : '-').toUpperCase()));
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

      const link = window.location.href;
      doc.setTextColor(PRIMARY_DK[0], PRIMARY_DK[1], PRIMARY_DK[2]);
      doc.setFont("helvetica", "normal");
      doc.text(link, 15, currentY + 11);
      doc.link(15, currentY + 7, 180, 5, { url: link });

      doc.save(`${eventData.name}_Statement.pdf`);
    }

    function goBackToDashboard() {
      let tabIdx = 1; // Default to Collector (Shared Events)
      if (typeof isVisitor !== 'undefined' && isVisitor) {
        tabIdx = 2; // Discover
      } else if (typeof isOrganizer !== 'undefined' && isOrganizer) {
        tabIdx = 0; // My Events
      }
      window.location.href = `dashboard.html?tab=${tabIdx}`;
    }
    // ── CHAT MODULE ──
    let chatMessages = [];
    let chatOpen = false;
    let chatUnread = 0;
    let chatOldestId = null;
    let chatLoading = false;
    let chatFullyLoaded = false;
    let chatHistoryLoaded = false;
    let emojiPickerMode = 'reaction'; // 'reaction' or 'input'
    let isOrganizerGlobal = false;
    let unreadDividerId = null;

    function autoResizeChatInput(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 100) + 'px';
    }

    function updateSendBtnVisibility() {
      const input = document.getElementById('chat-input');
      const val = input.value;
      const btn = document.getElementById('chat-send-btn');
      btn.classList.toggle('is-visible', val.length > 0);
      
      const aiInlineBtn = document.getElementById('ai-inline-btn');
      if (aiInlineBtn) {
        aiInlineBtn.style.display = val.length > 0 ? 'none' : 'flex';
        input.style.paddingRight = val.length > 0 ? '12px' : '74px';
      }
    }

    let emojiTrayOpen = false;
    let pendingReactionMsgId = null;

    function setEmojiTrayOpen(open) {
      emojiTrayOpen = open;
      const ov = document.getElementById('emoji-picker-ov');
      const footer = document.querySelector('.chat-footer-zone');
      if (ov) ov.classList.toggle('is-open', open);
      if (footer) footer.classList.toggle('emoji-tray-open', open);
      if (!open) pendingReactionMsgId = null;
    }

    function closeEmojiTray() {
      setEmojiTrayOpen(false);
    }

    let chatScrollLockY = 0;

    function lockPageScrollForChat(lock) {
      if (window.matchMedia('(min-width: 1025px)').matches) return;
      const html = document.documentElement;
      if (lock) {
        chatScrollLockY = window.scrollY;
        html.classList.add('np-chat-open');
        document.body.style.position = 'fixed';
        document.body.style.top = `-${chatScrollLockY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
      } else {
        html.classList.remove('np-chat-open');
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, chatScrollLockY);
      }
    }

    function applyChatVisualViewport() {
      if (!chatOpen || !window.visualViewport) return;
      if (window.matchMedia('(min-width: 1025px)').matches) return;
      const vv = window.visualViewport;
      const drawer = document.querySelector('.chat-drawer');
      const overlay = document.getElementById('chat-overlay');
      if (!drawer || !overlay) return;
      overlay.style.top = vv.offsetTop + 'px';
      overlay.style.height = vv.height + 'px';
      overlay.style.bottom = 'auto';
      drawer.style.height = '100%';
      drawer.style.top = '';
      drawer.style.width = '';
      drawer.style.maxWidth = '';
      drawer.style.left = '';
      drawer.style.right = '';
    }

    let chatVvBound = false;
    function bindChatVisualViewport() {
      if (!window.visualViewport || chatVvBound) return;
      chatVvBound = true;
      window.visualViewport.addEventListener('resize', applyChatVisualViewport);
      window.visualViewport.addEventListener('scroll', applyChatVisualViewport);
    }

    window.addEventListener("popstate", (e) => {
      if (chatOpen) {
        closeChat(true);
      }
    });

    function openChat() {
      chatOpen = true;
      bindChatVisualViewport();

      // Set unread divider target before resetting count
      const lastRead = parseInt(localStorage.getItem(`np_chat_last_read_ev_${eventId}`) || '0');
      if (chatUnread > 0) unreadDividerId = lastRead;

      chatUnread = 0;
      updateChatBadge();
      lockPageScrollForChat(true);
      document.getElementById('chat-overlay').style.display = 'flex';
      applyChatVisualViewport();
      // Update URL to preserve chat open state on reload
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has('chat')) {
        urlParams.set('chat', '1');
        window.history.pushState({ chat: true }, '', `${window.location.pathname}?${urlParams}`);
      }

      if (!chatHistoryLoaded) loadChatHistory();
      else {
        renderChatMessages('bottom');
      }
      markChatAsRead();
    }

    function markChatAsRead() {
      if (chatMessages.length > 0) {
        const lastMsgId = chatMessages[chatMessages.length - 1].id;
        localStorage.setItem(`np_chat_last_read_ev_${eventId}`, lastMsgId);
      }
      chatUnread = 0;
      updateChatBadge();
    }

    function closeChat(fromPopState = false) {
      chatOpen = false;
      document.getElementById('chat-overlay').style.display = 'none';
      closeEmojiTray();
      lockPageScrollForChat(false);
      const drawer = document.querySelector('.chat-drawer');
      const overlay = document.getElementById('chat-overlay');
      if (drawer) {
        drawer.style.height = '';
        drawer.style.top = '';
        drawer.style.width = '';
        drawer.style.maxWidth = '';
        drawer.style.left = '';
        drawer.style.right = '';
      }
      if (overlay) {
        overlay.style.top = '';
        overlay.style.height = '';
        overlay.style.bottom = '';
      }
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('chat')) {
        urlParams.delete('chat');
        if (fromPopState === true) {
          window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
        } else {
          if (history.state && history.state.chat) {
            window.history.back();
          } else {
            window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
          }
        }
      }
    }

    function updateChatBadge() {
      const badge = document.getElementById('chat-badge');
      if (!badge) return;
      badge.textContent = chatUnread > 99 ? '99+' : chatUnread;
      badge.style.display = chatUnread > 0 ? 'flex' : 'none';
    }

    async function loadChatHistory(loadOlder = false, isBackground = false) {
      if (chatLoading) return;
      chatLoading = true;
      try {
        let url = `/events/${eventId}/chat?limit=50`;
        if (loadOlder && chatOldestId) url += `&before_id=${chatOldestId}`;
        const msgs = await apiFetch('GET', url);
        if (msgs.length < 50) {
          chatFullyLoaded = true;
        }
        if (msgs.length === 0 && loadOlder) {
          if (!isBackground || chatOpen) {
            renderChatMessages('older');
          }
          return;
        }
        if (loadOlder) {
          chatMessages = [...msgs, ...chatMessages];
        } else {
          chatMessages = msgs;
        }
        if (chatMessages.length > 0) {
          chatOldestId = chatMessages[0].id;
        }
        chatHistoryLoaded = true;

        // If chat is currently open, we MUST render the messages even if this is a background load
        // (to ensure newly arrived messages appear instantly if the user is already looking at the chat)
        if (!isBackground || chatOpen) {
          if (loadOlder) {
            prependOlderMessages(msgs);
          } else {
            renderChatMessages('bottom');
          }
        }

        // Calculate initial unread count on first load
        if (!loadOlder && (!chatOpen || isBackground)) {
          const lastRead = parseInt(localStorage.getItem(`np_chat_last_read_ev_${eventId}`) || '0');
          chatUnread = chatMessages.filter(m => m.id > lastRead).length;
          updateChatBadge();
        }
      } catch (e) {
        console.error('Failed to load chat:', e);
      } finally {
        chatLoading = false;
      }
    }

    function chatTimeExact(dateStr) {
      let d = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    function chatDateLabel(dateStr) {
      let d = dateStr.endsWith('Z') ? new Date(dateStr) : new Date(dateStr + 'Z');
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const diff = Math.floor((today - msgDay) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Yesterday';
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function buildMessageHTML(m, lastSender, lastDate, isNew = false) {
      const myId = parseInt(localStorage.getItem('np_my_id') || '0');
      const isOwn = m.user_id === myId;
      const dateLabel = chatDateLabel(m.sent_at);
      let html = '';

      if (dateLabel !== lastDate) {
        html += `<div class="chat-date-divider">${dateLabel}</div>`;
      }

      const isAILoading = m.id === 'ai-loading';
      const showSender = isAILoading ? true : (!isOwn && m.user_id !== lastSender);
      let replyHtml = '';
      if (m.reply_snippet) {
        replyHtml = `<div class="chat-reply-snippet" onclick="scrollToMsg(${m.reply_snippet.id})">
         <div class="rsp-name">${escHtml(m.reply_snippet.sender_name)}</div>
         <div class="rsp-text">${escHtml(m.reply_snippet.message)}</div>
       </div>`;
      }

      let rxHtml = '';
      if (m.reactions && Object.keys(m.reactions).length > 0) {
        rxHtml += `<div class="chat-reactions">`;
        for (const [emoji, users] of Object.entries(m.reactions)) {
          const amIMine = users.includes(myId) ? 'rx-mine' : '';
          rxHtml += `<div class="rx-pill ${amIMine}" onclick="sendReactionInline(${m.id}, '${emoji}')">${emoji} <span class="rx-count">${users.length}</span></div>`;
        }
        rxHtml += `</div>`;
      }

      const isDeleted = m.message === '[DELETED]' || m.message.includes('This message was deleted');

      const safeName = escHtml(m.sender_name).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
      const ctxText = isGroupCallMessage(m.message) ? 'Group call — Join meeting' : m.message;
      const safeText = escHtml(ctxText).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

      // Status Icons Logic
      let statusIcon = '';
      if (isOwn && !isDeleted) {
        if (m.is_pending) {
          statusIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
        } else {
          const membersCount = (typeof eventData !== 'undefined' && eventData && eventData.members) ? eventData.members.length : 1;
          const readCount = m.read_by ? m.read_by.length : 0;
          const deliveredCount = m.delivered_to ? m.delivered_to.length : 0;
          const requiredCount = Math.max(0, membersCount - 1);
          
          if (membersCount === 1 || readCount >= requiredCount) {
            statusIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon msg-status-blue"><path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path></svg>`;
          } else if (deliveredCount >= requiredCount) {
            statusIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon"><path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path></svg>`;
          } else if (m.id > 0) {
            statusIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          } else {
            statusIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
          }
        }
      }

      let avatarHtml = '';
      const isAI = m.user_id == null || m.sender_name === "AI Advisor";
      if (!isOwn && !isAI) {
        if (showSender) {
          const initial = m.sender_name.charAt(0).toUpperCase();
          const hue = (m.sender_name.charCodeAt(0) * 137) % 360;
          avatarHtml = `<div class="chat-avatar chat-avatar-clickable" style="background: hsl(${hue}, 60%, 45%)" onclick="event.stopPropagation();showMemberProfile(${m.user_id})" role="button" tabindex="0">${initial}</div>`;
        } else {
          avatarHtml = `<div style="width:28px; flex-shrink:0;"></div>`;
        }
      }

      if (!isOwn && !isAI) html += `<div class="chat-msg-row">${avatarHtml}`;
      if (isAI) html += `<div class="chat-msg-row" style="margin: 16px 0; max-width: 100%;">`; // Extra spacing for AI

      const animateClass = isNew ? 'animate-in' : '';
      html += `<div class="chat-msg ${isOwn ? 'chat-msg-own' : 'chat-msg-other'} ${showSender ? 'chat-msg-first' : ''} ${isDeleted ? 'chat-msg-deleted' : ''} ${animateClass}" id="chat-msg-${m.id}" ${isAI ? 'style="width: 100%; max-width: 100%;"' : ''}>`;
      
      const aiBubbleStyle = isAI ? 'width: 100%; max-width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);' : '';
      
      html += `<div class="chat-bubble" ${!isDeleted ? `data-id="${m.id}" data-uid="${m.user_id}" data-sender="${safeName}" data-text="${safeText}"` : ''} style="${aiBubbleStyle}">`;
      html += `<div class="chat-bubble-content">`;
      if (showSender && !isAI) {
        html += `<div class="chat-msg-sender">${escHtml(m.sender_name)}</div>`;
      } else if (showSender && isAI) {
        html += `<div class="chat-msg-sender" style="display:flex; align-items:center; gap:6px; color:var(--primary); font-size:14px; margin-bottom:8px;"><span style="font-size:16px;">\u2728</span> AI Advisor</div>`;
      }
      if (replyHtml) html += replyHtml;
      
      let msgContent = formatChatMessageText(m.message);
      if (isDeleted) {
        msgContent = `<span style="display:inline-flex;align-items:center;gap:6px;color:var(--text3);font-style:italic;">${npIcon('trash', {size: 16, tone: 'muted'})} This message was deleted.</span>`;
      } else if (m.id === 'ai-loading') {
        msgContent = `<div class="ai-typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
      }
      
      let timeHtml = "";
      if (!isDeleted) {
        msgContent += `<span class="time-spacer"></span>`;
        timeHtml = `<div class="chat-msg-time">${chatTimeExact(m.sent_at)} ${statusIcon}</div>`;
      }
      html += `<div class="chat-msg-text" ${isAI ? 'style="font-size:15px; line-height:1.6;"' : ''}>${msgContent}</div>`;
      html += timeHtml;
      html += `</div>`; // end chat-bubble-content
      html += `</div>`; // end chat-bubble
      html += rxHtml;
      html += `</div>`;

      if (!isOwn || isAI) html += `</div>`; // end chat-msg-row

      return { html, dateLabel, newSender: m.user_id };
    }

    function prependOlderMessages(msgs) {
      if (!msgs || msgs.length === 0) return;
      const container = document.getElementById('chat-messages');
      const prevScrollHeight = container.scrollHeight;
      const prevScrollTop = container.scrollTop;

      const loadBtn = container.querySelector('.chat-load-more');
      if (loadBtn) loadBtn.remove();
      const infoMsg = container.querySelector('.chat-retention-info');
      if (infoMsg) infoMsg.remove();

      let html = '';

      if (chatFullyLoaded) {
        html += `<div class="chat-retention-info" style="text-align:center; padding:10px 14px; margin:8px 12px; font-size:11px; font-weight:700; color:var(--text3); background:var(--surf-var); border-radius:10px; border:1px solid var(--border2); line-height:1.4;">
          All chat messages in this event are securely preserved.
        </div>`;
      } else if (chatMessages.length >= 50) {
        html += `<div class="chat-load-more" onclick="loadChatHistory(true)">Load older messages </div>`;
      }

      let lastDate = '';
      let lastSender = -1;
      msgs.forEach((m) => {
        const res = buildMessageHTML(m, lastSender, lastDate);
        html += res.html;
        lastDate = res.dateLabel;
        lastSender = res.newSender;
      });

      // Remove the redundant date divider of the old top message if it matches the last newly loaded message
      if (lastDate) {
        const oldDividers = container.querySelectorAll('.chat-date-divider');
        if (oldDividers.length > 0) {
           if (oldDividers[0].textContent === lastDate) {
             oldDividers[0].remove();
           }
        }
      }

      container.insertAdjacentHTML('afterbegin', html);
      container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
    }

    let chatObserver = null;
    let statusQueue = [];
    let isStatusSending = false;

    async function processStatusQueue() {
      if (isStatusSending || statusQueue.length === 0) return;
      isStatusSending = true;
      while (statusQueue.length > 0) {
        const id = statusQueue.shift();
        try {
          await apiFetch('POST', `/events/${eventId}/chat/${id}/status`, { status: 'read' });
        } catch (e) {
          console.warn(e);
        }
        await new Promise(r => setTimeout(r, 50)); // Prevent slamming the server
      }
      isStatusSending = false;
    }

    function setupChatObserver() {
      if (chatObserver) return;
      chatObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const id = entry.target.dataset.id;
            const uid = entry.target.dataset.uid;
            const myId = parseInt(localStorage.getItem('np_my_id') || '0');
            if (id && uid && parseInt(uid) !== myId) {
              statusQueue.push(id);
              processStatusQueue();
              chatObserver.unobserve(entry.target);
            }
          }
        });
      }, {
        root: document.getElementById('chat-messages'),
        threshold: 0.5
      });
    }

    function observeNewMessages() {
      setupChatObserver();
      const myId = parseInt(localStorage.getItem('np_my_id') || '0');
      const container = document.getElementById('chat-messages');
      container.querySelectorAll('.chat-bubble[data-id]').forEach(el => {
        const uid = parseInt(el.dataset.uid);
        if (uid !== myId) {
          const msgId = parseInt(el.dataset.id);
          const msg = chatMessages.find(x => x.id === msgId);
          if (msg && (!msg.read_by || !msg.read_by.includes(myId))) {
            chatObserver.observe(el);
          }
        }
      });
    }

    function renderChatMessages(scrollMode = 'bottom') {
      const container = document.getElementById('chat-messages');
      const emptyEl = document.getElementById('chat-empty');

      if (chatMessages.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';

      const prevScrollHeight = container.scrollHeight;
      const prevScrollTop = container.scrollTop;
      let html = '';

      if (chatFullyLoaded) {
        html += `<div class="chat-retention-info" style="text-align:center; padding:10px 14px; margin:8px 12px; font-size:11px; font-weight:700; color:var(--text3); background:var(--surf-var); border-radius:10px; border:1px solid var(--border2); line-height:1.4;">
          NotePay Chat preserves the latest 200 messages. Older messages are automatically deleted by the server.
        </div>`;
      } else if (chatMessages.length >= 50) {
        html += `<div class="chat-load-more" onclick="loadChatHistory(true)">Load older messages ↑</div>`;
      }

      let lastDate = '';
      let lastSender = -1;
      let unreadInserted = false;

      chatMessages.forEach((m) => {
        if (unreadDividerId && m.id > unreadDividerId && !unreadInserted) {
          html += `<div class="chat-unread-divider" id="chat-unread-divider">Unread Messages</div>`;
          unreadInserted = true;
        }
        const res = buildMessageHTML(m, lastSender, lastDate);
        html += res.html;
        lastDate = res.dateLabel;
        lastSender = res.newSender;
      });

      // Freeze paint to prevent the screen from blinking when replacing HTML
      container.style.overflowY = 'hidden';
      container.innerHTML = html;

      if (scrollMode === 'older') {
        // When prepending old messages, the scroll height increases.
        // We push the scroll down by the exact amount of new height added so the user's view doesn't jump.
        container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
      } else if (scrollMode === 'keep') {
        container.scrollTop = prevScrollTop;
      } else {
        const unreadEl = document.getElementById('chat-unread-divider');
        if (unreadEl && unreadDividerId) {
          // Auto-scroll to the unread divider if it exists
          unreadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          scrollChatToBottom();
        }
      }

      container.offsetHeight; 
      container.style.overflowY = 'auto';

      // Clear the divider flag after opening so it doesn't persist if they load older messages
      if (scrollMode !== 'older') unreadDividerId = null;
      
      observeNewMessages();
    }

    function appendChatMessage(m) {
      const container = document.getElementById('chat-messages');
      const emptyEl = document.getElementById('chat-empty');
      if (emptyEl) emptyEl.style.display = 'none';

      let lastDate = '';
      let lastSender = -1;
      if (chatMessages.length > 1) {
        const prev = chatMessages[chatMessages.length - 2];
        lastDate = chatDateLabel(prev.sent_at);
        lastSender = prev.user_id;
      }
      const res = buildMessageHTML(m, lastSender, lastDate);
      container.insertAdjacentHTML('beforeend', res.html);
      observeNewMessages();
    }

    function updateMessageNode(m) {
      const el = document.getElementById(`chat-msg-${m.id}`);
      if (!el) return;

      // To properly rebuild, find previous sender/date
      let lastSender = -1;
      let lastDate = '';
      const idx = chatMessages.findIndex(x => x.id === m.id);
      if (idx > 0) {
        lastDate = chatDateLabel(chatMessages[idx - 1].sent_at);
        lastSender = chatMessages[idx - 1].user_id;
      }
      const res = buildMessageHTML(m, lastSender, lastDate);

      // Create a dummy container to extract inner elements without breaking the main layout flow
      const temp = document.createElement('div');
      temp.innerHTML = res.html;
      const newMsgEl = temp.querySelector('.chat-msg');

      // Replace the old message div completely
      el.replaceWith(newMsgEl);
    }

    function scrollChatToBottom(smooth = false) {
      const c = document.getElementById('chat-messages');
      if (c) requestAnimationFrame(() => {
        c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
        keepChatInputFocused();
      });
    }

    let activeCtxMsg = null;
    let replyingToId = null;
    function startReply(id, name, text) {
      replyingToId = id;
      document.getElementById('chat-reply-bar').style.display = 'flex';
      document.getElementById('reply-name').textContent = name;
      document.getElementById('reply-text').textContent = text;
      keepChatInputFocused();
    }
    function cancelReply() {
      replyingToId = null;
      document.getElementById('chat-reply-bar').style.display = 'none';
    }
    function applyChatReactionFromServer(data) {
      if (!data || data.id == null) return;
      const idx = chatMessages.findIndex(m => m.id === data.id);
      if (idx === -1) return;
      chatMessages[idx] = data;
      if (chatOpen) updateMessageNode(data);
    }

    async function sendReactionInline(mId, emoji) {
      try {
        const data = await apiFetch('POST', `/events/${eventId}/chat/${mId}/react`, { emoji: emoji });
        applyChatReactionFromServer(data);
      } catch (e) {
        console.error('Reaction failed', e);
        showToast('Could not add reaction', 'error');
      }
    }

    function openChatMsgCtx(e, id, name, text, senderId) {
      activeCtxMsg = { id, name, text };
      const ov = document.getElementById('chat-msg-ctx-ov');
      const ctx = document.getElementById('chat-msg-ctx');

      // CRITICAL FIX: Ensure the menu is set back to flex (visible),
      // because opening the full emoji picker sets it to 'none'!
      ctx.style.display = 'flex';

      // Check delete permission
      const delBtn = document.getElementById('ctx-delete-btn');
      const myId = parseInt(localStorage.getItem('np_my_id') || '0');
      if (senderId === myId || isOrganizerGlobal) {
        delBtn.style.display = 'block';
      } else {
        delBtn.style.display = 'none';
      }

      ov.style.display = 'block';

      let ww = window.innerWidth;
      let wh = window.innerHeight;
      let x = e.clientX;
      let y = e.clientY;

      if (x + 220 > ww) x = ww - 230;
      if (y + 200 > wh) y = wh - 220;

      ctx.style.left = x + 'px';
      ctx.style.top = y + 'px';
    }
    function closeChatMsgCtx() {
      document.getElementById('chat-msg-ctx-ov').style.display = 'none';
      closeEmojiTray();
      activeCtxMsg = null;
    }
    function handleCtxReply() {
      if (!activeCtxMsg) return;
      startReply(activeCtxMsg.id, activeCtxMsg.name, activeCtxMsg.text);
      closeChatMsgCtx();
    }
    function handleCtxCopy() {
      if (!activeCtxMsg) return;
      copyToClipboard(activeCtxMsg.text, "Message copied");
      closeChatMsgCtx();
    }
    async function handleCtxDelete() {
      if (!activeCtxMsg) return;
      const mId = activeCtxMsg.id;
      closeChatMsgCtx();
      try {
        await apiFetch('DELETE', `/events/${eventId}/chat/${mId}`);
        const idx = chatMessages.findIndex(m => m.id === mId);
        if (idx !== -1) {
          chatMessages[idx].message = '[DELETED]';
          updateMessageNode(chatMessages[idx]);
        }
      } catch (e) {
        console.error('Delete failed', e);
        showToast("Delete failed", "error");
      }
    }
    async function sendReactionInlineCtx(emoji) {
      const mId = pendingReactionMsgId || activeCtxMsg?.id;
      if (!mId) return;
      closeChatMsgCtx();
      pendingReactionMsgId = null;
      await sendReactionInline(mId, emoji);
    }
    function openFullEmojiPickerCtx() {
      if (!activeCtxMsg) return;
      pendingReactionMsgId = activeCtxMsg.id;
      emojiPickerMode = 'reaction';
      document.getElementById('chat-msg-ctx-ov').style.display = 'none';
      activeCtxMsg = null;
      document.getElementById('chat-input').blur();
      setEmojiTrayOpen(true);
    }

    async function scrollToMsg(id) {
      let el = document.getElementById(`chat-msg-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = el.querySelector('.chat-bubble');
        if (bubble) {
          bubble.classList.remove('highlight-msg');
          void bubble.offsetWidth; // force reflow
          bubble.classList.add('highlight-msg');
        }
      } else if (!chatFullyLoaded) {
        showToast("Loading older messages...", "info");
        while (!el && !chatFullyLoaded) {
          await loadChatHistory(true);
          el = document.getElementById(`chat-msg-${id}`);
          if (el) {
            setTimeout(() => scrollToMsg(id), 100);
            return;
          }
        }
        if (!el) showToast("Message not found", "error");
      }
    }

    function showAITypingIndicator() {
      const el = document.getElementById('ai-typing-status');
      if (!el) return;
      el.innerHTML = `
        <strong class="ai-typing-name">AI Advisor</strong>
        <span class="ai-typing-verb"> is typing</span>
        <span class="ai-typing-dots">
          <span class="ai-td"></span>
          <span class="ai-td"></span>
          <span class="ai-td"></span>
        </span>
      `;
      el.style.display = 'flex';
    }

    function hideAITypingIndicator() {
      const el = document.getElementById('ai-typing-status');
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    }

    async function processChatQueue() {
      if (!navigator.onLine) return;
      let chatSyncQueue = JSON.parse(localStorage.getItem(`np_chat_sync_${eventId}`) || '[]');
      if (chatSyncQueue.length === 0) return;
      
      const queue = [...chatSyncQueue];
      localStorage.setItem(`np_chat_sync_${eventId}`, '[]');
      
      for (let item of queue) {
        try {
          const realMsg = await apiFetch('POST', `/events/${eventId}/chat`, item.payload);
          const idx = chatMessages.findIndex(m => m.id === item.mockId);
          if (idx !== -1) {
            chatMessages[idx] = realMsg;
            if (chatOpen) updateMessageNode(realMsg);
          }
        } catch(e) {
          if (!navigator.onLine || e.message === 'Failed to fetch') {
            let q = JSON.parse(localStorage.getItem(`np_chat_sync_${eventId}`) || '[]');
            q.push(item);
            localStorage.setItem(`np_chat_sync_${eventId}`, JSON.stringify(q));
          }
        }
      }
    }
    window.addEventListener('online', processChatQueue);

    async function sendChatMessage() {
      const input = document.getElementById('chat-input');
      const msg = input.value.trim();
      if (!msg) return;

      input.value = '';
      input.style.height = 'auto';
      updateSendBtnVisibility();
      closeEmojiTray();

      try {
        const payload = { message: msg };
        if (replyingToId) payload.reply_to_id = replyingToId;
        
        const myId = parseInt(localStorage.getItem('np_my_id'));
        const mockMsg = {
          id: -Date.now(),
          event_id: eventId,
          user_id: myId,
          sender_name: localStorage.getItem('np_my_name') || 'You',
          message: msg,
          reply_to_id: replyingToId,
          reactions: {},
          sent_at: new Date().toISOString(),
          is_pending: true, // Start as pending
          delivered_to: [],
          read_by: []
        };
        chatMessages.push(mockMsg);
        if (chatOpen) {
          const container = document.getElementById('chat-messages');
          const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
          appendChatMessage(mockMsg);
          if (isAtBottom) scrollChatToBottom(true);
        } else {
          chatUnread++;
          updateChatBadge();
        }

        if (!navigator.onLine) {
          let chatSyncQueue = JSON.parse(localStorage.getItem(`np_chat_sync_${eventId}`) || '[]');
          chatSyncQueue.push({ mockId: mockMsg.id, payload: payload });
          localStorage.setItem(`np_chat_sync_${eventId}`, JSON.stringify(chatSyncQueue));
          cancelReply();
          return;
        }

        const realMsg = await apiFetch('POST', `/events/${eventId}/chat`, payload);
        cancelReply();
        
        // Update mock message to real one if we haven't received it via WebSocket yet
        const idx = chatMessages.findIndex(m => m.id === mockMsg.id);
        if (idx !== -1) {
          chatMessages[idx] = realMsg;
          updateMessageNode(realMsg);
        }

        if (msg.toLowerCase().startsWith('@ai ')) {
          window._aiLoadingShownAt = Date.now();
          showAITypingIndicator();
        }
        if (chatOpen) {
          scrollChatToBottom(true);
        }
      } catch (e) {
        if (!navigator.onLine || e.message === 'Failed to fetch') {
          let chatSyncQueue = JSON.parse(localStorage.getItem(`np_chat_sync_${eventId}`) || '[]');
          chatSyncQueue.push({ mockId: chatMessages[chatMessages.length - 1].id, payload: { message: msg, reply_to_id: replyingToId } });
          localStorage.setItem(`np_chat_sync_${eventId}`, JSON.stringify(chatSyncQueue));
          cancelReply();
        } else {
          showToast('Failed to send message', 'error');
          input.value = msg;
          updateSendBtnVisibility();
          // Remove the mock message if it failed due to bad request
          chatMessages.pop();
          if (chatOpen) renderChatMessages(); // re-render to clear mock message
        }
      }
      requestAnimationFrame(() => {
        input.focus({ preventScroll: true });
        applyChatVisualViewport();
      });
    }

    function keepChatInputFocused() {
      const input = document.getElementById('chat-input');
      if (input && chatOpen) input.focus({ preventScroll: true });
    }

    function handleIncomingChatMsg(data) {
      const myId = parseInt(localStorage.getItem('np_my_id') || '0');
      
      // If it's my own message, see if we have a pending mock message to replace
      if (data.user_id === myId) {
        const mockIdx = chatMessages.findIndex(m => m.id < 0 && m.message === data.message && m.reply_to_id === data.reply_to_id);
        if (mockIdx !== -1) {
          chatMessages[mockIdx] = data;
          updateMessageNode(data);
          return;
        }
      }

      if (chatMessages.some(m => m.id === data.id)) return;
      
      // Mark as delivered if it's from someone else
      if (data.user_id != null && data.user_id !== myId) {
        apiFetch('POST', `/events/${eventId}/chat/${data.id}/status`, { status: 'delivered' }).catch(e => console.warn(e));
      }

      if (data.user_id == null) {
        const showRealResponse = () => {
          hideAITypingIndicator();
          chatMessages.push(data);
          if (chatOpen) {
            const container = document.getElementById('chat-messages');
            const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
            appendChatMessage(data);
            if (isAtBottom) {
              scrollChatToBottom(true);
              markChatAsRead();
            }
          } else {
            chatUnread++;
            updateChatBadge();
          }
        };
        // Ensure typing animation shows for at least 1.5s
        const loadingShownAt = window._aiLoadingShownAt || 0;
        const elapsed = Date.now() - loadingShownAt;
        const minShow = 1500;
        if (elapsed >= minShow) {
          showRealResponse();
        } else {
          setTimeout(showRealResponse, minShow - elapsed);
        }
        return;
      }
      
      chatMessages.push(data);
      if (chatOpen) {
        const container = document.getElementById('chat-messages');
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        appendChatMessage(data);
        if (isAtBottom) {
          scrollChatToBottom(true);
          markChatAsRead();
        }
      } else {
        chatUnread++;
        updateChatBadge();
      }
    }

    function handleIncomingChatReaction(data) {
      const idx = chatMessages.findIndex(m => m.id === data.id);
      if (idx !== -1) {
        chatMessages[idx] = data;
        if (chatOpen) updateMessageNode(data);
      }
    }

    function handleIncomingChatStatus(data) {
      const idx = chatMessages.findIndex(m => m.id === data.id);
      if (idx !== -1) {
        chatMessages[idx] = data;
        if (chatOpen) updateMessageNode(data);
      }
    }

    // Event delegation for context menu to survive DOM updates completely
    document.addEventListener('DOMContentLoaded', () => {
      const picker = document.getElementById('np-emoji-picker');
      if (picker) {
        picker.addEventListener('emoji-click', event => {
          const unicode = event.detail?.unicode || '';
          if (!unicode) return;
          if (emojiPickerMode === 'reaction') {
            sendReactionInlineCtx(unicode);
            closeEmojiTray();
          }
        });
      }

      const sendBtn = document.getElementById('chat-send-btn');
      if (sendBtn) {
        sendBtn.addEventListener('pointerdown', e => e.preventDefault());
        sendBtn.addEventListener('click', e => {
          e.preventDefault();
          sendChatMessage();
        });
      }

      const chatInput = document.getElementById('chat-input');
      if (chatInput) {
        chatInput.addEventListener('focus', () => {
          if (emojiTrayOpen) closeEmojiTray();
          applyChatVisualViewport();
          requestAnimationFrame(applyChatVisualViewport);
        });
      }

      function handleCtxMenuOpen(e) {
        const bubble = e.target.closest('.chat-bubble');
        if (!bubble) return;
        e.preventDefault();
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();

        if (bubble.parentElement.classList.contains('chat-msg-deleted') || bubble.closest('.chat-msg-deleted')) return;

        const id = parseInt(bubble.getAttribute('data-id'));
        const uid = parseInt(bubble.getAttribute('data-uid'));
        const name = bubble.getAttribute('data-sender');
        const text = bubble.getAttribute('data-text');
        openChatMsgCtx(e, id, name, text, uid);
      }

      document.getElementById('chat-messages').addEventListener('dblclick', handleCtxMenuOpen);
      document.getElementById('chat-messages').addEventListener('contextmenu', handleCtxMenuOpen);
    });
    const GROUP_CALL_PREFIX = '[[GROUP_CALL]]';

    function generateUniqueMeetUrl() {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 14));
      return `https://meet.jit.si/np-${id}`;
    }

    function parseGroupCallUrl(text) {
      if (!text) return null;
      if (text.startsWith(GROUP_CALL_PREFIX)) {
        const url = text.slice(GROUP_CALL_PREFIX.length).trim();
        return /^https:\/\/meet\.jit\.si\/[^\s]+$/i.test(url) ? url : null;
      }
      const legacy = text.match(/https:\/\/meet\.jit\.si\/[A-Za-z0-9._-]+/i);
      return legacy ? legacy[0] : null;
    }

    function isGroupCallMessage(text) {
      return !!parseGroupCallUrl(text);
    }

    function formatChatMessageText(text) {
      const meetUrl = parseGroupCallUrl(text);
      if (meetUrl) {
        const href = escHtml(meetUrl).replace(/"/g, '&quot;');
        return `<div class="chat-group-call-card">
          <div class="chat-gc-title">Group call</div>
          <div class="chat-gc-sub">Tap to join the meeting</div>
          <a href="${href}" target="_blank" rel="noopener noreferrer" class="chat-gc-join-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
            Join meeting
          </a>
        </div>`;
      }
      let escaped = escHtml(text);
      // Basic markdown parsing for AI responses
      escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
      escaped = escaped.replace(/\*(.*?)\*/g, '<i>$1</i>');
      escaped = escaped.replace(/\n/g, '<br/>');
      
      return escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>'
      );
    }

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
      const msg = GROUP_CALL_PREFIX + meetUrl;

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
    document.addEventListener('DOMContentLoaded', () => {
      const ptrIndicator = document.createElement('div');
      ptrIndicator.innerHTML = '<div class="loader" style="width:24px;height:24px;margin:auto;"></div>';
      ptrIndicator.style.cssText = 'position:absolute; top:-50px; left:50%; transform:translateX(-50%); z-index:99999; background:var(--card); border-radius:50%; box-shadow:0 4px 12px rgba(0,0,0,0.15); padding:8px; transition:top 0.2s ease; display:flex; align-items:center; justify-content:center; width:40px; height:40px; opacity:0; pointer-events:none;';
      document.body.appendChild(ptrIndicator);

      let ptrStartY = 0;
      let ptrCurrentY = 0;
      let ptrIsPulling = false;
      const ptrThreshold = 75;

      document.addEventListener('touchstart', (e) => {
        const target = e.target.closest('.tbl-sc, .sum-body, .theater-scroll-area');
        // Only start pulling if we're at the top of a scroll area
        if (target && target.scrollTop <= 0) {
          ptrStartY = e.touches[0].clientY;
          ptrCurrentY = ptrStartY; // Fix: Reset currentY so normal clicks don't trigger previous drag distance
          ptrIsPulling = true;
          ptrIndicator.style.transition = 'none';
        } else {
          ptrIsPulling = false;
        }
      }, { passive: true });

      document.addEventListener('touchmove', (e) => {
        if (!ptrIsPulling) return;
        ptrCurrentY = e.touches[0].clientY;
        const dy = ptrCurrentY - ptrStartY;
        if (dy > 0 && dy < 150) {
          ptrIndicator.style.top = (dy / 2 - 40) + 'px';
          ptrIndicator.style.opacity = Math.min(dy / 100, 1).toString();
          
          if(dy > ptrThreshold) {
             ptrIndicator.querySelector('.loader').style.borderTopColor = 'var(--teal)';
          } else {
             ptrIndicator.querySelector('.loader').style.borderTopColor = 'var(--primary)';
          }
        }
      }, { passive: true });

      document.addEventListener('touchend', async (e) => {
        if (!ptrIsPulling) return;
        ptrIsPulling = false;
        const dy = ptrCurrentY - ptrStartY;
        ptrIndicator.style.transition = 'top 0.3s ease, opacity 0.3s ease';
        
        if (dy > ptrThreshold) {
          ptrIndicator.style.top = '20px';
          ptrIndicator.style.opacity = '1';
          if(typeof loadAll === 'function') {
            await loadAll(true, true); // True (background mode) prevents the screen from blinking
          }
          ptrIndicator.style.top = '-50px';
          ptrIndicator.style.opacity = '0';
        } else {
          ptrIndicator.style.top = '-50px';
          ptrIndicator.style.opacity = '0';
        }
      });
    });
    async function shareReceipt(donorName, amount, dateStr, collectorName) {
      const eventName = typeof eventData !== 'undefined' && eventData ? eventData.name : 'Event';
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

