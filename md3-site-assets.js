/** Site-wide overrides — images, section backgrounds (localStorage + optional Firestore) */
(function (global) {
  const KEY = 'md3_site_assets';

  /** Editable image slots the AI and admin can target */
  const IMAGE_SLOTS = {
    hero: {
      label: 'Homepage hero / header background',
      aliases: ['header', 'hero', 'start', 'top banner', 'huvudbild'],
    },
    fashion: {
      label: 'Mode / Fashion collection card',
      aliases: ['fashion', 'mode', 'fashion card'],
      selector: '.collection-card--fashion',
    },
    maison: {
      label: 'Maison / Home collection card',
      aliases: ['maison', 'home card', 'maison card'],
      selector: '.collection-card--maison',
    },
    lifestyle: {
      label: 'Lifestyle collection card',
      aliases: ['lifestyle', 'lifestyle card'],
      selector: '.collection-card--lifestyle',
    },
    limited: {
      label: 'Édition limitée collection card',
      aliases: ['limited', 'edition', 'édition limitée', 'limited card'],
      selector: '.collection-card--limited',
    },
    manifesto: {
      label: 'Manifesto section background',
      aliases: ['manifesto', 'quote section'],
      selector: '#manifesto',
    },
  };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!raw.images && (raw.hero || raw.fashion)) {
        raw.images = {};
        if (raw.hero) raw.images.hero = raw.hero;
        if (raw.fashion) raw.images.fashion = raw.fashion;
      }
      return raw;
    } catch (_) {
      return {};
    }
  }

  function save(data) {
    localStorage.setItem(KEY, JSON.stringify(data));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-site-assets-updated', { detail: data }));
    }
    if (global.MD3Firebase && global.MD3Firebase.isEnabled && global.MD3Firebase.isEnabled()) {
      global.MD3Firebase.saveSiteAssets(data).catch((e) => console.error('site assets sync', e));
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
    return getImages()[slot] || null;
  }

  function setImage(slot, url) {
    const d = load();
    d.images = d.images || {};
    d.images[slot] = url;
    if (slot === 'hero') d.hero = url;
    if (slot === 'fashion') d.fashion = url;
    d.updatedAt = Date.now();
    save(d);
    applyToDocument();
    return url;
  }

  function resolveSlot(name) {
    const q = String(name || '')
      .trim()
      .toLowerCase();
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

  function applyCardBackground(el, url) {
    if (!el || !url) return;
    const safe = String(url).replace(/'/g, "\\'");
    el.style.backgroundImage = "url('" + safe + "')";
    el.style.backgroundPosition = 'center 32%';
    el.style.backgroundSize = 'cover';
    el.style.backgroundRepeat = 'no-repeat';
    el.classList.add('collection-card--has-bg');
  }

  function applyToDocument(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return;
    const images = getImages();

    if (images.hero) {
      const img = root.querySelector('#md3-hero .hero-bg-img, .hero-bg-img');
      if (img) {
        img.src = images.hero;
        const pic = img.closest('picture');
        if (pic) pic.querySelectorAll('source').forEach((s) => s.remove());
      }
    }

    Object.entries(IMAGE_SLOTS).forEach(([slot, meta]) => {
      const url = images[slot];
      if (!url || slot === 'hero') return;
      const el = meta.selector ? root.querySelector(meta.selector) : null;
      if (!el) return;
      if (slot === 'manifesto') {
        const safe = String(url).replace(/'/g, "\\'");
        el.style.backgroundImage = "linear-gradient(rgba(248,245,240,0.92), rgba(248,245,240,0.92)), url('" + safe + "')";
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
      } else {
        applyCardBackground(el, url);
      }
    });
  }

  function getCatalog() {
    return Object.entries(IMAGE_SLOTS).map(([id, meta]) => ({
      slot: id,
      label: meta.label,
      aliases: meta.aliases,
      current: !!getImage(id),
    }));
  }

  async function init() {
    if (global.MD3Firebase && global.MD3Firebase.isConfigured && global.MD3Firebase.isConfigured()) {
      try {
        await global.MD3Firebase.init();
        if (global.MD3Firebase.isEnabled && global.MD3Firebase.isEnabled()) {
          const remote = await global.MD3Firebase.loadSiteAssets();
          if (remote && (remote.hero || remote.fashion || remote.images)) {
            const local = load();
            const merged = {
              ...local,
              ...remote,
              images: { ...(local.images || {}), ...(remote.images || {}) },
              updatedAt: remote.updatedAt || Date.now(),
            };
            if (remote.hero) merged.images.hero = remote.hero;
            if (remote.fashion) merged.images.fashion = remote.fashion;
            localStorage.setItem(KEY, JSON.stringify(merged));
          }
        }
      } catch (e) {
        console.error('MD3SiteAssets init', e);
      }
    }
    applyToDocument();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === KEY) applyToDocument();
      });
    }
  }

  global.MD3SiteAssets = {
    KEY,
    IMAGE_SLOTS,
    load,
    save,
    getImages,
    getImage,
    setImage,
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
