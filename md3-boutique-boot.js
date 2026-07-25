/** Boutique / category shop — must load via defer AFTER store, lang, shop-render */
(function () {
  const L = (k) => MD3Lang.t(k);
  let catFilter = null;
  let subFilter = null;

  function readParams() {
    const params = new URLSearchParams(location.search);
    catFilter = params.get('cat') || null;
    subFilter = params.get('sub') || null;
  }

  function canonicalCat(cat) {
    return MD3Store.canonicalCategory ? MD3Store.canonicalCategory(cat) : cat;
  }

  function activeCategory() {
    readParams();
    return catFilter ? canonicalCat(catFilter) : null;
  }

  function applyPageTitle(activeCat) {
    const titleEl = document.getElementById('boutiqueTitle');
    if (!titleEl) return;
    if (activeCat) {
      const label = MD3Lang.translateCategory(activeCat) || activeCat;
      titleEl.textContent = label;
      document.title = 'MD3 Scandi — ' + label;
    } else {
      const label = L('nav-shop') || L('shop-eyebrow') || 'Shop';
      titleEl.textContent = label;
      document.title = 'MD3 Scandi — ' + label;
    }
  }

  function markActiveNav(activeCat) {
    document.querySelectorAll('.nav-cat-link').forEach((a) => {
      try {
        const href = new URL(a.getAttribute('href'), location.href);
        const cat = href.searchParams.get('cat');
        const match = activeCat && cat && canonicalCat(cat) === activeCat;
        a.classList.toggle('is-active', !!match);
        if (match) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      } catch (_) {
        a.classList.remove('is-active');
      }
    });
  }

  function setSub(sub) {
    subFilter = sub || null;
    const url = new URL(location.href);
    if (subFilter) url.searchParams.set('sub', subFilter);
    else url.searchParams.delete('sub');
    history.replaceState(null, '', url.pathname + url.search);
    renderBoutique();
  }

  function renderBoutique() {
    const activeCat = activeCategory();
    applyPageTitle(activeCat);
    markActiveNav(activeCat);

    let products = [];
    try {
      products = MD3Store.getVisibleProducts
        ? MD3Store.getVisibleProducts()
        : (MD3Store.getProducts() || []);
    } catch (e) {
      products = [];
    }
    if (activeCat) products = products.filter((p) => canonicalCat(p.category) === activeCat);
    if (subFilter) products = products.filter((p) => p.sub === subFilter);

    const grid = document.getElementById('boutiqueGrid');
    const empty = document.getElementById('boutiqueEmpty');
    const filtersEl = document.getElementById('boutiqueFilters');
    if (!grid || !empty || !filtersEl) return;

    if (activeCat) {
      const allInCat = (MD3Store.getVisibleProducts
        ? MD3Store.getVisibleProducts()
        : MD3Store.getProducts() || []
      ).filter((p) => canonicalCat(p.category) === activeCat);
      const subs = [...new Set(allInCat.map((p) => p.sub))].filter(Boolean);
      if (subs.length > 1) {
        filtersEl.hidden = false;
        filtersEl.innerHTML = [
          `<button type="button" class="boutique-filter${subFilter ? '' : ' active'}" onclick="MD3Boutique.setSub(null)">${L('shop-all')}</button>`,
          ...subs.map((s) => {
            const active = s === subFilter ? ' active' : '';
            const safe = String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<button type="button" class="boutique-filter${active}" onclick="MD3Boutique.setSub('${safe}')">${MD3Shop.esc(MD3Lang.translateSub(s))}</button>`;
          }),
        ].join('');
      } else {
        filtersEl.hidden = true;
        filtersEl.innerHTML = '';
      }
    } else {
      filtersEl.hidden = true;
      filtersEl.innerHTML = '';
    }

    if (!products.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      empty.textContent = L('shop-empty-filter');
      return;
    }
    empty.hidden = true;
    MD3Shop.renderGrid(grid, products);
  }

  function boot() {
    renderBoutique();
    if (typeof MD3Header !== 'undefined') {
      MD3Header.updateCartBadge();
      MD3Header.updateAuth();
    }
  }

  window.MD3Boutique = { setSub, renderBoutique, boot };

  MD3Lang.init({
    onChange() {
      if (typeof MD3Currency !== 'undefined') MD3Currency.refreshCurrency();
      MD3Lang.refreshUI();
      boot();
    },
  });
  try {
    if (MD3Store.ensureCaches) MD3Store.ensureCaches();
  } catch (e) {}
  boot();
  MD3Store.init()
    .then(boot)
    .catch(boot);
  window.addEventListener('md3-products-updated', renderBoutique);
  window.addEventListener('md3-carts-updated', () => MD3Header.updateCartBadge());
})();
