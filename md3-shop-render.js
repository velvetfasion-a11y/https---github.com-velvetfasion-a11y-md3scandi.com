/** Shared shop card rendering + cart toast */
(function (global) {
  let toastTimer = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function productImageBlock(p) {
    const image =
      global.MD3Store && global.MD3Store.normalizeProductImages
        ? global.MD3Store.normalizeProductImages(p)[0]
        : p && p.image;
    if (image) {
      return `<img src="${esc(image)}" alt="" class="product-photo" loading="lazy" />`;
    }
    return `<div class="cemoji">${esc((p && p.emoji) || '✦')}</div>`;
  }

  function localizedName(p) {
    return global.MD3Lang && global.MD3Lang.productName ? global.MD3Lang.productName(p) : (p && p.name) || '';
  }

  function categoryFallbackImage(p) {
    const catKey = String((p && p.category) || '');
    if (/maison|home/i.test(catKey)) return 'images/cat-maison.jpg';
    if (/lifestyle/i.test(catKey)) return 'images/cat-lifestyle.jpg';
    if (/édition|edition|limit/i.test(catKey)) return 'images/journal-linen.jpg';
    return 'images/cat-mode.jpg';
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
    const local = list.find(
      (s) => s.startsWith('images/') || s.startsWith('/') || s.startsWith('data:image')
    );
    if (local) return local;
    const remote = list.find((s) => /^https?:\/\//i.test(s));
    if (remote) return remote;
    return fallback;
  }

  function storeCardHomeHtml(p, labels) {
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const fallback = categoryFallbackImage(p);
    const image = pickHomeImage(p);
    const cat = labels.catLabel ? labels.catLabel(p.category) : p.category;
    const isLimited = /édition|edition|limit/i.test(String(p.category || ''));
    const badge = isLimited
      ? `<span class="home-product-badge">${esc(labels.limitedBadge || 'Édition')}</span>`
      : '';
    const imgHtml = image
      ? `<img src="${esc(image)}" alt="${esc(name)}" loading="eager" decoding="async" draggable="false" onerror="this.onerror=null;this.src='${fallback}'" />`
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

  function storeCardMinimalHtml(p, labels) {
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const image =
      global.MD3Store && global.MD3Store.normalizeProductImages
        ? global.MD3Store.normalizeProductImages(p)[0]
        : p && p.image;
    const imgHtml = image
      ? `<img src="${esc(image)}" alt="${esc(name)}" loading="lazy" />`
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
          ${productImageBlock(p)}
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
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = products.map((p) => storeCardHomeHtml(p, lbl)).join('');
  }

  /**
   * 3 equal photos visible; step one card every 2s; seamless infinite loop.
   * No center-scale (that caused overlap + lag).
   */
  let featuredAutoplayTimer = null;
  let featuredTransitionTimer = null;
  let featuredIndex = 0;

  function stopFeaturedAutoplay() {
    if (featuredAutoplayTimer) {
      clearInterval(featuredAutoplayTimer);
      featuredAutoplayTimer = null;
    }
    if (featuredTransitionTimer) {
      clearTimeout(featuredTransitionTimer);
      featuredTransitionTimer = null;
    }
  }

  function startFeaturedAutoplay(carousel) {
    stopFeaturedAutoplay();
    if (!carousel) return;

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
      track.appendChild(clone);
    }

    featuredIndex = 0;
    let wrapping = false;
    let stepPx = 0;

    function layoutCards() {
      const styles = window.getComputedStyle(group);
      const gap = parseFloat(styles.columnGap || styles.gap) || 0;
      // 3 equal cards + 2 gutters inside the visible window
      const w = Math.max(120, (carousel.clientWidth - gap * 2) / 3);
      track.style.setProperty('--featured-card-w', w.toFixed(2) + 'px');
      track.style.setProperty('--featured-gap', gap.toFixed(2) + 'px');

      // Force layout, then derive step from full group width
      // (includes end padding = gap so the clone seam never touches)
      void group.offsetWidth;
      stepPx = count > 0 ? group.offsetWidth / count : 0;
    }

    function apply(animate) {
      if (!stepPx) layoutCards();
      const x = -(featuredIndex * stepPx);
      track.style.transition = animate ? 'transform 0.5s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none';
      track.style.transform = 'translate3d(' + x + 'px, 0, 0)';
    }

    layoutCards();
    apply(false);
    // Remeasure after fonts/images settle once
    requestAnimationFrame(function () {
      layoutCards();
      apply(false);
    });

    featuredAutoplayTimer = window.setInterval(function () {
      if (wrapping) return;
      featuredIndex += 1;
      apply(true);

      // After sliding onto the clone of card 0, jump back with no transition
      if (featuredIndex >= count) {
        wrapping = true;
        featuredTransitionTimer = window.setTimeout(function () {
          featuredIndex = 0;
          apply(false);
          wrapping = false;
        }, 520);
      }
    }, 2000);

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
          }, 100);
        },
        { passive: true }
      );
    }
  }

  function renderHomeCarousel(container, products, labels) {
    if (!container) return;
    const lbl = labels || homeLabels();
    const carousel = container.closest('.home-featured-carousel') || container.parentElement;
    stopFeaturedAutoplay();

    if (!products.length) {
      container.innerHTML = '';
      container.classList.remove('is-ready');
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

    // Only duplicate favourites for a smooth loop — never pull non-favourited catalog items
    if (!list.length) {
      container.innerHTML = '';
      container.classList.remove('is-ready');
      return;
    }
    const favourites = list.slice();
    while (list.length < 3) list = list.concat(favourites);
    list = list.slice(0, Math.max(favourites.length, 3));

    const cards = list.map((p) => storeCardHomeHtml(p, lbl)).join('');
    container.innerHTML =
      '<div class="home-featured-group">' +
      cards +
      '</div><div class="home-featured-group" aria-hidden="true">' +
      cards +
      '</div>';
    container.classList.add('is-ready');

    requestAnimationFrame(function () {
      startFeaturedAutoplay(carousel);
    });
  }

  function renderGrid(container, products, labels) {
    if (!container) return;
    const lbl = labels || defaultLabels();
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    const render = lbl.homeStyle ? storeCardHomeHtml : lbl.minimal ? storeCardMinimalHtml : storeCardHtml;
    container.innerHTML = products.map((p) => render(p, lbl)).join('');
  }

  global.MD3Shop = {
    esc,
    storeCardHtml,
    storeCardHomeHtml,
    productImageBlock,
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
