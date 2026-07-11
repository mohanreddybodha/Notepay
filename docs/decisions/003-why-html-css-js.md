# ADR 003: Vanilla Frontend vs. Single Page Frameworks (React/Vue)

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Notepay is designed for users on mobile devices, often in areas with poor internet connectivity (such as outdoor festivals or community gatherings). We need a frontend that:
1.  Loads instantly without downloading heavy JavaScript bundles.
2.  Works without complex build tools, enabling easy debugging and deployment.
3.  Runs efficiently on older mobile browsers.

---

## Decision Rationale

We chose a **Vanilla HTML5, CSS3, and JavaScript** stack over React, Vue, or Angular:

1.  **Zero Build / Compilation Time**: Frontend files are served as static files, eliminating compilation, bundlers (Vite/Webpack), or node dependency updates.
2.  **Fast Loading Performance**: The initial page load requires only a few kilobytes of HTML/CSS/JS, rendering instantly.
3.  **Low Complexity**: Standard web APIs (like Custom Elements) allow us to build custom UI components (like the sidebar) without the complexity of frontend frameworks.
4.  **No Package Version Conflicts**: Using vanilla JavaScript avoids the risk of package version conflicts, ensuring long-term maintainability.

---

## Consequences & Trade-offs

*   **State Management**: Vanilla JS lacks built-in reactive state bindings, requiring manual DOM updates.
    *   *Mitigation*: We use controllers (e.g. `EventFinancialsController.js`) to manage state and handle DOM updates explicitly.
*   **Duplicate Code**: Sharing UI elements across pages can lead to duplicate HTML code.
    *   *Mitigation*: We build reusable Web Components (like `<np-sidebar>`) to centralize shared layout elements.
