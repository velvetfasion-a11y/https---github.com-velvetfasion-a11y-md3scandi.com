/** Shared store — local cache + optional Firebase cloud sync */
(function (global) {
  const ADMIN_PASS = '1111';
  const ADMIN_IDS = ['m3dadmin.com', 'md3admin.com', 'md3scandi.com'];
  const ADMIN_EMAIL = ADMIN_IDS[0];

  const PRODUCTS_KEY = 'md3_products';
  const PENDING_PRODUCTS_KEY = 'md3_products_pending_cloud';
  const USERS_KEY = 'md3_users';
  const CARTS_KEY = 'md3_carts';
  const SESSION_KEY = 'md3_session';
  /** Guest carts stay in localStorage only — never sync to Firestore (shared doc caused removals to revert). */
  const GUEST_CART_KEY = '_guest';

  let productsCache = null;
  let usersCache = null;
  let cartsCache = null;
  /** Ignore remote cart snapshots for this owner until (ms) after a local cart write. */
  let cartWriteGuard = { owner: null, until: 0 };
  let readyResolve;
  const ready = new Promise((r) => {
    readyResolve = r;
  });

  function isAdminLogin(identifier, password) {
    const id = (identifier || '').trim().toLowerCase();
    return password === ADMIN_PASS && ADMIN_IDS.includes(id);
  }

  const CATEGORY_ALIASES = {
    mode: 'Mode',
    fashion: 'Mode',
    maison: 'Maison',
    home: 'Maison',
    lifestyle: 'Lifestyle',
    'edition limitee': 'Édition limitée',
    'edition limite': 'Édition limitée',
    'limited edition': 'Édition limitée',
    limited: 'Édition limitée',
  };

  function categoryKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function canonicalCategory(category) {
    const raw = String(category || '').trim();
    return CATEGORY_ALIASES[categoryKey(raw)] || raw;
  }

  function normalizeProductImages(p) {
    const list = Array.isArray(p.images) ? p.images : [];
    const images = [...list, p.image]
      .filter((img) => typeof img === 'string' && img.trim())
      .filter((img, idx, arr) => arr.indexOf(img) === idx)
      .slice(0, 3);
    return images;
  }

  function normalizeProductFields(p) {
    if (!p || typeof p !== 'object') return p;
    const images = normalizeProductImages(p);
    const out = {
      ...p,
      category: canonicalCategory(p.category),
      featured: !!p.featured,
      desc: typeof p.desc === 'string' ? p.desc : '',
    };
    if (images.length) {
      out.images = images;
      out.image = images[0];
    } else {
      delete out.images;
      delete out.image;
    }
    return out;
  }

  function defaultProducts() {
    return [
      { id: 1, name: 'Robe Lin Ivoire', category: 'Mode', sub: 'Vêtements', price: 149, emoji: '👗', stock: 8, featured: true, desc: 'Robe en lin lavé, coupe fluide et intemporelle.' },
      { id: 2, name: 'Sac Tote Naturel', category: 'Mode', sub: 'Sacs', price: 89, emoji: '👜', stock: 5, featured: false, desc: '' },
      { id: 3, name: 'Sneakers Blanches', category: 'Mode', sub: 'Chaussures', price: 195, emoji: '👟', stock: 0, featured: false, desc: '' },
      { id: 4, name: 'Canapé Stockholm', category: 'Maison', sub: 'Canapés', price: 1290, emoji: '🛋️', stock: 3, featured: true, desc: 'Canapé scandinave en tissu naturel, lignes épurées.' },
      { id: 5, name: 'Lampe Bouleau', category: 'Maison', sub: 'Lampes', price: 245, emoji: '💡', stock: 12, featured: false, desc: '' },
      { id: 6, name: 'Vase Grès Gris', category: 'Maison', sub: 'Déco', price: 68, emoji: '🏺', stock: 0, featured: false, desc: '' },
      { id: 7, name: 'Carafe Nordique', category: 'Lifestyle', sub: 'Vaisselle', price: 55, emoji: '🫙', stock: 20, featured: true, desc: 'Carafe en verre soufflé, design minimal.' },
      { id: 8, name: 'Bougie Hygge', category: 'Lifestyle', sub: 'Déco', price: 32, emoji: '🕯️', stock: 2, featured: false, desc: '' },
      { id: 9, name: 'Set Lin Naturel', category: 'Édition limitée', sub: 'Textile', price: 320, emoji: '✨', stock: 1, featured: true, desc: 'Édition limitée — linge de maison en lin européen.' },
    ].map(normalizeProductFields);
  }

  function loadProductsLocal() {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    if (!raw) {
      const p = defaultProducts();
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(p));
      return p;
    }
    try {
      const p = JSON.parse(raw);
      if (!Array.isArray(p)) throw new Error('INVALID');
      return p.map(normalizeProductFields);
    } catch (_) {
      const p = defaultProducts();
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(p));
      return p;
    }
  }

  function loadUsersLocal() {
    try {
      return JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function loadCartsLocal() {
    try {
      return JSON.parse(localStorage.getItem(CARTS_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function ensureCaches() {
    if (!productsCache) productsCache = loadProductsLocal();
    if (!usersCache) usersCache = loadUsersLocal();
    if (!cartsCache) cartsCache = loadCartsLocal();
  }

  function notifyProductsUpdated() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-products-updated'));
    }
  }

  function notifyCartsUpdated() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-carts-updated'));
    }
  }

  function notifySessionChanged() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-session-changed'));
    }
  }

  function syncSessionFromUsersCache() {
    const cur = getCurrentUser();
    if (!cur || cur.isAdmin) return;
    const profile = usersCache && usersCache[cur.email];
    if (!profile) return;
    const name = profile.name || cur.name;
    if (name === cur.name) return;
    setCurrentUser({ email: cur.email, name, isAdmin: false });
    notifySessionChanged();
  }

  function cartsSnapshot(carts) {
    try {
      return JSON.stringify(carts || {});
    } catch (_) {
      return '';
    }
  }

  function applyRemoteCartsMap(remoteMap) {
    ensureCaches();
    const before = cartsSnapshot(cartsCache);
    const guestCart = { ...(cartsCache[GUEST_CART_KEY] || {}) };
    const remote = { ...(remoteMap || {}) };
    delete remote[GUEST_CART_KEY];

    const owner = getCartOwnerKey();
    const now = Date.now();
    const guardActive =
      cartWriteGuard.owner === owner && now < cartWriteGuard.until;
    if (guardActive) {
      const localItems = { ...(cartsCache[owner] || {}) };
      cartsCache = { ...remote, [owner]: localItems, [GUEST_CART_KEY]: guestCart };
    } else {
      cartsCache = { ...remote, [GUEST_CART_KEY]: guestCart };
    }
    pruneOwnerCart(GUEST_CART_KEY, false);
    if (owner !== GUEST_CART_KEY) pruneOwnerCart(owner, false);
    try {
      localStorage.setItem(CARTS_KEY, JSON.stringify(cartsCache));
    } catch (_) {}
    if (cartsSnapshot(cartsCache) !== before) notifyCartsUpdated();
  }

  function productsSnapshot(list) {
    try {
      return JSON.stringify(list || []);
    } catch (_) {
      return '';
    }
  }

  function setProductsCache(p) {
    const prevSnap = productsSnapshot(productsCache);
    productsCache = p;
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(p));
    } catch (_) {}
    if (pruneAllCartsLocal()) notifyCartsUpdated();
    if (productsSnapshot(productsCache) !== prevSnap) notifyProductsUpdated();
  }

  function getProducts() {
    ensureCaches();
    return productsCache.map((x) => ({ ...x }));
  }

  function markProductsPendingCloud(list) {
    try {
      localStorage.setItem(PENDING_PRODUCTS_KEY, JSON.stringify(list || productsCache || []));
    } catch (_) {}
  }

  function clearProductsPendingCloud() {
    try {
      localStorage.removeItem(PENDING_PRODUCTS_KEY);
    } catch (_) {}
  }

  function readProductsPendingCloud() {
    try {
      const raw = localStorage.getItem(PENDING_PRODUCTS_KEY);
      if (!raw) return null;
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.map(normalizeProductFields) : null;
    } catch (_) {
      return null;
    }
  }

  async function ensureCloudReady() {
    if (!global.MD3Firebase || !global.MD3Firebase.isConfigured()) return false;
    if (global.MD3Firebase.isEnabled()) return true;
    return global.MD3Firebase.init();
  }

  async function flushPendingProductsCloud() {
    const pending = readProductsPendingCloud();
    if (!pending) return false;
    const ok = await ensureCloudReady();
    if (!ok || !global.MD3Firebase.isEnabled()) return false;
    await global.MD3Firebase.saveProducts(pending);
    clearProductsPendingCloud();
    return true;
  }

  async function saveProducts(p, opts) {
    ensureCaches();
    const list = p.map((x) => ({ ...x }));
    setProductsCache(list);
    const ok = await ensureCloudReady();
    if (!ok || !global.MD3Firebase.isEnabled()) {
      markProductsPendingCloud(list);
      return;
    }
    try {
      const result = await global.MD3Firebase.saveProducts(list, opts);
      clearProductsPendingCloud();
      if (result && Array.isArray(result)) {
        const byId = new Map(result.map((x) => [x.id, x]));
        const merged = list.map((item) => {
          const u = byId.get(item.id);
          if (!u) return item;
          return { ...item, ...u };
        });
        setProductsCache(merged);
      }
    } catch (e) {
      markProductsPendingCloud(list);
      console.error('saveProducts cloud queued for retry', e);
    }
  }

  function productVisualInner(p) {
    const image = p && normalizeProductImages(p)[0];
    if (image) {
      return `<img src="${image}" alt="" class="product-photo" loading="lazy" />`;
    }
    return `<span class="product-emoji-fallback">${(p && p.emoji) || '✦'}</span>`;
  }

  function productThumbInner(p) {
    const image = p && normalizeProductImages(p)[0];
    if (image) {
      return `<img src="${image}" alt="" class="product-thumb" loading="lazy" />`;
    }
    return `<span class="product-emoji-fallback">${(p && p.emoji) || '✦'}</span>`;
  }

  /** Homepage “New Collection” row — fixed order */
  const HOME_FEATURED_IDS = [1, 4, 7, 9];

  function getHomeFeaturedProducts() {
    const byId = new Map(getProducts().map((p) => [p.id, p]));
    return HOME_FEATURED_IDS.map((id) => byId.get(id)).filter(Boolean);
  }

  function syncHomeFeaturedFlags() {
    const featuredSet = new Set(HOME_FEATURED_IDS);
    const products = getProducts();
    let changed = false;
    const next = products.map((p) => {
      const want = featuredSet.has(p.id);
      if (!!p.featured !== want) {
        changed = true;
        return { ...p, featured: want };
      }
      return p;
    });
    if (!changed) return false;
    productsCache = next;
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(next));
    } catch (_) {}
    notifyProductsUpdated();
    return true;
  }

  function getFeaturedProducts() {
    const home = getHomeFeaturedProducts();
    if (home.length) return home;
    return getProducts().filter((p) => p.featured);
  }

  function getProductById(id) {
    const n = parseInt(id, 10);
    return getProducts().find((p) => p.id === n) || null;
  }

  function productHref(id) {
    return 'product.html?id=' + encodeURIComponent(String(id));
  }

  function boutiqueHref(cat, sub) {
    const params = new URLSearchParams();
    if (cat) params.set('cat', cat);
    if (sub) params.set('sub', sub);
    const q = params.toString();
    return q ? 'boutique.html?' + q : 'boutique.html';
  }

  function getUsers() {
    ensureCaches();
    return { ...usersCache };
  }

  async function saveUsers(u) {
    ensureCaches();
    usersCache = { ...u };
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(usersCache));
    } catch (_) {}
    const ok = await ensureCloudReady();
    if (ok && global.MD3Firebase.isEnabled()) {
      await global.MD3Firebase.saveUsersMap(usersCache);
    }
  }

  const PENDING_TTL_MS = 15 * 60 * 1000;

  function getPendingSignups() {
    try {
      return JSON.parse(localStorage.getItem('md3_pending_signups') || '{}');
    } catch (_) {
      return {};
    }
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
    const prev = getCurrentUser();
    localStorage.setItem(SESSION_KEY, JSON.stringify(u));
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    if (!u.isAdmin) {
      ensureCaches();
      const hasGuest =
        cartsCache[GUEST_CART_KEY] && Object.keys(cartsCache[GUEST_CART_KEY]).length > 0;
      const newUser = !prev || prev.isAdmin || prev.email !== u.email;
      if (newUser || hasGuest) {
        mergeGuestCartIntoUser(u.email).catch((e) => console.error('mergeGuestCart', e));
      }
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  const PROFILE_PAGE = 'compte.html';
  const LOGIN_PAGE = 'login.html';

  function getProfileHref() {
    return PROFILE_PAGE;
  }

  function isLoggedIn() {
    return !!getCurrentUser();
  }

  function guardLoginPage(redirectTo) {
    const dest = redirectTo || PROFILE_PAGE;
    if (!getCurrentUser()) return false;
    window.location.replace(dest);
    return true;
  }

  function syncAccountNav(accountEl, user) {
    if (!accountEl) return;
    const u = user !== undefined ? user : getCurrentUser();
    accountEl.href = PROFILE_PAGE;
    const labelKey = !u ? 'nav-login' : u.isAdmin ? 'nav-admin' : 'nav-account';
    const label =
      typeof global.MD3Lang !== 'undefined' && global.MD3Lang.t
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

  function isWishlisted(email, productId) {
    const users = getUsers();
    const wishlist = users[email]?.wishlist || [];
    return wishlist.includes(productId);
  }

  async function toggleLiked(productId) {
    const user = getCurrentUser();
    if (!user || user.isAdmin) return { ok: false, reason: 'login' };
    const users = getUsers();
    if (!users[user.email]) return { ok: false, reason: 'login' };
    const liked = users[user.email].liked || [];
    const idx = liked.indexOf(productId);
    if (idx === -1) liked.push(productId);
    else liked.splice(idx, 1);
    users[user.email].liked = liked;
    await saveUsers(users);
    return { ok: true, liked: idx === -1 };
  }

  async function toggleWishlist(productId) {
    const user = getCurrentUser();
    if (!user || user.isAdmin) return { ok: false, reason: 'login' };
    const users = getUsers();
    if (!users[user.email]) return { ok: false, reason: 'login' };
    const wishlist = users[user.email].wishlist || [];
    const idx = wishlist.indexOf(productId);
    if (idx === -1) wishlist.push(productId);
    else wishlist.splice(idx, 1);
    users[user.email].wishlist = wishlist;
    await saveUsers(users);
    return { ok: true, wishlisted: idx === -1 };
  }

  function getCartOwnerKey() {
    const user = getCurrentUser();
    if (user && !user.isAdmin) return user.email;
    return GUEST_CART_KEY;
  }

  function findProduct(productId) {
    const id = Number(productId);
    return getProducts().find((x) => x.id === id || String(x.id) === String(productId));
  }

  /** Drop unknown products and clamp qty to stock. Returns true if cart changed. */
  function pruneOwnerCart(owner, persist) {
    ensureCaches();
    const cart = cartsCache[owner];
    if (!cart || typeof cart !== 'object') return false;
    let changed = false;
    Object.keys(cart).forEach((id) => {
      const p = findProduct(id);
      const qty = Number(cart[id]);
      if (!p || !Number.isFinite(qty) || qty <= 0) {
        delete cart[id];
        changed = true;
        return;
      }
      const capped = Math.min(Math.floor(qty), p.stock);
      if (capped <= 0) {
        delete cart[id];
        changed = true;
      } else if (capped !== qty) {
        cart[id] = capped;
        changed = true;
      }
    });
    if (changed && persist) {
      saveOwnerCart(owner, cart).catch((e) => console.error('pruneOwnerCart', e));
    }
    return changed;
  }

  async function mergeGuestCartIntoUser(email) {
    if (!email) return;
    ensureCaches();
    const guest = cartsCache[GUEST_CART_KEY];
    if (!guest || !Object.keys(guest).length) return;

    const userCart = { ...(cartsCache[email] || {}) };
    Object.entries(guest).forEach(([id, qty]) => {
      const p = findProduct(id);
      if (!p || p.stock === 0) return;
      const key = String(id);
      const next = (userCart[key] || 0) + Math.max(0, Number(qty) || 0);
      if (next > 0) userCart[key] = Math.min(next, p.stock);
    });

    delete cartsCache[GUEST_CART_KEY];
    await saveOwnerCart(email, userCart);
    notifyCartsUpdated();
  }

  function getAllCarts() {
    ensureCaches();
    return { ...cartsCache };
  }

  function cartsForCloud(carts) {
    const out = { ...(carts || {}) };
    delete out[GUEST_CART_KEY];
    return out;
  }

  async function saveOwnerCart(owner, items) {
    ensureCaches();
    cartWriteGuard = { owner, until: Date.now() + 8000 };
    cartsCache[owner] = { ...(items || {}) };
    pruneOwnerCart(owner, false);
    try {
      localStorage.setItem(CARTS_KEY, JSON.stringify(cartsCache));
    } catch (_) {}
    notifyCartsUpdated();
    if (
      global.MD3Firebase &&
      global.MD3Firebase.isEnabled() &&
      owner !== GUEST_CART_KEY
    ) {
      await global.MD3Firebase.saveCart(owner, cartsCache[owner]);
    }
  }

  async function saveAllCarts(carts, opts) {
    ensureCaches();
    cartsCache = { ...carts };
    try {
      localStorage.setItem(CARTS_KEY, JSON.stringify(cartsCache));
    } catch (_) {}
    if (global.MD3Firebase && global.MD3Firebase.isEnabled()) {
      const cloudCarts = cartsForCloud(cartsCache);
      if (opts && opts.fullMap) {
        if (Object.keys(cloudCarts).length) {
          await global.MD3Firebase.saveCartsMap(cloudCarts);
        }
      } else {
        const owner = getCartOwnerKey();
        if (owner !== GUEST_CART_KEY) {
          await saveOwnerCart(owner, cartsCache[owner] || {});
        }
      }
    }
  }

  function getCart() {
    ensureCaches();
    const owner = getCartOwnerKey();
    if (!cartsCache[owner] || typeof cartsCache[owner] !== 'object') {
      cartsCache[owner] = {};
    }
    pruneOwnerCart(owner, false);
    return cartsCache[owner];
  }

  function persistCartsCache() {
    try {
      localStorage.setItem(CARTS_KEY, JSON.stringify(cartsCache));
    } catch (_) {}
  }

  function pruneAllCartsLocal() {
    ensureCaches();
    let changed = false;
    Object.keys(cartsCache).forEach((owner) => {
      if (pruneOwnerCart(owner, false)) changed = true;
    });
    if (changed) persistCartsCache();
    return changed;
  }

  async function setCart(cart) {
    const owner = getCartOwnerKey();
    await saveOwnerCart(owner, cart);
  }

  function getCartCount() {
    const cart = getCart();
    return Object.values(cart).reduce((sum, n) => sum + n, 0);
  }

  function isInCart(productId) {
    const cart = getCart();
    return (cart[String(productId)] || 0) > 0;
  }

  async function addToCart(productId) {
    const p = findProduct(productId);
    if (!p) return { ok: false, reason: 'missing' };
    if (p.stock === 0) return { ok: false, reason: 'out' };
    const cart = getCart();
    const key = String(productId);
    const next = (cart[key] || 0) + 1;
    if (next > p.stock) return { ok: false, reason: 'max' };
    cart[key] = next;
    await setCart(cart);
    return { ok: true, count: getCartCount() };
  }

  async function setCartQty(productId, qty) {
    const cart = getCart();
    const key = String(productId);
    if (qty <= 0) {
      delete cart[key];
      await setCart(cart);
      return { ok: true, count: getCartCount() };
    }
    const p = findProduct(productId);
    if (!p) return { ok: false, reason: 'missing' };
    if (p.stock === 0) return { ok: false, reason: 'out' };
    cart[key] = Math.min(qty, p.stock);
    await setCart(cart);
    return { ok: true, count: getCartCount() };
  }

  async function removeFromCart(productId) {
    return setCartQty(productId, 0);
  }

  function getCartLines() {
    const cart = getCart();
    return Object.entries(cart)
      .map(([id, qty]) => {
        const p = findProduct(id);
        if (!p) return null;
        return { product: p, qty: Number(qty) || 0 };
      })
      .filter((line) => line && line.qty > 0);
  }

  function isCloudEnabled() {
    return !!(global.MD3Firebase && global.MD3Firebase.isEnabled());
  }

  async function syncCloud() {
    if (!global.MD3Firebase || !global.MD3Firebase.isConfigured()) return;
    const ok = await global.MD3Firebase.init();
    if (!ok) return;

    const FB = global.MD3Firebase;

    try {
      await flushPendingProductsCloud();
      const remoteProducts = await FB.loadProducts();
      if (remoteProducts && remoteProducts.length) {
        // Merge: keep any local-only products not yet in Firebase
        const remoteIds = new Set(remoteProducts.map((p) => String(p.id)));
        const localOnly = productsCache.filter((p) => !remoteIds.has(String(p.id)));
        if (localOnly.length) {
          const merged = [...remoteProducts, ...localOnly];
          merged.sort((a, b) => a.id - b.id);
          setProductsCache(merged);
          FB.saveProducts(merged, { onlyIds: localOnly.map((p) => p.id) }).catch((e) =>
            console.error('syncCloud push local-only products', e)
          );
        } else {
          setProductsCache(remoteProducts);
        }
      } else if (productsCache.length) {
        await FB.saveProducts(productsCache);
      }

      FB.watchProducts((list) => {
        if (!list || !list.length) return;
        // Same merge: never drop local-only products via a watcher update
        const remoteIds = new Set(list.map((p) => String(p.id)));
        const localOnly = productsCache
          ? productsCache.filter((p) => !remoteIds.has(String(p.id)))
          : [];
        if (localOnly.length) {
          const merged = [...list, ...localOnly];
          merged.sort((a, b) => a.id - b.id);
          setProductsCache(merged);
        } else {
          setProductsCache(list);
        }
      });

      const remoteUsers = await FB.loadUsersMap();
      if (remoteUsers && Object.keys(remoteUsers).length) {
        usersCache = remoteUsers;
        localStorage.setItem(USERS_KEY, JSON.stringify(usersCache));
      } else if (Object.keys(usersCache).length) {
        await FB.saveUsersMap(usersCache);
      }

      FB.watchUsers((map) => {
        usersCache = map;
        try {
          localStorage.setItem(USERS_KEY, JSON.stringify(usersCache));
        } catch (_) {}
        syncSessionFromUsersCache();
      });

      const remoteCarts = await FB.loadCartsMap();
      if (remoteCarts && Object.keys(remoteCarts).length) {
        applyRemoteCartsMap(remoteCarts);
      } else if (Object.keys(cartsCache).length) {
        await saveAllCarts(cartsCache, { fullMap: true });
      }

      FB.watchCarts((map) => {
        applyRemoteCartsMap(map);
      });

      if (FB.deleteLegacyGuestCart) {
        FB.deleteLegacyGuestCart().catch(() => {});
      }

      const remoteTax = await FB.loadTaxonomy();
      if (remoteTax) {
        localStorage.setItem('md3_taxonomy', JSON.stringify(remoteTax));
      } else {
        const localTax = localStorage.getItem('md3_taxonomy');
        if (localTax) await FB.saveTaxonomy(JSON.parse(localTax));
      }

      if (FB.watchTaxonomy) {
        FB.watchTaxonomy((data) => {
          if (!data) return;
          try {
            localStorage.setItem('md3_taxonomy', JSON.stringify(data));
          } catch (_) {}
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('md3-taxonomy-updated'));
          }
        });
      }
    } catch (e) {
      console.error('MD3Store cloud sync', e);
    }
  }

  async function init() {
    ensureCaches();
    syncHomeFeaturedFlags();
    pruneAllCartsLocal();
    readyResolve();
    syncCloud()
      .then(() => {
        syncHomeFeaturedFlags();
        if (global.MD3Auth && global.MD3Auth.initSessionSync) {
          return global.MD3Auth.initSessionSync();
        }
      })
      .catch((e) => console.error('MD3Store cloud sync', e));
  }

  global.MD3Store = {
    ADMIN_EMAIL,
    ADMIN_IDS,
    ADMIN_PASS,
    ready,
    init,
    isCloudEnabled,
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
    isWishlisted,
    toggleLiked,
    toggleWishlist,
    getCart,
    getCartCount,
    isInCart,
    addToCart,
    setCartQty,
    removeFromCart,
    getCartLines,
    mergeGuestCartIntoUser,
    productVisualInner,
    productThumbInner,
    canonicalCategory,
    normalizeProductImages,
    normalizeProductFields,
    getFeaturedProducts,
    getHomeFeaturedProducts,
    HOME_FEATURED_IDS,
    syncHomeFeaturedFlags,
    getProductById,
    productHref,
    boutiqueHref,
    getPendingSignups,
    setPendingSignup,
    getPendingSignup,
    clearPendingSignup,
  };
})(typeof window !== 'undefined' ? window : globalThis);
