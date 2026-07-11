# Frontend JavaScript Architecture

This directory houses the client-side scripting logic, controllers, API wrappers, and utility modules for the Notepay application.

---

## 📂 File Summary

### Core Client Files
*   [api.js](api.js): The core HTTP wrapper. Attaches Firebase session tokens, manages local caching, and hosts the **Smart Offline sync queue**.
*   [auth-guard.js](auth-guard.js): Protects pages by redirecting unauthenticated users. Injects the loading splash screen to prevent FOUC (Flash of Unauthenticated Content).
*   [firebase-config.js](firebase-config.js): Initializes the Firebase SDK, implements App Check keys, and manages JWT ID token caching.
*   [components.js](components.js): Registers custom Web Components (such as `<np-sidebar>`).
*   [shared-utils.js](shared-utils.js): URL helpers (`buildUrl`), path parsers (`parseCurrentPath`), and formatters (`formatINR`, `formatDate`).
*   [icons.js](icons.js): Reusable svg icon references.
*   [page-init.js](page-init.js): Triggers core DOM load utilities.
*   [pull-to-refresh.js](pull-to-refresh.js): Mobile pull-to-refresh touch event gestures.

### Page Controllers (`js/controllers/`)
These manage dynamic views inside the master `event.html` template:
*   [EventFinancialsController.js](controllers/EventFinancialsController.js): Implements transaction tables, custom columns rendering, edits, and receipts management.
*   [EventChatController.js](controllers/EventChatController.js): Implements the real-time chat interface, message replies, and emoji reactions.
*   [EventMembersController.js](controllers/EventMembersController.js): Implements member list management, roles, and restrictions.

---

## 🔄 Interaction Flows

```
[UI Actions] ---> [Page Controller] ---> [apiFetch() in api.js]
                                              |
     [Register Offline Sync] <--- [Offline?] -+- [Online?] ---> [FastAPI Server]
```

### 1. Token Refresh
Before dispatching a REST API call, the client calls `getIdToken()` inside `firebase-config.js` to retrieve the cached session token. If the token is older than 50 minutes, it fetches a fresh one from Firebase Auth.

### 2. Offline Writing Operations
If the client is offline, `handleOfflineWrite()` intercepts the action and writes it to `np_offline_queue` in `localStorage`. The UI is updated immediately using a mock object with a negative ID. When network connectivity is restored, the queue is synced automatically.
