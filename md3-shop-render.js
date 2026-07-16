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

  function pickReliableHomeImage(p) {
    const fallback = categoryFallbackImage(p);
    const imgs =
      global.MD3Store && global.MD3Store.normalizeProductImages
        ? global.MD3Store.normalizeProductImages(p)
        : p && p.images
          ? p.images
          : p && p.image
            ? [p.image]
            : [];
    // Prefer local / data URLs — remote https often 404s on the live site
    const local = (imgs || []).find((src) => {
      const s = String(src || '');
      return s.startsWith('images/') || s.startsWith('/') || s.startsWith('data:image');
    });
    if (local) return local;
    return fallback;
  }

  function storeCardHomeHtml(p, labels) {
    const href = global.MD3Store.productHref(p.id);
    const name = localizedName(p);
    const fallback = categoryFallbackImage(p);
    const image = pickReliableHomeImage(p);
    const cat = labels.catLabel ? labels.catLabel(p.category) : p.category;
    const isLimited = /édition|edition|limit/i.test(String(p.category || ''));
    const badge = isLimited
      ? `<span class="home-product-badge">${esc(labels.limitedBadge || 'Édition')}</span>`
      : '';
    const imgHtml = image
      ? `<img src="${esc(image)}" alt="${esc(name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${fallback}'" />`
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
   * Continuous infinite marquee (CSS translateX -50%).
   * Two identical groups → seamless circle. No step/scale “focus” effect.
   */
  function stopFeaturedAutoplay() {
    /* no JS timer — marquee is CSS-driven */
  }

  function startFeaturedAutoplay(carousel) {
    if (!carousel) return;
    const track = carousel.querySelector('.home-featured-track') || carousel.firstElementChild;
    if (!track) return;

    const groups = track.querySelectorAll('.home-featured-group');
    const group = groups[0];
    if (!group) return;

    if (groups.length < 2) {
      const clone = group.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      track.appendChild(clone);
    }

    const cards = group.querySelectorAll('.home-product-card');
    const n = Math.max(1, cards.length);
    // ~2.5s of travel per card → full loop = one group width
    const seconds = Math.max(20, Math.min(80, n * 2.5));
    track.style.setProperty('--featured-marquee-duration', seconds + 's');
    track.style.removeProperty('transform');
    track.style.removeProperty('transition');
    track.classList.add('is-ready');
  }

  function renderHomeCarousel(container, products, labels) {
    if (!container) return;
    const lbl = labels || homeLabels();
    const carousel = container.closest('.home-featured-carousel') || container.parentElement;

    if (!products.length) {
      container.innerHTML = '';
      container.classList.remove('is-ready');
      return;
    }

    // Dedupe by id, then pad with more catalog items so the strip isn't one product ×3
    const seen = new Set();
    let list = [];
    products.forEach((p) => {
      const id = p && p.id != null ? String(p.id) : '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      list.push(p);
    });

    if (list.length < 4 && global.MD3Store && global.MD3Store.getProducts) {
      try {
        global.MD3Store.getProducts().forEach((p) => {
          if (list.length >= 6) return;
          const id = p && p.id != null ? String(p.id) : '';
          if (!id || seen.has(id)) return;
          const name = String((p && p.name) || '').trim();
          if (!name || name === '.' || name.length < 2) return;
          seen.add(id);
          list.push(p);
        });
      } catch (_) {}
    }

    while (list.length < 4) list = list.concat(list);
    list = list.slice(0, Math.max(4, Math.min(list.length, 10)));

    const cards = list.map((p) => storeCardHomeHtml(p, lbl)).join('');
    container.innerHTML =
      '<div class="home-featured-group">' +
      cards +
      '</div><div class="home-featured-group" aria-hidden="true">' +
      cards +
      '</div>';

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
