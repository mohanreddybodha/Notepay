---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Design System & Resource Reference

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Global Variables & Themes**: [frontend/css/global.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/global.css)
*   **Web Components Layout**: [frontend/js/components.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/js/components.js) (Class: `NpSidebar`)
*   **Custom Theme CSS**: [frontend/css/components.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/components.css), [frontend/css/dashboard.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/dashboard.css)

---

## 🎨 CSS Custom Properties (Design Tokens)

Notepay defines a central palette of design tokens inside [global.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/global.css). Styling is modified dynamically by toggling the `.dark-mode` class on the `<html>` or `<body>` element.

### Brand & Surface Token Values

| CSS Variable Name | Light Mode Value | Dark Mode Value | Semantic Role |
| :--- | :--- | :--- | :--- |
| `--primary` | `#1A4E8C` | `#5A9BE8` | Main brand color |
| `--primary-dk` | `#0D2B55` | `#2A4A72` | Brand headers and active selections |
| `--primary-lt` | `#EDF3FF` | `#182B47` | Active background accents |
| `--teal` | `#0FA3A3` | `#12C5C5` | Secondary toggles and badges |
| `--surface` | `#FFFFFF` | `#000000` | Core page backgrounds |
| `--surf-var` | `#EAF0F6` | `#0A0A0A` | Secondary panels and overlays |
| `--card` | `#FFFFFF` | `#111111` | Card containers and modal elements |
| `--border` | `#D6E4F0` | `#222222` | Thin separator lines |
| `--text` | `#0D1B2A` | `#E8E8E8` | High contrast primary text |
| `--text2` | `#3D5A7A` | `#AAAAAA` | Secondary descriptive text |
| `--text3` | `#6B8AA8` | `#777777` | Low contrast placeholders |
| `--green` | `#1A7A5E` | `#22B580` | Confirmed transaction status (Paid) |
| `--red` | `#C0392B` | `#E05252` | Error states and delete operations |
| `--amber` | `#C4860A` | `#E0A020` | Deactivated alerts, warnings |

---

## 📄 Typography & Font Hierarchy

Notepay imports fonts from Google Fonts:
*   **Primary Typeface**: Sans-serif base typography using Inter and system-sans families.
*   **Header Typeface**: Rounded display accents using Outfit.
*   **Hierarchy Values**:
    *   `h1`: 32px (Outfit, font-weight 700)
    *   `h2`: 24px (Outfit, font-weight 600)
    *   `h3`: 20px (Outfit, font-weight 600)
    *   `Body`: 14px (Inter, font-weight 400)
    *   `Caption / Small`: 12px (Inter, font-weight 500)

---

## 📂 CSS Stylesheet Structure

The frontend styles are organized modularly:
1.  **[global.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/global.css)**: Core CSS variables, button styles, modal variables, input fields, scrollbars, and helper classes.
2.  **[components.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/components.css)**: Definitions for custom elements, navigation sidebars, header bars, user avatars, and toast notifications.
3.  **[dashboard.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/dashboard.css)**: Dashboard structures, statistics grids, event search filters, and profile layout cards.
4.  **[event.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/event.css)**: Transaction spreadsheets, financial summary metrics, chat logs, member manager grids, and receipt upload forms.
5.  **[admin.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/admin.css)**: Admin dashboard layouts, audit trails, and system log formats.

---

## 🧱 Web Component Specs

Developer integrations should utilize defined components:

### 1. Sidebar Component (`<np-sidebar>`)
Render by placing the element in the DOM:
```html
<np-sidebar active-link="dashboard" active-tab="0"></np-sidebar>
```
*   `active-link`: Sets selection on fixed actions (`dashboard`, `create`, `join`).
*   `active-tab`: Highlights active dashboard lists (`0` for All, `1` for My Events, `2` for Shared, `3` for Discovery).

### 2. Status Badge Element
Displays live WebSocket connectivity.
```html
<span id="live-badge" class="live-badge">Live Sync</span>
```
*   Adding class `.v` updates the style to a green indicator, indicating active synchronization.

---

## 💫 Micro-Animations & Transitions

Smooth interactions improve the app's responsiveness:
*   **Loading Spinner**: Controlled by `@keyframes npSpinUnique`. Spinners animate using a cubic-bezier easing curve:
    ```css
    animation: npSpinUnique 1.2s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite;
    ```
*   **Smooth Hover States**: Buttons and list items use standard transitions:
    ```css
    transition: all 0.2s ease;
    ```
*   **Fade Transitions**: Modals and dropdown elements utilize:
    ```css
    transition: opacity 0.15s ease, transform 0.15s ease;
    ```
