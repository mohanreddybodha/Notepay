# Frontend Directory

This directory contains the user interface assets, pages, and client scripts for the Notepay application.

---

## 📂 Directory Layout

```
frontend/
├── assets/          # Fonts, brand icons, and static images
├── css/             # Stylesheets (variables, page-specific layout, custom designs)
│   └── README.md    # CSS design system documentation
├── js/              # Client-side JavaScript
│   ├── controllers/ # Event-specific sub-view controllers (Chat, Financials, Members)
│   └── README.md    # JavaScript architecture documentation
├── admin.html       # Management console dashboard (Admin JWT)
├── create-event.html# Event creation and settings editor
├── dashboard.html   # Main SPA workspace page for users
├── contribute.html      # Public visitor contribution page (UPI screenshot upload portal)
├── edit-profile.html# Profile metadata updater (Name, Gender)
├── error.html       # Fallback error landing page
├── event.html       # Master SPA page container for event ledgers
├── index.html       # Landing page portal (Welcome / Login redirection gateway)
├── join-event.html  # Invitation code gateway and pre-join preview handler
├── login.html       # OTP Phone number login controller
├── manifest.json    # PWA configuration manifest
├── privacy.html     # Privacy policies
├── profile-setup.html# Initial profile wizard for newly registered users
├── profile.html     # User profile summary page
├── sitemap.xml      # Search engine indexing configuration
└── terms.html       # Terms of service
```

---

## 🛠️ Clean URL Routing (Production vs. Local)

*   **Production**: CloudFront maps paths (e.g., `/dashboard` or `/event/event_id/collections`) to the correct HTML controller files.
*   **Local Development**: Since standard browser servers do not map clean URLs, run `python serve_frontend.py` from the project root. This starts a server on port `3000` that emulates CloudFront's clean routing behavior (e.g., serving `dashboard.html` when a request hits `/dashboard` and serving static files normally).
