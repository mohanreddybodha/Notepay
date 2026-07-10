// ══════════════════════════════════════════════
//  Notepay — Event Members & Role Controller
//  Handles member lists, invite codes, role management,
//  restriction/unrestriction, and member profile modals.
// ══════════════════════════════════════════════

(function (global) {
  'use strict';

  let memTarget = null;
  let restrictUserId = null;

  function openCodeSheet() {
    const el = document.getElementById("sheet-code");
    if (el) el.textContent = (typeof eventData !== 'undefined' && eventData?.invite_code) || "—";
    const sheet = document.getElementById("code-sheet");
    if (sheet) sheet.style.display = "flex";
  }

  function closeCodeSheet() {
    const sheet = document.getElementById("code-sheet");
    if (sheet) sheet.style.display = "none";
  }

  function copyCode() {
    const code = (typeof eventData !== 'undefined' && eventData?.invite_code) || "";
    if (typeof copyToClipboard === 'function') {
      copyToClipboard(code, "Code copied!");
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      if (typeof showToast === 'function') showToast("Code copied!");
    }
    const btn = document.getElementById("sheet-copy-btn");
    if (btn) {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
      }, 2000);
    }
  }

  async function openMembersSheet() {
    const sheet = document.getElementById("members-sheet");
    if (sheet) sheet.style.display = "flex";
    const list = document.getElementById("members-list");
    if (!list) return;

    // Use cached members if available, otherwise fetch
    if (typeof members === 'undefined' || !members || members.length === 0) {
      list.innerHTML = `<div style="padding:14px;text-align:center;"><div class="loader" style="width:22px;height:22px;margin:0 auto;"></div></div>`;
      try {
        const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
        const fetched = await getMembers(evId);
        if (typeof members !== 'undefined') {
          members = fetched;
        } else {
          window.members = fetched;
        }
      } catch (e) {
        list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--red);">Failed to load.</div>`;
        return;
      }
    }

    const mList = (typeof members !== 'undefined') ? members : window.members;
    const evData = (typeof eventData !== 'undefined') ? eventData : window.eventData;
    const myId = (typeof myUserId !== 'undefined') ? myUserId : window.myUserId;
    const isOrg = (typeof isOrganizer !== 'undefined') ? isOrganizer : window.isOrganizer;

    const mCount = document.getElementById("members-count");
    if (mCount) mCount.textContent = mList.length + " total";

    const sortedMembers = [...mList].sort((a, b) => {
      const roleWeight = (m) => {
        if (m.user_id === evData?.organizer_id) return 0;
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

    const esc = (typeof escHtml === 'function') ? escHtml : (typeof escapeHtml === 'function' ? escapeHtml : (s => s));

    list.innerHTML = sortedMembers.map(m => {
      const uId = m.user_id;
      const uName = m.user?.full_name || "Unknown";
      const isMe = uId == myId;
      const roleStr = (m.role || "").toLowerCase();
      const isRes = m.is_restricted;
      const isCreator = uId == evData?.organizer_id;

      const crownIcon = (typeof npIcon === 'function') ? npIcon("crown", { size: 12, tone: "amber" }) : "";
      const roleTxt = isRes ? '<span style="color:var(--red);font-weight:800;">Restricted</span>' : (isCreator ? `<span style="color:var(--amber);font-weight:800;">${crownIcon} Creator</span>` : (m.role === "Organizer" ? "Organizer" : "Collector"));

      return `<div class="mem-row">
        <div class="mem-av">${typeof getInitials === 'function' ? getInitials(uName) : uName.charAt(0)}</div>
        <div style="flex:1;">
          <div class="mem-name">${esc(uName)}${isMe ? " <span style='color:var(--teal);font-size:10px;font-weight:900;'>(You)</span>" : ""}</div>
          <div class="mem-sub">${roleTxt}</div>
        </div>
        ${isOrg && !isMe && !isCreator ? `
          <div class="mem-dots" onclick="openMCtx(event, ${uId}, '${esc(uName)}', '${roleStr}', ${isRes})">⋮</div>
        ` : ""}
      </div>`;
    }).join("");
  }

  function closeMembersSheet() {
    const sheet = document.getElementById("members-sheet");
    if (sheet) sheet.style.display = "none";
  }

  function openMCtx(ev, uId, uName, role, res) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    memTarget = { id: uId, name: uName, role: role, res: res };
    const box = document.getElementById("mctx-box");
    const ov = document.getElementById("mctx-ov");
    if (!box || !ov) return;

    const crownIcon = (typeof npIcon === 'function') ? npIcon("crown", { size: 14, tone: "amber" }) : "";
    const checkIcon = (typeof npIcon === 'function') ? npIcon("check", { size: 14, tone: "green" }) : "";
    const banIcon = (typeof npIcon === 'function') ? npIcon("ban", { size: 14, tone: "red" }) : "";

    const promoteEl = document.getElementById("mctx-promote");
    if (promoteEl) promoteEl.innerHTML = role.toLowerCase() === "organizer" ? "Demote to Collector" : crownIcon + " Make Organizer";
    const restrictEl = document.getElementById("mctx-restrict");
    if (restrictEl) restrictEl.innerHTML = res ? checkIcon + " Unrestrict User" : banIcon + " Restrict User";

    ov.style.display = "block";
    ov.style.background = "transparent";

    const x = ev?.clientX ?? ev?.touches?.[0]?.clientX ?? window.innerWidth / 2;
    const y = ev?.clientY ?? ev?.touches?.[0]?.clientY ?? window.innerHeight / 2;
    const bw = 180;
    const bh = 88;
    const clampedX = Math.max(8, Math.min(x - bw / 2, window.innerWidth - bw - 8));
    const clampedY = Math.max(8, Math.min(y + 4, window.innerHeight - bh - 8));
    box.style.left = clampedX + "px";
    box.style.top = clampedY + "px";
  }

  function closeMCtx() {
    const ov = document.getElementById("mctx-ov");
    if (ov) ov.style.display = "none";
  }

  function openRestrictedPromotionPopup() {
    const popup = document.getElementById("restricted-promo-pop");
    if (popup) popup.style.display = "flex";
  }

  function handlePromoteClick() {
    closeMCtx();
    if (!memTarget) return;
    if (memTarget.role.toLowerCase() === "organizer") {
      const el = document.getElementById("demote-user-name");
      if (el) el.textContent = memTarget.name;
      const pop = document.getElementById("demote-pop");
      if (pop) pop.style.display = "flex";
    } else {
      if (memTarget.res) {
        openRestrictedPromotionPopup();
        return;
      }
      const el = document.getElementById("promote-user-name");
      if (el) el.textContent = memTarget.name;
      const pop = document.getElementById("promote-pop");
      if (pop) pop.style.display = "flex";
    }
  }

  async function confirmDemote() {
    if (!memTarget) return;
    const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
    try {
      await apiFetch("PUT", `/events/${evId}/members/${memTarget.id}/role`, { role: "Collector" });
      const mList = (typeof members !== 'undefined') ? members : window.members;
      if (mList) {
        const m = mList.find(x => x.user_id === memTarget.id);
        if (m) m.role = "Collector";
      }
      const pop = document.getElementById("demote-pop");
      if (pop) pop.style.display = "none";
      if (typeof showToast === 'function') showToast(`${memTarget.name} is now a Collector.`);
      if (typeof clearEventCache === 'function') clearEventCache();
      if (typeof loadAll === 'function') await loadAll(true, true);
      openMembersSheet();
      const myId = (typeof myUserId !== 'undefined') ? myUserId : window.myUserId;
      if (memTarget.id === myId) location.reload();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || "Failed to demote.", "error");
    }
  }

  async function confirmPromote() {
    if (!memTarget) return;
    const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
    try {
      if (memTarget.res) {
        openRestrictedPromotionPopup();
        const pop = document.getElementById("promote-pop");
        if (pop) pop.style.display = "none";
        return;
      }
      await apiFetch("PUT", `/events/${evId}/members/${memTarget.id}/role`, { role: "Organizer" });
      const mList = (typeof members !== 'undefined') ? members : window.members;
      if (mList) {
        const m = mList.find(x => x.user_id === memTarget.id);
        if (m) m.role = "Organizer";
      }
      const pop = document.getElementById("promote-pop");
      if (pop) pop.style.display = "none";
      if (typeof showToast === 'function') showToast(`${memTarget.name} is now an Organizer!`);
      if (typeof clearEventCache === 'function') clearEventCache();
      if (typeof loadAll === 'function') await loadAll(true, true);
      openMembersSheet();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || "Promotion failed.", "error");
    }
  }

  function handleRestrictClick() {
    closeMCtx();
    if (!memTarget) return;
    if (memTarget.res) {
      doUnrestrict(memTarget.id);
    } else {
      doRestrict(memTarget.id, memTarget.name);
    }
  }

  function closeRestrictPop() {
    const pop = document.getElementById("restrict-pop");
    if (pop) pop.style.display = "none";
  }

  function doRestrict(uid, name) {
    restrictUserId = uid;
    const ns = document.getElementById("restrict-user-name");
    if (ns) ns.textContent = name;
    const pop = document.getElementById("restrict-pop");
    if (pop) pop.style.display = "flex";
  }

  async function confirmRestrict() {
    if (restrictUserId === null) return;
    const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
    const myId = (typeof myUserId !== 'undefined') ? myUserId : window.myUserId;
    try {
      await restrictMember(evId, restrictUserId);
      if (typeof showToast === 'function') showToast("Member restricted.");
      const mList = (typeof members !== 'undefined') ? members : window.members;
      if (mList) {
        const m = mList.find(x => x.user_id === restrictUserId);
        if (m) {
          m.is_restricted = true;
          m.role = "collector";
        }
      }
      if (typeof clearEventCache === 'function') clearEventCache();
      if (restrictUserId === myId) {
        if (typeof isRestricted !== 'undefined') {
          isRestricted = true;
        } else {
          window.isRestricted = true;
        }
        if (typeof renderPage === 'function') renderPage();
      } else {
        if (typeof loadAll === 'function') await loadAll(true, true);
      }
      closeRestrictPop();
      openMembersSheet();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || "Failed.", "error");
    }
  }

  async function doUnrestrict(uid) {
    const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
    try {
      await unrestrictMember(evId, uid);
      if (typeof showToast === 'function') showToast("Member restored.");
      const mList = (typeof members !== 'undefined') ? members : window.members;
      if (mList) {
        const m = mList.find(x => x.user_id === uid);
        if (m) m.is_restricted = false;
      }
      if (typeof clearEventCache === 'function') clearEventCache();
      if (typeof loadAll === 'function') await loadAll(true, true);
      openMembersSheet();
    } catch (e) {
      if (typeof showToast === 'function') showToast(e.message || "Failed.", "error");
    }
  }

  function getMemberRoleLabel(m) {
    if (!m) return 'Member';
    const evData = (typeof eventData !== 'undefined') ? eventData : window.eventData;
    if (m.is_restricted) return 'Restricted';
    if (m.user_id === evData?.organizer_id) {
      const crownIcon = (typeof npIcon === 'function') ? npIcon("crown", { size: 14, tone: "amber" }) : "";
      return crownIcon + ' Creator';
    }
    if ((m.role || '').toLowerCase() === 'organizer') return 'Organizer';
    return 'Collector';
  }

  async function showMemberProfile(userId) {
    const mList = (typeof members !== 'undefined') ? members : window.members;
    let mem = mList?.find(x => x.user_id === userId);
    let name = mem?.user?.full_name || 'Unknown';
    let role = mem ? (mem.role === 'Organizer' ? 'Organizer' : 'Collector') : 'Member';
    if (mem?.is_restricted) role = 'Restricted';

    try {
      const av = document.getElementById('mp-avatar');
      if (av) {
        av.textContent = name.charAt(0).toUpperCase();
        const hue = (name.charCodeAt(0) * 137) % 360;
        av.style.background = `hsl(${hue}, 60%, 45%)`;
      }
      const nmEl = document.getElementById('mp-name');
      if (nmEl) nmEl.textContent = name;
      const rlEl = document.getElementById('mp-role');
      if (rlEl) rlEl.textContent = "Loading contact...";
      const phEl = document.getElementById('mp-phone');
      if (phEl) phEl.textContent = "Fetching phone number...";
      const callBtn = document.getElementById('mp-call-btn');
      if (callBtn) callBtn.style.display = "none";
      const modal = document.getElementById('member-profile-modal');
      if (modal) modal.style.display = 'flex';

      const evId = (typeof eventId !== 'undefined') ? eventId : window.eventId;
      const contact = await getMemberContact(evId, userId);

      const finalName = contact.full_name || name;
      const phone = contact.phone_number || '';
      const roleLabel = getMemberRoleLabel(mem);

      if (av) av.textContent = (typeof getInitials === 'function') ? getInitials(finalName) : finalName.charAt(0);
      if (nmEl) nmEl.textContent = finalName;
      if (rlEl) rlEl.innerHTML = roleLabel;
      if (phEl) phEl.textContent = phone || 'No phone number on file';

      if (callBtn) {
        if (phone) {
          callBtn.href = `tel:${phone}`;
          callBtn.style.display = "flex";
          callBtn.classList.remove('mp-call-disabled');
          callBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg> Call`;
        } else {
          callBtn.style.display = "none";
        }
      }
    } catch (e) {
      console.error("Profile load failed:", e);
      const rlEl = document.getElementById('mp-role');
      if (rlEl) rlEl.innerHTML = getMemberRoleLabel(mem);
      const phEl = document.getElementById('mp-phone');
      if (phEl) phEl.textContent = "Contact info unavailable";
      const callBtn = document.getElementById('mp-call-btn');
      if (callBtn) callBtn.style.display = "none";
    }
  }

  function closeMemberProfile() {
    const modal = document.getElementById('member-profile-modal');
    if (modal) modal.style.display = 'none';
  }

  // Export public API
  const Controller = {
    openCodeSheet,
    closeCodeSheet,
    copyCode,
    openMembersSheet,
    closeMembersSheet,
    openMCtx,
    closeMCtx,
    openRestrictedPromotionPopup,
    handlePromoteClick,
    confirmDemote,
    confirmPromote,
    handleRestrictClick,
    closeRestrictPop,
    doRestrict,
    confirmRestrict,
    doUnrestrict,
    getMemberRoleLabel,
    showMemberProfile,
    closeMemberProfile
  };

  global.EventMembersController = Controller;

  // Expose methods globally for HTML onclick compatibility
  Object.keys(Controller).forEach(fnName => {
    global[fnName] = Controller[fnName];
  });

})(typeof window !== 'undefined' ? window : this);
