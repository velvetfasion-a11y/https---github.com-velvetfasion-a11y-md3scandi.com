/** Shared header icons — account & cart */
(function (global) {
  const ICON_ACCOUNT =
    '<svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg>';

  const ICON_CART =
    '<svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M6 6L5 3H2"/></svg>';

  const ICON_HEART =
    '<svg class="product-heart-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

  function iconLink(href, icon, label, extraAttrs) {
    const attrs = extraAttrs || '';
    const safeLabel = (label || '').replace(/"/g, '&quot;');
    return `<a href="${href}" class="nav-icon-btn" title="${safeLabel}" aria-label="${safeLabel}"${attrs}>${icon}</a>`;
  }

  function iconButton(icon, label, onclick, extraAttrs) {
    const safeLabel = (label || '').replace(/"/g, '&quot;');
    const attrs = extraAttrs || '';
    return `<button type="button" class="nav-icon-btn" title="${safeLabel}" aria-label="${safeLabel}" onclick="${onclick}"${attrs}>${icon}</button>`;
  }

  global.MD3NavIcons = {
    account: ICON_ACCOUNT,
    cart: ICON_CART,
    cartSmall: ICON_CART,
    heart: ICON_HEART,
    iconLink,
    iconButton,
  };
})(typeof window !== 'undefined' ? window : globalThis);
