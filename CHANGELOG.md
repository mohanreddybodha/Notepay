# Changelog

All notable changes to the Notepay project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] — 2026-07-11

### Added
- **Clean URL Routing**: Implemented routing for dashboard tabs, chat drawer, create-event, and join paths, resolving pages without `.html` extensions.
- **Local Dev Clean Server**: Added clean dashboard URL path resolution inside the local development server (`serve_frontend.py`).
- **CloudFront Rewrites**: Implemented ES5 clean URL rewrites in CloudFront function and added `<base href>` targeting to all HTML templates.
- **Visual Loading Indicators**: Added a circular loading spinner to root navigation clean paths and the auto-join page redirection layout.

### Fixed
- **Navigation Page Parsing**: Fixed page load parsing for active tabs using `parseCurrentPath` and resolved delete-event relative redirection failures in production.
- **Referrer Redirection Parameters**: Removed `from=dashboard` and `from=event` query parameters from the URL. Configured `sessionStorage` (`np_edit_from`) to manage back button routing on desktop views.
- **Local Settings Queries**: Resolved double question mark `??` query string bugs on localhost event settings URLs.
- **Mobile Swipe Handling**: Improved horizontal swipe gesture thresholds to prevent layout displacement on mobile screens.

---

## [1.1.0] — 2026-05-20

### Added
- **Magic-Byte File Signatures**: Implemented magic-byte signature validation on receipt screenshot uploads to verify file types before parsing.

### Fixed
- **Serverless Event Loop**: Resolved `Mangum Event loop is closed` errors by ensuring a healthy event loop is set on handler calls and avoiding closing global loops in WebSocket auth processes.
- **CORS Preflight Failures**: Hardcoded `www.notepay.in` in CORS configurations to prevent preflight failures in production pipelines.
- **Bleach Sanitizer Fallback**: Replaced external `bleach`-dependent sanitizers with a standard library fallback to resolve dependency import failures in the AWS Lambda pipeline.
- **Admin JWT Fatal Configuration**: Downgraded missing `ADMIN_JWT_SECRET` errors from critical crashes to warnings, preventing container restarts on AWS.

---

## [1.0.0] — 2026-02-10

### Added
- **Unified Modals**: Unified all duplicate, exit, and remove event confirmation popups into a single global modal system (`np-modal`), preventing local script conflicts.
- **Smooth Dashboard Indicators**: Implemented smooth CSS sliding animations for dashboard and event tab active indicators.
- **Scrollbar Consistency**: Styled matching scrollbar thicknesses across the dashboard and event ledgers.
- **Session-Verification Overlays**: Added clean auth-guard overlays and background invite link joining.
- **Core Ledger API**: Implemented FastAPI backend models, Neon PostgreSQL migrations, S3 receipt storage, and real-time WebSocket messaging.
