
    if (localStorage.getItem("np_dark")) {
      document.documentElement.classList.add("dark-mode");
      window.addEventListener('DOMContentLoaded', () => document.body.classList.add("dark-mode"));
    }
  

    // ── State ──
    const params = new URLSearchParams(location.search);
    const eventId = parseInt(params.get("id"));
    let eventData = null;
    let myUserId = null;
    let isOrganizer = false;
    let isActive = true;
    let donations = [];
    let expenses = [];
    let members = [];
    let currentTab = params.get("tab") || "don";
    let ctxTarget = null; // { type:'don'|'exp', entry, row }
    let editTarget = null;
    let isVisitor = false;
    let activeTheaterTab = params.get("theater");
    let theaterRotation = 0;
    const tabRotations = { don: 0, exp: 0, sum: 0 };
    let summaryData = null; // Backend Summary data
    let ws = null; // WebSocket connection
    let vTxnsCount = 5; // Global activity count

    if (!eventId || isNaN(eventId)) {
      console.error("Invalid or missing eventId:", params.get("id"));
      window.location.replace("dashboard.html");
    }

    async function init() {
      const user = await waitForAuthReady();
      if (!user) return; // auth-guard.js will handle redirect

      const loader = document.getElementById("loading-pane");
      const loadTimeout = setTimeout(() => {
        if (loader && loader.style.display !== "none") {
          loader.innerHTML = `<div style="text-align:center; padding:20px;"><div style="font-size:40px; margin-bottom:10px;">⏳</div><div style="font-weight:bold; margin-bottom:5px;">Taking longer than usual...</div><div style="font-size:12px; color:var(--text3); margin-bottom:20px;">Check your connection or try again.</div><button class="pbk" onclick="location.reload()">Retry Now</button></div>`;
        }
      }, 10000);

      try {
        const profile = await getMyProfile();
        myUserId = profile.id;
        // Also set sessionStorage as a backup for other functions
        sessionStorage.setItem("np_my_id", myUserId);

        setupWebSocket();
        await loadAll();
      } catch (e) {
        console.error("Init failed:", e);
        const loader = document.getElementById("loading-pane");
        if (loader) {
          loader.innerHTML = `<div style="text-align:center; padding:20px;"><div style="font-size:40px; margin-bottom:10px;">❌</div><div style="font-weight:bold; margin-bottom:5px;">Load Failed</div><div style="font-size:12px; color:var(--text3); margin-bottom:20px;">${e.message || "Unknown error"}</div><button class="pbk" onclick="location.reload()">Retry</button></div>`;
        }
      } finally {
        clearTimeout(loadTimeout);
      }
    }

    let sessionAuthorized = false; // Flag to allow active visitors to stay

    init();

    // Re-check access every time user returns to this tab
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible") {
        // If data changed, force a FRESH fetch to avoid stale cache flickers
        loadAll(true, true);
      }
    });


    function applyData(res) {
      eventData = res.event;
      donations = res.donations;
      expenses = res.expenses;
      summaryData = res.summary;
      members = res.members || [];

      const rawRole = (res.my_role || "visitor").toLowerCase();
      const myIdStr = sessionStorage.getItem("np_my_id");
      const myId = myIdStr ? parseInt(myIdStr) : -1;

      // Robust check: Ensure types match for comparison
      const orgId = parseInt(eventData.organizer_id);
      isOrganizer = (rawRole === "organizer") || (orgId === myId);
      isOrganizerGlobal = isOrganizer;
      isVisitor = (rawRole === "visitor") && !isOrganizer;
      isRestricted = res.is_restricted || false;

      renderPage();
      // Real-time update for Theater Mode: If active, re-enter to refresh columns/data
      if (typeof activeTheaterTab !== 'undefined' && activeTheaterTab) {
        enterTheater(activeTheaterTab);
      }

      // Silently fetch chat history to calculate accurate unread count on page load
      if (!chatHistoryLoaded) {
        loadChatHistory(false, true);
      }
    }

    async function loadAll(isBackground = false, forceFresh = false) {
      if (!isBackground && !forceFresh) {
        // RESET GLOBALS
        isOrganizer = false;
        isOrganizerGlobal = false;
        isVisitor = true;
        isRestricted = false;

        // PLACE 2: Hybrid Caching (Frontend)
        const cacheKey = "ev_cache_" + eventId;
        const cached = sessionStorage.getItem(cacheKey);
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
        sessionStorage.setItem("ev_cache_" + eventId, JSON.stringify(res));

        // Apply Fresh Data
        applyData(res);
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
                <button onclick="window.location.href='dashboard.html'" class="pbk" 
                  style="margin-top:10px; padding:14px 40px; border-radius:18px; background:var(--primary); color:white; font-weight:900; box-shadow: 0 8px 20px rgba(0,0,0,0.1);">
                  ← Back to Dashboard
                </button>
              </div>
            `;
          }
        } else {
          renderPage();
        }
      }
    }

    function setupWebSocket() {
      if (ws) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Hardcode port 8000 for the backend
      const host = window.location.hostname + ":8000";

      ws = new WebSocket(`${protocol}//${host}/ws/${eventId}`);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "DATA_CHANGED") {
          console.log("📢 Real-time update received. Forcing fresh fetch.");
          loadAll(true, true);
        }
        if (msg.type === "NEW_CHAT_MSG" && msg.data) {
          handleIncomingChatMsg(msg.data);
        }
        if (msg.type === "CHAT_REACTION" && msg.data) {
          handleIncomingChatReaction(msg.data);
        }
      };

      ws.onclose = () => {
        ws = null;
        // Reconnect after 5 seconds if connection lost
        setTimeout(setupWebSocket, 5000);
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

        // GRACEFUL LOCKOUT: If they were already in, let them stay until refresh
        if (sessionAuthorized) canSeeData = true;
        else if (canSeeData) sessionAuthorized = true; // First successful load

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
        if (date) date.textContent = "📅 " + formatDate(eventData.event_date);
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
        if (donVisLbl) donVisLbl.textContent = showDon ? "Hide Donations Table" : "Show Donations Table";
        if (expVisLbl) expVisLbl.textContent = showExp ? "Hide Expenses Table" : "Show Expenses Table";
        const donVisBtn = document.getElementById("don-visibility-btn");
        const expVisBtn = document.getElementById("exp-visibility-btn");
        if (donVisBtn) donVisBtn.style.display = isOrganizer ? "flex" : "none";
        if (expVisBtn) expVisBtn.style.display = isOrganizer ? "flex" : "none";

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
            const icon = isRestricted ? "🚫" : "🔒";
            const sub = isRestricted ? "You have been restricted by the organizer." : (!isEventActive ? "The organizer has deactivated this event." : "The organizer has turned off public access.");

            lp.innerHTML = `
              <div style="text-align:center; padding:20px;">
                <div style="font-size:72px; margin-bottom:20px;">${icon}</div>
                <div style="font-family:'Nunito',sans-serif;font-size:24px;font-weight:900;color:var(--text);margin-bottom:8px;">${msg}</div>
                <div style="font-size:15px;color:var(--text3);line-height:1.6;max-width:300px;margin:0 auto 24px;">${sub}</div>
                <button onclick="window.location.href='dashboard.html'" class="pbk" 
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
            mb.textContent = "👥 Members";
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
        switchTab(defaultTab, false);
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
    function switchTab(tab, updateUrl = true) {
      currentTab = tab;
      if (updateUrl) {
        const p = new URLSearchParams(window.location.search);
        p.set("tab", tab);
        history.replaceState(null, "", "?" + p.toString());
      }
      ["don", "exp", "sum"].forEach(t => {
        const el = document.getElementById("tab-" + t);
        if (el) el.classList.toggle("active", t === tab);
        const p = document.getElementById("pane-" + t);
        if (p) p.style.display = t === tab ? (t === "sum" ? "block" : "flex") : "none";
        if (p && t !== "sum") p.style.flexDirection = "column";
      });
      if (tab === "don") renderDonations();
      if (tab === "exp") renderExpenses();
      if (tab === "sum") { vTxnsCount = 5; renderSummary(); }
      else vTxnsCount = 5;
    }

    // ── Donations ──
    function renderDonations(q = "") {
      const q2 = q.trim().toLowerCase();
      const filtered = q2 ? donations.filter(d => d.donor_name.toLowerCase().includes(q2)) : donations;
      const total = donations.reduce((s, d) => s + (d.amount || 0), 0);
      document.getElementById("don-count").textContent = `${filtered.length} donor${filtered.length !== 1 ? "s" : ""}`;
      document.getElementById("don-total").innerHTML = `Total: <span class="sum-g">${formatINR(total)}</span>`;

      const tblBody = document.getElementById("don-tbl-body");
      tblBody.innerHTML = "";
      const customCols = eventData.donation_custom_columns || [];

      // 1. Render Header Row
      const hdr = document.createElement("div");
      hdr.className = "tr hdr-row";
      hdr.innerHTML = `<div class="th sticky-col">Name</div>
                   <div class="th" style="width:90px;">Amount</div>
                   <div class="th" style="width:100px;">Date</div>
                   <div class="th" style="width:130px;">Collected By</div>`;

      customCols.forEach(col => {
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
        filtered.forEach((d, i) => {
          const row = document.createElement("div");
          row.className = "tr" + (i % 2 ? " alt" : "");

          const customCells = customCols.map(col => {
            const colName = typeof col === "string" ? col : col.n;
            const colWidth = typeof col === "string" ? 180 : (col.w || 180);
            const val = (d.custom_fields && d.custom_fields[colName]) || "";
            return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
          }).join("");

          row.innerHTML = `
        <div class="fc sticky-col" style="display: block !important; line-height: 38px; text-align: left !important; padding-left: 6px !important;">${escHtml(d.donor_name)}</div>
        <div class="sc" style="width:90px;"><span class="cg">${d.amount ? formatINR(d.amount) : '<span class="cm">—</span>'}</span></div>
        <div class="sc" style="width:100px;font-size:11px;">${formatDate(d.collected_at)}</div>
        <div class="sc" style="width:130px;font-size:11px;" title="${escHtml(d.collected_by_name || "—")}">${escHtml(d.collected_by_name || "—")}</div>
        ${customCells}
      `;
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
        const btnHtml = isOrganizer && !q ? `<button class="ef-save" style="margin-top:12px; width:auto; padding:10px 24px;" onclick="openEntryForm('don')">+ Add First Donation</button>` : "";
        emptyMsg.innerHTML = `<div class="empty-state" style="padding:40px 24px; border-top:1px solid var(--border2);">
      <div class="es-icon" style="font-size:32px; margin-bottom:8px;">${q ? '🔍' : '📋'}</div>
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
        nr.innerHTML = `<div class="fc sticky-col" style="background:transparent!important; border:none; box-shadow:none; width: 200px !important; max-width: 200px !important; min-width: 200px !important; display: block !important; text-align: left !important; padding-left: 14px !important; line-height: 38px;"><span style="margin-right:8px; font-size:16px;">+</span> New entry</div>`;
        tblBody.appendChild(nr);
      }
    }

    // ── Expenses ──
    function renderExpenses(q = "") {
      const q2 = q.trim().toLowerCase();
      const filtered = q2 ? expenses.filter(e => e.description.toLowerCase().includes(q2)) : expenses;
      const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      document.getElementById("exp-count").textContent = `${filtered.length} expense${filtered.length !== 1 ? "s" : ""}`;
      document.getElementById("exp-total").innerHTML = `Total: <span class="sum-r">${formatINR(total)}</span>`;

      const tblBody = document.getElementById("exp-tbl-body");
      tblBody.innerHTML = "";
      const customCols = eventData.expense_custom_columns || [];

      // 1. Render Header Row
      const hdr = document.createElement("div");
      hdr.className = "tr hdr-row";
      hdr.innerHTML = `<div class="th sticky-col">Description</div>
                   <div class="th" style="width:90px;">Amount</div>
                   <div class="th" style="width:100px;">Date</div>
                   <div class="th" style="width:130px;">Added By</div>`;

      customCols.forEach(col => {
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
        filtered.forEach((e, i) => {
          const row = document.createElement("div");
          row.className = "tr" + (i % 2 ? " alt" : "");

          const customCells = customCols.map(col => {
            const colName = typeof col === "string" ? col : col.n;
            const colWidth = typeof col === "string" ? 180 : (col.w || 180);
            const val = (e.custom_fields && e.custom_fields[colName]) || "";
            return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
          }).join("");

          row.innerHTML = `
        <div class="fc sticky-col" style="display: block !important; line-height: 38px; text-align: left !important; padding-left: 6px !important;">${escHtml(e.description)}</div>
        <div class="sc" style="width:90px;"><span class="cr">${e.amount ? formatINR(e.amount) : '<span class="cm">—</span>'}</span></div>
        <div class="sc" style="width:100px;font-size:11px;">${formatDate(e.collected_at)}</div>
        <div class="sc" style="width:130px;font-size:11px;" title="${escHtml(e.collected_by_name || "—")}">${escHtml(e.collected_by_name || "—")}</div>
        ${customCells}
      `;
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
        const btnHtml = isOrganizer && !q ? `<button class="ef-save" style="margin-top:12px; width:auto; padding:10px 24px;" onclick="openEntryForm('exp')">+ Add First Expense</button>` : "";
        emptyMsg.innerHTML = `<div class="empty-state" style="padding:40px 24px; border-top:1px solid var(--border2);">
      <div class="es-icon" style="font-size:32px; margin-bottom:8px;">${q ? '🔍' : '📋'}</div>
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
        nr.innerHTML = `<div class="fc sticky-col" style="background:transparent!important; border:none; box-shadow:none; width: 200px !important; max-width: 200px !important; min-width: 200px !important; display: block !important; text-align: left !important; padding-left: 14px !important; line-height: 38px;"><span style="margin-right:8px; font-size:16px;">+</span> New entry</div>`;
        tblBody.appendChild(nr);
      }
    }

    // ── Summary ──
    // ── Summary ──
    async function renderSummary(mode = 0, containerId = "sum-body") { // 1: More, -1: Less
      if (mode === 1) vTxnsCount += 5;
      else if (mode === -1) vTxnsCount = 5;

      if (summaryData) {
        renderSummaryUI(summaryData, false, containerId);
        return;
      }
    }

    function renderSummaryUI(data, isTheater, containerId) {
      const body = document.getElementById(containerId || "sum-body");
      const s = data;
      const bal = s.balance;

      // Top Donors (Ranked)
      const donorTotals = {};
      donations.forEach(d => {
        const name = d.donor_name;
        if (!donorTotals[name]) donorTotals[name] = 0;
        donorTotals[name] += (d.amount || 0);
      });
      const topDonors = Object.entries(donorTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      // Top Expenses (Ranked)
      const topExpenses = [...expenses]
        .sort((a, b) => (b.amount || 0) - (a.amount || 0))
        .slice(0, 5);

      const spendRatio = s.total_donations > 0 ? (s.total_expenses / s.total_donations) * 100 : 0;

      // Top Collectors (Ranked)
      const collectorTotals = {};
      donations.forEach(d => {
        const name = d.collected_by_name || 'System';
        if (!collectorTotals[name]) collectorTotals[name] = 0;
        collectorTotals[name] += (d.amount || 0);
      });
      const topCollectors = Object.entries(collectorTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      // Table visibility flags
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;

      const html = `
      <div style="padding: 10px; max-width: 500px; margin: 0 auto;">
        <!-- Available Balance -->
        <div style="background:var(--primary-dk); border-radius:18px; padding:20px; margin-bottom:12px; color:white; box-shadow:0 10px 20px -5px rgba(0,0,0,0.3); text-align:center;">
          <div style="font-size:12px; font-weight:800; opacity:0.8; text-transform:uppercase; letter-spacing:1px;">Available Balance</div>
          <div style="font-size:32px; font-weight:900; margin:4px 0;">${formatINR(Math.abs(bal))}</div>
          <div style="font-size:11px; font-weight:700; opacity:0.9;">${bal >= 0 ? "🟢 SURPLUS STATUS" : "🔴 DEFICIT ALERT"} · REAL-TIME</div>
        </div>

        <div class="stats" style="display:flex; gap:10px; margin-bottom:12px;">
          ${showDon ? `<div style="flex:1; background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:12px; text-align:center;">
            <div style="font-size:11px; font-weight:800; color:var(--text3);">COLLECTED</div>
            <div style="font-size:16px; font-weight:900; color:var(--green);">${formatINR(s.total_donations)}</div>
          </div>` : ''}
          ${showExp ? `<div style="flex:1; background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:12px; text-align:center;">
            <div style="font-size:11px; font-weight:800; color:var(--text3);">SPENT</div>
            <div style="font-size:16px; font-weight:900; color:var(--red);">${formatINR(s.total_expenses)}</div>
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

          <!-- Top Donors (only if donations visible) -->
          ${showDon ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">Top Donors</span>
              <span>🏆</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topDonors.length ? topDonors.map((d, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--row-alt); border-radius:10px;">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px;">
                    <span style="opacity:0.4;">${i + 1}</span> ${escHtml(d[0])}
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--green);">${formatINR(d[1])}</div>
                </div>
              `).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No donations yet</div>'}
            </div>
          </div>` : ''}

          <!-- High Outflows (only if expenses visible) -->
          ${showExp ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">High Outflows</span>
              <span>💸</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topExpenses.length ? topExpenses.map((exp, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--row-alt); border-radius:10px;">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px;">
                    <span style="opacity:0.4;">${i + 1}</span> ${escHtml(exp.description)}
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--red);">${formatINR(exp.amount)}</div>
                </div>
              `).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No expenses yet</div>'}
            </div>
          </div>` : ''}

          <!-- Top Collectors (only if donations visible) -->
          ${showDon ? `<div style="background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:14px; box-shadow:var(--shadow-sm);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:14px; font-weight:900; color:var(--text);">Top Collectors</span>
              <span>🎖️</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              ${topCollectors.length ? topCollectors.map((c, i) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--row-alt); border-radius:10px;">
                  <div style="font-size:13px; font-weight:800; color:var(--text); display:flex; gap:8px;">
                    <span style="opacity:0.4;">${i + 1}</span> ${escHtml(c[0])}
                  </div>
                  <div style="font-size:14px; font-weight:900; color:var(--primary);">${formatINR(c[1])}</div>
                </div>
              `).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No collections yet</div>'}
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
                  ${t.type === 'donation' ? '+' : '-'}${formatINR(t.amount)}
                </div>
                <div style="font-size:9px; font-weight:800; color:var(--text3);">${t.type.toUpperCase()}</div>
              </div>
            </div>
          `).join("")}
          
          <div style="display:flex; background:var(--row-alt); border-top:1px solid var(--border2);">
            ${s.recent_transactions.length > vTxnsCount ? `
              <div style="flex:1; padding:14px; text-align:center; cursor:pointer; font-size:12.5px; font-weight:900; color:var(--primary); border-right:1px solid var(--border2);" onclick="renderSummary(1, '${containerId}')">
                SHOW MORE ACTIVITY
              </div>
            ` : ""}
            ${vTxnsCount > 5 ? `
              <div style="flex:1; padding:14px; text-align:center; cursor:pointer; font-size:12.5px; font-weight:900; color:var(--text3);" onclick="renderSummary(-1, '${containerId}')">
                COLLAPSE LIST
              </div>
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
    function openEntryForm(type) {
      entryType = type;
      document.getElementById("ef-title").textContent = type === "don" ? "New Donation" : "New Expense";
      document.getElementById("ef-name-label").textContent = type === "don" ? "Donor Name *" : "Description *";
      document.getElementById("ef-name").value = "";
      document.getElementById("ef-amount").value = "";

      const customDiv = document.getElementById("ef-custom-fields");
      customDiv.innerHTML = "";
      const cols = type === "don" ? eventData.donation_custom_columns : eventData.expense_custom_columns;
      if (cols && cols.length) {
        cols.forEach(col => {
          const colName = typeof col === "string" ? col : col.n;
          customDiv.innerHTML += `<div class="ef-field">
        <div class="ef-label">${escHtml(colName)}</div>
        <input class="ef-input dynamic-cf" data-col="${escHtml(colName)}" type="text" placeholder="Enter ${escHtml(colName)}"/>
      </div>`;
        });
      }

      document.getElementById("entry-form-ov").style.display = "flex";
      setTimeout(() => document.getElementById("ef-name").focus(), 100);
    }
    function closeEntryForm() { document.getElementById("entry-form-ov").style.display = "none"; }

    async function saveEntry(skipDupCheck = false) {
      const name = document.getElementById("ef-name").value.trim();
      const amount = document.getElementById("ef-amount").value;
      const btn = document.getElementById("ef-save-btn");
      if (!name) { showToast("Name is required.", "error"); return; }

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
          openDupPop(() => saveEntry(true), existingName, existing.amount, entryType);
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
        updateTheaterStats();
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
        closeEntryForm();
        showToast("Saved!");
      } catch (e) {
        showToast(e.message || "Failed to save.", "error");
      }
      btn.disabled = false; btn.textContent = "Save";
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
      if (!isOrganizer && entry.collected_by !== myUserId) {
        return;
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
      ctx.innerHTML = `
    <div class="ctx-lbl">${escHtml(name)}</div>
    <div class="ctx-item" onclick="closeCtx();openEditForm()">✏️ Modify</div>
    <div class="ctx-item dng" onclick="closeCtx();openDelPop()">🗑️ Delete</div>
  `;
      ctx.style.cssText = `left:${Math.min(e.clientX, window.innerWidth - 190)}px;top:${e.clientY - 10}px;`;
      ov.appendChild(ctx);
      document.body.appendChild(ov);
    }
    function closeCtx() { const ov = document.getElementById("ctx-ov"); if (ov) ov.remove(); }

    function openEditForm() {
      const name = ctxType === "don" ? ctxEntry.donor_name : ctxEntry.description;
      document.getElementById("edit-name-label").textContent = ctxType === "don" ? "Donor Name" : "Description";
      document.getElementById("edit-name").value = name;
      document.getElementById("edit-amount").value = ctxEntry.amount || "";

      const customDiv = document.getElementById("edit-custom-fields");
      customDiv.innerHTML = "";
      const cols = ctxType === "don" ? eventData.donation_custom_columns : eventData.expense_custom_columns;
      if (cols && cols.length) {
        cols.forEach(col => {
          const colName = typeof col === "string" ? col : col.n;
          const val = (ctxEntry.custom_fields && ctxEntry.custom_fields[colName]) || "";
          customDiv.innerHTML += `<div class="ef-field">
        <div class="ef-label">${escHtml(colName)}</div>
        <input class="ef-input dynamic-edit-cf" data-col="${escHtml(colName)}" type="text" value="${escHtml(val)}"/>
      </div>`;
        });
      }

      editTarget = { type: ctxType, entry: ctxEntry };
      document.getElementById("edit-form-ov").style.display = "flex";
    }
    function closeEditForm() { document.getElementById("edit-form-ov").style.display = "none"; }

    async function saveEdit(skipDupCheck = false) {
      const name = document.getElementById("edit-name").value.trim();
      const amount = document.getElementById("edit-amount").value;
      const btn = document.getElementById("edit-save-btn");
      if (!name) { showToast("Name is required.", "error"); return; }

      const customFields = {};
      document.querySelectorAll("#edit-custom-fields .dynamic-edit-cf").forEach(inp => {
        customFields[inp.dataset.col] = inp.value.trim();
      });

      // Duplicate Check (excluding current entry)
      if (!skipDupCheck) {
        const amtVal = amount ? parseFloat(amount) : null;
        let existing = null;
        if (editTarget.type === "don") {
          existing = donations.find(d => d.id !== editTarget.entry.id && d.donor_name.toLowerCase() === name.toLowerCase());
        } else {
          existing = expenses.find(e => e.id !== editTarget.entry.id && e.description.toLowerCase() === name.toLowerCase());
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
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
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

    function openDelColPop() {
      if (!editingColName) return;
      document.getElementById("del-col-nm").textContent = editingColName;
      document.getElementById("del-col-pop").style.display = "flex";
    }
    function closeDelColPop() { document.getElementById("del-col-pop").style.display = "none"; }

    async function confirmDeleteColumn() {
      try {
        const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
        const existing = eventData[key] || [];
        const updated = existing.filter(c => {
          const n = typeof c === "string" ? c : c.n;
          return n !== editingColName;
        });

        const data = {}; data[key] = updated;
        const res = await updateEvent(eventId, data);
        eventData[key] = res[key];
        if (activeColType === "don") renderDonations(); else renderExpenses();
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
        closeCustomColSheet();
        closeDelColPop();
        showToast("Column deleted.");
      } catch (e) {
        showToast(e.message || "Failed.", "error");
        closeDelColPop();
      }
    }

    async function confirmDelete() {
      try {
        if (ctxType === "don") { await deleteDonation(eventId, ctxEntry.id); donations = donations.filter(d => d.id !== ctxEntry.id); renderDonations(); }
        else { await deleteExpense(eventId, ctxEntry.id); expenses = expenses.filter(e => e.id !== ctxEntry.id); renderExpenses(); }
        summaryData = null; // Invalidate cache
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
        closeDelPop(); showToast("Entry deleted.");
      } catch (e) { showToast(e.message || "Failed.", "error"); closeDelPop(); }
    }

    // ── Organizer/Collector Dropdowns ──
    function openDD() { document.getElementById("dd-ov").style.display = "block"; }
    function closeDD() { document.getElementById("dd-ov").style.display = "none"; }

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
        sessionStorage.removeItem("ev_cache_" + eventId);
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
        sessionStorage.removeItem("ev_cache_" + eventId);
        window.location.replace("dashboard.html");
      } catch (e) {
        if (lp) lp.style.display = "none";
        showToast(e.message || "Error removing event.", "error");
      }
    }

    async function revokeCode() {
      if (!confirm("Are you sure you want to revoke this code? Existing members keep access, but no one new can join.")) return;
      await apiCall(`/events/${eventId}/generate_code`, "POST");
      loadAll();
    }

    function clearEventCache() {
      const myId = sessionStorage.getItem("np_my_id") || "guest";
      sessionStorage.removeItem(`event_cache_${eventId}_u${myId}`);
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
        showToast(newVal ? `${type === 'don' ? 'Donations' : 'Expenses'} table is now visible` : `${type === 'don' ? 'Donations' : 'Expenses'} table hidden`, newVal ? "success" : "info");
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
    function copyCode() { copyToClipboard(eventData.invite_code || "", "Code copied!"); }
    function shareCode() {
      const code = eventData.invite_code || "";
      if (navigator.share) {
        navigator.share({ title: "Join " + eventData.name, text: "Use code: " + code }).catch(() => { });
      } else {
        copyCode();
        showToast("Share blocked on HTTP - Code copied!", "default");
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
      list.innerHTML = members.map(m => {
        const uId = m.user_id;
        const uName = m.user?.full_name || "Unknown";
        const isMe = uId === myUserId;
        const roleStr = (m.role || "").toLowerCase();
        const isRes = m.is_restricted;
        const isCreator = uId === eventData.organizer_id;

        const roleTxt = isRes ? '<span style="color:var(--red);font-weight:800;">Restricted</span>' : (isCreator ? '<span style="color:var(--amber);font-weight:800;">👑 Creator</span>' : (m.role === "Organizer" ? "Organizer" : "Collector"));

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
      document.getElementById("mctx-promote").textContent = role.toLowerCase() === "organizer" ? "Demote to Collector" : "👑 Make Organizer";
      document.getElementById("mctx-restrict").textContent = res ? "✅ Unrestrict User" : "🚫 Restrict User";

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

    function handlePromoteClick() {
      closeMCtx();
      if (memTarget.role.toLowerCase() === "organizer") {
        document.getElementById("demote-user-name").textContent = memTarget.name;
        document.getElementById("demote-pop").style.display = "flex";
      } else {
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
          if (m) m.role = "collector";
        }
        document.getElementById("demote-pop").style.display = "none";
        showToast(`${memTarget.name} is now a Collector.`);
        clearEventCache();
        openMembersSheet();
        if (memTarget.id === myUserId) loadAll();
      } catch (e) {
        showToast(e.message || "Failed to demote.", "error");
      }
    }

    async function confirmPromote() {
      try {
        await apiFetch("PUT", `/events/${eventId}/members/${memTarget.id}/role`, { role: "Organizer" });
        // Proactively update local members array
        if (members) {
          const m = members.find(x => x.user_id === memTarget.id);
          if (m) m.role = "organizer";
        }
        document.getElementById("promote-pop").style.display = "none";
        showToast(`${memTarget.name} is now an Organizer!`);
        clearEventCache();
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

    function setCCWidth(w, id) {
      const v = parseInt(w);
      document.getElementById("cc-width").value = v;
      updateCCPreview(v);
    }
    function updateCCPreview(w) {
      const v = parseInt(w);
      document.getElementById("cc-size-label").textContent = `Adjust Width`;
      document.getElementById("cc-width-display").textContent = v + "px";
      document.getElementById("cc-preview").style.width = v + "px";

      const preview = document.getElementById("cc-preview-text");
      preview.textContent = "Column Width";
    }

    function highlightPreset(w) {
      const v = parseInt(w);
      document.querySelectorAll(".w-btn").forEach(b => b.classList.remove("active"));
      if (v === 70) document.getElementById("w-n").classList.add("active");
      else if (v === 140) document.getElementById("w-m").classList.add("active");
      else if (v === 180) document.getElementById("w-s").classList.add("active");
      else if (v === 250) document.getElementById("w-w").classList.add("active");
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
      updateCharCount(inp);
      setCCWidth(180);
      document.getElementById("cc-add-btns").style.display = "flex";
      document.getElementById("cc-edit-btns").style.display = "none";
      document.getElementById("cc-error").style.display = "none";
      document.getElementById("custom-col-sheet").style.display = "flex";
      setTimeout(() => inp.focus(), 100);
    }

    function openEditCol(name, type) {
      activeColType = type;
      editingColName = name;
      document.getElementById("cc-sheet-title").textContent = "Update Column";
      document.getElementById("cc-sheet-sub").textContent = `Editing: ${name}`;
      const inp = document.getElementById("cc-name");
      inp.value = name;
      updateCharCount(inp);

      // Find current width
      const key = type === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const colObj = (eventData[key] || []).find(c => (typeof c === 'string' ? c : c.n) === name);
      const w = (colObj && typeof colObj === 'object') ? (colObj.w || 180) : 180;
      setCCWidth(w);

      document.getElementById("cc-add-btns").style.display = "none";
      document.getElementById("cc-edit-btns").style.display = "flex";
      document.getElementById("cc-error").style.display = "none";
      document.getElementById("custom-col-sheet").style.display = "flex";
    }

    function closeCustomColSheet() {
      document.getElementById("custom-col-sheet").style.display = "none";
    }

    async function saveCustomColumn() {
      const newName = document.getElementById("cc-name").value.trim();
      const width = parseInt(document.getElementById("cc-width").value) || 180;
      if (!newName) return;

      const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existingRecords = eventData[key] || [];
      const existingNames = existingRecords.map(c => (typeof c === 'string' ? c : c.n).toLowerCase());
      const errorEl = document.getElementById("cc-error");

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
        if (activeColType === "don") renderDonations(); else renderExpenses();
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
        closeCustomColSheet();
        showToast("Column added!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }
    async function renameCustomColumn() {
      const newName = document.getElementById("cc-name").value.trim();
      const width = parseInt(document.getElementById("cc-width").value) || 180;
      if (!newName || !editingColName) return;

      const key = activeColType === "don" ? "donation_custom_columns" : "expense_custom_columns";
      const existing = eventData[key] || [];
      const errorEl = document.getElementById("cc-error");

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

        if (activeColType === "don") renderDonations(); else renderExpenses();
        if (activeTheaterTab) switchTheaterTab(activeTheaterTab);
        closeCustomColSheet();
        showToast("Column renamed!");
      } catch (e) { showToast(e.message || "Failed.", "error"); }
    }

    async function deleteCustomColumn() {
      openDelColPop();
    }

    function renderTable(type, isTheater = false) {
      const container = document.createElement("div");
      container.className = "tbl-inner" + (isTheater ? " is-theater-table" : "");

      const role = isOrganizer ? "organizer" : (isVisitor ? "visitor" : "collector");
      const list = type === "don" ? donations : expenses;
      const customCols = type === "don" ? (eventData.donation_custom_columns || []) : (eventData.expense_custom_columns || []);

      // Header
      const hdrRow = document.createElement("div");
      hdrRow.className = "hdr-row";

      const hName = document.createElement("div");
      hName.className = "th sticky-col";
      hName.textContent = type === "don" ? "NAME" : "DESCRIPTION";
      hdrRow.appendChild(hName);

      const hAmt = document.createElement("div");
      hAmt.className = "th";
      hAmt.textContent = "AMOUNT";
      hAmt.style.width = "100px";
      hdrRow.appendChild(hAmt);

      const hDate = document.createElement("div");
      hDate.className = "th";
      hDate.textContent = "DATE";
      hDate.style.width = "110px";
      hdrRow.appendChild(hDate);

      if (type === "don") {
        const hCol = document.createElement("div");
        hCol.className = "th";
        hCol.textContent = "COLLECTED BY";
        hCol.style.width = "140px";
        hdrRow.appendChild(hCol);
      }

      customCols.forEach((c, idx) => {
        const th = document.createElement("div");
        th.className = "th";
        const colName = typeof c === "string" ? c : c.n;

        if (isOrganizer && !isVisitor) {
          th.style.cursor = "pointer";
          th.title = "Click to Edit Column";
          th.onclick = (e) => { e.stopPropagation(); openEditCol(colName, type); };
          th.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
              <span>${colName.toUpperCase()}</span>
              <div style="display:flex; gap:4px; opacity:0.6;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              </div>
            </div>
          `;
        } else {
          th.textContent = colName.toUpperCase();
        }

        th.style.width = (typeof c === "string" ? 180 : c.w) + "px";
        hdrRow.appendChild(th);
      });

      container.appendChild(hdrRow);

      // Rows
      list.forEach((entry, i) => {
        const tr = document.createElement("div");
        tr.className = "tr" + (i % 2 !== 0 ? " alt" : "");
        tr.onclick = (e) => openCtx(e, type, entry);

        const cName = document.createElement("div");
        cName.className = "fc sticky-col";
        cName.style.cssText = "display: block !important; line-height: 38px; text-align: left !important; padding-left: 6px !important;";
        cName.textContent = entry.donor_name || entry.description;
        tr.appendChild(cName);

        const cAmt = document.createElement("div");
        cAmt.className = "sc";
        cAmt.style.width = "100px";
        cAmt.innerHTML = `<span style="font-weight:800; color:${type === "don" ? "var(--green)" : "var(--red)"};">₹${(entry.amount || 0).toLocaleString()}</span>`;
        tr.appendChild(cAmt);

        const cDate = document.createElement("div");
        cDate.className = "sc";
        cDate.style.width = "110px";
        cDate.textContent = formatDate(entry.collected_at);
        tr.appendChild(cDate);

        if (type === "don") {
          const cCol = document.createElement("div");
          cCol.className = "sc";
          cCol.style.width = "140px";
          cCol.textContent = entry.collected_by_name || "-";
          tr.appendChild(cCol);
        }

        customCols.forEach(c => {
          const n = typeof c === "string" ? c : c.n;
          const sc = document.createElement("div");
          sc.className = "sc";
          sc.style.width = (typeof c === "string" ? 180 : c.w) + "px";
          sc.textContent = (entry.custom_fields && entry.custom_fields[n]) || "-";
          tr.appendChild(sc);
        });

        container.appendChild(tr);
      });

      // New Entry Row
      if (!isVisitor && (role === "organizer" || role === "collector")) {
        const nr = document.createElement("div");
        nr.className = "tr new-row";
        nr.onclick = () => openEntryForm(type);
        nr.innerHTML = `<div class="fc sticky-col" style="background:transparent!important; border:none; box-shadow:none; width: 200px !important; max-width: 200px !important; min-width: 200px !important; display: block !important; text-align: left !important; padding-left: 14px !important; line-height: 38px;"><span style="margin-right:8px; font-size:16px;">+</span> New entry</div>`;
        container.appendChild(nr);
      }

      return container;
    }

    function cycleRotation(requestedTab) {
      const tab = requestedTab || activeTheaterTab;
      if (!tab) return;

      const el = document.getElementById("rot-main");
      if (!el) return;

      const isMobile = window.innerWidth <= 1024;

      if (!activeTheaterTab) {
        theaterRotation = isMobile ? 90 : 0;
        tabRotations[tab] = theaterRotation;
        document.body.classList.remove("is-rotated-90", "is-rotated-180", "is-rotated-270");
        if (theaterRotation !== 0) document.body.classList.add("is-rotated-" + theaterRotation);
        enterTheater(tab);
        return;
      }

      el.style.opacity = "0";
      setTimeout(() => {
        theaterRotation = (theaterRotation === 0) ? 90 : 0;
        tabRotations[tab] = theaterRotation;
        document.body.classList.remove("is-rotated-90", "is-rotated-180", "is-rotated-270");
        if (theaterRotation !== 0) document.body.classList.add("is-rotated-" + theaterRotation);
        el.classList.remove("rot-0", "rot-90", "rot-180", "rot-270");
        enterTheater(tab);
        setTimeout(() => { if (el) el.style.opacity = "1"; }, 50);
      }, 100);
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

    function switchTheaterTab(tab) {
      if (!activeTheaterTab || activeTheaterTab === tab) return;
      // Block switching to a hidden tab
      const showDon = eventData.show_donations !== false;
      const showExp = eventData.show_expenses !== false;
      if (tab === 'don' && !showDon) return;
      if (tab === 'exp' && !showExp) return;
      enterTheater(tab);
    }

    function enterTheater(tab) {
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
      body.style.overflowY = "hidden";
      // Remove any previous touch handler
      if (body._scrollHandler) {
        body.removeEventListener('touchmove', body._scrollHandler);
        body._scrollHandler = null;
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

      const rotation = theaterRotation;
      let content;

      if (tab === "sum") {
        body.classList.add("sum-mode");
        const sumDiv = document.createElement("div");
        sumDiv.id = "sum-body-theater";
        sumDiv.style.cssText = "width:100%; min-height:100%; background:var(--surface);";
        body.appendChild(sumDiv);
        renderSummary(0, "sum-body-theater");
        content = sumDiv;
      } else {
        // Isolated Table Render for Theater Mode
        const tableContainer = document.createElement("div");
        tableContainer.className = "tbl-sc";
        tableContainer.style.height = "100%";
        tableContainer.style.width = "100%";

        const table = renderTable(tab, true);
        tableContainer.appendChild(table);
        body.appendChild(tableContainer);
        content = tableContainer;
      }

      if (tab !== "sum") {
        body.classList.remove("sum-mode");
        body.style.overflowY = "hidden";
      } else {
        body.style.overflowY = "auto";
        // On mobile the body is rotated 90°, so physical up/down swipes
        // register as left/right in DOM coords. We intercept touch and
        // manually redirect the movement to scrollTop.
        let _ts = null;
        body._scrollHandler = null;
        const isRotated = (rotation === 90 || rotation === 270);
        if (isRotated) {
          let startX = 0, startScrollTop = 0;
          body._scrollHandler = (e) => {
            if (e.touches.length !== 1) return;
            if (_ts === null) {
              startX = e.touches[0].clientX;
              startScrollTop = body.scrollTop;
              _ts = startX;
              return;
            }
            const dx = e.touches[0].clientX - startX;
            // rotated 90°: swipe down = finger moves right (+dx) = scroll down (+scrollTop)
            body.scrollTop = startScrollTop + dx;
            e.preventDefault();
          };
          const onEnd = () => { _ts = null; };
          body.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            startX = e.touches[0].clientX;
            startScrollTop = body.scrollTop;
            _ts = startX;
          }, { passive: true });
          body.addEventListener('touchmove', body._scrollHandler, { passive: false });
          body.addEventListener('touchend', onEnd, { passive: true });
        }
      }
      main.classList.remove("rot-0", "rot-90", "rot-180", "rot-270");
      main.classList.add("rot-" + rotation);
      main.classList.add("is-theater");

      // Uniform 90-degree sizing
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;

      if (rotation === 90 || rotation === 270) {
        main.style.width = h + "px";
        main.style.height = w + "px";
        body.style.height = (w - 44) + "px";
      } else {
        main.style.width = w + "px";
        main.style.height = h + "px";
        body.style.height = (h - 44) + "px";
      }
      main.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

      updateTheaterStats();

      // Restore Add Column button
      const addBtn = document.getElementById("rot-add-col");
      if (isOrganizer && tab !== 'sum') {
        addBtn.style.display = "flex";
        addBtn.onclick = (e) => { e.stopPropagation(); openAddCol(tab); };
      } else {
        addBtn.style.display = "none";
      }

      const popups = ["entry-form-ov", "edit-form-ov", "duplicate-pop", "custom-col-sheet", "code-sheet", "members-sheet", "del-pop"];
      popups.forEach(id => {
        const p = document.getElementById(id);
        if (p) overlay.appendChild(p);
      });
    }

    // Update theater size on window resize
    window.addEventListener("resize", () => {
      if (activeTheaterTab) {
        const main = document.getElementById("rot-main");
        const body = document.getElementById("rot-ov-body");
        const rotation = theaterRotation;

        const w = window.innerWidth;
        const h = window.innerHeight;

        if (rotation === 90 || rotation === 270) {
          main.style.width = h + "px";
          main.style.height = w + "px";
          body.style.height = (w - 44) + "px";
        } else {
          main.style.width = w + "px";
          main.style.height = h + "px";
          body.style.height = (h - 44) + "px";
        }
      }
    });

    function exitTheater() {
      if (!activeTheaterTab) return;
      activeTheaterTab = null;
      const upEx = new URLSearchParams(window.location.search);
      upEx.delete("theater");
      history.replaceState(null, "", "?" + upEx.toString());

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
      const popups = ["entry-form-ov", "edit-form-ov", "duplicate-pop", "custom-col-sheet", "code-sheet", "members-sheet", "del-pop"];
      popups.forEach(id => {
        const p = document.getElementById(id);
        if (p) document.getElementById("main-page").appendChild(p);
      });

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
      const doc = new jsPDF('p', 'mm', 'a4');
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
      const donCols = eventData.donation_custom_columns || [];
      const donHead = ['NAME', 'AMOUNT (RS.)', 'DATE', 'COLLECTED BY', ...donCols.map(c => (typeof c === 'string' ? c : c.n).toUpperCase())];
      const donBody = donations.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).map(d => [
        d.donor_name.toUpperCase(),
        formatPDF_Amt(d.amount),
        formatDate(d.collected_at).toUpperCase(),
        (d.collected_by_name || '-').toUpperCase(),
        ...donCols.map(c => (d.custom_fields ? (d.custom_fields[typeof c === 'string' ? c : c.n] || '-') : '-').toUpperCase())
      ]);

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
          styles: { fontSize: 7, cellPadding: 2.5, valign: 'middle', font: 'helvetica', lineColor: BORDER, lineWidth: 0.1 },
          headStyles: { fillColor: PRIMARY_DK, textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
          columnStyles: {
            0: { halign: 'left', fontStyle: 'bold', cellWidth: 'auto' },
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

      // Check for page overflow
      if (currentY > 240) { doc.addPage(); currentY = 20; }

      // --- EXPENSES TABLE (DEBITS) ---
      const expCols = eventData.expense_custom_columns || [];
      const expHead = ['DESCRIPTION', 'AMOUNT (RS.)', 'DATE', 'ADDED BY', ...expCols.map(c => (typeof c === 'string' ? c : c.n).toUpperCase())];
      const expBody = expenses.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at)).map(e => [
        e.description.toUpperCase(),
        formatPDF_Amt(e.amount),
        formatDate(e.collected_at).toUpperCase(),
        (e.collected_by_name || '-').toUpperCase(),
        ...expCols.map(c => (e.custom_fields ? (e.custom_fields[typeof c === 'string' ? c : c.n] || '-') : '-').toUpperCase())
      ]);

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
          styles: { fontSize: 7, cellPadding: 2.5, valign: 'middle', font: 'helvetica', lineColor: BORDER, lineWidth: 0.1 },
          headStyles: { fillColor: PRIMARY_DK, textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
          columnStyles: {
            0: { halign: 'left', fontStyle: 'bold', cellWidth: 'auto' },
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

    function updateSendBtnVisibility() {
      const val = document.getElementById('chat-input').value.trim();
      document.getElementById('chat-send-btn').style.display = val.length > 0 ? 'flex' : 'none';
    }

    function openChat() {
      chatOpen = true;

      // Set unread divider target before resetting count
      const lastRead = parseInt(localStorage.getItem(`np_chat_last_read_ev_${eventId}`) || '0');
      if (chatUnread > 0) unreadDividerId = lastRead;

      chatUnread = 0;
      updateChatBadge();
      document.getElementById('chat-overlay').style.display = 'flex';
      // Update URL to preserve chat open state on reload
      const urlParams = new URLSearchParams(window.location.search);
      if (!urlParams.has('chat')) {
        urlParams.set('chat', '1');
        window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
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

    function closeChat() {
      chatOpen = false;
      document.getElementById('chat-overlay').style.display = 'none';
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('chat')) {
        urlParams.delete('chat');
        window.history.replaceState({}, '', `${window.location.pathname}?${urlParams}`);
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
        if (msgs.length === 0 && loadOlder) {
          chatFullyLoaded = true;
          chatLoading = false;
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
        if (!isBackground) {
          renderChatMessages(loadOlder ? 'older' : 'bottom');
        }

        // Calculate initial unread count on first load
        if (!loadOlder && (!chatOpen || isBackground)) {
          const lastRead = parseInt(localStorage.getItem(`np_chat_last_read_ev_${eventId}`) || '0');
          chatUnread = chatMessages.filter(m => m.id > lastRead).length;
          updateChatBadge();
        }
      } catch (e) {
        console.error('Failed to load chat:', e);
      }
      chatLoading = false;
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

    function buildMessageHTML(m, lastSender, lastDate) {
      const myId = parseInt(sessionStorage.getItem('np_my_id') || '0');
      const isOwn = m.user_id === myId;
      const dateLabel = chatDateLabel(m.sent_at);
      let html = '';

      if (dateLabel !== lastDate) {
        html += `<div class="chat-date-divider">${dateLabel}</div>`;
      }

      const showSender = !isOwn && m.user_id !== lastSender;
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

      const isDeleted = m.message === '🚫 This message was deleted.';

      const safeName = escHtml(m.sender_name).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
      const ctxText = isGroupCallMessage(m.message) ? 'Group call — Join meeting' : m.message;
      const safeText = escHtml(ctxText).replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

      let avatarHtml = '';
      if (!isOwn) {
        if (showSender) {
          const initial = m.sender_name.charAt(0).toUpperCase();
          const hue = (m.sender_name.charCodeAt(0) * 137) % 360;
          avatarHtml = `<div class="chat-avatar chat-avatar-clickable" style="background: hsl(${hue}, 60%, 45%)" onclick="event.stopPropagation();showMemberProfile(${m.user_id})" role="button" tabindex="0">${initial}</div>`;
        } else {
          avatarHtml = `<div style="width:28px; flex-shrink:0;"></div>`;
        }
      }

      if (!isOwn) html += `<div class="chat-msg-row">${avatarHtml}`;

      html += `<div class="chat-msg ${isOwn ? 'chat-msg-own' : 'chat-msg-other'} ${isDeleted ? 'chat-msg-deleted' : ''}" id="chat-msg-${m.id}">`;
      html += `<div class="chat-bubble" ${!isDeleted ? `data-id="${m.id}" data-uid="${m.user_id}" data-sender="${safeName}" data-text="${safeText}"` : ''}>`;
      html += `<div class="chat-bubble-content">`;
      if (showSender) {
        html += `<div class="chat-msg-sender">${escHtml(m.sender_name)}</div>`;
      }
      if (replyHtml) html += replyHtml;
      html += `<div class="chat-msg-text">${formatChatMessageText(m.message)}</div>`;
      html += `<div class="chat-msg-time">${chatTimeExact(m.sent_at)}</div>`;
      html += `</div>`; // end chat-bubble-content
      html += `</div>`; // end chat-bubble
      html += rxHtml;
      html += `</div>`;

      if (!isOwn) html += `</div>`; // end chat-msg-row

      return { html, dateLabel, newSender: m.user_id };
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

      if (!chatFullyLoaded && chatMessages.length >= 50) {
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

      container.innerHTML = html;

      if (scrollMode === 'older') {
        container.scrollTop = container.scrollHeight - prevScrollHeight;
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

      // Clear the divider flag after opening so it doesn't persist if they load older messages
      if (scrollMode !== 'older') unreadDividerId = null;
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
      if (c) requestAnimationFrame(() => { c.scrollTo({ top: c.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }); });
    }

    let activeCtxMsg = null;
    let replyingToId = null;
    function startReply(id, name, text) {
      replyingToId = id;
      document.getElementById('chat-reply-bar').style.display = 'flex';
      document.getElementById('reply-name').textContent = name;
      document.getElementById('reply-text').textContent = text;
      document.getElementById('chat-input').focus();
    }
    function cancelReply() {
      replyingToId = null;
      document.getElementById('chat-reply-bar').style.display = 'none';
    }
    async function sendReactionInline(mId, emoji) {
      try {
        await apiFetch('POST', `/events/${eventId}/chat/${mId}/react`, { emoji: emoji });
      } catch (e) { console.error('Reaction failed', e); }
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
      const myId = parseInt(sessionStorage.getItem('np_my_id') || '0');
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
      document.getElementById('emoji-picker-ov').style.display = 'none';
      activeCtxMsg = null;
    }
    function handleCtxReply() {
      if (!activeCtxMsg) return;
      startReply(activeCtxMsg.id, activeCtxMsg.name, activeCtxMsg.text);
      closeChatMsgCtx();
    }
    function handleCtxCopy() {
      if (!activeCtxMsg) return;
      navigator.clipboard.writeText(activeCtxMsg.text);
      closeChatMsgCtx();
    }
    async function handleCtxDelete() {
      if (!activeCtxMsg) return;
      try {
        await apiFetch('DELETE', `/events/${eventId}/chat/${activeCtxMsg.id}`);
      } catch (e) { console.error('Delete failed', e); }
      closeChatMsgCtx();
    }
    function sendReactionInlineCtx(emoji) {
      if (!activeCtxMsg) return;
      sendReactionInline(activeCtxMsg.id, emoji);
      closeChatMsgCtx();
    }
    function openFullEmojiPickerCtx() {
      emojiPickerMode = 'reaction';
      document.getElementById('chat-msg-ctx').style.display = 'none';
      document.getElementById('emoji-picker-ov').style.display = 'block';
    }
    function openInputEmojiPicker() {
      emojiPickerMode = 'input';
      document.getElementById('emoji-picker-ov').style.display = 'block';
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

    async function sendChatMessage() {
      const input = document.getElementById('chat-input');
      const msg = input.value.trim();
      if (!msg) return;

      const btn = document.getElementById('chat-send-btn');
      btn.disabled = true;
      input.value = '';
      updateSendBtnVisibility();

      try {
        const payload = { message: msg };
        if (replyingToId) payload.reply_to_id = replyingToId;
        await apiFetch('POST', `/events/${eventId}/chat`, payload);
        cancelReply();
      } catch (e) {
        showToast('Failed to send message', 'error');
        input.value = msg; // Restore on failure
      }
      btn.disabled = false;
      input.focus();
    }

    function handleIncomingChatMsg(data) {
      if (chatMessages.some(m => m.id === data.id)) return;
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

    // Bind emoji picker events once DOM loads
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelector('emoji-picker').addEventListener('emoji-click', event => {
        if (emojiPickerMode === 'reaction') {
          sendReactionInlineCtx(event.detail.unicode);
        } else {
          const input = document.getElementById('chat-input');
          input.value += event.detail.unicode;
          updateSendBtnVisibility();
          document.getElementById('emoji-picker-ov').style.display = 'none';
          input.focus();
        }
      });

      // Event delegation for context menu to survive DOM updates completely
      document.getElementById('chat-messages').addEventListener('dblclick', function (e) {
        const bubble = e.target.closest('.chat-bubble');
        if (!bubble) return;
        if (bubble.parentElement.classList.contains('chat-msg-deleted') || bubble.closest('.chat-msg-deleted')) return;

        const id = parseInt(bubble.getAttribute('data-id'));
        const uid = parseInt(bubble.getAttribute('data-uid'));
        const name = bubble.getAttribute('data-sender');
        const text = bubble.getAttribute('data-text');
        openChatMsgCtx(e, id, name, text, uid);
      });
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
      const escaped = escHtml(text).replace(/\n/g, '<br/>');
      return escaped.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>'
      );
    }

    function getMemberRoleLabel(m) {
      if (!m) return 'Member';
      if (m.is_restricted) return 'Restricted';
      if (m.user_id === eventData?.organizer_id) return '👑 Creator';
      if ((m.role || '').toLowerCase() === 'organizer') return 'Organizer';
      return 'Collector';
    }

    function telHref(phone) {
      return 'tel:' + String(phone).replace(/[^\d+]/g, '');
    }

    async function showMemberProfile(userId) {
      let mem = members.find(x => x.user_id === userId);
      if (!mem) {
        try {
          const fetched = await getMembers(eventId);
          members = fetched || [];
          mem = members.find(x => x.user_id === userId);
        } catch (e) {
          showToast('Could not load member info', 'error');
          return;
        }
      }
      if (!mem) {
        showToast('Member not found', 'error');
        return;
      }

      const name = mem.user?.full_name || 'Unknown';
      const phone = mem.user?.phone_number || '';
      const roleLabel = getMemberRoleLabel(mem);

      document.getElementById('mp-avatar').textContent = getInitials(name);
      document.getElementById('mp-name').textContent = name;
      document.getElementById('mp-role').textContent = roleLabel;
      document.getElementById('mp-phone').textContent = phone || 'No phone number on file';

      const callBtn = document.getElementById('mp-call-btn');
      if (phone) {
        callBtn.href = telHref(phone);
        callBtn.classList.remove('mp-call-disabled');
        callBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg> Call`;
      } else {
        callBtn.href = '#';
        callBtn.classList.add('mp-call-disabled');
        callBtn.textContent = 'No phone on file';
      }

      document.getElementById('member-profile-modal').style.display = 'flex';
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
  