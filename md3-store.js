/** Shared product & user storage (localStorage / sessionStorage) */
(function (global) {
  const ADMIN_PASS = '1111';
  /** Admin can log in with any of these (no @ required) */
  const ADMIN_IDS = ['m3dadmin.com', 'md3admin.com', 'md3scandi.com'];
  const ADMIN_EMAIL = ADMIN_IDS[0];

  function isAdminLogin(identifier, password) {
    const id = (identifier || '').trim().toLowerCase();
    return password === ADMIN_PASS && ADMIN_IDS.includes(id);
  }

  function defaultProducts() {
    return [
      { id: 1, name: 'Robe Lin Ivoire', category: 'Mode', sub: 'Vêtements', price: 149, emoji: '👗', stock: 8 },
      { id: 2, name: 'Sac Tote Naturel', category: 'Mode', sub: 'Sacs', price: 89, emoji: '👜', stock: 5 },
      { id: 3, name: 'Sneakers Blanches', category: 'Mode', sub: 'Chaussures', price: 195, emoji: '👟', stock: 0 },
      { id: 4, name: 'Canapé Stockholm', category: 'Maison', sub: 'Canapés', price: 1290, emoji: '🛋️', stock: 3 },
      { id: 5, name: 'Lampe Bouleau', category: 'Maison', sub: 'Lampes', price: 245, emoji: '💡', stock: 12 },
      { id: 6, name: 'Vase Grès Gris', category: 'Maison', sub: 'Déco', price: 68, emoji: '🏺', stock: 0 },
      { id: 7, name: 'Carafe Nordique', category: 'Lifestyle', sub: 'Vaisselle', price: 55, emoji: '🫙', stock: 20 },
      { id: 8, name: 'Bougie Hygge', category: 'Lifestyle', sub: 'Déco', price: 32, emoji: '🕯️', stock: 2 },
      { id: 9, name: 'Set Lin Naturel', category: 'Édition limitée', sub: 'Textile', price: 320, emoji: '✨', stock: 1 },
    ];
  }

  function getProducts() {
    const raw = localStorage.getItem('md3_products');
    if (!raw) {
      const p = defaultProducts();
      localStorage.setItem('md3_products', JSON.stringify(p));
      return p;
    }
    try {
      const p = JSON.parse(raw);
      if (!Array.isArray(p)) throw new Error('INVALID');
      return p;
    } catch (_) {
      const p = defaultProducts();
      localStorage.setItem('md3_products', JSON.stringify(p));
      return p;
    }
  }

  function saveProducts(p) {
    try {
      localStorage.setItem('md3_products', JSON.stringify(p));
    } catch (e) {
      throw new Error('STORAGE_FULL');
    }
  }

  /** HTML for product visual: uploaded image or emoji fallback */
  function productVisualInner(p) {
    if (p && p.image) {
      return `<img src="${p.image}" alt="" class="product-photo" loading="lazy" />`;
    }
    return `<span class="product-emoji-fallback">${(p && p.emoji) || '✦'}</span>`;
  }

  function productThumbInner(p) {
    if (p && p.image) {
      return `<img src="${p.image}" alt="" class="product-thumb" loading="lazy" />`;
    }
    return `<span class="product-emoji-fallback">${(p && p.emoji) || '✦'}</span>`;
  }

  function getUsers() {
    return JSON.parse(localStorage.getItem('md3_users') || '{}');
  }

  function saveUsers(u) {
    localStorage.setItem('md3_users', JSON.stringify(u));
  }

  const PENDING_TTL_MS = 15 * 60 * 1000;

  function getPendingSignups() {
    return JSON.parse(localStorage.getItem('md3_pending_signups') || '{}');
  }

  function savePendingSignups(p) {
    localStorage.setItem('md3_pending_signups', JSON.stringify(p));
  }

  function setPendingSignup(email, data) {
    const all = getPendingSignups();
    all[email] = { ...data, expires: Date.now() + PENDING_TTL_MS };
    savePendingSignups(all);
  }

  function getPendingSignup(email) {
    const p = getPendingSignups()[email];
    if (!p) return null;
    if (p.expires < Date.now()) {
      clearPendingSignup(email);
      return null;
    }
    return p;
  }

  function clearPendingSignup(email) {
    const all = getPendingSignups();
    delete all[email];
    savePendingSignups(all);
  }

  const SESSION_KEY = 'md3_session';

  function getCurrentUser() {
    try {
      let raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        const legacy = sessionStorage.getItem(SESSION_KEY);
        if (legacy) {
          localStorage.setItem(SESSION_KEY, legacy);
          sessionStorage.removeItem(SESSION_KEY);
          raw = legacy;
        }
      }
      if (!raw) return null;
      const user = JSON.parse(raw);
      return user && typeof user === 'object' ? user : null;
    } catch (_) {
      return null;
    }
  }

  function setCurrentUser(u) {
    if (!u) {
      clearSession();
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  const PROFILE_PAGE = 'compte.html';
  const LOGIN_PAGE = 'login.html';

  /** Profile always opens compte; that page routes to login if needed. */
  function getProfileHref() {
    return PROFILE_PAGE;
  }

  function isLoggedIn() {
    return !!getCurrentUser();
  }

  /** Send logged-in users away from login (same tab, back button, new tab). */
  function guardLoginPage(redirectTo) {
    const dest = redirectTo || PROFILE_PAGE;
    if (!getCurrentUser()) return false;
    window.location.replace(dest);
    return true;
  }

  /** Apply profile link + accessible label on the account nav icon. */
  function syncAccountNav(accountEl, user) {
    if (!accountEl) return;
    const u = user !== undefined ? user : getCurrentUser();
    accountEl.href = PROFILE_PAGE;
    const labelKey = !u ? 'nav-login' : u.isAdmin ? 'nav-admin' : 'nav-account';
    const label = typeof global.MD3Lang !== 'undefined' && global.MD3Lang.t
      ? global.MD3Lang.t(labelKey)
      : labelKey;
    accountEl.setAttribute('data-i18n-aria', labelKey);
    accountEl.setAttribute('aria-label', label);
    accountEl.setAttribute('title', label);
  }

  function isLiked(email, productId) {
    const users = getUsers();
    const liked = users[email]?.liked || [];
    return liked.includes(productId);
  }

  function toggleLiked(productId) {
    const user = getCurrentUser();
    if (!user || user.isAdmin) return { ok: false, reason: 'login' };
    const users = getUsers();
    if (!users[user.email]) return { ok: false, reason: 'login' };
    const liked = users[user.email].liked || [];
    const idx = liked.indexOf(productId);
    if (idx === -1) liked.push(productId);
    else liked.splice(idx, 1);
    users[user.email].liked = liked;
    saveUsers(users);
    return { ok: true, liked: idx === -1 };
  }

  function getCartOwnerKey() {
    const user = getCurrentUser();
    if (user && !user.isAdmin) return user.email;
    return '_guest';
  }

  function getAllCarts() {
    try {
      return JSON.parse(localStorage.getItem('md3_carts') || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveAllCarts(carts) {
    localStorage.setItem('md3_carts', JSON.stringify(carts));
  }

  function getCart() {
    const carts = getAllCarts();
    return carts[getCartOwnerKey()] || {};
  }

  function setCart(cart) {
    const carts = getAllCarts();
    carts[getCartOwnerKey()] = cart;
    saveAllCarts(carts);
  }

  function getCartCount() {
    const cart = getCart();
    return Object.values(cart).reduce((sum, n) => sum + n, 0);
  }

  function isInCart(productId) {
    const cart = getCart();
    return (cart[String(productId)] || 0) > 0;
  }

  function addToCart(productId) {
    const products = getProducts();
    const p = products.find((x) => x.id === productId);
    if (!p) return { ok: false, reason: 'missing' };
    if (p.stock === 0) return { ok: false, reason: 'out' };
    const cart = getCart();
    const key = String(productId);
    const next = (cart[key] || 0) + 1;
    if (next > p.stock) return { ok: false, reason: 'max' };
    cart[key] = next;
    setCart(cart);
    return { ok: true, count: getCartCount() };
  }

  function setCartQty(productId, qty) {
    const products = getProducts();
    const p = products.find((x) => x.id === productId);
    if (!p) return { ok: false };
    const cart = getCart();
    const key = String(productId);
    if (qty <= 0) {
      delete cart[key];
    } else {
      cart[key] = Math.min(qty, p.stock);
    }
    setCart(cart);
    return { ok: true, count: getCartCount() };
  }

  function removeFromCart(productId) {
    return setCartQty(productId, 0);
  }

  function getCartLines() {
    const cart = getCart();
    const products = getProducts();
    return Object.entries(cart)
      .map(([id, qty]) => {
        const p = products.find((x) => x.id === Number(id));
        if (!p) return null;
        return { product: p, qty };
      })
      .filter(Boolean);
  }

  global.MD3Store = {
    ADMIN_EMAIL,
    ADMIN_IDS,
    ADMIN_PASS,
    isAdminLogin,
    defaultProducts,
    getProducts,
    saveProducts,
    getUsers,
    saveUsers,
    getCurrentUser,
    setCurrentUser,
    clearSession,
    PROFILE_PAGE,
    LOGIN_PAGE,
    getProfileHref,
    isLoggedIn,
    guardLoginPage,
    syncAccountNav,
    isLiked,
    toggleLiked,
    getCart,
    getCartCount,
    isInCart,
    addToCart,
    setCartQty,
    removeFromCart,
    getCartLines,
    productVisualInner,
    productThumbInner,
    getPendingSignups,
    setPendingSignup,
    getPendingSignup,
    clearPendingSignup,
  };
})(typeof window !== 'undefined' ? window : globalThis);
