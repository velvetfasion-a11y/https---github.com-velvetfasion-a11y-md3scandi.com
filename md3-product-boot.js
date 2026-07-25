/** Product detail page — deferred boot (runs after store / lang / shop-render). */
(function () {
  let qty = 1;
  let selectedSize = null;
  let currentProductId = null;
  let currentProductNeedsSize = false;
  let currentProductImages = [];
  let currentProductImageIndex = 0;
  let currentProductStock = 0;
  let productPaintedId = null;
  let productPaintedImageKey = '';
  let loadGaveUp = false;
  const LOAD_GIVE_UP_MS = 2500;
  const L = (k) => MD3Lang.t(k);
  const cartSvg =
    '<svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>';

  function imageRank(url) {
    const s = String(url || '');
    if (/^https?:\/\//i.test(s)) return 0;
    if (s.startsWith('images/') || s.startsWith('/')) return 1;
    if (s.startsWith('data:image')) return 3;
    if (s) return 2;
    return 9;
  }

  function productIdFromUrl() {
    return new URLSearchParams(location.search).get('id');
  }

  function setQty(n) {
    const msg = document.getElementById('productQtyMsg');
    const max = Math.max(1, Number(currentProductStock) || 1);
    if (n > max) {
      qty = max;
      if (msg) {
        msg.textContent = L('product-last-item');
        msg.hidden = false;
      }
    } else {
      qty = Math.max(1, n);
      if (msg) msg.hidden = true;
    }
    const el = document.getElementById('productQty');
    if (el) el.textContent = qty;
  }

  async function addProductToCart(id) {
    const p = MD3Store.getProductById(id);
    if (!p || !p.stock) return;
    if (currentProductNeedsSize && !selectedSize) {
      MD3Shop.showToast(L('size-pick'));
      return;
    }
    let added = 0;
    for (let i = 0; i < qty; i++) {
      const res = await MD3Store.addToCart(id, selectedSize || undefined);
      if (!res.ok) {
        if (res.reason === 'size') MD3Shop.showToast(L('size-pick'));
        else if (res.reason === 'out') MD3Shop.showToast(L('cart-out-stock'));
        else if (res.reason === 'max') MD3Shop.showToast(L('cart-max-stock'));
        break;
      }
      added++;
    }
    if (added > 0) {
      MD3Header.updateCartBadge();
      MD3Shop.showToast(L('cart-added-qty').replace('%n', String(added)));
    }
  }

  function pickProductSize(size) {
    if (!window.MD3Sizes) return;
    const p = MD3Store.getProductById(currentProductId);
    if (!p) return;
    const avail = MD3Sizes.getSizeStock(p, size);
    if (avail <= 0) return;
    selectedSize = size;
    currentProductStock = avail;
    qty = Math.min(qty, avail);
    const qtyEl = document.getElementById('productQty');
    if (qtyEl) qtyEl.textContent = qty;
    const msg = document.getElementById('productQtyMsg');
    if (msg) msg.hidden = true;
    document.querySelectorAll('.product-size-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.size === size);
    });
    const addBtn = document.querySelector('.product-btn-add');
    if (addBtn) addBtn.disabled = false;
    const hint = document.getElementById('productSizeHint');
    if (hint) hint.hidden = true;
  }

  function renderProduct() {
    const id = productIdFromUrl();
    const wrap = document.getElementById('productWrap');
    if (!wrap) return false;
    const p = MD3Store.getProductById(id);
    const cloudDone = MD3Store.isCloudSynced && MD3Store.isCloudSynced();
    const hidden = !!(p && MD3Store.isProductHidden && MD3Store.isProductHidden(p));

    if (!p) {
      // Keep Loading until cloud/hydrate finishes — never flash "not found" too early
      if (!cloudDone && !loadGaveUp) {
        if (!wrap.querySelector('[data-product-loading]')) {
          wrap.innerHTML = `<p class="shop-empty-state" style="grid-column:1/-1" data-product-loading="1" data-i18n="product-loading">${L('product-loading')}</p>`;
        }
        productPaintedId = null;
        productPaintedImageKey = '';
        return false;
      }
      wrap.innerHTML = `<p class="shop-empty-state" style="grid-column:1/-1">${L('product-not-found')}</p>`;
      productPaintedId = null;
      productPaintedImageKey = '';
      return false;
    }

    if (hidden) {
      // Only treat as missing after sync — avoids false "not found" during cache races
      if (!cloudDone && !loadGaveUp) {
        if (!wrap.querySelector('[data-product-loading]')) {
          wrap.innerHTML = `<p class="shop-empty-state" style="grid-column:1/-1" data-product-loading="1" data-i18n="product-loading">${L('product-loading')}</p>`;
        }
        return false;
      }
      wrap.innerHTML = `<p class="shop-empty-state" style="grid-column:1/-1">${L('product-not-found')}</p>`;
      productPaintedId = null;
      productPaintedImageKey = '';
      return false;
    }

    const imagesPreview = MD3Store.normalizeProductImages
      ? MD3Store.normalizeProductImages(p)
      : p.image
        ? [p.image]
        : [];
    const nextImageKey =
      String(p.id) +
      ':' +
      imagesPreview.map((s) => String(s || '').slice(-40)).join(',');

    // Avoid wiping the gallery while the user interacts, if same product+images already painted
    if (
      productPaintedId != null &&
      String(productPaintedId) === String(p.id) &&
      productPaintedImageKey === nextImageKey &&
      wrap.querySelector('.product-ptitle')
    ) {
      return true;
    }

    // Soft-upgrade: swap gallery sources when HTTPS replaces data: (no full remount)
    if (
      productPaintedId != null &&
      String(productPaintedId) === String(p.id) &&
      wrap.querySelector('.product-ptitle') &&
      imagesPreview.length
    ) {
      const frames = wrap.querySelectorAll('.product-gallery-frame img');
      if (frames.length === imagesPreview.length) {
        let upgraded = false;
        imagesPreview.forEach((next, i) => {
          const el = frames[i];
          if (!el || !next) return;
          const cur = el.getAttribute('src') || '';
          if (cur !== next && (cur.startsWith('data:') || imageRank(cur) > imageRank(next))) {
            el.src = next;
            upgraded = true;
          }
        });
        if (upgraded || productPaintedImageKey === nextImageKey) {
          currentProductImages = imagesPreview;
          productPaintedImageKey = nextImageKey;
          return true;
        }
      }
      if (productPaintedImageKey === nextImageKey) return true;
    }

    const prevSize = selectedSize;
    const prevQty = qty;
    const displayName = MD3Store.productDisplayName
      ? MD3Store.productDisplayName(p)
      : MD3Lang.productName
        ? MD3Lang.productName(p)
        : p.name;
    document.title = 'MD3 Scandi — ' + displayName;
    currentProductId = p.id;
    const SZ = window.MD3Sizes;
    currentProductNeedsSize = !!(SZ && SZ.productNeedsSize(p));
    selectedSize = null;
    const out = !p.stock;
    currentProductStock = Number(p.stock) || 0;
    qty = 1;
    const images = imagesPreview;
    currentProductImages = images;
    currentProductImageIndex = 0;
    // Multi: carousel + hover arrows (fashion PDP). Single: one still.
    const multi = images.length > 1;
    const chevronPrev =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
    const chevronNext =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
    const gallery =
      images.length > 0
        ? `<div class="product-gallery${multi ? ' product-gallery--multi' : ''}" aria-label="${MD3Shop.esc(displayName)}">
            <div class="product-gallery-stage">
              ${
                multi
                  ? `<button type="button" class="product-gallery-nav product-gallery-nav--prev" id="productGalleryPrev" aria-label="Previous photo" onclick="navigateProductPhoto(-1)">${chevronPrev}</button>
                     <button type="button" class="product-gallery-nav product-gallery-nav--next" id="productGalleryNext" aria-label="Next photo" onclick="navigateProductPhoto(1)">${chevronNext}</button>`
                  : ''
              }
              <div class="product-gallery-track" id="productGalleryTrack" role="list">
                ${images
                  .map(
                    (src, idx) => `
                  <figure class="product-gallery-frame" role="listitem" data-index="${idx}">
                    <img
                      src="${MD3Shop.esc(src)}"
                      alt="${MD3Shop.esc(displayName)}${multi ? ' — ' + (idx + 1) : ''}"
                      class="product-photo${idx === 0 ? ' product-photo--hero' : ''}"
                      width="900"
                      height="1200"
                      ${idx === 0 ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"'}
                      draggable="false"
                    />
                  </figure>`
                  )
                  .join('')}
              </div>
            ${
              multi
                ? `<div class="product-gallery-chrome">
                    <div class="product-gallery-dots" id="productGalleryDots" role="tablist" aria-label="Photos">
                      ${images
                        .map(
                          (_, idx) =>
                            `<button type="button" class="product-gallery-dot${idx === 0 ? ' is-active' : ''}" role="tab" aria-selected="${idx === 0 ? 'true' : 'false'}" aria-label="${idx + 1}" onclick="setProductPhoto(${idx})"></button>`
                        )
                        .join('')}
                    </div>
                    <span class="product-gallery-count" id="productGalleryCount">1 / ${images.length}</span>
                  </div>`
                : ''
            }
            </div>
          </div>`
        : `<div class="product-gallery"><div class="product-gallery-stage"><div class="product-gallery-track"><div class="product-gallery-frame product-gallery-frame--empty"><div class="product-ebig">${MD3Shop.esc(p.emoji || '✦')}</div></div></div></div></div>`;
    const catLine = [MD3Lang.translateCategory(p.category), MD3Lang.translateSub(p.sub)]
      .filter(Boolean)
      .join(' · ');
    const localizedDesc = MD3Lang.productDesc ? MD3Lang.productDesc(p) : p.desc || '';
    const desc = localizedDesc || L('product-desc-fallback').replace('%s', displayName);
    let sizeBlock = '';
    if (currentProductNeedsSize && SZ) {
      const type = SZ.getProductSizeType(p);
      const options = SZ.sizeOptionsForType(type);
      const sizeLabel = type === 'shoes' ? L('size-shoes') : L('size-clothes');
      sizeBlock = `<div class="product-size-row">
        <span class="product-size-lbl">${MD3Shop.esc(sizeLabel)}</span>
        <div class="product-size-grid">${options
          .map((s) => {
            const avail = SZ.getSizeStock(p, s);
            const disabled = avail <= 0;
            if (disabled) {
              return `<button type="button" class="product-size-btn product-size-btn--soldout" data-size="${MD3Shop.esc(s)}" disabled aria-disabled="true">
                <span class="product-size-code">${MD3Shop.esc(s)}</span>
                <span class="product-size-soldout">${MD3Shop.esc(L('size-sold-out'))}</span>
              </button>`;
            }
            return `<button type="button" class="product-size-btn" data-size="${MD3Shop.esc(s)}" onclick="pickProductSize('${String(s).replace(/'/g, "\\'")}')">
              <span class="product-size-code">${MD3Shop.esc(s)}</span>
            </button>`;
          })
          .join('')}</div>
        <p class="product-size-hint" id="productSizeHint" hidden>${MD3Shop.esc(L('size-pick'))}</p>
      </div>`;
    }

    wrap.innerHTML = `
      ${gallery}
      <div class="product-info">
        ${catLine ? `<div class="product-pcat">${MD3Shop.esc(catLine)}</div>` : ''}
        <h1 class="product-ptitle">${MD3Shop.esc(displayName)}</h1>
        <div class="product-ppr">
          <span class="product-pp">${MD3Currency.formatPrice(p.price)}</span>
          <span class="product-ppn">${L('price-incl')}</span>
        </div>
        <div class="product-pstk ${out ? 'out' : 'in'}">${out ? L('stock-out-lbl') : L('stock-in')}</div>
        <p class="product-pdesc">${MD3Shop.esc(desc)}</p>
        ${sizeBlock}
        <div class="product-qrow">
          <span class="product-qlbl">${L('label-qty')}</span>
          <div class="product-qctl">
            <button type="button" class="product-qb" onclick="setQty(qty - 1)">−</button>
            <span class="product-qn" id="productQty">1</span>
            <button type="button" class="product-qb" onclick="setQty(qty + 1)">+</button>
          </div>
        </div>
        <p class="product-qmsg" id="productQtyMsg" hidden></p>
        <button type="button" class="product-btn-add" ${out || currentProductNeedsSize ? 'disabled' : ''} onclick="addProductToCart(${p.id})">
          ${cartSvg}${L('cart-add')}
        </button>
      </div>`;
    productPaintedId = p.id;
    productPaintedImageKey = nextImageKey;
    bindProductGallerySwipe();
    if (prevSize && currentProductNeedsSize && SZ) {
      const avail = SZ.getSizeStock(p, prevSize);
      if (avail > 0) {
        selectedSize = prevSize;
        currentProductStock = avail;
        qty = Math.min(Math.max(1, prevQty || 1), avail);
        document.querySelectorAll('.product-size-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.size === prevSize);
        });
        const qtyEl = document.getElementById('productQty');
        if (qtyEl) qtyEl.textContent = qty;
        const addBtn = document.querySelector('.product-btn-add');
        if (addBtn) addBtn.disabled = false;
      }
    } else if (!currentProductNeedsSize && prevQty > 1) {
      setQty(Math.min(prevQty, currentProductStock || 1));
    }
    return true;
  }

  function updateProductGalleryChrome(index) {
    currentProductImageIndex = index;
    document.querySelectorAll('.product-gallery-dot').forEach((el, idx) => {
      const on = idx === index;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const count = document.getElementById('productGalleryCount');
    if (count && currentProductImages.length) {
      count.textContent = index + 1 + ' / ' + currentProductImages.length;
    }
  }

  function bindProductGallerySwipe() {
    const track = document.getElementById('productGalleryTrack');
    if (!track || track.dataset.md3Bound === '1') return;
    track.dataset.md3Bound = '1';
    let ticking = false;
    track.addEventListener(
      'scroll',
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          const w = track.clientWidth || 1;
          const idx = Math.round(track.scrollLeft / w);
          if (idx !== currentProductImageIndex) updateProductGalleryChrome(idx);
        });
      },
      { passive: true }
    );
  }

  function refreshProductGalleryControls() {
    updateProductGalleryChrome(currentProductImageIndex);
  }

  function setProductPhoto(index) {
    const src = currentProductImages[index];
    if (!src) return;
    updateProductGalleryChrome(index);
    const track = document.getElementById('productGalleryTrack');
    const frame = document.querySelectorAll('.product-gallery-frame')[index];
    if (!frame || !track) return;
    track.scrollTo({ left: frame.offsetLeft, behavior: 'smooth' });
  }

  function navigateProductPhoto(delta) {
    const total = currentProductImages.length;
    if (total <= 1) return;
    setProductPhoto((currentProductImageIndex + delta + total) % total);
  }

  function bootChrome() {
    if (typeof MD3Header !== 'undefined') {
      MD3Header.updateCartBadge();
      MD3Header.updateAuth();
    }
  }

  function boot() {
    renderProduct();
    bootChrome();
  }

  function forceRenderProduct() {
    productPaintedId = null;
    productPaintedImageKey = '';
    renderProduct();
    bootChrome();
  }

  async function hydrateUntilFound(id, attempts) {
    if (!id || !MD3Store.hydrateProductById) return null;
    const max = attempts || 4;
    for (let i = 0; i < max; i++) {
      try {
        const p = await MD3Store.hydrateProductById(id);
        if (p && !(MD3Store.isProductHidden && MD3Store.isProductHidden(p))) {
          forceRenderProduct();
          return p;
        }
        if (p) {
          forceRenderProduct();
          return p;
        }
      } catch (e) {
        console.error('hydrateUntilFound', e);
      }
      await new Promise(function (r) {
        setTimeout(r, 280 + i * 220);
      });
    }
    return null;
  }

  window.setQty = setQty;
  window.addProductToCart = addProductToCart;
  window.setProductPhoto = setProductPhoto;
  window.navigateProductPhoto = navigateProductPhoto;
  window.pickProductSize = pickProductSize;
  Object.defineProperty(window, 'qty', {
    get() {
      return qty;
    },
    set(v) {
      qty = v;
    },
    configurable: true,
  });

  MD3Lang.init({
    onChange() {
      if (typeof MD3Currency !== 'undefined') MD3Currency.refreshCurrency();
      MD3Lang.refreshUI();
      forceRenderProduct();
    },
  });

  try {
    if (MD3Store.ensureCaches) MD3Store.ensureCaches();
  } catch (e) {}

  // Paint from local cache immediately if possible
  boot();

  // Parallel: hydrate this product via REST ASAP (do not wait for full catalog)
  const earlyId = productIdFromUrl();
  if (earlyId) {
    hydrateUntilFound(earlyId, 5).then(function (p) {
      if (!p) forceRenderProduct();
    });
  }

  // Safety: leave Loading after a short wait, then keep retrying hydrate
  setTimeout(function () {
    if (productPaintedId) return;
    loadGaveUp = true;
    forceRenderProduct();
    if (earlyId && !MD3Store.getProductById(earlyId)) {
      hydrateUntilFound(earlyId, 3);
    }
  }, LOAD_GIVE_UP_MS);

  MD3Store.init()
    .then(function () {
      forceRenderProduct();
      if (earlyId && !productPaintedId) hydrateUntilFound(earlyId, 3);
    })
    .catch(function () {
      forceRenderProduct();
    });

  window.addEventListener('md3-products-updated', forceRenderProduct);
  window.addEventListener('md3-cloud-ready', forceRenderProduct);
  window.addEventListener('md3-carts-updated', function () {
    if (typeof MD3Header !== 'undefined') MD3Header.updateCartBadge();
  });
})();
