/** Site-wide image overrides (hero, fashion card) — localStorage + optional Firestore */
(function (global) {
  const KEY = 'md3_site_assets';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
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

  function getHero() {
    return load().hero || null;
  }

  function getFashion() {
    return load().fashion || null;
  }

  function setHero(url) {
    const d = load();
    d.hero = url;
    d.updatedAt = Date.now();
    save(d);
    return d.hero;
  }

  function setFashion(url) {
    const d = load();
    d.fashion = url;
    d.updatedAt = Date.now();
    save(d);
    return d.fashion;
  }

  function applyToDocument(doc) {
    const root = doc || (typeof document !== 'undefined' ? document : null);
    if (!root) return;
    const data = load();
    if (data.hero) {
      const img = root.querySelector('#md3-hero .hero-bg-img, .hero-bg-img');
      if (img) {
        img.src = data.hero;
        const pic = img.closest('picture');
        if (pic) {
          pic.querySelectorAll('source').forEach((s) => s.remove());
        }
      }
    }
    if (data.fashion) {
      const card = root.querySelector('.collection-card--fashion');
      if (card) {
        card.style.backgroundImage = "url('" + String(data.fashion).replace(/'/g, "\\'") + "') center 32% / cover no-repeat";
      }
    }
  }

  async function init() {
    if (global.MD3Firebase && global.MD3Firebase.isConfigured && global.MD3Firebase.isConfigured()) {
      try {
        await global.MD3Firebase.init();
        if (global.MD3Firebase.isEnabled && global.MD3Firebase.isEnabled()) {
          const remote = await global.MD3Firebase.loadSiteAssets();
          if (remote && (remote.hero || remote.fashion)) {
            const local = load();
            const merged = { ...local, ...remote, updatedAt: remote.updatedAt || Date.now() };
            localStorage.setItem(KEY, JSON.stringify(merged));
          }
        }
      } catch (e) {
        console.error('MD3SiteAssets init', e);
      }
    }
    applyToDocument();
  }

  global.MD3SiteAssets = {
    load,
    save,
    getHero,
    getFashion,
    setHero,
    setFashion,
    applyToDocument,
    init,
  };
})(typeof window !== 'undefined' ? window : globalThis);
