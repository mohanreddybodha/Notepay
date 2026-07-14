class NPSidebar extends HTMLElement {
  getInitials(name = "") {
    if (typeof window.getInitials === 'function') return window.getInitials(name);
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() || "")
      .join("") || "??";
  }

  getAvatarColor(name = "") {
    if (typeof window.getAvatarColor === 'function') return window.getAvatarColor(name);
    const colors = ["#A855F7", "#3b82f6", "#14b8a6", "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#8b5cf6"];
    let hash = 0;
    const value = String(name || "");
    for (let i = 0; i < value.length; i++) {
      hash = value.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  }

  applySidebarAvatar(el, name = "") {
    if (!el) return;
    el.textContent = this.getInitials(name);
    el.style.background = this.getAvatarColor(name);
  }

  connectedCallback() {
    this.innerHTML = `
    <aside class="sidebar">
      <div class="sb-brand" onclick="window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):'dashboard.html')" style="cursor:pointer;">
        <img src="favicon.svg" alt="Notepay Logo" class="brand-logo-img">
        <span class="sb-brand-name">Notepay</span>
      </div>

      <nav class="sb-nav">
        <div class="sb-section">Events</div>
        <div class="sb-item" id="sb-tab-0" onclick="if(typeof switchSPAView === 'function'){switchSPAView('overview'); switchTab(0)} else {window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):'dashboard.html')}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
          All Events <span class="sb-count" id="sb-count-0">0</span>
        </div>
        <div class="sb-item" id="sb-tab-1" onclick="if(typeof switchSPAView === 'function'){switchSPAView('overview'); switchTab(1)} else {window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):'dashboard.html')}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          My Events <span class="sb-count" id="sb-count-1">0</span>
        </div>
        <div class="sb-item" id="sb-tab-2" onclick="if(typeof switchSPAView === 'function'){switchSPAView('overview'); switchTab(2)} else {window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):'dashboard.html')}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Shared Events <span class="sb-count" id="sb-count-2">0</span>
        </div>
        <div class="sb-item" id="sb-tab-3" onclick="if(typeof switchSPAView === 'function'){switchSPAView('overview'); switchTab(3)} else {window.location.href=(typeof buildUrl==='function'?buildUrl('dashboard'):'dashboard.html')}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Visited Events <span class="sb-count" id="sb-count-3">0</span>
        </div>

        <div class="sb-divider"></div>
        <div class="sb-section" style="margin-top:0;">Add</div>
        <a href="${typeof buildUrl === 'function' ? buildUrl('create-event') : 'create-event.html'}" class="sb-item" id="sb-create">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Create Event
        </a>
        <a href="${typeof buildUrl === 'function' ? buildUrl('join') : 'join-event.html'}" class="sb-item" id="sb-join">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Join by Code
        </a>
      </nav>

      <div class="sb-footer">
        <a href="${typeof buildUrl === 'function' ? buildUrl('profile') : 'profile.html'}" class="sb-user">
          <div class="sb-avatar" id="av-btn-side">??</div>
          <div>
            <div class="sb-uname" id="user-name-side">My Profile</div>
            <div class="sb-uphon">Settings & Account</div>
          </div>
        </a>
      </div>
    </aside>
    `;

    const activeTab = this.getAttribute('active-tab');
    if (activeTab !== null) {
      const el = this.querySelector('#sb-tab-' + activeTab);
      if (el) el.classList.add('active');
    }

    const activeLink = this.getAttribute('active-link');
    
    // Sync state from localStorage (using existing Notepay cache keys)
    try {
      const countsStr = localStorage.getItem('np_event_counts');
      if (countsStr) {
        const counts = JSON.parse(countsStr);
        for(let i=0; i<4; i++) {
          const countEl = this.querySelector('#sb-count-' + i);
          if (countEl && counts[i] !== undefined) countEl.textContent = counts[i];
        }
      }
      
      const dashCache = localStorage.getItem('np_dash_cache');
      const profCache = localStorage.getItem('np_profile');
      let profileObj = null;
      if (dashCache) profileObj = JSON.parse(dashCache).profile;
      else if (profCache) profileObj = JSON.parse(profCache);
      
      if (profileObj && profileObj.full_name) {
        const nameEl = this.querySelector('#user-name-side');
        if (nameEl) nameEl.textContent = profileObj.full_name;
        
        const avEl = this.querySelector('#av-btn-side');
        this.applySidebarAvatar(avEl, profileObj.full_name);
      }
    } catch(e) {}

    if (activeLink) {
      const el = this.querySelector('#sb-' + activeLink);
      if (el && !(activeLink === 'create' && (window.location.pathname.includes('edit-event') || window.location.search.includes('edit=')))) {
        el.classList.add('active');
      } else if (activeLink === 'event' || 
                 window.location.pathname.startsWith('/event/') || 
                 window.location.pathname.includes('event.html') ||
                 (activeLink === 'create' && (window.location.pathname.includes('edit-event') || window.location.search.includes('edit=')))) {
        let tabNum = '0';
        try {
          const uParams = new URLSearchParams(window.location.search);
          const t = uParams.get('tab') || uParams.get('from_tab') || uParams.get('dbtab');
          if (['0', '1', '2', '3'].includes(t)) {
            tabNum = t;
            localStorage.setItem('np_dash_tab', t);
          } else {
            const saved = localStorage.getItem('np_dash_tab');
            if (saved && ['0', '1', '2', '3'].includes(saved)) tabNum = saved;
          }
        } catch(e) {}
        const tabEl = this.querySelector('#sb-tab-' + tabNum);
        if (tabEl) tabEl.classList.add('active');
      }
    }
  }
}
customElements.define('np-sidebar', NPSidebar);
