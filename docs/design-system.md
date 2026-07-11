---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# UI Design System & Component Guidelines

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Global Layout CSS Tokens**: [frontend/css/global.css](../frontend/css/global.css)
*   **Web Components Layout**: [frontend/js/components.js](../frontend/js/components.js)
*   **Toast, Spinner, & Sheets styling**: [frontend/css/components.css](../frontend/css/components.css)

---

## 🎨 Color Palette & Themes

Notepay uses CSS custom properties defined in `global.css` to manage themes. Switching between light and dark modes is handled by toggling the `.dark-mode` class on the `<html>` or `<body>` element.

```css
/* Color Variable Definitions */
:root {
  --primary:        #1A4E8C; /* Royal Blue */
  --primary-dk:     #0D2B55; /* Navy */
  --primary-lt:     #EDF3FF; /* Soft Blue Accent */
  --teal:           #0FA3A3; /* Cyan Accent */
  --surface:        #FFFFFF; /* White Background */
  --surf-var:       #EAF0F6; /* Light Blue-Grey Panels */
  --surf-var2:      #D6E4F0; /* Deep Blue-Grey Panels */
  --card:           #FFFFFF; /* Card Backgrounds */
  --border:         #D6E4F0; /* Standard Border */
  --text:           #0D1B2A; /* High Contrast Text */
  --text2:          #3D5A7A; /* Medium Contrast Text */
  --text3:          #6B8AA8; /* Low Contrast Text */
  --green:          #1A7A5E; /* Paid / Positive Alert */
  --red:            #C0392B; /* Danger / Error */
  --amber:          #C4860A; /* Warning / Deactivated */
  --input-bg:       #F2F7FB; /* Input Fields Background */
}

body.dark-mode {
  --primary:        #5A9BE8; /* Light Blue */
  --primary-dk:     #2A4A72; /* Medium Blue Accent */
  --primary-lt:     #182B47; /* Deep Navy Background Accent */
  --teal:           #12C5C5; /* Vibrant Cyan */
  --surface:        #000000; /* Pure Black Background */
  --surf-var:       #0A0A0A; /* Very Dark Grey Panels */
  --surf-var2:      #111111; /* Dark Grey Panels */
  --card:           #111111; /* Card Backgrounds */
  --border:         #222222; /* Dark Border */
  --text:           #E8E8E8; /* Light Grey Text */
  --text2:          #AAAAAA; /* Medium Grey Text */
  --text3:          #777777; /* Low Contrast Placeholder */
  --green:          #22B580; /* Light Green */
  --red:            #E05252; /* Light Red */
  --input-bg:       #111111;
}
```

---

## 📐 Spacing & Layout Grid

To maintain layout consistency, we use a standard **8px spacing grid**:
*   `Padding / Margin Units`: `8px` (XS), `16px` (S), `24px` (M), `32px` (L), `48px` (XL).
*   `Desktop Sidebar Width`: `236px` fixed width on desktop viewports.
*   `Max-Content Width`: Dashboard and event contents are capped at a maximum width of `1200px` for optimal readability.

---

## 🧱 Component Layout Specifications

### 1. Cards
*   **Background**: `var(--card)`.
*   **Borders**: `1px solid var(--border)`.
*   **Border Radius**: `12px` (`border-radius: 12px`).
*   **Shadow**:
    *   Light Mode: `0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)`
    *   Dark Mode: `0 4px 6px -1px rgba(0,0,0,0.5), 0 2px 4px -1px rgba(0,0,0,0.3)`

### 2. Buttons
*   **Primary Button**:
    *   Style: `background: var(--btn-primary-bg); color: var(--btn-primary-text);`
    *   Border Radius: `8px` (`border-radius: 8px`).
    *   Transition: `all 0.15s ease`.
*   **Danger Button**:
    *   Style: `background: var(--btn-danger-bg); color: var(--btn-danger-text);`

### 3. Form Input Fields
*   **Style**: `background: var(--input-bg); border: 1.5px solid var(--input-border); color: var(--text); padding: 12px; border-radius: 8px;`
*   **Focus State**: `border-color: var(--input-focus); outline: none; box-shadow: 0 0 0 3px var(--primary-lt);`

### 4. Tables & Spreadsheets
*   **Row Height**: `48px` for desktop grids, `56px` for touch-friendly mobile cells.
*   **Alternating Rows**: Alternate row backgrounds use `var(--row-alt)` to improve readability.
*   **Highlight Row Colors**:
    *   Recently added rows (newly created entries): `var(--row-new)` (Soft Green).
    *   Modified / Edited rows: `var(--row-mod)` (Soft Blue).
    *   Pending payment transactions: `var(--row-lp)` (Soft Amber).

### 5. Dialogs (Modals)
*   **Structure**: Fixed full-screen overlay backdrop (`position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);`).
*   **Animation**: Modals use a subtle slide-up animation:
    ```css
    transform: translateY(20px);
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    ```

### 6. Bottom Sheets (Mobile Views)
On screens smaller than 768px, full-screen dialogs adapt to become bottom sheets:
*   **Positioning**: Fixed to the bottom of the screen (`position: fixed; bottom: 0; left: 0; right: 0; border-radius: 20px 20px 0 0;`).
*   **Interactive Handle**: Includes a drag handle bar at the top (`width: 36px; height: 4px; background: var(--border); border-radius: 2px; margin: 8px auto;`).

### 7. Floating Action Buttons (FAB)
*   Used on mobile views to provide quick access to key actions (e.g., adding a contribution).
*   **Style**: `position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: var(--primary); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);`

### 8. Badges
*   **Confirmed Paid status**: `background: var(--np-green-lt); color: var(--np-green); border-radius: 4px; padding: 4px 8px; font-weight: 600;`
*   **Pending status**: `background: var(--row-lp); color: var(--amber); border-radius: 4px; padding: 4px 8px;`

---

## 📱 Responsive Grid System

Notepay uses media queries to adjust layouts for different screen sizes:
*   **Mobile (< 768px)**:
    *   The sidebar `<np-sidebar>` collapses into a bottom navigation bar.
    *   Padding values are reduced to `12px` to maximize screen space.
    *   Spreadsheet columns are simplified to show only the donor name and payment amount, with other fields accessible via detail cards.
*   **Tablet & Desktop (>= 768px)**:
    *   The sidebar displays as a fixed navigation column on the left.
    *   Modals render as centered overlay windows.
    *   The transaction tables display all custom columns and action buttons.
