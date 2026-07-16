/** MD3 Scandi — shared announcement bar + header (reference layout; keeps lang picker) */
(function (global) {
  const ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

  const CHROME_HTML =
    '<div class="promo-bar" data-i18n="promo-bar">Livraison offerte en Europe dès 150€ · Retours prolongés 30 jours</div>' +
    '<header class="site-header" id="siteHeader">' +
    '<div class="header-inner">' +
    '<div class="header-left">' +
    '<button type="button" class="header-menu-btn" id="headerMenuBtn" data-i18n-aria="nav-menu" aria-label="Menu" aria-expanded="false">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/></svg>' +
    '</button></div>' +
    '<div class="header-center">' +
    '<a href="index.html" class="logo" aria-label="MD3 Scandi">MD3<em>scandi</em></a>' +
    '<nav class="header-nav" data-i18n-aria="nav-categories" aria-label="Catégories">' +
    '<a href="boutique.html?cat=Mode" class="nav-cat-link link-underline" data-i18n="nav-fashion">Mode</a>' +
    '<a href="boutique.html?cat=Maison" class="nav-cat-link link-underline" data-i18n="nav-home">Maison</a>' +
    '<a href="boutique.html?cat=Lifestyle" class="nav-cat-link link-underline" data-i18n="nav-lifestyle">Lifestyle</a>' +
    '<a href="boutique.html?cat=%C3%89dition%20limit%C3%A9e" class="nav-cat-link link-underline" data-i18n="nav-limited">Édition limitée</a>' +
    '</nav></div>' +
    '<div class="header-util">' +
    '<div class="header-icons">' +
    '<a href="compte.html" class="header-icon-btn" id="navAccount" data-i18n-aria="nav-account" aria-label="Mon compte" title="Mon compte"></a>' +
    '<a href="cart.html" class="header-icon-btn" id="navCart" data-i18n-aria="nav-cart" aria-label="Panier" title="Panier"></a>' +
    '</div>' +
    '<div class="lang lang-compact" role="group" data-i18n-aria="nav-lang" aria-label="Langue">' +
    '<button type="button" class="lang-btn active" data-lang="fr">FR</button>' +
    '<button type="button" class="lang-btn" data-lang="en">EN</button>' +
    '<button type="button" class="lang-btn" data-lang="ar">AR</button>' +
    '</div></div></div></header>' +
    '<div class="mobile-drawer" id="mobileDrawer" aria-hidden="true">' +
    '<div class="mobile-drawer-backdrop" id="mobileDrawerBackdrop"></div>' +
    '<aside class="mobile-drawer-panel">' +
    '<div class="mobile-drawer-head"><span data-i18n="nav-menu">Menu</span>' +
    '<button type="button" class="mobile-drawer-close" id="mobileDrawerClose" data-i18n-aria="nav-close" aria-label="Fermer">' +
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
    '</button></div>' +
    '<nav class="mobile-drawer-nav">' +
    '<a href="boutique.html?cat=Mode" data-i18n="nav-fashion">Mode</a>' +
    '<a href="boutique.html?cat=Maison" data-i18n="nav-home">Maison</a>' +
    '<a href="boutique.html?cat=Lifestyle" data-i18n="nav-lifestyle">Lifestyle</a>' +
    '<a href="boutique.html?cat=%C3%89dition%20limit%C3%A9e" data-i18n="nav-limited">Édition limitée</a>' +
    '<div class="mobile-drawer-extra">' +
    '<a href="boutique.html" data-i18n="nav-shop-all">Toute la boutique</a>' +
    '<a href="compte.html" data-i18n="nav-account">Compte</a>' +
    '<a href="mailto:info@md3scandi.com" data-i18n="footer-contact">Contact</a>' +
    '</div></nav></aside></div>';

  function isHomePage() {
    const p = (global.location && global.location.pathname) || '';
    return p === '/' || p.endsWith('/') || /index\.html$/i.test(p);
  }

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
    if (global.MD3Viewport && global.MD3Viewport.init) global.MD3Viewport.init();
    initIcons();
    initMobileMenu();
    initHeaderScroll();
    if (global.MD3Lang) {
      if (typeof global.MD3Lang.bindLangButtons === 'function') {
        global.MD3Lang.bindLangButtons(root);
      }
      if (typeof global.MD3Lang.refreshUI === 'function') {
        global.MD3Lang.refreshUI();
      }
    }
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

  function initMobileMenu() {
    const drawer = document.getElementById('mobileDrawer');
    const openBtn = document.getElementById('headerMenuBtn');
    const closeBtn = document.getElementById('mobileDrawerClose');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    if (!drawer || !openBtn) return;

    function close() {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      openBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    function open() {
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      openBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  function initHeaderScroll() {
    const header = document.getElementById('siteHeader');
    const hero = document.getElementById('md3-hero');
    if (!header) return;

    const overlayHome = isHomePage() && !!hero;
    if (!overlayHome) {
      header.classList.add('site-header--solid');
      return;
    }

    header.classList.add('site-header--overlay');

    function update() {
      const y = global.scrollY || 0;
      const solid = y > 48;
      header.classList.toggle('site-header--solid', solid);
      header.classList.toggle('site-header--overlay', !solid);
    }

    global.addEventListener('scroll', update, { passive: true });
    update();
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
    ARROW_SVG,
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount);
  }
})(typeof window !== 'undefined' ? window : globalThis);
