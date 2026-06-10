/**
 * Firebase sync — products (Firestore + Storage), users, carts, taxonomy.
 * Requires compat SDK scripts + firebase-config.js on the page before md3-store.js.
 */
(function (global) {
  let db = null;
  let storage = null;
  let auth = null;
  let active = false;
  let productsUnsub = null;
  let usersUnsub = null;
  let cartsUnsub = null;

  function config() {
    return global.MD3_FIREBASE_CONFIG;
  }

  function isConfigured() {
    const c = config();
    return !!(c && c.apiKey && c.projectId && !String(c.apiKey).includes('YOUR_'));
  }

  function isEnabled() {
    return active && db;
  }

  function init() {
    if (!isConfigured() || typeof global.firebase === 'undefined') {
      return Promise.resolve(false);
    }
    try {
      const c = config();
      const app =
        global.firebase.apps && global.firebase.apps.length
          ? global.firebase.app()
          : global.firebase.initializeApp(c);
      db = global.firebase.firestore(app);
      storage = global.firebase.storage(app);
      auth = global.firebase.auth(app);
      active = true;
      return Promise.resolve(true);
    } catch (e) {
      console.error('MD3Firebase init', e);
      return Promise.resolve(false);
    }
  }

  function productsCol() {
    return db.collection('products');
  }

  function usersCol() {
    return db.collection('users');
  }

  function cartsCol() {
    return db.collection('carts');
  }

  const LEGACY_GUEST_CART_KEY = '_guest';

  function stripGuestFromCartsMap(map) {
    if (!map) return map;
    const out = { ...map };
    delete out[LEGACY_GUEST_CART_KEY];
    return out;
  }

  function productDoc(id) {
    return productsCol().doc(String(id));
  }

  function normalizeProduct(p) {
    if (!p || typeof p !== 'object') return null;
    const images = (Array.isArray(p.images) ? p.images : [p.image])
      .filter((img) => typeof img === 'string' && img.trim() && !img.startsWith('data:'))
      .filter((img, idx, arr) => arr.indexOf(img) === idx)
      .slice(0, 3);
    const out = {
      id: Number(p.id),
      name: String(p.name || ''),
      category: String(p.category || ''),
      sub: String(p.sub || ''),
      price: Number(p.price) || 0,
      stock: Math.max(0, parseInt(p.stock, 10) || 0),
      emoji: p.emoji || '✦',
      featured: !!p.featured,
      desc: typeof p.desc === 'string' ? p.desc : '',
    };
    if (images.length) {
      out.images = images;
      out.image = images[0];
    }
    return out;
  }

  /**
   * Upload cropped image (data URL) via Storage putString data_url format.
   * Compat SDK equivalent of modular uploadString(ref, data, 'data_url').
   */
  async function uploadProductImage(productId, dataUrl, index) {
    if (!storage || !dataUrl) return dataUrl || null;
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const suffix = index ? '-' + String(index + 1) : '';
    const storageRef = storage.ref('products/' + String(productId) + suffix + '.jpg');
    try {
      await storageRef.putString(dataUrl, 'data_url', { contentType: 'image/jpeg' });
      return storageRef.getDownloadURL();
    } catch (e) {
      if (e && e.code === 'storage/unauthorized') {
        const hint =
          'Storage rules block products/ uploads. Firebase Console → Storage → Rules: allow read,write on products/{fileName} (see storage.rules in the repo), then Publish.';
        console.error(hint, e);
        throw new Error(hint);
      }
      throw e;
    }
  }

  async function deleteProductImageFile(productId) {
    if (!storage) return;
    const refs = [
      'products/' + String(productId) + '.jpg',
      'products/' + String(productId) + '-2.jpg',
      'products/' + String(productId) + '-3.jpg',
    ];
    for (const path of refs) {
      try {
        await storage.ref(path).delete();
      } catch (e) {
        if (!e || e.code !== 'storage/object-not-found') {
          console.warn('deleteProductImageFile', e);
        }
      }
    }
  }

  let productWatchMutedUntil = 0;

  function muteProductWatch(ms) {
    productWatchMutedUntil = Date.now() + (ms || 2500);
  }

  /**
   * Full document write (no merge) so removing image clears the field in Firestore.
   */
  async function writeProductDoc(raw, opts) {
    const p = normalizeProduct(raw);
    if (!p) return null;

    const rawImages = (Array.isArray(raw.images) ? raw.images : [raw.image])
      .filter((img) => typeof img === 'string' && img.trim())
      .slice(0, 3);
    const imageUrls = [];
    for (let i = 0; i < rawImages.length; i++) {
      imageUrls.push(await uploadProductImage(p.id, rawImages[i], i));
    }
    raw.images = imageUrls;
    raw.image = imageUrls[0];

    const data = { ...p };
    if (imageUrls.length) {
      data.images = imageUrls;
      data.image = imageUrls[0];
    } else {
      delete data.images;
      delete data.image;
    }

    await productDoc(p.id).set(data);

    if (opts && opts.clearImage) {
      await deleteProductImageFile(p.id);
    }

    return raw;
  }

  async function loadProducts() {
    if (!db) return null;
    const snap = await productsCol().get();
    if (snap.empty) return null;
    const list = snap.docs.map((d) => normalizeProduct(d.data())).filter(Boolean);
    list.sort((a, b) => a.id - b.id);
    return list;
  }

  async function saveProducts(products, options) {
    if (!db) return products;
    muteProductWatch();
    const saved = (products || []).map((p) => ({ ...p }));
    const ids = new Set(saved.map((p) => String(p.id)));
    const opts = options || {};
    const onlyIds = opts.onlyIds ? new Set(opts.onlyIds.map((id) => String(id))) : null;
    const removeImageSet = new Set((opts.removeImageIds || []).map((id) => String(id)));
    const deletedIds = opts.deletedIds || [];

    let toWrite = saved;
    if (onlyIds) {
      toWrite = saved.filter((p) => onlyIds.has(String(p.id)));
    } else if (deletedIds.length) {
      toWrite = [];
    }

    for (const raw of toWrite) {
      await writeProductDoc(raw, { clearImage: removeImageSet.has(String(raw.id)) });
    }

    for (const id of deletedIds) {
      await productDoc(id).delete();
      await deleteProductImageFile(id);
    }

    if (!onlyIds && !deletedIds.length) {
      const snap = await productsCol().get();
      const batch = db.batch();
      let pending = 0;
      snap.docs.forEach((doc) => {
        if (!ids.has(doc.id)) {
          batch.delete(doc.ref);
          pending++;
        }
      });
      if (pending) await batch.commit();
    }

    return saved;
  }

  function watchProducts(onChange) {
    if (!db) return () => {};
    if (productsUnsub) productsUnsub();
    productsUnsub = productsCol().onSnapshot(
      (snap) => {
        if (Date.now() < productWatchMutedUntil) return;
        const list = snap.docs.map((d) => normalizeProduct(d.data())).filter(Boolean);
        list.sort((a, b) => a.id - b.id);
        onChange(list);
      },
      (err) => console.error('products snapshot', err)
    );
    return productsUnsub;
  }

  async function loadUsersMap() {
    if (!db) return null;
    const snap = await usersCol().get();
    if (snap.empty) return null;
    const map = {};
    snap.docs.forEach((doc) => {
      map[doc.id] = doc.data();
    });
    return map;
  }

  async function saveUsersMap(users) {
    if (!db) return;
    const emails = Object.keys(users || {});
    const snap = await usersCol().get();
    const batch = db.batch();
    let ops = 0;
    emails.forEach((email) => {
      batch.set(usersCol().doc(email), users[email], { merge: true });
      ops++;
    });
    snap.docs.forEach((doc) => {
      if (!emails.includes(doc.id)) {
        batch.delete(doc.ref);
        ops++;
      }
    });
    if (ops) await batch.commit();
  }

  function watchUsers(onChange) {
    if (!db) return () => {};
    if (usersUnsub) usersUnsub();
    usersUnsub = usersCol().onSnapshot(
      (snap) => {
        const map = {};
        snap.docs.forEach((doc) => {
          map[doc.id] = doc.data();
        });
        onChange(map);
      },
      (err) => console.error('users snapshot', err)
    );
    return usersUnsub;
  }

  async function loadCartsMap() {
    if (!db) return null;
    const snap = await cartsCol().get();
    if (snap.empty) return null;
    const map = {};
    snap.docs.forEach((doc) => {
      if (doc.id === LEGACY_GUEST_CART_KEY) return;
      map[doc.id] = doc.data().items || {};
    });
    return map;
  }

  /** Remove shared legacy guest doc (guest carts are local-only now). */
  async function deleteLegacyGuestCart() {
    if (!db) return;
    try {
      await cartsCol().doc(LEGACY_GUEST_CART_KEY).delete();
    } catch (_) {}
  }

  /** Replace one cart document entirely (no merge — avoids stale line items). */
  async function saveCart(ownerKey, items) {
    if (!db || !ownerKey || ownerKey === LEGACY_GUEST_CART_KEY) return;
    await cartsCol().doc(ownerKey).set({ items: items || {} });
  }

  async function saveCartsMap(carts) {
    if (!db) return;
    const keys = Object.keys(carts || {});
    const snap = await cartsCol().get();
    const batch = db.batch();
    let ops = 0;
    keys.forEach((key) => {
      if (key === LEGACY_GUEST_CART_KEY) return;
      batch.set(cartsCol().doc(key), { items: carts[key] || {} });
      ops++;
    });
    snap.docs.forEach((doc) => {
      if (!keys.includes(doc.id)) {
        batch.delete(doc.ref);
        ops++;
      }
    });
    if (ops) await batch.commit();
  }

  function watchCarts(onChange) {
    if (!db) return () => {};
    if (cartsUnsub) cartsUnsub();
    cartsUnsub = cartsCol().onSnapshot(
      (snap) => {
        const map = {};
        snap.docs.forEach((doc) => {
          if (doc.id === LEGACY_GUEST_CART_KEY) return;
          map[doc.id] = doc.data().items || {};
        });
        onChange(stripGuestFromCartsMap(map));
      },
      (err) => console.error('carts snapshot', err)
    );
    return cartsUnsub;
  }

  async function loadTaxonomy() {
    if (!db) return null;
    const doc = await db.collection('meta').doc('taxonomy').get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async function saveTaxonomy(data) {
    if (!db) return;
    await db.collection('meta').doc('taxonomy').set(data, { merge: true });
  }

  function watchTaxonomy(onChange) {
    if (!db) return () => {};
    return db
      .collection('meta')
      .doc('taxonomy')
      .onSnapshot(
        (doc) => {
          if (doc.exists) onChange(doc.data());
        },
        (err) => console.error('taxonomy snapshot', err)
      );
  }

  function getAuth() {
    return auth;
  }

  global.MD3Firebase = {
    isConfigured,
    isEnabled,
    init,
    getAuth,
    loadProducts,
    saveProducts,
    watchProducts,
    loadUsersMap,
    saveUsersMap,
    watchUsers,
    loadCartsMap,
    saveCart,
    saveCartsMap,
    watchCarts,
    deleteLegacyGuestCart,
    loadTaxonomy,
    saveTaxonomy,
    watchTaxonomy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
