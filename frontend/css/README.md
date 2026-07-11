# Frontend Stylesheets Directory

This directory contains Vanilla CSS stylesheets defining Notepay's Design System, responsive grid layouts, styling variables, and page styles.

---

## 📂 Stylesheet Index

*   [global.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/global.css): Core configuration. Contains the Light/Dark mode design tokens (CSS variables), input element styles, button templates, and alignment classes.
*   [components.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/components.css): Layout styles for reusable components (such as sidebars, headers, user avatar circles, loading spinners, and toast notifications).
*   [dashboard.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/dashboard.css): Styles for user dashboards, stats cards, creation forms, search inputs, and event grids.
*   [event.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/event.css): Layouts for event details. Styled spreadsheets, financial summaries, the chat message timeline, and receipt upload forms.
*   [admin.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/admin.css): Administrative interface styles. Audit trail lists, user status cards, and resolve switches.
*   [forms.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/forms.css): Standard input field sizes.
*   [icons.css](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/css/icons.css): Styling parameters for SVG icons.

---

## 🌓 Theme & Mode Toggling

All stylesheets consume variables defined in `:root`. Dark mode styles are applied by adding the `.dark-mode` class to the `<html>` or `<body>` element, which overrides the CSS variables:

```css
/* Example Variable Usage */
body {
  background-color: var(--surface);
  color: var(--text);
}
```

Do not use hardcoded hex values in component stylesheets. Always use the CSS variables defined in `global.css` to ensure full light/dark mode support.
