/**
 * Admin categories & subcategories (defaults + optional custom entries in localStorage).
 */
(function (global) {
  const STORAGE_KEY = 'md3_taxonomy';

  const DEFAULT_CATEGORIES = ['Mode', 'Maison', 'Lifestyle', 'Édition limitée'];

  const LIMITED_EDITION = 'Édition limitée';
  const SUB_SOURCE_CATEGORIES = ['Mode', 'Maison', 'Lifestyle'];

  const DEFAULT_SUBS = {
    Mode: ['Chaussures', 'Vêtements', 'Sacs', 'Accessoires'],
    Maison: ['Canapés', 'Lampes', 'Déco', 'Textile', 'Vaisselle', 'Mobilier'],
    Lifestyle: ['Vaisselle', 'Déco'],
    [LIMITED_EDITION]: [],
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { customCategories: [], customSubs: {} };
      const data = JSON.parse(raw);
      return {
        customCategories: Array.isArray(data.customCategories) ? data.customCategories : [],
        customSubs: data.customSubs && typeof data.customSubs === 'object' ? data.customSubs : {},
      };
    } catch (_) {
      return { customCategories: [], customSubs: {} };
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (global.MD3Firebase && global.MD3Firebase.isConfigured()) {
      const push = () => {
        if (global.MD3Firebase.isEnabled()) {
          global.MD3Firebase.saveTaxonomy(data).catch((e) => console.error('taxonomy sync', e));
        }
      };
      if (global.MD3Firebase.isEnabled()) push();
      else global.MD3Firebase.init().then(push).catch((e) => console.error('taxonomy init', e));
    }
  }

  function getCategories() {
    const { customCategories } = load();
    const out = [...DEFAULT_CATEGORIES];
    customCategories.forEach((c) => {
      const name = (c || '').trim();
      if (name && !out.includes(name)) out.push(name);
    });
    return out;
  }

  function subsFromProducts(category) {
    const extra = [];
    if (global.MD3Store && typeof global.MD3Store.getProducts === 'function') {
      global.MD3Store.getProducts().forEach((p) => {
        if (p.category === category && p.sub && !extra.includes(p.sub)) extra.push(p.sub);
      });
    }
    return extra;
  }

  function mergeSubsUnique(target, list) {
    list.forEach((s) => {
      const name = (s || '').trim();
      if (name && !target.includes(name)) target.push(name);
    });
    return target;
  }

  /** Subcategories for one category (not including cross-category merge). */
  function getSubsForCategory(category) {
    const defaults = DEFAULT_SUBS[category] ? [...DEFAULT_SUBS[category]] : [];
    const { customSubs } = load();
    const custom = customSubs[category] || [];
    const merged = mergeSubsUnique([], defaults);
    mergeSubsUnique(merged, custom);
    mergeSubsUnique(merged, subsFromProducts(category));
    return merged;
  }

  function getLimitedEditionSubs() {
    const merged = [];
    SUB_SOURCE_CATEGORIES.forEach((cat) => {
      mergeSubsUnique(merged, getSubsForCategory(cat));
    });
    mergeSubsUnique(merged, getSubsForCategory(LIMITED_EDITION));
    return merged;
  }

  function getSubs(category) {
    if (category === LIMITED_EDITION) return getLimitedEditionSubs();
    return getSubsForCategory(category);
  }

  function addCategory(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const data = load();
    const all = getCategories();
    if (all.includes(trimmed)) return trimmed;
    data.customCategories.push(trimmed);
    if (!data.customSubs[trimmed]) data.customSubs[trimmed] = [];
    save(data);
    return trimmed;
  }

  function addSub(category, name) {
    const cat = (category || '').trim();
    const trimmed = (name || '').trim();
    if (!cat || !trimmed) return null;
    const data = load();
    if (!data.customSubs[cat]) data.customSubs[cat] = [];
    if (!getSubs(cat).includes(trimmed) && !data.customSubs[cat].includes(trimmed)) {
      data.customSubs[cat].push(trimmed);
      save(data);
    }
    return trimmed;
  }

  function labelCategory(cat) {
    if (global.MD3Lang && typeof global.MD3Lang.translateCategory === 'function') {
      return global.MD3Lang.translateCategory(cat);
    }
    return cat;
  }

  function labelSub(sub) {
    if (global.MD3Lang && typeof global.MD3Lang.translateSub === 'function') {
      return global.MD3Lang.translateSub(sub);
    }
    return sub;
  }

  function fillSelect(selectEl, values, selected, labelFn) {
    if (!selectEl) return;
    const prev = selected != null ? selected : selectEl.value;
    selectEl.innerHTML = values
      .map((v) => {
        const esc = (s) =>
          String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
        const label = labelFn ? labelFn(v) : v;
        const sel = v === prev ? ' selected' : '';
        return `<option value="${esc(v)}"${sel}>${esc(label)}</option>`;
      })
      .join('');
    if (values.length && !values.includes(prev)) selectEl.value = values[0];
    else if (values.includes(prev)) selectEl.value = prev;
  }

  function syncCategorySelect(selectEl, selected) {
    if (!selectEl) return;
    const cats = getCategories();
    const prev = selected != null ? selected : selectEl.value;
    const defaultSet = new Set(DEFAULT_CATEGORIES);
    selectEl.innerHTML = cats
      .map((c) => {
        const esc = (s) =>
          String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
        const sel = c === prev ? ' selected' : '';
        const i18n = defaultSet.has(c) ? ' data-i18n-opt="' + esc(c) + '"' : '';
        return `<option value="${esc(c)}"${sel}${i18n}>${esc(labelCategory(c))}</option>`;
      })
      .join('');
    if (cats.includes(prev)) selectEl.value = prev;
    else if (cats.length) selectEl.value = cats[0];
    if (global.MD3Lang && typeof global.MD3Lang.applySelectOptions === 'function') {
      global.MD3Lang.applySelectOptions(global.MD3Lang.getLang());
    }
  }

  function syncSubSelect(selectEl, category, selected) {
    const subs = getSubs(category);
    fillSelect(selectEl, subs, selected, labelSub);
    if (global.MD3Lang && typeof global.MD3Lang.applySubSelectOptions === 'function') {
      global.MD3Lang.applySubSelectOptions(global.MD3Lang.getLang());
    }
  }

  function onCategoryChange(catSelect, subSelect) {
    const cat = catSelect ? catSelect.value : 'Mode';
    syncSubSelect(subSelect, cat);
  }

  global.MD3Taxonomy = {
    DEFAULT_CATEGORIES,
    DEFAULT_SUBS,
    getCategories,
    getSubs,
    addCategory,
    addSub,
    syncCategorySelect,
    syncSubSelect,
    onCategoryChange,
    labelCategory,
    labelSub,
  };
})(typeof window !== 'undefined' ? window : globalThis);
