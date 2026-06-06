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
    // Prevent PTR if we are inside a horizontal scroll area like the dashboard tabs
    if (e.target.closest('.slider-container')) return;
    
    // Prevent PTR inside the chat overlay or drawer
    if (e.target.closest('.chat-drawer') || e.target.closest('#chat-overlay')) return;
    
    // Support either specific scroll areas or the body itself
    let target = e.target.closest('.tbl-sc, .sum-body, .theater-scroll-area, .content-container, .page-content');
    let scrollTop = target ? target.scrollTop : document.documentElement.scrollTop;
    
    // Only start pulling if we're at the top of a scroll area or the top of the page
    if (scrollTop <= 0) {
      ptrStartY = e.touches[0].clientY;
      ptrCurrentY = ptrStartY;
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
    
    // If pulling down
    if (dy > 0 && dy < 150) {
      ptrIndicator.style.top = (dy / 2 - 40) + 'px';
      ptrIndicator.style.opacity = Math.min(dy / 100, 1).toString();
      
      const loader = ptrIndicator.querySelector('.loader');
      if (loader) {
        if (dy > ptrThreshold) {
          loader.style.borderTopColor = 'var(--teal)';
        } else {
          loader.style.borderTopColor = 'var(--primary)';
        }
      }
    } else if (dy < 0) {
      // Swiping up, cancel pull
      ptrIsPulling = false;
      ptrIndicator.style.top = '-50px';
      ptrIndicator.style.opacity = '0';
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
      
      // Perform the refresh action
      if (typeof loadAll === 'function') {
        // We are on the event page, silently reload without blinking
        await loadAll(true, true);
        ptrIndicator.style.top = '-50px';
        ptrIndicator.style.opacity = '0';
      } else {
        // We are on dashboard or another page, do a hard reload
        window.location.reload(true);
      }
    } else {
      ptrIndicator.style.top = '-50px';
      ptrIndicator.style.opacity = '0';
    }
  });
});
