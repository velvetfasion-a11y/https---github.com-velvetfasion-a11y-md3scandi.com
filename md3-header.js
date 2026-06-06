/** MD3 Scandi — shared announcement bar + header (all pages) */
(function (global) {
  const CHROME_HTML =
    '<div class="bar">' +
    '<div class="bar-track">' +
    '<span class="bar-item" data-i18n="marquee-item">STYLE ◆ NEW COLLECTION ◆ FASHION · HOME · LIFESTYLE ◆ LIMITED EDITION ◆ FREE DELIVERY WORLDWIDE ◆</span>' +
    '<span class="bar-item" data-i18n="marquee-item" aria-hidden="true">STYLE ◆ NEW COLLECTION ◆ FASHION · HOME · LIFESTYLE ◆ LIMITED EDITION ◆ FREE DELIVERY WORLDWIDE ◆</span>' +
    '</div></div>' +
    '<header class="site-header">' +
    '<div class="header-inner">' +
    '<a href="index.html" class="logo"><strong>MD3</strong><em>Scandi</em></a>' +
    '<nav class="header-nav" aria-label="Categories">' +
    '<a href="boutique.html?cat=Mode" class="nav-cat-link" data-i18n="nav-fashion">Mode</a>' +
    '<span class="nav-dot" aria-hidden="true"></span>' +
    '<a href="boutique.html?cat=Maison" class="nav-cat-link" data-i18n="nav-home">Maison</a>' +
    '<span class="nav-dot" aria-hidden="true"></span>' +
    '<a href="boutique.html?cat=Lifestyle" class="nav-cat-link" data-i18n="nav-lifestyle">Lifestyle</a>' +
    '<span class="nav-dot" aria-hidden="true"></span>' +
    '<a href="boutique.html?cat=%C3%89dition%20limit%C3%A9e" class="nav-cat-link" data-i18n="nav-limited">Édition limitée</a>' +
    '</nav>' +
    '<div class="header-util">' +
    '<div class="header-icons">' +
    '<a href="compte.html" class="header-icon-btn" id="navAccount" data-i18n-aria="nav-account" aria-label="Mon compte" title="Mon compte"></a>' +
    '<a href="cart.html" class="header-icon-btn" id="navCart" data-i18n-aria="nav-cart" aria-label="Panier" title="Panier"></a>' +
    '</div>' +
    '<div class="lang lang-compact" role="group" aria-label="Language">' +
    '<button type="button" class="lang-btn active" data-lang="fr">FR</button>' +
    '<button type="button" class="lang-btn" data-lang="en">EN</button>' +
    '<button type="button" class="lang-btn" data-lang="ar">AR</button>' +
    '</div></div></div></header>';

  function mount() {
    let root = document.getElementById('md3-site-header');
    if (!root) {
      root = document.createElement('div');
      root.id = 'md3-site-header';
      document.body.insertBefore(root, document.body.firstChild);
    }
    if (root.dataset.md3HeaderMounted === '1') return root;
    root.innerHTML = CHROME_HTML;
    root.dataset.md3HeaderMounted = '1';
    initIcons();
    return root;
  }

  function initIcons() {
    const I = global.MD3NavIcons;
    if (!I) return;
    const account = document.getElementById('navAccount');
    const cart = document.getElementById('navCart');
    if (account && !account.querySelector('.nav-icon-svg')) {
      account.innerHTML = I.account;
    }
    if (cart && !cart.querySelector('.nav-icon-svg')) {
      cart.innerHTML = I.cart + '<span class="nav-cart-badge" id="navCartBadge" hidden></span>';
    }
  }

  function updateCartBadge() {
    const badge = document.getElementById('navCartBadge');
    if (!badge || typeof global.MD3Store === 'undefined') return;
    const n = global.MD3Store.getCartCount();
    badge.textContent = n;
    badge.hidden = n <= 0;
  }

  function updateAuth() {
    initIcons();
    const accountEl = document.getElementById('navAccount');
    const cartEl = document.getElementById('navCart');
    if (!accountEl || !cartEl) return;
    const S = global.MD3Store;
    if (S && S.syncAccountNav) {
      S.syncAccountNav(accountEl, S.getCurrentUser ? S.getCurrentUser() : null);
    }
    cartEl.href = 'cart.html';
    if (global.MD3Lang && global.MD3Lang.t) {
      const cartLabel = global.MD3Lang.t('nav-cart');
      cartEl.setAttribute('aria-label', cartLabel);
      cartEl.setAttribute('title', cartLabel);
    }
    updateCartBadge();
  }

  global.MD3Header = {
    mount,
    initIcons,
    updateAuth,
    updateCartBadge,
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})(typeof window !== 'undefined' ? window : globalThis);
