let currentCollections = 0;

  // ── 0ms Instant Synchronous Render from Cache ──
  try {
    const cachedDash = localStorage.getItem("np_dash_cache");
    const cachedProf = localStorage.getItem("np_profile");
    const profileObj = cachedDash ? JSON.parse(cachedDash).profile : (cachedProf ? JSON.parse(cachedProf) : null);
    if (profileObj && profileObj.full_name) {
      if (typeof applyAvatar === "function") {
        const topBtn = document.getElementById("topbar-av-btn");
        if (topBtn) applyAvatar(topBtn, profileObj.full_name);
        const sideBtn = document.getElementById("av-btn-side");
        if (sideBtn) applyAvatar(sideBtn, profileObj.full_name);
      }
      const nameSide = document.getElementById("user-name-side");
      if (nameSide) nameSide.textContent = profileObj.full_name;
    }
  } catch(e) {}
  function goBack() {
    if (document.referrer && document.referrer.indexOf(window.location.host) !== -1) {
      window.history.back();
      return;
    }
    // editId comes from clean path /edit-event/ABCD123 or legacy ?edit= param
    const pathCtx = (typeof parseCurrentPath === 'function') ? parseCurrentPath() : {};
    const editId = pathCtx.id || new URLSearchParams(window.location.search).get('edit');
    if (editId) {
      window.location.href = (typeof buildUrl === 'function') ? buildUrl('event', editId) : getCleanUrl('event.html') + '?id=' + encodeURIComponent(editId);
    } else {
      window.location.href = (typeof buildUrl === 'function') ? buildUrl('dashboard') : getCleanUrl('dashboard.html');
    }
  }

  function openTipsModal() {
    const modalId = editId ? "manage-tips-modal" : "tips-modal";
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = "flex";
  }
  function closeTipsModal() {
    const createModal = document.getElementById("tips-modal");
    const manageModal = document.getElementById("manage-tips-modal");
    if (createModal) createModal.style.display = "none";
    if (manageModal) manageModal.style.display = "none";
  }

  function showNativeConfirmModal({ title, description, iconClass, iconSvg, btnText, btnColor, onConfirm }) {
    const modal = document.getElementById("confirm-popup-modal");
    document.getElementById("confirm-popup-title").textContent = title;
    document.getElementById("confirm-popup-desc").textContent = description;
    const iconEl = document.getElementById("confirm-popup-icon");
    iconEl.className = "popup-icon " + iconClass;
    iconEl.innerHTML = iconSvg;
    const actionBtn = document.getElementById("confirm-popup-action-btn");
    actionBtn.textContent = btnText;
    actionBtn.style.background = btnColor;
    // Clone to remove old listeners
    const newAction = actionBtn.cloneNode(true);
    actionBtn.parentNode.replaceChild(newAction, actionBtn);
    newAction.addEventListener("click", () => { modal.classList.remove("open"); onConfirm(); });
    const cancelBtn = document.getElementById("confirm-popup-cancel-btn");
    const newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newCancel.addEventListener("click", () => { modal.classList.remove("open"); });
    modal.addEventListener("click", function handler(e) { if (e.target === modal) { modal.classList.remove("open"); modal.removeEventListener("click", handler); } });
    modal.classList.add("open");
  }

  function updateLivePreview() {
    const name = document.getElementById("ev-name").value.trim();
    const desc = document.getElementById("ev-desc").value.trim();
    const date = document.getElementById("ev-date").value;
    const goal = document.getElementById("ev-goal").value.trim();

    document.getElementById("pv-card-name").textContent = name || "My New Event";
    document.getElementById("pv-card-desc").textContent = desc || "No description yet";
    
    if (date) {
      document.getElementById("pv-card-date").textContent = new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } else {
      document.getElementById("pv-card-date").textContent = "Today";
    }

    const ring = document.getElementById("pv-card-ring");
    if (goal && parseInt(goal, 10) > 0) {
      ring.style.display = "flex";
      const goalAmount = parseInt(goal, 10);
      const pct = Math.min(Math.round((currentCollections / goalAmount) * 100), 999) || 0;
      const circ = 2 * Math.PI * 14;
      const offset = circ - (Math.min(pct, 100) / 100) * circ;
      const ringCircle = ring.querySelectorAll("circle")[1];
      if (ringCircle) {
        ringCircle.setAttribute("stroke-dasharray", circ);
        ringCircle.setAttribute("stroke-dashoffset", offset);
      }
      const ringLbl = ring.querySelector(".pv-ring-lbl");
      if (ringLbl) ringLbl.textContent = pct + "%";
    } else {
      ring.style.display = "none";
    }
  }

  document.getElementById("ev-name").addEventListener("input", function() {
    document.getElementById("ev-name-cnt").textContent = this.value.length + "/50";
    document.getElementById("ev-name-error").classList.remove("visible");
    document.getElementById("name-field-box").style.borderColor = "var(--border-str)";
    updateLivePreview();
  });
  document.getElementById("ev-desc").addEventListener("input", () => {
    updateLivePreview();
  });
  document.getElementById("ev-date").addEventListener("change", () => {
    document.getElementById("ev-date-error").classList.remove("visible");
    document.getElementById("date-field-box").style.borderColor = "var(--border-str)";
    updateLivePreview();
  });
  document.getElementById("ev-goal").addEventListener("input", () => {
    document.getElementById("ev-goal-error").classList.remove("visible");
    document.getElementById("goal-field-box").style.borderColor = "var(--border-str)";
    updateLivePreview();
  });


  // Extract editId from clean path (/edit-event/ABCD123) or legacy ?edit= param
  const _pathCtx = (typeof parseCurrentPath === 'function') ? parseCurrentPath() : {};
  const editId = _pathCtx.id || new URLSearchParams(window.location.search).get('edit');

  if (!editId) {
    waitForAuthReady().finally(() => {
      if (typeof hideCircleLoading === "function") hideCircleLoading(true);
    });
  }


  if (editId) {
    if (typeof showCircleLoading === "function") showCircleLoading();
    document.getElementById("btn-txt-span").textContent = "Save Changes";
    if (document.getElementById("btn-icon")) document.getElementById("btn-icon").style.display = "none";
    document.getElementById("org-note-box").style.display = "none";
    
    waitForAuthReady().then(async user => {
      if (!user) {
        const loaderStyle = document.getElementById("sync-edit-loader");
        if (loaderStyle) loaderStyle.remove();
        if (typeof hideCircleLoading === "function") hideCircleLoading(true);
        return;
      }
      try {
        const my = await getMyEvents();
        const ev = my.find(e => e.id == editId);
        if (ev) {
          document.getElementById("ev-name").value = ev.name;
          document.getElementById("ev-name-cnt").textContent = (ev.name?.length || 0) + "/50";
          document.getElementById("ev-desc").value = ev.description || "";
          document.getElementById("ev-date").value = ev.event_date.split("T")[0];
          document.getElementById("ev-goal").value = ev.goal_amount || "";
          currentCollections = ev.total_collections || 0;
          updateLivePreview();

          // Populate Join Code
          const joinCodeBox = document.getElementById("join-code-box");
          const editInviteCode = document.getElementById("edit-invite-code");
          if (joinCodeBox && editInviteCode) {
            joinCodeBox.style.display = "block";
            editInviteCode.textContent = ev.invite_code || "---";

            document.getElementById("copy-code-btn").onclick = () => {
              const code = editInviteCode.textContent;
              if (code && code !== "---") {
                navigator.clipboard.writeText(code);
                showToast("Code copied to clipboard!");
                
                const copyBtnSvg = document.getElementById("copy-icon");
                if (copyBtnSvg) {
                  copyBtnSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                  setTimeout(() => {
                    copyBtnSvg.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
                  }, 3000);
                }
              }
            };

            document.getElementById("share-code-btn").onclick = async () => {
              const code = editInviteCode.textContent;
              if (code && code !== "---" && navigator.share) {
                try {
                  const cleanPath = getCleanUrl('join-event.html');
                  const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
                  const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
                  const joinUrl = (typeof buildUrl === 'function')
                    ? window.location.origin + buildUrl('join', code)
                    : origin + path + '?code=' + code;
                  const inviteMsg = `🤝 Invitation to Collaborate\n\nYou have been invited as a Collector for "${ev.name}" on Notepay (Event Contributions & Expenses Tracker).\n\nManage contributions, log expenses, and maintain the event ledger in real time.\n\n🔑 Invite Code: ${code}\n\n👉 Click below to join as a Collector:`;
                  
                  await navigator.share({
                    title: `Notepay Invite — ${ev.name}`,
                    text: inviteMsg,
                    url: joinUrl
                  });
                } catch(e) { console.error("Share failed", e); }
              } else if (!navigator.share) {
                showToast("Sharing not supported on this device.");
              }
            };

            const refreshBtn = document.getElementById("refresh-code-btn");
            refreshBtn.onclick = async () => {
              showNativeConfirmModal({
                title: "Refresh Code",
                description: "Are you sure? This will permanently invalidate the old code. Anyone with the old code won't be able to join.",
                iconClass: "pi-amber",
                iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`,
                btnText: "Refresh",
                btnColor: "var(--np-amber)",
                onConfirm: async () => {
                  try {
                    refreshBtn.disabled = true;
                    const res = await generateCode(editId);
                    if (res && res.invite_code) {
                      ev.invite_code = res.invite_code;
                      editInviteCode.textContent = res.invite_code;
                      showToast("New code generated!");
                    }
                  } catch(e) {
                    showToast(e.message || "Failed to refresh code", "error");
                  } finally {
                    refreshBtn.disabled = false;
                  }
                }
              });
            };
          }

          // Update Tips Modal for Edit Mode
          const tipsTitle = document.querySelector("#tips-modal .popup-title") || document.querySelector("#tips-modal .sheet-title");
          if (tipsTitle) tipsTitle.textContent = "Editing Event Tips";
          const tipsDesc = document.querySelector("#tips-modal .popup-desc") || document.querySelector("#tips-modal .sheet-sub");
          if (tipsDesc) tipsDesc.textContent = "Keep these in mind while updating your event.";
          const tipItems = document.querySelectorAll("#tips-modal .tip-item");
          if (tipItems.length >= 4) {
            tipItems[0].querySelector(".ti-t").textContent = "Editing Basics";
            tipItems[0].querySelector(".ti-d").textContent = "Update event name, description, and goal. Changes sync instantly.";
            tipItems[1].querySelector(".ti-t").textContent = "Role Management";
            tipItems[1].querySelector(".ti-d").textContent = "Add or remove collectors from the dashboard, not here.";
            tipItems[2].querySelector(".ti-t").textContent = "Deactivating Event";
            tipItems[2].querySelector(".ti-d").textContent = "Temporarily locks out all collectors. You can reactivate anytime.";
            tipItems[3].querySelector(".ti-t").textContent = "Deleting Event";
            tipItems[3].querySelector(".ti-d").textContent = "Permanently deletes the event and all entries. This cannot be undone.";
          }

          // Set Danger Zone button text & styles
          const deactivateBtn = document.getElementById("deactivate-btn");
          if (deactivateBtn) {
            if (ev.is_active) {
              deactivateBtn.textContent = "Deactivate Event";
              deactivateBtn.classList.remove("reactivate-theme");
              deactivateBtn.style.cssText = "width:100%; height:40px; background:var(--surface); border:1.5px solid var(--np-red); color:var(--np-red); border-radius:10px; font-size:13.5px; font-weight:700; cursor:pointer;";
            } else {
              deactivateBtn.textContent = "Reactivate Event";
              deactivateBtn.classList.add("reactivate-theme");
              deactivateBtn.style.cssText = "width:100%; height:40px; background:var(--surface); border:1.5px solid var(--np-green); color:var(--np-green); border-radius:10px; font-size:13.5px; font-weight:700; cursor:pointer;";
            }
          }

          // Set Public Access Box
          const publicAccessBox = document.getElementById("public-access-box");
          const publicToggleBtn = document.getElementById("public-toggle-btn");
          const publicLinkOptions = document.getElementById("public-link-options");
          
          if (publicAccessBox && publicToggleBtn && publicLinkOptions) {
            publicAccessBox.style.display = "block";
            let isPub = ev.is_public === true;
            
            const updatePubUI = (pub) => {
              if (pub) {
                publicToggleBtn.classList.add("on");
                publicLinkOptions.style.display = "block";
              } else {
                publicToggleBtn.classList.remove("on");
                publicLinkOptions.style.display = "none";
              }
            };
            
            updatePubUI(isPub);
            
            publicToggleBtn.onclick = async () => {
              try {
                publicToggleBtn.disabled = true;
                const newPub = !isPub;
                await updateEventPrivacy(editId, newPub);
                isPub = newPub;
                updatePubUI(isPub);
                showToast(isPub ? "Public Access Enabled" : "Public Access Disabled");
              } catch(err) {
                showToast(err.message || "Failed to update public access", "error");
              } finally {
                publicToggleBtn.disabled = false;
              }
            };

            const copyPubLinkBtn = document.getElementById("copy-public-link-btn");
            const sharePubLinkBtn = document.getElementById("share-public-link-btn");
            const getPubLink = () => {
              const cleanPath = getCleanUrl('event.html');
              const origin = window.location.origin.endsWith('/') ? window.location.origin.slice(0, -1) : window.location.origin;
              const path = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
              return (typeof buildUrl === 'function')
                ? window.location.origin + buildUrl('event', editId)
                : origin + path + '?id=' + editId;
            };

            if (copyPubLinkBtn) {
              let copyTimeout;
              copyPubLinkBtn.onclick = () => {
                navigator.clipboard.writeText(getPubLink());
                showToast("Public view link copied!");
                
                const originalHtml = `<span data-np-icon="copy" data-np-size="14" style="margin-right:6px;"></span> Copy Link`;
                copyPubLinkBtn.innerHTML = `<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right:6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Copied!`;
                
                clearTimeout(copyTimeout);
                copyTimeout = setTimeout(() => {
                  copyPubLinkBtn.innerHTML = (typeof npIcon === 'function') ? `${npIcon('copy', {size:14})} Copy Link` : originalHtml;
                  if (typeof initIcons === 'function') initIcons();
                }, 3000);
              };
            }

            if (sharePubLinkBtn) {
              sharePubLinkBtn.onclick = async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({
                      title: `Notepay Public Ledger — ${ev.name}`,
                      text: `📊 You are invited to view the real-time financial ledger for "${ev.name}". Track collections and expenses transparently.\n\n👉 View live data here:`,
                      url: getPubLink()
                    });
                  } catch(e) { console.error("Share failed", e); }
                } else {
                  showToast("Sharing not supported on this device.");
                }
              };
            }
          }

        }
      } catch(e) {
        console.error("Failed to load event details", e);
      } finally {
        const loaderStyle = document.getElementById("sync-edit-loader");
        if (loaderStyle) loaderStyle.remove();
        if (typeof hideCircleLoading === "function") hideCircleLoading(true);
      }
    });

    // Danger Zone Action Listeners
    const dangerZone = document.getElementById("danger-zone-box");
    if (dangerZone) dangerZone.style.display = "block";

    const deactivateBtn = document.getElementById("deactivate-btn");
    const deleteBtn = document.getElementById("delete-btn");

    deactivateBtn.addEventListener("click", async () => {
      const isCurrentlyActive = !deactivateBtn.classList.contains("reactivate-theme");
      const eventName = document.getElementById("ev-name").value.trim() || "this event";
      showNativeConfirmModal({
        title: isCurrentlyActive ? "Deactivate Event" : "Reactivate Event",
        description: isCurrentlyActive
          ? `Are you sure you want to deactivate '${eventName}'? Collectors will be locked out immediately.`
          : `Are you sure you want to reactivate '${eventName}'? Collectors will regain access.`,
        iconClass: isCurrentlyActive ? "pi-red" : "pi-amber",
        iconSvg: isCurrentlyActive
          ? `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
          : `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 7 13.5 15.5 8.5 10.5 1 17"/><polyline points="17 7 23 7 23 13"/></svg>`,
        btnText: isCurrentlyActive ? "Deactivate" : "Reactivate",
        btnColor: isCurrentlyActive ? "var(--np-red)" : "var(--np-green, #1a7a5e)",
        onConfirm: async () => {
          deactivateBtn.disabled = true;
          try {
            if (isCurrentlyActive) {
              await deactivateEvent(editId);
              showToast("Event deactivated successfully.");
            } else {
              await reactivateEvent(editId);
              showToast("Event reactivated successfully.");
            }
            window.location.reload();
          } catch(e) {
            showToast(e.message || "Action failed.", "error");
            deactivateBtn.disabled = false;
          }
        }
      });
    });

    deleteBtn.addEventListener("click", async () => {
      const eventName = document.getElementById("ev-name").value.trim() || "this event";
      showNativeConfirmModal({
        title: "Delete Event",
        description: `Are you sure? This will PERMANENTLY delete "${eventName}" and ALL its donations and expenses. This action cannot be undone.`,
        iconClass: "pi-red",
        iconSvg: `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
        btnText: "Delete",
        btnColor: "var(--np-red)",
        onConfirm: async () => {
          deleteBtn.disabled = true;
          try {
            await deleteEvent(editId);
            showToast("Event permanently deleted.");
            window.location.href = getCleanUrl("dashboard.html");
          } catch(e) {
            showToast(e.message || "Failed to delete event.", "error");
            deleteBtn.disabled = false;
          }
        }
      });
    });
  } else {
    document.getElementById("ev-date").valueAsDate = new Date();
  }

  document.getElementById("create-btn").addEventListener("click", async () => {
    const name  = document.getElementById("ev-name").value.trim();
    const desc  = document.getElementById("ev-desc").value.trim();
    const date  = document.getElementById("ev-date").value;
    const goal  = document.getElementById("ev-goal").value.trim();
    const btn   = document.getElementById("create-btn");
    const mainErr = document.getElementById("main-error");
    const mainErrTxt = document.getElementById("main-err-txt");

    mainErr.classList.remove("visible");

    if (!name) {
      const err = document.getElementById("ev-name-error");
      err.querySelector("span").textContent = "Event name is required.";
      err.classList.add("visible");
      document.getElementById("name-field-box").style.borderColor = "var(--np-red)";
      document.getElementById("ev-name").focus();
      return;
    }

    if (!date) {
      const err = document.getElementById("ev-date-error");
      err.querySelector("span").textContent = "Event date is required.";
      err.classList.add("visible");
      document.getElementById("date-field-box").style.borderColor = "var(--np-red)";
      document.getElementById("ev-date").focus();
      return;
    }

    btn.classList.add("loading"); btn.disabled = true;
    try {
      const goalAmount = goal ? parseInt(goal, 10) : 0;
      if (editId) {
        await updateEvent(editId, {
          name, description: desc, event_date: new Date(date).toISOString(),
          show_donations: true, show_expenses: true,
          goal_amount: goalAmount
        });
        showToast("Event updated!");
        window.history.back();
      } else {
        await createEvent(name, desc, date, true, true, goalAmount);
        showToast("Event created!");
        window.location.replace(getCleanUrl("dashboard.html"));
      }
    } catch(err) {
      mainErrTxt.textContent = err.message || "Failed to save event. Please try again.";
      mainErr.classList.add("visible");
      btn.classList.remove("loading"); btn.disabled = false;
    }
  });