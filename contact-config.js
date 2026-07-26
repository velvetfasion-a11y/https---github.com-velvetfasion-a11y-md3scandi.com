/**
 * Where customers send their cart (WhatsApp / SMS / TikTok).
 * Values can also be set in Admin → Contact (saved to the cloud).
 *
 * phone / whatsappPhone: digits only with country code, no + or spaces
 *   e.g. France mobile 06 12 34 56 78 → '33612345678'
 * tiktokHandle: username without @
 */
(function (global) {
  const STORAGE_KEY = 'md3_contact';

  const defaults = {
    phone: '',
    whatsappPhone: '',
    tiktokHandle: '',
    siteName: 'MD3 Scandi',
  };

  /** Static fallbacks from this file (may be empty). */
  global.MD3_CONTACT = Object.assign({}, defaults);

  function readStored() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch (_) {
      return {};
    }
  }

  function normalize(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
      phone: String(c.phone || '').replace(/\D/g, ''),
      whatsappPhone: String(c.whatsappPhone || c.phone || '').replace(/\D/g, ''),
      tiktokHandle: String(c.tiktokHandle || '')
        .replace(/^@/, '')
        .trim(),
      siteName: String(c.siteName || defaults.siteName).trim() || defaults.siteName,
    };
  }

  function get() {
    const fileCfg = global.MD3_CONTACT || {};
    const site =
      global.MD3SiteAssets && typeof global.MD3SiteAssets.load === 'function'
        ? (global.MD3SiteAssets.load().contact || {})
        : {};
    const stored = readStored();
    // Priority: localStorage override → site assets (cloud) → contact-config defaults
    return normalize({
      ...defaults,
      ...fileCfg,
      ...site,
      ...stored,
    });
  }

  function persistLocal(contact) {
    const clean = normalize(contact);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch (_) {}
    return clean;
  }

  function save(contact) {
    const clean = persistLocal(contact);
    if (global.MD3SiteAssets && typeof global.MD3SiteAssets.load === 'function') {
      const data = global.MD3SiteAssets.load() || {};
      data.contact = clean;
      data.updatedAt = Date.now();
      global.MD3SiteAssets.save(data);
    } else if (global.MD3Firebase && global.MD3Firebase.isEnabled && global.MD3Firebase.isEnabled()) {
      global.MD3Firebase.saveSiteAssets({ contact: clean, updatedAt: Date.now() }).catch(function (e) {
        console.error('contact sync', e);
      });
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('md3-contact-updated', { detail: clean }));
    }
    return clean;
  }

  function applyRemoteSiteAssets(remote) {
    if (!remote || !remote.contact) return;
    // Remote admin save is source of truth (including cleared empty fields)
    const clean = normalize(remote.contact);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch (_) {}
  }

  global.MD3Contact = {
    STORAGE_KEY,
    get,
    save,
    normalize,
    applyRemoteSiteAssets,
  };
})(typeof window !== 'undefined' ? window : globalThis);
