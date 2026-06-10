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

  function storeCardHtml(p, labels) {
    const out = !p.stock;
    const href = global.MD3Store.productHref(p.id);
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
          <div class="ctitle">${esc(p.name)}</div>
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
        global.MD3Currency && global.MD3Currency.formatPriceInSiteLang
          ? global.MD3Currency.formatPriceInSiteLang(n)
          : global.MD3Currency.formatPrice(n),
      catLabel: (c) => global.MD3Lang.translateCategory(c),
      subLabel: (s) => global.MD3Lang.translateSub(s),
      cartSvg,
    };
  }

  function renderGrid(container, products, labels) {
    if (!container) return;
    const lbl = labels || defaultLabels();
    if (!products.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = products.map((p) => storeCardHtml(p, lbl)).join('');
  }

  global.MD3Shop = {
    esc,
    storeCardHtml,
    productImageBlock,
    addToCart,
    showToast,
    defaultLabels,
    renderGrid,
  };
})(typeof window !== 'undefined' ? window : globalThis);
