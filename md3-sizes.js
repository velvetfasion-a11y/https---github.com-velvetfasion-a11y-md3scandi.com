/**
 * Product size helpers — shoe EU sizes vs clothing sizes.
 */
(function (global) {
  const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];
  const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  function getProductSizeType(p) {
    if (!p) return 'none';
    if (p.sizeType === 'shoes' || p.sizeType === 'clothes' || p.sizeType === 'none') return p.sizeType;
    const sub = String(p.sub || '').toLowerCase();
    const name = String(p.name || '').toLowerCase();
    if (/chaussure|shoe|sneaker|sandal|boot|footwear|chaussures/i.test(sub + ' ' + name)) return 'shoes';
    if (/vêtement|vetement|robe|dress|cloth|wear|top|pant|jupe|shirt|lin|textile/i.test(sub)) return 'clothes';
    if (p.category === 'Mode' && !/sac|bag|accessoire|bijou|jewel/i.test(sub)) return 'clothes';
    return 'none';
  }

  function sizeOptionsForType(type) {
    if (type === 'shoes') return SHOE_SIZES.slice();
    if (type === 'clothes') return CLOTHING_SIZES.slice();
    return [];
  }

  function normalizeSizeStock(p) {
    const type = getProductSizeType(p);
    if (type === 'none') return null;
    const options = sizeOptionsForType(type);
    const raw = p.sizeStock && typeof p.sizeStock === 'object' ? p.sizeStock : null;
    const stock = {};
    if (raw) {
      options.forEach((s) => {
        stock[s] = Math.max(0, parseInt(raw[s], 10) || 0);
      });
    } else {
      const legacy = Math.max(0, parseInt(p.stock, 10) || 0);
      options.forEach((s) => {
        stock[s] = 0;
      });
      if (legacy > 0) {
        const fallback = type === 'shoes'
          ? (options.includes('39') ? '39' : options[Math.floor(options.length / 2)])
          : (options.includes('M') ? 'M' : options[Math.floor(options.length / 2)]);
        stock[fallback] = legacy;
      }
    }
    return { type, options, stock };
  }

  function totalFromSizeStock(sizeStock) {
    if (!sizeStock || typeof sizeStock !== 'object') return 0;
    return Object.values(sizeStock).reduce((sum, n) => sum + Math.max(0, parseInt(n, 10) || 0), 0);
  }

  function syncProductStockFromSizes(p) {
    if (!p || typeof p !== 'object') return p;
    const norm = normalizeSizeStock(p);
    if (!norm) {
      p.sizeType = 'none';
      delete p.sizeStock;
      return p;
    }
    p.sizeType = norm.type;
    p.sizeStock = norm.stock;
    p.stock = totalFromSizeStock(norm.stock);
    return p;
  }

  function getSizeStock(p, size) {
    if (!p || !size) return 0;
    const norm = normalizeSizeStock(p);
    if (!norm) return Math.max(0, parseInt(p.stock, 10) || 0);
    return Math.max(0, parseInt(norm.stock[size], 10) || 0);
  }

  function productNeedsSize(p) {
    return getProductSizeType(p) !== 'none';
  }

  function cartLineKey(productId, size) {
    if (size) return String(productId) + '::' + encodeURIComponent(String(size));
    return String(productId);
  }

  function parseCartLineKey(key) {
    const raw = String(key);
    const sep = raw.indexOf('::');
    if (sep === -1) return { productId: raw, size: null };
    return {
      productId: raw.slice(0, sep),
      size: decodeURIComponent(raw.slice(sep + 2)),
    };
  }

  global.MD3Sizes = {
    SHOE_SIZES,
    CLOTHING_SIZES,
    getProductSizeType,
    sizeOptionsForType,
    normalizeSizeStock,
    totalFromSizeStock,
    syncProductStockFromSizes,
    getSizeStock,
    productNeedsSize,
    cartLineKey,
    parseCartLineKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
