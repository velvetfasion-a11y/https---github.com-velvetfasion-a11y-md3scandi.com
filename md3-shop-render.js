/** Shared shop card rendering + cart toast */
(function (global) {
  let toastTimer = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function categoryFallbackImage(p) {
    const catKey = String((p && p.category) || '');
    if (/maison|home/i.test(catKey)) return '/images/cat-maison.jpg';
    if (/lifestyle/i.test(catKey)) return '/images/cat-lifestyle.jpg';
    if (/édition|edition|limit/i.test(catKey)) return '/images/journal-linen.jpg';
    return '/images/cat-mode.jpg';
  }

  /**
   * Instant preview (local category shot as CSS background) + fade-in when the
   * real product photo arrives — avoids empty beige boxes in the carousel.
   */
  function progressiveImgHtml(src, opts) {
    const o = opts || {};
    function abs(u) {
      const s = String(u || '').trim();
      if (!s) return '';
      if (/^(https?:|data:|blob:)/i.test(s) || s.startsWith('/') || s.startsWith('//')) return s;
      return '/' + s.replace(/^\.\//, '');
    }
    const fallback = abs(o.fallback || '/images/cat-mode.jpg');
    const real = abs(String(src || fallback || '').trim() || fallback);
    const ph = abs(fallback || '/images/cat-mode.jpg');
    const same = real === ph;
    const eager = !!o.eager;
    const alt = o.alt || '';
    const width = o.width || 600;
    const height = o.height || 800;
    const extraClass = o.className ? ' ' + o.className : '';
    const readyClass = same ? ' is-ready' : '';
    const loading = eager ? 'eager' : 'lazy';
    const prio = eager ? ' fetchpriority="high"' : '';
    const phCss = esc(ph).replace(/'/g, '%27');
    return (
      `<span class="md3-img" style="background-image:url('${phCss}')">` +
      `<img class="md3-img__full${readyClass}${extraClass}" src="${esc(real)}" alt="${esc(alt)}" width="${width}" height="${height}" ` +
      `loading="${loading}" decoding="async"${prio} ` +
      `onload="this.classList.add('is-ready')" ` +
      `onerror="this.onerror=null;this.src='${esc(ph)}';this.classList.add('is-ready')" />` +
      `</span>`
    );
  }

  function hydrateProgressiveImages(root) {
    const scope = root && root.querySelectorAll ? root : document;
    try {
      scope.querySelectorAll('.md3-img__full').forEach(function (img) {
        if (img.complete && img.naturalWidth > 0) img.classList.add('is-ready');
      });
    } catch (_) {}
  }

  function productImageBlock(p, opts) {
    const image =
      global.MD3Store && global.MD3Store.normalizeProductImages
        ? global.MD3Store.normalizeProductImages(p)[0]
        : p && p.image;
    const fallback = categoryFallbackImage(p);
    if (image || fallback) {
      return progressiveImgHtml(image || fallback, {
        fallback,
        eager: opts && opts.eager,
        className: 'product-photo-wrap',
        width: 600,
        height: 800,
      });
    }
    return `<div class="cemoji">${esc((p && p.emoji) || '✦')}</div>`;
  }

  function localizedName(p) {
    if (global.MD3Store && typeof global.MD3Store.productDisplayName === 'function') {
      return global.MD3Store.productDisplayName(p);
    }
    return global.MD3Lang && global.MD3Lang.productName ? global.MD3Lang.productName(p) : (p && p.name) || '';
  }

  function pickHomeImage(p) {
    const fallback = categoryFallbackImage(p);
    const imgs =
      global.MD3Store && global.MD3Store.normalizeProductImages
        ? global.MD3Store.normalizeProductImages(p)
        : p && p.images
          ? p.images
          : p && p.image
            ? [p.image]
            : [];
    const list = (imgs || []).map((s) => String(s || '')).filter(Boolean);
    // Prefer real network/local files — never prefer huge data: URLs for storefront
    const remote = list.find((s) => /^https?:\/\//i.test(s));
    if (remote) return remote;
    const local = list.find((s) => s.startsWith('images/') || s.startsWith('/'));
    if (local) return local;
    const data = list.find((s) => s.startsWith('data:image'));
    if (data) return data;
    return fallback;
  }

  function storeCardHomeHtml(p, labels, opts) {
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const fallback = categoryFallbackImage(p);
    const image = pickHomeImage(p);
    const cat = labels.catLabel ? labels.catLabel(p.category) : p.category;
    const isLimited = /édition|edition|limit/i.test(String(p.category || ''));
    const badge = isLimited
      ? `<span class="home-product-badge">${esc(labels.limitedBadge || 'Édition')}</span>`
      : '';
    const eager = opts && opts.eager;
    const imgHtml = image
      ? progressiveImgHtml(image, {
          fallback,
          alt: name,
          eager,
          width: 600,
          height: 800,
        })
      : `<div class="featured-emoji-fallback">${esc((p && p.emoji) || '✦')}</div>`;
    return `
      <a href="${href}" class="home-product-card">
        <div class="home-product-visual">${badge}${imgHtml}</div>
        <div class="home-product-meta">
          <div class="home-product-cat">${esc(cat)}</div>
          <div class="home-product-name display-serif">${esc(name)}</div>
          <div class="home-product-price">${labels.price(p.price)}</div>
        </div>
      </a>`;
  }

  function storeCardMinimalHtml(p, labels, opts) {
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const fallback = categoryFallbackImage(p);
    const image = pickHomeImage(p);
    const eager = opts && opts.eager;
    const imgHtml = image
      ? progressiveImgHtml(image, {
          fallback,
          alt: name,
          eager,
          width: 600,
          height: 800,
        })
      : `<div class="featured-emoji-fallback">${esc((p && p.emoji) || '✦')}</div>`;
    return `
      <a href="${href}" class="product-card">
        <div class="image-wrapper">${imgHtml}</div>
        <div class="product-info">
          <span class="product-name">${esc(name)}</span>
          <span class="product-price">${labels.price(p.price)}</span>
        </div>
      </a>`;
  }

  function storeCardHtml(p, labels) {
    const out = !p.stock;
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const cat = labels.catLabel ? labels.catLabel(p.category) : p.category;
    const sub = labels.subLabel ? labels.subLabel(p.sub) : p.sub;
    const catLine = [cat, sub].filter(Boolean).join(' · ');
    const cartSvg = labels.cartSvg || '';

    return `
      <article class="scard" onclick="location.href='${href}'" role="link" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.href='${href}'}">
        <div class="cimgw">
          ${productImageBlock(p, labels && labels.eagerFirst ? { eager: true } : null)}
          ${out ? `<div class="otag">${esc(labels.out)}</div>` : ''}
        </div>
        <div class="cinf">
          ${catLine ? `<div class="ccat">${esc(catLine)}</div>` : ''}
          <div class="ctitle">${esc(name)}</div>
          <div class="cprice">${labels.price(p.price)}${labels.priceNote ? ` <small>${esc(labels.priceNote)}</small>` : ''}</div>
          <div class="cstock ${out ? 'out' : 'in'}">${esc(out ? labels.stockOut : labels.stockIn)}</div>
          <button type="button" class="ccbtn" ${out ? 'disabled' : ''} onclick="MD3Shop.addToCart(${p.id}, event)">
            ${cartSvg}${esc(labels.addToCart)}
          </button>
        </div>
      </article>`;
  }

  function showToast(msg) {
    let el = document.getElementById('md3ShopToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'md3ShopToast';
      el.className = 'md3-shop-toast';
      el.innerHTML = '<div class="tdot"></div><span id="md3ShopToastMsg"></span>';
      document.body.appendChild(el);
    }
    const msgEl = document.getElementById('md3ShopToastMsg');
    if (msgEl) msgEl.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function addToCart(id, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const S = global.MD3Store;
    const L = global.MD3Lang ? (k) => global.MD3Lang.t(k) : (k) => k;
    const p = S.getProductById ? S.getProductById(id) : S.getProducts().find((x) => x.id == id);
    if (p && global.MD3Sizes && global.MD3Sizes.productNeedsSize(p)) {
      const href = S.productHref(p.id);
      if (event) {
        showToast(L('cart-select-size'));
        setTimeout(() => { location.href = href; }, 600);
      } else {
        location.href = href;
      }
      return false;
    }
    const res = await S.addToCart(id);
    if (!res.ok) {
      if (res.reason === 'out') showToast(L('cart-out-stock'));
      else if (res.reason === 'max') showToast(L('cart-max-stock'));
      return false;
    }
    if (global.MD3Header) global.MD3Header.updateCartBadge();
    showToast(L('cart-added-toast'));
    global.dispatchEvent(new CustomEvent('md3-carts-updated'));
    return true;
  }

  function defaultLabels() {
    const L = global.MD3Lang ? (k) => global.MD3Lang.t(k) : (k) => k;
    const cartSvg = global.MD3NavIcons
      ? global.MD3NavIcons.cartSmall.replace('nav-icon-svg', '')
      : '';
    return {
      out: L('shop-out'),
      stockIn: L('stock-in'),
      stockOut: L('stock-out-lbl'),
      addToCart: L('cart-add'),
      priceNote: L('price-incl'),
      price: (n) =>
        global.MD3Currency && global.MD3Currency.formatPrice
          ? global.MD3Currency.formatPrice(n)
          : `${n} €`,
      catLabel: (c) =>
        global.MD3Lang && global.MD3Lang.translateCategory
          ? global.MD3Lang.translateCategory(c)
          : c || '',
      subLabel: (s) =>
        global.MD3Lang && global.MD3Lang.translateSub
          ? global.MD3Lang.translateSub(s)
          : s || '',
      cartSvg,
      minimal: false,
    };
  }

  function minimalLabels() {
    return { ...defaultLabels(), minimal: true };
  }

  function homeLabels() {
    const L = global.MD3Lang ? (k) => global.MD3Lang.t(k) : (k) => k;
    return {
      ...minimalLabels(),
      homeStyle: true,
      limitedBadge: L('home-limited-badge'),
    };
  }

  function renderHomeGrid(container, products, labels) {
    if (!container) return;
    const lbl = labels || homeLabels();
    const key = (products || [])
      .map((p) => String(p.id) + ':' + String((p.images && p.images[0]) || p.image || '').slice(-24))
      .join('|');
    if (container.dataset.md3ShopKey === key && container.childElementCount) return;
    container.dataset.md3ShopKey = key;
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = products
      .map((p, i) => storeCardHomeHtml(p, lbl, { eager: i === 0 }))
      .join('');
  }

  /**
   * Equal photos visible; step one card; seamless infinite loop.
   * Visible count adapts: 1 phone / 2 tablet / 3 desktop. Pauses when off-screen.
   */
  let featuredAutoplayTimer = null;
  let featuredTransitionTimer = null;
  let featuredIndex = 0;
  let featuredLastKey = '';
  let featuredIo = null;

  function stopFeaturedAutoplay() {
    if (featuredAutoplayTimer) {
      clearInterval(featuredAutoplayTimer);
      featuredAutoplayTimer = null;
    }
    if (featuredTransitionTimer) {
      clearTimeout(featuredTransitionTimer);
      featuredTransitionTimer = null;
    }
    if (featuredIo) {
      featuredIo.disconnect();
      featuredIo = null;
    }
  }

  function visibleCardCount(carousel) {
    const w = (carousel && carousel.clientWidth) || window.innerWidth || 0;
    if (w < 560) return 1;
    if (w < 900) return 2;
    return 3;
  }

  function startFeaturedAutoplay(carousel) {
    stopFeaturedAutoplay();
    if (!carousel) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const track = carousel.querySelector('.home-featured-track') || carousel.firstElementChild;
    if (!track) return;

    track.style.animation = 'none';
    track.classList.add('is-ready');

    let groups = track.querySelectorAll('.home-featured-group');
    const group = groups[0];
    if (!group) return;

    const baseCards = group.querySelectorAll('.home-product-card');
    const count = baseCards.length;
    if (count < 1) return;

    if (groups.length < 2) {
      const clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      // Clones must not compete for bandwidth with the live cards
      clone.querySelectorAll('img').forEach((img) => {
        img.loading = 'lazy';
        img.removeAttribute('fetchpriority');
        img.setAttribute('fetchpriority', 'low');
      });
      track.appendChild(clone);
    }

    featuredIndex = 0;
    let wrapping = false;
    let stepPx = 0;
    let paused = false;

    function layoutCards() {
      const styles = window.getComputedStyle(group);
      const gap = parseFloat(styles.columnGap || styles.gap) || 0;
      const visible = visibleCardCount(carousel);
      const gutters = Math.max(0, visible - 1);
      const w = Math.max(140, (carousel.clientWidth - gap * gutters) / visible);
      track.style.setProperty('--featured-card-w', w.toFixed(2) + 'px');
      track.style.setProperty('--featured-gap', gap.toFixed(2) + 'px');
      void group.offsetWidth;
      stepPx = count > 0 ? group.offsetWidth / count : 0;
    }

    function apply(animate) {
      if (!stepPx) layoutCards();
      const x = -(featuredIndex * stepPx);
      track.style.transition = animate ? 'transform 0.45s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none';
      track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
    }

    layoutCards();
    apply(false);
    requestAnimationFrame(function () {
      layoutCards();
      apply(false);
    });

    function tick() {
      if (paused || wrapping || document.hidden) return;
      featuredIndex += 1;
      apply(true);
      if (featuredIndex >= count) {
        wrapping = true;
        featuredTransitionTimer = window.setTimeout(function () {
          featuredIndex = 0;
          apply(false);
          wrapping = false;
        }, 480);
      }
    }

    featuredAutoplayTimer = window.setInterval(tick, 3500);

    if (typeof IntersectionObserver !== 'undefined') {
      featuredIo = new IntersectionObserver(
        function (entries) {
          const entry = entries[0];
          paused = !(entry && entry.isIntersecting);
        },
        { threshold: 0.2 }
      );
      featuredIo.observe(carousel);
    }

    if (!carousel.dataset.md3StepBound) {
      carousel.dataset.md3StepBound = '1';
      let resizeTimer = null;
      window.addEventListener(
        'resize',
        function () {
          window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(function () {
            layoutCards();
            apply(false);
          }, 120);
        },
        { passive: true }
      );
    }
  }

  function renderHomeCarousel(container, products, labels) {
    if (!container) return;
    const lbl = labels || homeLabels();
    const carousel = container.closest('.home-featured-carousel') || container.parentElement;

    if (!products.length) {
      stopFeaturedAutoplay();
      container.innerHTML = '';
      container.classList.remove('is-ready');
      featuredLastKey = '';
      return;
    }

    const seen = new Set();
    let list = [];
    products.forEach((p) => {
      const id = p && p.id != null ? String(p.id) : '';
      if (!id || seen.has(id)) return;
      const featuredOk =
        global.MD3Store && global.MD3Store.isProductFeatured
          ? global.MD3Store.isProductFeatured(p)
          : !!(p && p.featured);
      if (!featuredOk) return;
      seen.add(id);
      list.push(p);
    });

    if (!list.length) {
      stopFeaturedAutoplay();
      container.innerHTML = '';
      container.classList.remove('is-ready');
      featuredLastKey = '';
      return;
    }

    const favourites = list.slice();
    const key = favourites
      .map((p) => String(p.id) + ':' + String((p.images && p.images[0]) || p.image || '').slice(-32))
      .join(',');
    if (key === featuredLastKey && container.querySelector('.home-featured-group')) {
      return;
    }
    featuredLastKey = key;

    stopFeaturedAutoplay();
    while (list.length < 3) list = list.concat(favourites);
    list = list.slice(0, Math.max(favourites.length, 3));

    // Eager-load the first few visible cards; placeholders cover the rest until ready
    const cards = list
      .map((p, i) => storeCardHomeHtml(p, lbl, { eager: i < 3 }))
      .join('');
    container.innerHTML = '<div class="home-featured-group">' + cards + '</div>';
    container.classList.add('is-ready');
    hydrateProgressiveImages(container);

    requestAnimationFrame(function () {
      startFeaturedAutoplay(carousel);
      hydrateProgressiveImages(carousel);
    });
  }

  function renderGrid(container, products, labels) {
    if (!container) return;
    const lbl = labels || defaultLabels();
    const key = (products || [])
      .map((p) => String(p.id) + ':' + String((p.images && p.images[0]) || p.image || '').slice(-24) + ':' + (p.stock || 0))
      .join('|');
    if (container.dataset.md3ShopKey === key && container.childElementCount) return;
    container.dataset.md3ShopKey = key;
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    const render = lbl.homeStyle ? storeCardHomeHtml : lbl.minimal ? storeCardMinimalHtml : storeCardHtml;
    container.innerHTML = products
      .map((p, i) => {
        if (render === storeCardHtml && i === 0) {
          return storeCardHtml(p, { ...lbl, eagerFirst: true });
        }
        return render(p, lbl, i < 2 ? { eager: true } : null);
      })
      .join('');
    hydrateProgressiveImages(container);
  }

  global.MD3Shop = {
    esc,
    storeCardHtml,
    storeCardHomeHtml,
    productImageBlock,
    progressiveImgHtml,
    hydrateProgressiveImages,
    categoryFallbackImage,
    addToCart,
    showToast,
    defaultLabels,
    minimalLabels,
    homeLabels,
    renderGrid,
    renderHomeGrid,
    renderHomeCarousel,
    startFeaturedAutoplay,
    stopFeaturedAutoplay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
