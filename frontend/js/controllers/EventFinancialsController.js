// ══════════════════════════════════════════════
//  Notepay — Event Financials Controller
//  Handles all rendering, inline editing, modal logic,
//  and DOM manipulations for Donations and Expenses.
// ══════════════════════════════════════════════

(function (global) {
  'use strict';



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
        const qNormalized = q.toLowerCase().trim();
        const qStripped = stripPrefixes(q);
        
        const donorName = obj.donor_name || '';
        const donorNameStripped = stripPrefixes(donorName);
        const description = obj.description || '';
        const descriptionStripped = stripPrefixes(description);
        const collectedByName = obj.collected_by_name || 'System';
        const amount = String(obj.amount || '');
        
        // Check raw match
        let strRaw = (donorName + ' ' + description + ' ' + amount + ' ' + collectedByName).toLowerCase();
        const cfRaw = getCustomFieldsObj(obj);
        if (Object.keys(cfRaw).length > 0) {
          strRaw += ' ' + Object.values(cfRaw).join(' ').toLowerCase();
        }
        
        if (strRaw.includes(qNormalized)) return true;
        
        // Check stripped match (e.g. ignoring prefixes like (AI), (M), (AI-P))
        let strStripped = (donorNameStripped + ' ' + descriptionStripped + ' ' + amount + ' ' + collectedByName.toLowerCase());
        const cfStripped = getCustomFieldsObj(obj);
        if (Object.keys(cfStripped).length > 0) {
          strStripped += ' ' + Object.values(cfStripped).join(' ').toLowerCase();
        }
        
        if (strStripped.includes(qStripped)) return true;
        
        return false;
      }


      function renderDonations(q = null) {
        const tblBody = document.getElementById("don-tbl-body");
        captureInlineState(tblBody, "don");
        if (q === null) {
          const inp = document.getElementById("don-search");
          q = inp ? inp.value : "";
        }
        const clearBtn = document.querySelector("#pane-don .srch-clear");
        if (clearBtn) clearBtn.classList.toggle("v", q && String(q).length > 0);
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
        const total = donations.reduce((sum, d) => sum + (d.payment_received === false ? 0 : (parseFloat(d.amount) || 0)), 0);
        document.getElementById("don-count").textContent = `${filtered.length} contributor${filtered.length !== 1 ? "s" : ""}`;
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
        hdrHTML += `<div class="th" style="width:80px;">Received</div>`;
        
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
              const cf = getCustomFieldsObj(d);
              const val = cf[colName] || "";
              return `<div class="sc" data-col="${escHtml(colName)}" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
            }).join("");

            const pinned = isPinned("don", d.id || d._id);
            
            let donVersionHtml = (d.version && d.version > 1) ? `<span style="font-size:10px; color:var(--text3); margin-left:4px;">v${d.version}</span>` : '';
            let rowHTML = `
          <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('don_name', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              ${pinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
            </div>
            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${formatPrefixes(d.donor_name)}${donVersionHtml}</div>
          </div>
          `;
          let receiptHtml = d.receipt_key 
              ? `<button type="button" style="margin-left:auto; background:none; border:none; color:var(--primary); cursor:pointer; padding:6px; margin-right:-6px; display:inline-flex; align-items:center; justify-content:center; position:relative; z-index:10;" onclick="event.stopPropagation(); openReceiptModal('${d.id || d._id}', event, 'don');" title="View Payment Proof">${npIcon("file-text", {size: 16, tone: "primary"})}</button>` 
              : (isOrganizer || String(d.collected_by) === String(myUserId) ? `<button type="button" style="margin-left:auto; background:none; border:none; color:var(--text3); cursor:pointer; padding:6px; margin-right:-6px; display:inline-flex; align-items:center; justify-content:center; position:relative; z-index:10;" onclick="event.stopPropagation(); triggerManualReceiptUpload('${d.id || d._id}', 'don');" title="Upload Receipt">${npIcon("upload", {size: 16, tone: "muted"})}</button>` : '');
              
          rowHTML += `<div class="sc" style="width:${getColWidth('don_amt', 90)}px; display:flex; align-items:center;"><span class="cg">${d.amount ? formatINR(d.amount) : '₹0'}</span>${receiptHtml}</div>`;
          
          if (!hideDonDate) {
            rowHTML += `<div class="sc" style="width:${getColWidth('don_date', 100)}px;font-size:11px;">${formatDate(d.collected_at)}</div>`;
          }
          if (!hideDonColBy) {
            rowHTML += `<div class="sc" style="width:${getColWidth('don_colby', 130)}px;font-size:11px;" title="${escHtml(d.collected_by_name || "—")}">${escHtml(d.collected_by_name || "—")}</div>`;
          }
          const rcvd = d.payment_received !== false;
          rowHTML += `<div class="sc" style="width:80px;"><span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; background:${rcvd ? 'rgba(72,187,120,0.15)' : 'rgba(245,158,11,0.15)'}; color:${rcvd ? 'var(--green)' : 'var(--amber)'}; border:1px solid ${rcvd ? 'rgba(72,187,120,0.3)' : 'rgba(245,158,11,0.3)'}; white-space:nowrap;">${rcvd ? '✓ Yes' : '⏳ No'}</span></div>`;
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
          const btnHtml = isOrganizer && !q ? `<button class="btn btn-solid-primary" style="margin-top:12px; width:auto; padding:10px 24px;" onclick="openEntryForm('don')">+ Add First Contribution</button>` : "";
          emptyMsg.innerHTML = `<div class="empty-state" style="padding:40px 24px;">
        <div class="es-icon" style="margin-bottom:8px;">${q ? npIcon("search", { size: 32, tone: "muted" }) : npIcon("file-text", { size: 32, tone: "muted" })}</div>
        <div class="es-title" style="font-size:15px; font-weight:900;">${q ? 'No results found' : 'No contributions yet'}</div>
        <div class="es-sub" style="font-size:12px; opacity:0.7; max-width:220px; line-height:1.5;">${q ? 'Try a different search term.' : 'Start tracking now — add your first contribution!'}</div>
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
        if (typeof initIcons === 'function') initIcons();
      }


      function renderExpenses(q = null) {
        const tblBody = document.getElementById("exp-tbl-body");
        captureInlineState(tblBody, "exp");
        if (q === null) {
          const inp = document.getElementById("exp-search");
          q = inp ? inp.value : "";
        }
        const clearBtn = document.querySelector("#pane-exp .srch-clear");
        if (clearBtn) clearBtn.classList.toggle("v", q && String(q).length > 0);
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
              const cf = getCustomFieldsObj(e);
              const val = cf[colName] || "";
              return `<div class="sc" data-col="${escHtml(colName)}" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
            }).join("");

            const pinned = isPinned("exp", e.id || e._id);
            
            let expVersionHtml = (e.version && e.version > 1) ? `<span style="font-size:10px; color:var(--text3); margin-left:4px;">v${e.version}</span>` : '';
            let rowHTML = `
          <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth('exp_desc', 140)}px;">
            <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
              ${pinned ? `<span style="color:var(--amber);" title="Pinned">${npIcon("pin", { size: 12 })}</span>` : ''}
            </div>
            <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${formatPrefixes(e.description)}${expVersionHtml}</div>
          </div>
          `;
          let receiptHtmlExp = e.receipt_key 
              ? `<button type="button" style="margin-left:auto; background:none; border:none; color:var(--primary); cursor:pointer; padding:6px; margin-right:-6px; display:inline-flex; align-items:center; justify-content:center; position:relative; z-index:10;" onclick="event.stopPropagation(); openReceiptModal('${e.id || e._id}', event, 'exp');" title="View Receipt">${npIcon("file-text", {size: 16, tone: "primary"})}</button>` 
              : (isOrganizer || String(e.collected_by) === String(myUserId) ? `<button type="button" style="margin-left:auto; background:none; border:none; color:var(--text3); cursor:pointer; padding:6px; margin-right:-6px; display:inline-flex; align-items:center; justify-content:center; position:relative; z-index:10;" onclick="event.stopPropagation(); triggerManualReceiptUpload('${e.id || e._id}', 'exp');" title="Upload Receipt">${npIcon("upload", {size: 16, tone: "muted"})}</button>` : '');
              
          rowHTML += `<div class="sc" style="width:${getColWidth('exp_amt', 90)}px; display:flex; align-items:center;"><span class="cr">${e.amount ? formatINR(e.amount) : '₹0'}</span>${receiptHtmlExp}</div>`;
          
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
        if (typeof initIcons === 'function') initIcons();
      }



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

        const totalDonations = fDon.reduce((sum, d) => sum + (d.payment_received === false ? 0 : (parseFloat(d.amount) || 0)), 0);
        const totalToCollect = fDon.reduce((sum, d) => sum + (d.payment_received === false ? (parseFloat(d.amount) || 0) : 0), 0);
        const totalExpenses = fExp.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        
        const recent = [...fDon.map(d => ({ ...d, type: 'donation', title: d.donor_name })), ...fExp.map(e => ({ ...e, type: 'expense', title: e.description }))]
          .sort((a, b) => new Date(b.collected_at || 0) - new Date(a.collected_at || 0));

        const dynamicSummary = {
          total_donations: totalDonations,
          total_to_collect: totalToCollect,
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

        // Top Donors (Ranked) — only count payment_received entries
        const donorTotals = {};
        fDon.filter(d => d.payment_received !== false).forEach(d => {
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

        // Top Collectors (Ranked) — only count payment_received entries
        const collectorTotals = {};
        fDon.filter(d => d.payment_received !== false).forEach(d => {
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

        let goalDashboardUI = "";
        if (eventData.goal_amount > 0) {
          const collections = s.total_donations || 0;
          const percent = Math.min(Math.round((collections / eventData.goal_amount) * 100), 999);
          const strokePercent = Math.min(percent, 100);
          
          goalDashboardUI = `
            <!-- Goal Dashboard Gauge -->
            <div style="background:var(--card); border:1.5px solid var(--border2); border-radius:18px; padding:16px; margin-bottom:12px; box-shadow:var(--shadow-sm); display:flex; align-items:center; gap:16px;">
              <!-- Left Circular Progress Gauge -->
              <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 68px; height: 68px; flex-shrink: 0;">
                <svg width="68" height="68" viewBox="0 0 36 36" style="transform: rotate(-90deg);">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border2)" stroke-width="3" />
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--teal)" stroke-dasharray="${strokePercent}, 100" stroke-width="3" stroke-linecap="round" />
                </svg>
                <div style="position: absolute; font-family: 'Nunito', sans-serif; font-size: 13px; font-weight: 900; color: var(--text);">${percent}%</div>
              </div>
              <!-- Right Details -->
              <div style="flex:1; min-width:0;">
                <div style="font-size:11px; font-weight:800; color:var(--text3); text-transform:uppercase; letter-spacing:0.5px;">COLLECTION GOAL PROGRESS</div>
                <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:4px;">
                  <span style="font-size:18px; font-weight:900; color:var(--text);">${formatINR(collections)}</span>
                  <span style="font-size:12px; font-weight:700; color:var(--text3);">of ${formatINR(eventData.goal_amount)}</span>
                </div>
                <div style="height:6px; background:var(--border2); border-radius:10px; overflow:hidden; margin-top:8px;">
                  <div style="height:100%; width:${strokePercent}%; background:var(--teal); border-radius:10px;"></div>
                </div>
              </div>
            </div>
          `;
        }

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
              ${s.total_to_collect > 0 ? `<div style="font-size:10px; font-weight:700; color:var(--amber); margin-top:2px;">+${formatINR(s.total_to_collect)} to collect</div>` : ''}
              <div style="position:absolute; bottom:6px; left:12px; font-size:9px; font-weight:800; color:var(--text3); opacity:0.6;">${s.donations_count} contributors</div>
            </div>` : ''}
            ${showExp ? `<div style="flex:1; background:var(--card); border:1.5px solid var(--border2); border-radius:16px; padding:12px; text-align:center; position:relative; padding-bottom:18px;">
              <div style="font-size:11px; font-weight:800; color:var(--text3);">SPENT</div>
              <div style="font-size:16px; font-weight:900; color:var(--red);">${formatINR(s.total_expenses)}</div>
              <div style="position:absolute; bottom:6px; left:12px; font-size:9px; font-weight:800; color:var(--text3); opacity:0.6;">${s.expenses_count} expenses</div>
            </div>` : ''}
          </div>

          <div class="sum-grid" style="display:flex; flex-direction:column; gap:10px;">
            ${goalDashboardUI}
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
                <span style="font-size:14px; font-weight:900; color:var(--text);">Top Contributors</span>
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
                `}).join("") : '<div style="text-align:center; padding:10px; color:var(--text3); font-size:12px;">No contributions yet</div>'}
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
                  <div style="font-size:9px; font-weight:800; color:var(--text3);">${(t.type === 'donation' ? 'contribution' : t.type).toUpperCase()}</div>
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




      function filterTable(type, q) {
        const inp = document.getElementById(type === 'don' ? 'don-search' : 'exp-search');
        const val = q !== undefined && q !== null ? String(q) : (inp ? inp.value : "");
        const clearBtn = document.querySelector(`#pane-${type} .srch-clear`);
        if (clearBtn) {
          clearBtn.classList.toggle("v", val.length > 0);
        }
        type === "don" ? renderDonations(q) : renderExpenses(q);
      }



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


      function renderInlineEntryForm(type, scroll = true) {
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
                <input type="search" name="notepay_entry_val1" class="inline-input inl-str-val" placeholder="${isDon ? 'Contributor' : 'Description'}" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 22px 0 6px; font-size:13px; background:var(--input-bg); color:var(--text); line-height:30px; margin:0; display:block;" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" inputmode="text" readonly onfocus="this.removeAttribute('readonly');">
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
            ${isDon ? `<div class="sc" style="width:80px; align-items:center; display:flex;">
              <select class="inl-payment-received" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 4px; font-size:12px; font-weight:700; background:var(--input-bg); color:var(--text);">
                <option value="true" selected>✓ Yes</option>
                <option value="false">⏳ No</option>
              </select>
            </div>` : ''}
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
            existing = donations.find(d => stripPrefixes(d.donor_name) === stripPrefixes(name));
          } else {
            existing = expenses.find(e => stripPrefixes(e.description) === stripPrefixes(name));
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
            const prSel = row.querySelector('.inl-payment-received');
            const paymentReceived = prSel ? prSel.value !== 'false' : true;
            newEntry = await addDonation(eventId, name, amt ? parseFloat(amt) : null, customFields, paymentReceived);
            donations.push(newEntry);

            // Silent Update Totals & Counts
            const total = donations.reduce((sum, d) => sum + (d.payment_received === false ? 0 : (parseFloat(d.amount) || 0)), 0);
            document.getElementById("don-count").textContent = `${donations.length} contributor${donations.length !== 1 ? "s" : ""}`;
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
            
            const hideDate = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_date" : "_sys_exp_date") && c.hidden);
            const hideColBy = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_colby" : "_sys_exp_colby") && c.hidden);
            const hideAmt = customCols.some(c => (typeof c === "string" ? c : c.n) === (isDon ? "_sys_don_amt" : "_sys_exp_amt") && c.hidden);
            
            const visibleCustomCols = customCols.filter(c => {
              const n = typeof c === 'string' ? c : c.n;
              return !n.startsWith('_sys_') && !(c.hidden === true);
            });

            const customCells = visibleCustomCols.map(col => {
              const colName = typeof col === "string" ? col : col.n;
              const colWidth = typeof col === "string" ? 180 : (col.w || 180);
              const cf = getCustomFieldsObj(newEntry);
              const val = cf[colName] || "";
              return `<div class="sc" style="width:${colWidth}px;font-size:11px;" title="${escHtml(val)}">${escHtml(val)}</div>`;
            }).join("");
    
            let innerHTML = `
                <div class="fc sticky-col" style="display:flex !important; flex-direction:row !important; align-items:center !important; justify-content:flex-start !important; flex-wrap:nowrap !important; width:${getColWidth(isDon ? 'don_name' : 'exp_desc', 140)}px;">
                  <div style="width:14px; margin-right:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center;"></div>
                  <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left;">${escHtml(isDon ? newEntry.donor_name : newEntry.description)}</div>
                </div>
                <div class="sc" style="width:${getColWidth(isDon ? 'don_amt' : 'exp_amt', 90)}px; display:${hideAmt ? 'none !important' : 'flex'};"><span class="${isDon ? 'cg' : 'cr'}">${newEntry.amount ? formatINR(newEntry.amount) : '₹ 0'}</span></div>`;
            
            if (!hideDate) {
              innerHTML += `\n              <div class="sc" style="width:${getColWidth(isDon ? 'don_date' : 'exp_date', 100)}px;font-size:11px;">${formatDate(newEntry.collected_at)}</div>`;
            }
            if (!hideColBy) {
              innerHTML += `\n              <div class="sc" style="width:${getColWidth(isDon ? 'don_colby' : 'exp_colby', 130)}px;font-size:11px;" title="${escHtml(newEntry.collected_by_name || "—")}">${escHtml(newEntry.collected_by_name || "—")}</div>`;
            }
            if (isDon) {
              const rcvd = newEntry.payment_received !== false;
              innerHTML += `\n              <div class="sc" style="width:80px;"><span style="font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; background:${rcvd ? 'rgba(72,187,120,0.15)' : 'rgba(245,158,11,0.15)'}; color:${rcvd ? 'var(--green)' : 'var(--amber)'}; border:1px solid ${rcvd ? 'rgba(72,187,120,0.3)' : 'rgba(245,158,11,0.3)'}; white-space:nowrap;">${rcvd ? '✓ Yes' : '⏳ No'}</span></div>`;
            }
            
            innerHTML += `\n              ${customCells}\n            `;
            newRowDom.innerHTML = innerHTML;
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
          const prSel = row.querySelector('.inl-payment-received');
          if (prSel) prSel.value = "true";

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
            ${isDon ? `<div class="sc" style="width:80px; align-items:center; display:flex;">
              <select class="inl-payment-received" style="width:100%; height:30px; box-sizing:border-box; border:1px solid var(--border); border-radius:4px; padding:0 4px; font-size:12px; font-weight:700; background:var(--input-bg); color:var(--text);">
                <option value="true" ${d.payment_received !== false ? 'selected' : ''}>✓ Yes</option>
                <option value="false" ${d.payment_received === false ? 'selected' : ''}>⏳ No</option>
              </select>
            </div>` : ''}
        `;

        customCols.forEach(col => {
          const colName = typeof col === "string" ? col : col.n;
          if (colName.startsWith("_sys_")) return;
          const colWidth = typeof col === "string" ? 180 : (col.w || 180);
          const isHidden = typeof col === "object" && col.hidden;
          const cf = getCustomFieldsObj(d);
          const cv = cf[colName] ? escHtml(cf[colName]) : '';
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
            existing = donations.find(d => String(d.id || d._id) !== currentIdStr && stripPrefixes(d.donor_name) === stripPrefixes(name));
          } else {
            existing = expenses.find(e => String(e.id || e._id) !== currentIdStr && stripPrefixes(e.description) === stripPrefixes(name));
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
            const prSel = row.querySelector('.inl-payment-received');
            const paymentReceived = prSel ? prSel.value !== 'false' : true;
            updatedEntry = await updateDonation(eventId, id, { donor_name: name, amount: amt ? parseFloat(amt) : null, custom_fields: customFields, payment_received: paymentReceived });
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
            if (nameEl) {
              const rawName = isDon ? updatedEntry.donor_name : updatedEntry.description;
              const versionHtml = (updatedEntry.version && updatedEntry.version > 1) ? `<span style="font-size:10px; color:var(--text3); margin-left:4px;">v${updatedEntry.version}</span>` : '';
              nameEl.innerHTML = formatPrefixes(rawName) + versionHtml;
            }
            
            const amtEl = oRow.querySelector('.sc:nth-child(2) span');
            if (amtEl) {
              amtEl.className = isDon ? 'cg' : 'cr';
              amtEl.innerHTML = updatedEntry.amount ? formatINR(updatedEntry.amount) : '₹0';
            }

            // Update custom field elements in oRow in-place instantly
            const customInputs = row.querySelectorAll('.inl-custom');
            customInputs.forEach(inp => {
              const colName = inp.getAttribute('data-col');
              let newVal = inp.value.trim();
              const colCell = oRow.querySelector(`.sc[data-col="${colName}"]`);
              if (colCell) {
                if (!newVal && activeTheaterTab) {
                  newVal = "-";
                }
                colCell.textContent = newVal;
                colCell.setAttribute('title', newVal);
              }
            });
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

          // Re-render the tables/theater mode to make sure all data (including custom columns) is updated instantly on the UI
          if (activeTheaterTab) {
            refreshTheaterTable();
          } else {
            if (isDon) renderDonations(); else renderExpenses();
          }

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
          err.textContent = entryType === "don" ? "Contributor name is required." : "Description is required.";
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
            existing = donations.find(d => stripPrefixes(d.donor_name) === stripPrefixes(name));
          } else {
            existing = expenses.find(e => stripPrefixes(e.description) === stripPrefixes(name));
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
        const color = type === "don" ? "var(--green)" : "var(--red)";
        const label = type === "don" ? "contributor" : "expense";
        const amtStr = `<span style="color:${color};font-weight:900;">₹${(amount || 0).toLocaleString()}</span>`;

        const desc = `An entry with the ${label} <strong>${escHtml(name)}</strong> and amount ${amtStr} already 
  exist. Do you want to add it again?`;

        showGlobalConfirmModal({
          title: "Duplicate Entry?",
          desc: desc,
          iconTone: "amber",
          confirmText: "Add Anyway",
          confirmColor: "var(--amber)",
          onConfirm: onConfirm
        });
      }


      function closeDupPop() { document.getElementById("duplicate-pop").style.display = "none"; }


      function openCtx(e, type, entry) {
        if (isVisitor) return;
        
        // Fetch latest entry from array to prevent stale closure data if previously inline-edited
        const entryIdStr = String(entry.id || entry._id);
        const latest = type === 'don' 
          ? donations.find(x => String(x.id || x._id) === entryIdStr) 
          : expenses.find(x => String(x.id || x._id) === entryIdStr);
        if (latest) entry = latest;
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
        const canModify = isOrganizer || String(entry.collected_by) === String(myUserId);
        const isUnverified = type === 'don' ? entry.payment_received === false : false;

        ctx.innerHTML = `
          <div class="ctx-lbl">${escHtml(name)}</div>
          <div class="ctx-item" onclick="closeCtx();togglePin('${type}', '${ctxEntry.id || ctxEntry._id}')">
            <span data-np-icon="pin" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
            ${pinned ? 'Unpin Entry' : 'Pin Entry'}
          </div>
          ${canModify ? `
            ${type === 'don' ? `
            <div class="ctx-item" onclick="closeCtx();shareReceipt('${escHtml(entry.donor_name).replace(/'/g, "\\'")}', '${entry.amount}', '${entry.collected_at}', '${escHtml(entry.collected_by_name || 'System').replace(/'/g, "\\'")}')">
              <span data-np-icon="share" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
              Share Receipt
            </div>
            ` : ''}
            ${(!entry.receipt_key) ? `
            <div class="ctx-item" onclick="closeCtx();triggerManualReceiptUpload('${entry.id || entry._id}', '${type}')">
              <span data-np-icon="camera" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
              Upload Proof
            </div>
            ` : ''}
            <div class="ctx-item" onclick="closeCtx();openEditForm()">
              <span data-np-icon="edit" data-np-size="16" style="vertical-align:text-bottom;margin-right:8px;"></span>
              Edit
            </div>
            <div class="ctx-item dng" onclick="closeCtx();openDelPop()">
              <span data-np-icon="trash" data-np-size="16" data-np-tone="red" style="vertical-align:text-bottom;margin-right:8px;"></span>
              Delete
            </div>
          ` : ''}
        `;
        document.body.appendChild(ov);
        ov.appendChild(ctx);
        if (typeof initIcons === 'function') initIcons();

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
          err.textContent = editTarget.type === "don" ? "Contributor name is required." : "Description is required.";
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
            existing = donations.find(d => String(d.id || d._id) !== currentIdStr && stripPrefixes(d.donor_name) === stripPrefixes(name));
          } else {
            existing = expenses.find(e => String(e.id || e._id) !== currentIdStr && stripPrefixes(e.description) === stripPrefixes(name));
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
        showGlobalConfirmModal({
          title: "Delete Entry?",
          desc: `"<strong>${escHtml(name)}</strong>" will be permanently deleted.`,
          iconTone: "red",
          confirmText: "Delete",
          confirmColor: "var(--red)",
          onConfirm: confirmDelete
        });
      }



      function openDelColPop() {
        if (!editingColName) return;
        colToDeleteType = "custom";
        showGlobalConfirmModal({
          title: "Hide this column?",
          desc: `Are you sure you want to hide "<strong>${escHtml(editingColName)}</strong>"? Existing data in this column will be preserved.`,
          iconTone: "red",
          confirmText: "Hide",
          confirmColor: "var(--red)",
          onConfirm: confirmDeleteColumn
        });
      }


      
      function openDelDefColPop() {
        colToDeleteType = "default";
        const title = document.getElementById("def-col-title").textContent;
        showGlobalConfirmModal({
          title: "Hide this column?",
          desc: `Are you sure you want to hide "<strong>${escHtml(title)}</strong>"? Existing data in this column will be preserved.`,
          iconTone: "red",
          confirmText: "Hide",
          confirmColor: "var(--red)",
          onConfirm: confirmDeleteColumn
        });
      }



      async function confirmDeleteColumn() {
        if (colToDeleteType === "default") {
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
          showToast("Column hidden.");
        } catch (e) {
          showToast(e.message || "Failed.", "error");
        }
      }



      async function confirmDelete() {
        try {
          if (ctxType === "don") { await deleteDonation(eventId, ctxEntry.id); donations = donations.filter(d => d.id !== ctxEntry.id); renderDonations(); }
          else { await deleteExpense(eventId, ctxEntry.id); expenses = expenses.filter(e => e.id !== ctxEntry.id); renderExpenses(); }
          clearEventCache();
          summaryData = null; // Invalidate cache
          if (activeTheaterTab) switchTheaterTab(activeTheaterTab, true);
          showToast("Entry deleted.");
        } catch (e) { showToast(e.message || "Failed.", "error"); }
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
        const sortRadio = document.querySelector(`input[name="fs_sort"][value="${currentSort}"]`);
        if (sortRadio) sortRadio.checked = true;
        if (document.getElementById("fs_my_entries")) document.getElementById("fs_my_entries").checked = myEntriesOnly;
        if (document.getElementById("fs_yet_to_be_collected")) document.getElementById("fs_yet_to_be_collected").checked = yetToBeCollected;
        if (document.getElementById("fs_date_val")) document.getElementById("fs_date_val").value = eventDateFilter || 'all';
        if (document.getElementById("fs_date_start")) document.getElementById("fs_date_start").value = eventDateStart || '';
        if (document.getElementById("fs_date_end")) document.getElementById("fs_date_end").value = eventDateEnd || '';
        if (!isVisitor) {
          document.getElementById("fs-filter-section").style.display = "block";
        } else {
          document.getElementById("fs-filter-section").style.display = "none";
        }
        syncEventFilterPills();
      }


      
      function closeFilterModal() {
        document.getElementById("filter-sort-overlay").style.display = "none";
      }



      function syncEventFilterPills() {
        const sortVal = document.querySelector('input[name="fs_sort"]:checked')?.value || 'time_asc';
        document.querySelectorAll('.flt-pills[data-target="fs_sort"] .flt-pill').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-val') === sortVal);
        });
        const myEntriesBtn = document.getElementById('pill_my_entries');
        if (myEntriesBtn && document.getElementById('fs_my_entries')) {
          myEntriesBtn.classList.toggle('active', document.getElementById('fs_my_entries').checked);
        }
        const yetBtn = document.getElementById('pill_yet_to_be_collected');
        if (yetBtn && document.getElementById('fs_yet_to_be_collected')) {
          yetBtn.classList.toggle('active', document.getElementById('fs_yet_to_be_collected').checked);
        }
        const dateVal = document.getElementById('fs_date_val')?.value || 'all';
        document.querySelectorAll('.flt-pills[data-target="fs_date"] .flt-pill').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-val') === dateVal);
        });
        const row = document.getElementById('ev-custom-date-row');
        if (row) {
          row.style.display = (dateVal === 'custom') ? 'flex' : 'none';
        }
      }



      function setEventSortPill(val, btn) {
        const radio = document.querySelector(`input[name="fs_sort"][value="${val}"]`);
        if (radio) {
          radio.checked = true;
          document.querySelectorAll('.flt-pills[data-target="fs_sort"] .flt-pill').forEach(b => b.classList.remove('active'));
          if (btn) btn.classList.add('active');
        }
      }



      function setEventDatePill(val, btn) {
        const inp = document.getElementById('fs_date_val');
        if (inp) inp.value = val;
        document.querySelectorAll('.flt-pills[data-target="fs_date"] .flt-pill').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        const row = document.getElementById('ev-custom-date-row');
        if (row) {
          row.style.display = (val === 'custom') ? 'flex' : 'none';
        }
      }



      function toggleEventFilterPill(inputId, btn) {
        const chk = document.getElementById(inputId);
        if (chk) {
          chk.checked = !chk.checked;
          if (btn) btn.classList.toggle('active', chk.checked);
        }
      }



      function clearEventFilterMenu() {
        const defaultRadio = document.querySelector('input[name="fs_sort"][value="time_asc"]');
        if (defaultRadio) defaultRadio.checked = true;
        if (document.getElementById('fs_my_entries')) document.getElementById('fs_my_entries').checked = false;
        if (document.getElementById('fs_yet_to_be_collected')) document.getElementById('fs_yet_to_be_collected').checked = false;
        if (document.getElementById('fs_date_val')) document.getElementById('fs_date_val').value = 'all';
        if (document.getElementById('fs_date_start')) document.getElementById('fs_date_start').value = '';
        if (document.getElementById('fs_date_end')) document.getElementById('fs_date_end').value = '';
        syncEventFilterPills();
        applyFilterSort();
        closeFilterModal();
      }



      function applyFilterSort() {
        currentSort = document.querySelector('input[name="fs_sort"]:checked')?.value || 'time_asc';
        myEntriesOnly = document.getElementById("fs_my_entries")?.checked || false;
        yetToBeCollected = document.getElementById("fs_yet_to_be_collected")?.checked || false;
        eventDateFilter = document.getElementById("fs_date_val")?.value || 'all';
        if (eventDateFilter === 'custom') {
          eventDateStart = document.getElementById("fs_date_start")?.value || '';
          eventDateEnd = document.getElementById("fs_date_end")?.value || '';
        }
        
        updateFilterIconStyles();
        
        const qd = document.getElementById("don-search")?.value || "";
        const qe = document.getElementById("exp-search")?.value || "";
        renderDonations(qd);
        renderExpenses(qe);
        if (activeTheaterTab) {
          enterTheater(activeTheaterTab);
        }
      }



      function updateFilterIconStyles() {
        const icons = document.querySelectorAll('.flt-btn, .filter-icon-btn');
        const isActive = currentSort !== 'time_asc' || myEntriesOnly || yetToBeCollected || (eventDateFilter && eventDateFilter !== 'all');
        icons.forEach(btn => {
          btn.classList.toggle('applied', isActive);
          if (isActive) {
            btn.style.color = "";
            btn.style.background = "";
            btn.style.borderColor = "";
          } else {
            btn.style.color = "";
            btn.style.background = "";
            btn.style.borderColor = "";
            if(btn.style.padding === "4px") btn.style.background = "var(--surface)"; // theater mode variant
          }
        });
      }



      function openColDD() { document.getElementById("dd-col-ov").style.display = "flex"; }


      function closeColDD() {
        document.getElementById("dd-col-ov").style.display = "none";
      }



  function triggerManualReceiptUpload(idStr, type = 'don') {
    pendingReceiptDonationId = idStr;
    pendingReceiptEntryType = type;
    document.getElementById('manual-receipt-upload').click();
  }



  async function handleManualReceiptUpload(e) {
    const file = e.target.files[0];
    if (!file || !pendingReceiptDonationId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const token = await getIdToken();
      const endpoint = pendingReceiptEntryType === 'don' ? '/donations/' : '/expenses/';
      const res = await fetch(API_BASE + '/events/' + eventId + endpoint + pendingReceiptDonationId + '/receipt', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token
        },
        body: formData
      });
      if (res.ok) {
        showToast('Receipt uploaded successfully!');
        const collection = pendingReceiptEntryType === 'don' ? donations : expenses;
        const d = collection.find(x => String(x.id || x._id) === pendingReceiptDonationId);
        if (d) {
          const data = await res.json();
          if (d.cached_receipt_url) {
            URL.revokeObjectURL(d.cached_receipt_url);
            delete d.cached_receipt_url;
          }
          d.receipt_key = data.receipt_key;

          // Generate local object URL from file and cache it
          const localObjUrl = URL.createObjectURL(file);
          d.cached_receipt_url = localObjUrl;

          // If modal is open for this entry, update image source immediately
          if (document.getElementById('receipt-modal').style.display === 'flex' && activeModalDonationId === pendingReceiptDonationId) {
            document.getElementById('receipt-img').src = localObjUrl;
          }

          if (pendingReceiptEntryType === 'don') renderDonations();
          else renderExpenses();
          if (typeof initIcons === 'function') initIcons();
        }
      } else {
        const data = await res.json();
        showToast(data.detail || 'Failed to upload receipt');
      }
    } catch (err) {
      hideLoading();
      showToast('Error uploading receipt');
    }
    e.target.value = ''; // reset input
  }



  async function openReceiptModal(donationIdStr, event, type = 'don') {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const collection = type === 'don' ? donations : expenses;
    let d = collection.find(x => String(x.id || x._id) === String(donationIdStr));
    if (!d) {
      // Fallback search across both collections in case of mismatched type param
      d = donations.find(x => String(x.id || x._id) === String(donationIdStr)) ||
          expenses.find(x => String(x.id || x._id) === String(donationIdStr));
    }
    if (!d || (!d.receipt_key && !d.receipt_url && !d.cached_receipt_url)) return;
    
    activeModalDonationId = donationIdStr;
    activeModalEntryType = type;
    
    const img = document.getElementById('receipt-img');
    if (img) img.src = '';
    
    const donorNameEl = document.getElementById('receipt-donor-name');
    if (donorNameEl) {
      let rawName = type === 'don' ? (d.donor_name || 'Contributor') : (d.description || 'Expense');
      let cleanName = String(rawName || "").replace(/^\((M|AI|AI-P)\)\s*/, '');
      donorNameEl.innerText = (type === 'don' ? "Contributor: " : "Expense: ") + cleanName;
    }
    
    const receiptModalEl = document.getElementById('receipt-modal');
    if (receiptModalEl) receiptModalEl.style.display = 'flex';
    
    // Security & Actions Logic
    const canModify = isOrganizer || String(d.collected_by) === String(myUserId);
    const editBtn = document.getElementById('btn-receipt-edit');
    const actionDiv = document.getElementById('receipt-actions');
    const verifyBtn = document.getElementById('btn-receipt-verify');
    const rejectBtn = document.getElementById('btn-receipt-reject');
    const removeBtn = document.getElementById('btn-receipt-remove');
    
    if (canModify) {
      if (editBtn) editBtn.style.display = 'flex';
      if (actionDiv) actionDiv.style.display = 'flex';
      const isUnverified = type === 'don' ? d.payment_received === false : false;
      
      if (isUnverified && isOrganizer) {
        if (verifyBtn) verifyBtn.style.display = 'flex';
        if (rejectBtn) rejectBtn.style.display = 'flex';
        if (removeBtn) removeBtn.style.display = 'none';
      } else {
        if (verifyBtn) verifyBtn.style.display = 'none';
        if (rejectBtn) rejectBtn.style.display = 'none';
        if (removeBtn) removeBtn.style.display = d.is_public_entry ? 'none' : 'flex';
      }
    } else {
      if (editBtn) editBtn.style.display = 'none';
      if (actionDiv) actionDiv.style.display = 'none';
    }
    
    if (d.cached_receipt_url) {
      img.src = d.cached_receipt_url;
      return;
    }

    try {
      const token = await getIdToken();
      const endpoint = type === 'don' ? '/donations/' : '/expenses/';
      const res = await fetch(API_BASE + '/events/' + eventId + endpoint + (d.id || d._id) + '/receipt', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) throw new Error("Receipt fetch failed");
      const blob = await res.blob();
      d.cached_receipt_url = URL.createObjectURL(blob);
      img.src = d.cached_receipt_url;
    } catch (err) {
      console.error("Failed to load receipt:", err);
      showToast('Failed to load receipt image');
    }
  }



  function closeReceiptModal() {
    document.getElementById('receipt-modal').style.display = 'none';
    const img = document.getElementById('receipt-img');
    img.src = '';
  }



  async function verifyReceiptDonation() {
    if (!activeModalDonationId) return;
    const d = donations.find(x => String(x.id || x._id) === activeModalDonationId);
    if (!d) return;
    
    const donorName = d.donor_name.replace(/^\((M|AI|AI-P)\)\s*/, '');
    
    showConfirmModal(
      "Accept Payment Proof",
      `Are you sure you want to approve the payment proof for '${donorName}'? This collection entry will be treated as verified.`,
      "Accept",
      "#10b981",
      async () => {
        const newName = d.donor_name.replace(/^\((M|AI|AI-P)\)\s*/, '');
        const prevReceiptKey = d.receipt_key;
        
        try {
          const res = await apiFetch('PUT', '/events/' + eventId + '/donations/' + (d.id || d._id), {
            donor_name: newName,
            receipt_key: prevReceiptKey,
            payment_received: true
          });
          if (res) {
            showToast('Payment proof accepted!');
            closeReceiptModal();
            loadAll(); // reload
          }
        } catch (err) {
          showToast(err.message || 'Failed to accept', 'error');
          console.error(err);
        }
      },
      "badge-check",
      "green"
    );
  }



  async function rejectReceiptDonation() {
    if (!activeModalDonationId) return;
    const d = donations.find(x => String(x.id || x._id) === activeModalDonationId);
    if (!d) return;
    
    const donorName = d.donor_name.replace(/^\((M|AI|AI-P)\)\s*/, '');
    
    showConfirmModal(
      "Reject Payment Proof",
      `Are you sure you want to reject this payment proof? This action will completely delete the data of ${donorName} from collections.`,
      "Reject",
      "var(--red)",
      async () => {
        showLoading('Deleting entry...');
        try {
          const res = await apiFetch('DELETE', '/events/' + eventId + '/donations/' + activeModalDonationId);
          
          hideLoading();
          if (res) {
            showToast('Entry rejected and deleted!');
            if (d.cached_receipt_url) {
              URL.revokeObjectURL(d.cached_receipt_url);
              delete d.cached_receipt_url;
            }
            closeReceiptModal();
            const idx = donations.findIndex(x => String(x.id || x._id) === activeModalDonationId);
            if (idx !== -1) donations.splice(idx, 1);
            renderDonations();
          }
        } catch(e) {
          hideLoading();
          showToast(e.message || 'Failed to delete entry', 'error');
        }
      },
      "trash",
      "var(--red)"
    );
  }



  async function removeReceiptDonation() {
    if (!activeModalDonationId) return;
    const collection = activeModalEntryType === 'don' ? donations : expenses;
    const d = collection.find(x => String(x.id || x._id) === activeModalDonationId);
    if (!d) return;
    
    const rawName = activeModalEntryType === 'don' ? d.donor_name : d.description;
    const donorName = rawName.replace(/^\((M|AI|AI-P)\)\s*/, '');
    
    showConfirmModal(
      "Remove Receipt",
      `Are you sure you want to remove the receipt image from the entry for '${donorName}'? The entry data will be kept.`,
      "Remove",
      "var(--red)",
      async () => {
        try {
          const endpoint = activeModalEntryType === 'don' ? '/donations/' : '/expenses/';
          const payload = activeModalEntryType === 'don' ? { donor_name: d.donor_name, receipt_key: "" } : { description: d.description, receipt_key: "" };
          const res = await apiFetch('PUT', '/events/' + eventId + endpoint + (d.id || d._id), payload);
          if (res) {
            showToast('Receipt removed successfully!');
            if (d.cached_receipt_url) {
              URL.revokeObjectURL(d.cached_receipt_url);
              delete d.cached_receipt_url;
            }
            closeReceiptModal();
            loadAll();
          }
        } catch (err) {
          showToast(err.message || 'Failed to remove receipt', 'error');
          console.error(err);
        }
      },
      "trash",
      "var(--red)"
    );
  }



  function toggleReceiptZoom() {
    const img = document.getElementById('receipt-img');
    if (!img) return;
    if (img.classList.contains('zoomed')) {
      img.classList.remove('zoomed');
      img.style.position = '';
      img.style.inset = '';
      img.style.zIndex = '';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '45vh';
      img.style.background = 'var(--bg)';
      img.style.cursor = 'zoom-in';
    } else {
      img.classList.add('zoomed');
      img.style.position = 'fixed';
      img.style.top = '0';
      img.style.left = '0';
      img.style.width = '100vw';
      img.style.height = '100dvh';
      img.style.zIndex = '100050';
      img.style.maxWidth = 'none';
      img.style.maxHeight = 'none';
      img.style.objectFit = 'contain';
      img.style.background = 'rgba(0,0,0,0.9)';
      img.style.cursor = 'zoom-out';
    }
  }



  function triggerModalReceiptEdit() {
    if (!activeModalDonationId) return;
    triggerManualReceiptUpload(activeModalDonationId, activeModalEntryType);
  }


      
      function getCustomFieldsObj(obj) {
        if (!obj || !obj.custom_fields) return {};
        let cf = obj.custom_fields;
        if (typeof cf === "string" && cf.trim()) {
          try { cf = JSON.parse(cf); } catch(e) { cf = {}; }
        }
        return (typeof cf === "object" && cf !== null) ? cf : {};
      }



      function applySortAndFilter(list, type) {
        let res = [...list];
        if (myEntriesOnly && myUserId) {
          const targetUserId = Number(myUserId);
          if (type === 'don') res = res.filter(d => Number(d.collected_by) === targetUserId);
          else res = res.filter(e => Number(e.collected_by) === targetUserId);
        }
        if (type === 'don' && yetToBeCollected) {
          res = res.filter(d => d.payment_received === false);
        }
        if (eventDateFilter && eventDateFilter !== 'all') {
          const now = new Date();
          res = res.filter(item => {
            if (!item.collected_at) return true;
            const dt = new Date(item.collected_at);
            if (eventDateFilter === '30days') {
              const diff = now - dt;
              return diff <= 30 * 24 * 60 * 60 * 1000;
            }
            if (eventDateFilter === 'custom') {
              if (eventDateStart) {
                const startDt = new Date(eventDateStart);
                startDt.setHours(0, 0, 0, 0);
                if (dt < startDt) return false;
              }
              if (eventDateEnd) {
                const endDt = new Date(eventDateEnd);
                endDt.setHours(23, 59, 59, 999);
                if (dt > endDt) return false;
              }
            }
            return true;
          });
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



  // Export public API
  const Controller = {
    preserveInlineState,
    captureInlineState,
    restoreInlineState,
    searchMatch,
    renderDonations,
    renderExpenses,
    filterByDate,
    jumpToTabAndSearch,
    renderSummary,
    renderSummaryUI,
    filterTable,
    restoreNewRowBtn,
    renderInlineEntryForm,
    submitInlineEntry,
    renderInlineEditForm,
    cancelInlineEdit,
    cancelInlineEntry,
    submitInlineEdit,
    openEntryForm,
    closeEntryForm,
    saveEntry,
    openDupPop,
    closeDupPop,
    openCtx,
    closeCtx,
    openEditForm,
    closeEditForm,
    saveEdit,
    openDelPop,
    openDelColPop,
    openDelDefColPop,
    confirmDeleteColumn,
    confirmDelete,
    isPinned,
    togglePin,
    refreshTheaterTable,
    openDD,
    closeDD,
    openFilterModal,
    closeFilterModal,
    syncEventFilterPills,
    setEventSortPill,
    setEventDatePill,
    toggleEventFilterPill,
    clearEventFilterMenu,
    applyFilterSort,
    updateFilterIconStyles,
    openColDD,
    closeColDD,
    triggerManualReceiptUpload,
    handleManualReceiptUpload,
    openReceiptModal,
    closeReceiptModal,
    verifyReceiptDonation,
    rejectReceiptDonation,
    removeReceiptDonation,
    toggleReceiptZoom,
    triggerModalReceiptEdit,
    getCustomFieldsObj,
    applySortAndFilter
  };

  global.EventFinancialsController = Controller;

})(typeof window !== 'undefined' ? window : this);
