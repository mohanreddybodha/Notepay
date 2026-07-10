// ══════════════════════════════════════════════
//  Notepay — Event Chat Controller
//  Handles real-time chat, AI advisor integration,
//  and WebSocket messages.
// ══════════════════════════════════════════════

(function (global) {
  'use strict';

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
    window.visualViewport.addEventListener('scroll', applyChatVisualViewport, { passive: true });
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

      // If the fetched messages contain an AI response, immediately hide the typing indicator
      // (covers the case where the AI response arrived via background poll instead of WebSocket)
      if (msgs.some(m => m.user_id == null)) {
        hideAITypingIndicator();
      }

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

    const safeName = escHtml(m.sender_name).replace(/"/g, '&quot;').replace(/\n  /g, '&#10;');
    const ctxText = isGroupCallMessage(m.message) ? 'Group call — Join meeting' : m.message;
    const safeText = escHtml(ctxText).replace(/"/g, '&quot;').replace(/\n  /g, '&#10;');

    // Status Icons Logic
    let statusIcon = '';
    if (isOwn && !isDeleted) {
      if (m.is_pending || m.id < 0) {
        // 1. TIMER — offline / not yet sent
        statusIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon" style="opacity:0.6"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
      } else if (m.id > 0) {
        // Count only unrestricted non-sender members using the top-level `members` array
        const myId2 = parseInt(localStorage.getItem('np_my_id') || '0');
        const membersArr = (typeof members !== 'undefined' && members && members.length > 0) ? members : [];
        const unrestrictedOthers = membersArr.filter(mem => !mem.is_restricted && mem.user_id !== myId2);
        const requiredCount = unrestrictedOthers.length;
        const readIds = (m.read_by || []).map(id => parseInt(id));
        const readCount = unrestrictedOthers.filter(mem => readIds.includes(parseInt(mem.user_id))).length;

        if (requiredCount > 0 && readCount >= requiredCount) {
          // 3. BLUE DOUBLE TICK — all unrestricted members have seen the message
          statusIcon = `<svg width="18" height="14" viewBox="-2 0 28 24" fill="none" stroke="#3b82f6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon msg-status-blue"><path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path></svg>`;
        } else {
          // 2. DOUBLE GRAY TICK — sent and in database
          statusIcon = `<svg width="18" height="14" viewBox="-2 0 28 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="msg-status-icon" style="opacity:0.65"><path d="M18 6 7 17l-5-5"></path><path d="m22 10-7.5 7.5L13 16"></path></svg>`;
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
    const baseClass = isAI ? 'chat-msg-ai' : (isOwn ? 'chat-msg-own' : 'chat-msg-other');
    const tailClass = showSender && !isAI ? 'chat-msg-first' : '';
    
    html += `<div class="chat-msg ${baseClass} ${tailClass} ${isDeleted ? 'chat-msg-deleted' : ''} ${animateClass}" id="chat-msg-${m.id}" ${isAI ? 'style="width: 100%; max-width: 100%;"' : ''}>`;
    
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
      msgContent = `<span style="display:inline-flex;align-items:center;gap:6px;opacity:0.85;font-style:italic;font-weight:500;">${npIcon('trash', {size: 16})} This message was deleted.</span>`;
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
      const evNameEscaped = typeof eventData !== 'undefined' && eventData ? escHtml(eventData.name) : 'NotePay';
      html += `<div class="chat-retention-info" style="text-align:center; padding:10px 14px; margin:8px 12px; font-size:11px; font-weight:700; color:var(--text3); background:var(--surf-var); border-radius:10px; border:1px solid var(--border2); line-height:1.4;">
        ${evNameEscaped} Chat preserves the latest 250 messages. Older messages are automatically deleted by the server.
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
      const evNameEscaped = typeof eventData !== 'undefined' && eventData ? escHtml(eventData.name) : 'NotePay';
      html += `<div class="chat-retention-info" style="text-align:center; padding:10px 14px; margin:8px 12px; font-size:11px; font-weight:700; color:var(--text3); background:var(--surf-var); border-radius:10px; border:1px solid var(--border2); line-height:1.4;">
        ${evNameEscaped} Chat preserves the latest 250 messages. Older messages are automatically deleted by the server.
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

  function updateMessageNode(m, oldId = null) {
    const searchId = oldId !== null ? oldId : m.id;
    const el = document.getElementById(`chat-msg-${searchId}`);
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



  let isSendingChat = false;
  const chatOutgoingQueue = [];

  async function processChatOutgoingQueue() {
    if (isSendingChat || chatOutgoingQueue.length === 0) return;
    isSendingChat = true;

    while (chatOutgoingQueue.length > 0) {
      const { payload, mockMsgId, originalMsgText } = chatOutgoingQueue[0];
      try {
        const realMsg = await apiFetch('POST', `/events/${eventId}/chat`, payload);
        
        const idx = chatMessages.findIndex(m => m.id === mockMsgId);
        if (idx !== -1) {
          chatMessages[idx] = realMsg;
          updateMessageNode(realMsg, mockMsgId);
        }
        if (chatOpen) {
          scrollChatToBottom(true);
        }
        chatOutgoingQueue.shift();
      } catch (e) {
        if (e.message === "NP_OFFLINE" || !navigator.onLine) {
          // Stop processing and keep message in the queue for later
          break;
        }
        
        console.error("Chat send error:", e);
        const errMsg = (e && e.message && e.message !== "Failed to fetch") ? e.message : 'Failed to send message';
        showToast(errMsg, 'error');
        
        const idx = chatMessages.findIndex(m => m.id === mockMsgId);
        if (idx !== -1) chatMessages.splice(idx, 1);
        if (chatOpen) renderChatMessages();
        
        const input = document.getElementById('chat-input');
        if (input && !input.value.trim()) {
          input.value = originalMsgText;
          updateSendBtnVisibility();
        }
        chatOutgoingQueue.shift();
      }
    }
    isSendingChat = false;
  }
  
  window.addEventListener('online', () => {
    if (typeof processChatOutgoingQueue === 'function') processChatOutgoingQueue();
  });

  async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;

    if (msg.toLowerCase().startsWith('@ai ') && !navigator.onLine) {
      showToast("AI queries cannot be sent while offline.", "error");
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    updateSendBtnVisibility();
    closeEmojiTray();

    try {
      const payload = { message: msg };
      if (replyingToId) payload.reply_to_id = replyingToId;
      
      const myId = parseInt(localStorage.getItem('np_my_id'));
      const mockMsg = {
        id: -(Date.now() + Math.floor(Math.random() * 10000)),
        event_id: eventId,
        user_id: myId,
        sender_name: localStorage.getItem('np_my_name') || 'You',
        message: msg,
        reply_to_id: replyingToId,
        reactions: {},
        sent_at: new Date().toISOString(),
        is_pending: true,
        delivered_to: [],
        read_by: []
      };
      
      payload.idempotency_key = mockMsg.id.toString();
      
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

      chatOutgoingQueue.push({ payload, mockMsgId: mockMsg.id, originalMsgText: msg });
      cancelReply();
      
      processChatOutgoingQueue();
    } catch (e) {
      console.error("Failed to queue chat message", e);
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

  const pendingStatusUpdates = {};

  function handleIncomingChatMsg(data) {
    const myId = parseInt(localStorage.getItem('np_my_id') || '0');
    
    if (data.user_id == null) {
      hideAITypingIndicator();
    }

    // If it's my own message, see if we have a pending mock message to replace
    if (data.user_id === myId) {
      const mockIdx = chatMessages.findIndex(m => m.id < 0 && m.message === data.message && m.reply_to_id === data.reply_to_id);
      if (mockIdx !== -1) {
        const oldMockId = chatMessages[mockIdx].id;
        
        // Merge any pending status updates that arrived before the HTTP response
        if (pendingStatusUpdates[data.id]) {
          data.delivered_to = pendingStatusUpdates[data.id].delivered_to;
          data.read_by = pendingStatusUpdates[data.id].read_by;
          delete pendingStatusUpdates[data.id];
        }
        
        chatMessages[mockIdx] = data;
        updateMessageNode(data, oldMockId);
        return;
      }
    }

    if (chatMessages.some(m => m.id === data.id)) return;
    
    // Mark as delivered if it's from someone else
    if (data.user_id != null && data.user_id !== myId) {
      apiFetch('POST', `/events/${eventId}/chat/${data.id}/status`, { status: 'delivered' }).catch(e => console.warn(e));
    }

    // Check if this new message arrived out of order compared to the last received message
    const lastMsg = chatMessages[chatMessages.length - 1];
    const outOfOrder = lastMsg && typeof lastMsg.id === 'number' && lastMsg.id > 0 && data.id < lastMsg.id;

    chatMessages.push(data);
    if (outOfOrder) {
      chatMessages.sort((a, b) => a.id - b.id);
    }

    if (data.user_id == null) {
      // AI responded — immediately hide typing indicator
      hideAITypingIndicator();
    }
    
    if (chatOpen) {
      const container = document.getElementById('chat-messages');
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      
      if (outOfOrder) {
        renderChatMessages();
      } else {
        appendChatMessage(data);
      }
      
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
      if (chatOpen) updateMessageNode(data, data.id);
    }
  }

  function handleIncomingChatStatus(data) {
    const idx = chatMessages.findIndex(m => m.id === data.id);
    if (idx !== -1) {
      chatMessages[idx] = data;
      if (chatOpen) updateMessageNode(data, data.id);
    } else {
      pendingStatusUpdates[data.id] = data;
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

    const chatMsgs = document.getElementById('chat-messages');
    if (chatMsgs) {
      chatMsgs.addEventListener('dblclick', handleCtxMenuOpen);
      chatMsgs.addEventListener('contextmenu', handleCtxMenuOpen);
    }
  });
  
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
    // Convert Markdown list items to bullet points (•)
    escaped = escaped.replace(/^[\s]*[\*\-]\s+/gm, '&bull; ');
    escaped = escaped.replace(/\n  /g, '<br/>');
    
    return escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>'
    );
  }

  // Export public API
  const Controller = {
    get chatHistoryLoaded() { return chatHistoryLoaded; },
    set chatHistoryLoaded(val) { chatHistoryLoaded = val; },
    get chatLoading() { return chatLoading; },
    set chatLoading(val) { chatLoading = val; },
    get chatOpen() { return chatOpen; },
    set chatOpen(val) { chatOpen = val; },
    get isOrganizerGlobal() { return isOrganizerGlobal; },
    set isOrganizerGlobal(val) { isOrganizerGlobal = val; },
    autoResizeChatInput,
    updateSendBtnVisibility,
    setEmojiTrayOpen,
    closeEmojiTray,
    lockPageScrollForChat,
    applyChatVisualViewport,
    bindChatVisualViewport,
    openChat,
    markChatAsRead,
    closeChat,
    updateChatBadge,
    loadChatHistory,
    chatTimeExact,
    chatDateLabel,
    buildMessageHTML,
    prependOlderMessages,
    processStatusQueue,
    setupChatObserver,
    observeNewMessages,
    renderChatMessages,
    appendChatMessage,
    updateMessageNode,
    scrollChatToBottom,
    startReply,
    cancelReply,
    applyChatReactionFromServer,
    sendReactionInline,
    openChatMsgCtx,
    closeChatMsgCtx,
    handleCtxReply,
    handleCtxCopy,
    handleCtxDelete,
    sendReactionInlineCtx,
    openFullEmojiPickerCtx,
    scrollToMsg,
    showAITypingIndicator,
    hideAITypingIndicator,
    processChatOutgoingQueue,
    sendChatMessage,
    keepChatInputFocused,
    handleIncomingChatMsg,
    handleIncomingChatReaction,
    handleIncomingChatStatus,
    handleCtxMenuOpen,
    generateUniqueMeetUrl,
    parseGroupCallUrl,
    isGroupCallMessage,
    formatChatMessageText
  };

  global.EventChatController = Controller;

  // Expose methods globally for HTML onclick compatibility
  Object.keys(Controller).forEach(key => {
    if (typeof Controller[key] === 'function') {
      global[key] = Controller[key];
    }
  });

})(typeof window !== 'undefined' ? window : this);

