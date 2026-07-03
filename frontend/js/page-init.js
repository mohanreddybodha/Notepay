// ══════════════════════════════════════════════
//  Notepay - page-init.js
//  Runs before all other scripts on every page.
//  Loaded as the first <script> in each HTML file.
// ══════════════════════════════════════════════

// Clean URL: strip .html extension in production
// e.g. /dashboard.html -> /dashboard (for pretty URLs on notepay.in)
(function () {
  if (
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1' &&
    window.location.protocol !== 'file:' &&
    window.location.pathname.endsWith('.html')
  ) {
    var cleanPath = window.location.pathname.replace(/\.html$/, '');
    if (cleanPath === '/index') cleanPath = '/';
    window.history.replaceState(null, '', cleanPath + window.location.search + window.location.hash);
  }
})();
