/**
 * Firebase sync — products (Firestore + Storage), users, carts, taxonomy.
 * Requires compat SDK scripts + firebase-config.js on the page before md3-store.js.
 */
(function (global) {
  let db = null;
  let storage = null;
  let active = false;
  let productsUnsub = null;
  let usersUnsub = null;

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

  function productDoc(id) {
    return productsCol().doc(String(id));
  }

  function normalizeProduct(p) {
    if (!p || typeof p !== 'object') return null;
    const out = {
      id: Number(p.id),
      name: String(p.name || ''),
      category: String(p.category || ''),
      sub: String(p.sub || ''),
      price: Number(p.price) || 0,
      stock: Math.max(0, parseInt(p.stock, 10) || 0),
      emoji: p.emoji || '✦',
    };
    if (p.image && typeof p.image === 'string' && !p.image.startsWith('data:')) {
      out.image = p.image;
    }
    return out;
  }

  /**
   * Upload cropped image (data URL) via Storage putString data_url format.
   * Compat SDK equivalent of modular uploadString(ref, data, 'data_url').
   */
  async function uploadProductImage(productId, dataUrl) {
    if (!storage || !dataUrl) return dataUrl || null;
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const storageRef = storage.ref('products/' + String(productId) + '.jpg');
    await storageRef.putString(dataUrl, 'data_url', { contentType: 'image/jpeg' });
    return storageRef.getDownloadURL();
  }

  async function loadProducts() {
    if (!db) return null;
    const snap = await productsCol().get();
    if (snap.empty) return null;
    const list = snap.docs.map((d) => normalizeProduct(d.data())).filter(Boolean);
    list.sort((a, b) => a.id - b.id);
    return list;
  }

  async function saveProducts(products) {
    if (!db) return products;
    const saved = (products || []).map((p) => ({ ...p }));
    const ids = new Set(saved.map((p) => String(p.id)));

    for (const raw of saved) {
      const p = normalizeProduct(raw);
      if (!p) continue;

      let imageUrl = raw.image;
      if (imageUrl && imageUrl.startsWith('data:')) {
        imageUrl = await uploadProductImage(p.id, imageUrl);
        raw.image = imageUrl;
      }

      const data = { ...p };
      if (imageUrl && !String(imageUrl).startsWith('data:')) {
        data.image = imageUrl;
      }
      await productDoc(p.id).set(data, { merge: true });
    }

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
    return saved;
  }

  function watchProducts(onChange) {
    if (!db) return () => {};
    if (productsUnsub) productsUnsub();
    productsUnsub = productsCol().onSnapshot(
      (snap) => {
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
      map[doc.id] = doc.data().items || {};
    });
    return map;
  }

  async function saveCartsMap(carts) {
    if (!db) return;
    const keys = Object.keys(carts || {});
    const snap = await cartsCol().get();
    const batch = db.batch();
    let ops = 0;
    keys.forEach((key) => {
      batch.set(cartsCol().doc(key), { items: carts[key] || {} }, { merge: true });
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
    return cartsCol().onSnapshot(
      (snap) => {
        const map = {};
        snap.docs.forEach((doc) => {
          map[doc.id] = doc.data().items || {};
        });
        onChange(map);
      },
      (err) => console.error('carts snapshot', err)
    );
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

  global.MD3Firebase = {
    isConfigured,
    isEnabled,
    init,
    loadProducts,
    saveProducts,
    watchProducts,
    loadUsersMap,
    saveUsersMap,
    watchUsers,
    loadCartsMap,
    saveCartsMap,
    watchCarts,
    loadTaxonomy,
    saveTaxonomy,
  };
})(typeof window !== 'undefined' ? window : globalThis);
