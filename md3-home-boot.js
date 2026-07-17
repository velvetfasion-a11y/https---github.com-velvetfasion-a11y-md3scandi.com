/** Homepage boot — runs after deferred store/header/shop scripts */
(function () {
  function updateCartBadge() {
    try {
      if (window.MD3Header) MD3Header.updateCartBadge();
    } catch (e) {}
  }

  document.documentElement.classList.add('js-reveal');

  function initReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if (!reveals.length) return;
    const featured = document.getElementById('boutique');
    if (featured) featured.classList.add('in-view');
    if (typeof IntersectionObserver === 'undefined') {
      reveals.forEach((el) => el.classList.add('in-view'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('in-view');
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );
    reveals.forEach((el) => observer.observe(el));
    requestAnimationFrame(() => {
      reveals.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92) el.classList.add('in-view');
      });
    });
  }
  initReveal();

  let featuredTimer = null;
  function renderFeatured() {
    try {
      const grid = document.getElementById('featuredGrid');
      const empty = document.getElementById('featuredEmpty');
      const carousel = document.getElementById('featuredCarousel');
      const section = document.getElementById('boutique');
      if (section) section.classList.add('in-view');
      if (!grid) return;
      if (!window.MD3Store) return;

      try {
        if (MD3Store.ensureCaches) MD3Store.ensureCaches();
      } catch (e) {}

      let products = [];
      try {
        products = MD3Store.getFeaturedProducts
          ? MD3Store.getFeaturedProducts()
          : MD3Store.getHomeFeaturedProducts
            ? MD3Store.getHomeFeaturedProducts()
            : [];
        const isFeat =
          MD3Store.isProductFeatured ||
          function (p) {
            return !!(p && p.featured);
          };
        products = (products || []).filter(isFeat);
      } catch (e) {
        console.error('featured products', e);
        products = [];
      }

      products = products.filter((p) => {
        const name = String((p && p.name) || '').trim();
        return !!(name && name !== '.' && name.length >= 2);
      });

      if (!products.length) {
        grid.innerHTML = '';
        grid.classList.remove('is-ready');
        if (carousel) {
          carousel.hidden = true;
          carousel.style.display = 'none';
        }
        if (empty) empty.hidden = false;
        return;
      }

      if (empty) empty.hidden = true;
      if (carousel) {
        carousel.hidden = false;
        carousel.style.display = '';
      }

      if (window.MD3Shop && MD3Shop.renderHomeCarousel) {
        MD3Shop.renderHomeCarousel(grid, products, MD3Shop.homeLabels());
      } else if (window.MD3Shop && MD3Shop.renderHomeGrid) {
        MD3Shop.renderHomeGrid(grid, products, MD3Shop.homeLabels());
        if (MD3Shop.startFeaturedAutoplay) MD3Shop.startFeaturedAutoplay(carousel);
      }
      updateCartBadge();
    } catch (e) {
      console.error('renderFeatured', e);
    }
  }

  function scheduleFeaturedRender() {
    clearTimeout(featuredTimer);
    featuredTimer = setTimeout(renderFeatured, 50);
  }

  function updateNavAuth() {
    try {
      if (window.MD3Header) MD3Header.updateAuth();
    } catch (e) {}
  }

  function bootShop() {
    try {
      updateNavAuth();
    } catch (e) {}
    try {
      updateCartBadge();
    } catch (e) {}
    try {
      if (window.MD3SiteAssets) MD3SiteAssets.applyToDocument();
    } catch (e) {}
    scheduleFeaturedRender();
  }

  try {
    if (window.MD3Lang) {
      MD3Lang.init({
        onChange() {
          try {
            if (window.MD3Currency) MD3Currency.refreshCurrency();
            MD3Lang.refreshUI();
          } catch (e) {}
          updateNavAuth();
          scheduleFeaturedRender();
          updateCartBadge();
          if (window.MD3HeroFit) MD3HeroFit.fit();
        },
      });
    }
  } catch (e) {
    console.error('MD3Lang.init', e);
  }

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  function startStore() {
    if (!window.MD3Store || !MD3Store.init) {
      bootShop();
      return;
    }
    MD3Store.init()
      .then(function () {
        try {
          if (window.MD3SiteAssets) MD3SiteAssets.init();
        } catch (e) {}
        bootShop();
      })
      .catch(function (e) {
        console.error('MD3Store.init', e);
        bootShop();
      });
  }
  startStore();

  window.addEventListener('pageshow', function () {
    updateNavAuth();
    updateCartBadge();
    scheduleFeaturedRender();
  });

  window.addEventListener('md3-products-updated', scheduleFeaturedRender);
  window.addEventListener('md3-carts-updated', updateCartBadge);
  window.addEventListener('md3-session-changed', updateNavAuth);
  window.addEventListener('md3-site-assets-updated', function () {
    if (window.MD3SiteAssets) MD3SiteAssets.applyToDocument();
    if (window.MD3HeroFit) MD3HeroFit.fit();
  });

  if (location.hash === '#boutique' || location.hash.startsWith('#boutique?')) {
    setTimeout(function () {
      const el = document.getElementById('boutique');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'md3_products') scheduleFeaturedRender();
    if (e.key === 'md3_carts') updateCartBadge();
    if (e.key === 'md3_session') updateNavAuth();
  });
})();
