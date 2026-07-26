/** Site-wide overrides — images, section backgrounds (localStorage + optional Firestore) */
(function (global) {
  const KEY = 'md3_site_assets';

  /** Make local asset paths work from nested routes (/compte/, /boutique/, …). */
  function publicUrl(url) {
    if (url == null) return '';
    const s = String(url).trim();
    if (!s) return '';
    if (/^(https?:|data:|blob:)/i.test(s)) return s;
    if (s.startsWith('//')) return s;
    if (s.startsWith('/')) return s;
    return '/' + s.replace(/^\.\//, '');
  }

  /** Non-product homepage images. `admin: true` = shown in Admin → Images. */
  const IMAGE_SLOTS = {
    hero: {
      label: 'Homepage hero',
      labelKey: 'site-img-hero',
      aliases: ['header', 'hero', 'start', 'top banner', 'huvudbild'],
      defaultSrc: '/images/NyZx3.jpg?v=2',
      aspectRatio: 1376 / 752,
      maxWidth: 3840,
      admin: true,
    },
    fashion: {
      label: 'Mode / Fashion card',
      labelKey: 'site-img-fashion',
      aliases: ['fashion', 'mode', 'fashion card'],
      selector: '.home-univers-card--mode img',
      defaultSrc: '/images/cat-mode.jpg',
      aspectRatio: 3 / 4,
      maxWidth: 2400,
      admin: true,
    },
    maison: {
      label: 'Maison / Home card',
      labelKey: 'site-img-maison',
      aliases: ['maison', 'home card', 'maison card'],
      selector: '.home-univers-card--maison img',
      defaultSrc: '/images/cat-maison.jpg',
      aspectRatio: 3 / 4,
      maxWidth: 2400,
      admin: true,
    },
    lifestyle: {
      label: 'Lifestyle card',
      labelKey: 'site-img-lifestyle',
      aliases: ['lifestyle', 'lifestyle card'],
      selector: '.home-univers-card--lifestyle img',
      defaultSrc: '/images/cat-lifestyle.jpg',
      aspectRatio: 3 / 4,
      maxWidth: 2400,
      admin: true,
    },
    journal: {
      label: 'Journal section',
      labelKey: 'site-img-journal',
      aliases: ['journal', 'story', 'linen', 'limited story'],
      selector: '.home-journal-visual img',
      defaultSrc: '/images/journal-linen.jpg',
      aspectRatio: 4 / 3,
      maxWidth: 2400,
      admin: true,
    },
    limited: {
      label: 'Édition limitée card',
      labelKey: 'site-img-limited',
      aliases: ['limited', 'edition', 'édition limitée', 'limited card'],
      selector: '.home-univers-card--limited img, .home-univers-card--lifestyle img',
      defaultSrc: '/images/cat-lifestyle.jpg',
      aspectRatio: 3 / 4,
      maxWidth: 2400,
      admin: true,
    },
    manifesto: {
      label: 'Manifesto section (legacy)',
      labelKey: 'site-img-manifesto',
      aliases: ['manifesto', 'quote section'],
      selector: '#homeJournal',
      admin: false,
    },
  };

  function isHeavyDataUrl(url) {
    const s = String(url || '');
    return s.startsWith('data:image');
  }

  /** Drop embedded data: images — they bloat localStorage/Firestore and stall paint. */
  function sanitizeAssets(data) {
    const d = data && typeof data === 'object' ? { ...data } : {};
    d.images = { ...(d.images || {}) };
    let changed = false;
    Object.keys(d.images).forEach((slot) => {
      if (isHeavyDataUrl(d.images[slot])) {
        delete d.images[slot];
        changed = true;
      }
    });
    if (isHeavyDataUrl(d.hero)) {
      delete d.hero;
      changed = true;
    }
    if (isHeavyDataUrl(d.fashion)) {
      delete d.fashion;
      changed = true;
    }
    if (d.hero && !d.images.hero) d.images.hero = d.hero;
    if (d.fashion && !d.images.fashion) d.images.fashion = d.fashion;
    return { data: d, changed };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!raw.images && (raw.hero || raw.fashion)) {
        raw.images = {};
        if (raw.hero) raw.images.hero = raw.hero;
        if (raw.fashion) raw.images.fashion = raw.fashion;
      }
      const { data, changed } = sanitizeAssets(raw);
      if (changed) {
        try {
          localStorage.setItem(KEY, JSON.stringify(data));
        } catch (_) {}
      }
      return data;
    } catch (_) {
      return {};
    }
  }

  function save(data) {
    const { data: clean } = sanitizeAssets(data || {});
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch (e) {
      console.warn('site assets save skipped (quota)', e);
      return;
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-site-assets-updated', { detail: clean }));
    }
    if (global.MD3Firebase && global.MD3Firebase.isEnabled && global.MD3Firebase.isEnabled()) {
      global.MD3Firebase.saveSiteAssets(clean).catch((e) => console.error('site assets sync', e));
    }
  }

  function getImages() {
    const d = load();
    const images = { ...(d.images || {}) };
    if (d.hero && !images.hero) images.hero = d.hero;
    if (d.fashion && !images.fashion) images.fashion = d.fashion;
    return images;
  }

  function getImage(slot) {
    const raw = getImages()[slot] || null;
    return raw ? publicUrl(raw) : null;
  }

  function getDefaultSrc(slot) {
    const meta = IMAGE_SLOTS[slot];
    return publicUrl((meta && meta.defaultSrc) || '');
  }

  function getDisplayUrl(slot) {
    return publicUrl(getImage(slot) || getDefaultSrc(slot) || '');
  }

  function setImage(slot, url) {
    if (!IMAGE_SLOTS[slot]) return null;
    // Never persist data: URLs as site assets — use Storage HTTPS or local files only
    if (isHeavyDataUrl(url)) {
      console.warn('MD3SiteAssets: refusing data: URL for slot', slot);
      return null;
    }
    const d = load();
    d.images = d.images || {};
    d.images[slot] = publicUrl(url);
    if (slot === 'hero') d.hero = url;
    if (slot === 'fashion') d.fashion = url;
    d.updatedAt = Date.now();
    save(d);
    applyToDocument();
    return url;
  }

  function clearImage(slot) {
    if (!IMAGE_SLOTS[slot]) return;
    const d = load();
    d.images = d.images || {};
    delete d.images[slot];
    if (slot === 'hero') delete d.hero;
    if (slot === 'fashion') delete d.fashion;
    d.updatedAt = Date.now();
    save(d);
    applyToDocument();
  }

  function resolveSlot(name) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    if (IMAGE_SLOTS[q]) return q;
    for (const [id, meta] of Object.entries(IMAGE_SLOTS)) {
      if (meta.aliases && meta.aliases.some((a) => q.includes(a) || a.includes(q))) return id;
    }
    return null;
  }

  function getHero() {
    return getImage('hero');
  }

  function getFashion() {
    return getImage('fashion');
  }

  function setHero(url) {
    return setImage('hero', url);
  }

  function setFashion(url) {
    return setImage('fashion', url);
  }

  function applyToDocument(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return;
    const images = getImages();

    const heroImg = root.querySelector('#md3-hero .hero-bg-img, .hero-bg-img');
    if (heroImg) {
      // Homepage hero is locked to NyZx3.jpg
      const url = publicUrl(IMAGE_SLOTS.hero.defaultSrc);
      heroImg.src = url;
      heroImg.setAttribute('src', url);
      const pic = heroImg.closest('picture');
      if (pic) pic.querySelectorAll('source').forEach((s) => s.remove());
    }

    Object.entries(IMAGE_SLOTS).forEach(([slot, meta]) => {
      if (slot === 'hero' || !meta.selector) return;
      let url = publicUrl(images[slot] || meta.defaultSrc);
      if (isHeavyDataUrl(url)) url = publicUrl(meta.defaultSrc || '');
      if (!url) return;
      const el = root.querySelector(meta.selector);
      if (!el) return;
      if (el.tagName === 'IMG') {
        if (el.getAttribute('src') !== url) {
          el.loading = el.loading || 'lazy';
          el.decoding = 'async';
          el.src = url;
        }
      } else if (images[slot] && !isHeavyDataUrl(images[slot])) {
        const safe = String(url).replace(/'/g, "\\'");
        el.style.backgroundImage = "url('" + safe + "')";
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      }
    });
  }

  function getCatalog(opts) {
    const adminOnly = !!(opts && opts.adminOnly);
    return Object.entries(IMAGE_SLOTS)
      .filter(([, meta]) => (adminOnly ? meta.admin === true : true))
      .map(([id, meta]) => ({
        slot: id,
        label: meta.label,
        labelKey: meta.labelKey,
        aliases: meta.aliases,
        defaultSrc: meta.defaultSrc || '',
        aspectRatio: meta.aspectRatio || NaN,
        maxWidth: meta.maxWidth || 2400,
        current: !!getImage(id),
        url: getDisplayUrl(id),
        custom: !!getImage(id),
      }));
  }

  async function init() {
    applyToDocument();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === KEY) applyToDocument();
      });
      window.addEventListener('md3-site-assets-updated', () => applyToDocument());
    }
    if (!global.MD3Firebase || !global.MD3Firebase.isConfigured || !global.MD3Firebase.isConfigured()) {
      return;
    }
    try {
      await global.MD3Firebase.init();
      if (!global.MD3Firebase.isEnabled || !global.MD3Firebase.isEnabled()) return;
      const remote = await global.MD3Firebase.loadSiteAssets();
      if (remote && (remote.hero || remote.fashion || remote.images || remote.contact)) {
        const local = load();
        const mergedRaw = {
          ...local,
          ...remote,
          images: { ...(local.images || {}), ...(remote.images || {}) },
          contact: { ...(local.contact || {}), ...(remote.contact || {}) },
          updatedAt: remote.updatedAt || Date.now(),
        };
        if (remote.hero) mergedRaw.images.hero = remote.hero;
        if (remote.fashion) mergedRaw.images.fashion = remote.fashion;
        const { data: merged } = sanitizeAssets(mergedRaw);
        try {
          localStorage.setItem(KEY, JSON.stringify(merged));
        } catch (_) {}
        if (global.MD3Contact && global.MD3Contact.applyRemoteSiteAssets) {
          global.MD3Contact.applyRemoteSiteAssets(merged);
        }
        applyToDocument();
      }
    } catch (e) {
      console.error('MD3SiteAssets init', e);
    }
  }

  global.MD3SiteAssets = {
    KEY,
    IMAGE_SLOTS,
    publicUrl,
    load,
    save,
    getImages,
    getImage,
    getDefaultSrc,
    getDisplayUrl,
    setImage,
    clearImage,
    resolveSlot,
    getHero,
    getFashion,
    setHero,
    setFashion,
    getCatalog,
    applyToDocument,
    init,
  };
})(typeof window !== 'undefined' ? window : globalThis);
