/**
 * Display prices in the visitor's currency (device locale / region).
 * Admin always stores amounts in EUR.
 */
(function (global) {
  const BASE = 'EUR';

  /** EUR → target (approximate; refresh periodically). */
  const RATES = {
    EUR: 1,
    USD: 1.09,
    GBP: 0.86,
    CHF: 0.97,
    CAD: 1.48,
    AUD: 1.66,
    NZD: 1.78,
    SEK: 11.4,
    NOK: 11.7,
    DKK: 7.46,
    PLN: 4.35,
    CZK: 25.3,
    HUF: 395,
    RON: 4.97,
    BGN: 1.96,
    HRK: 7.53,
    SAR: 4.08,
    AED: 4.0,
    QAR: 3.97,
    KWD: 0.33,
    BHD: 0.41,
    OMR: 0.42,
    EGP: 52,
    MAD: 10.9,
    TND: 3.35,
    JPY: 163,
    KRW: 1450,
    INR: 90,
    BRL: 5.4,
    MXN: 18.5,
  };

  const REGION_CURRENCY = {
    US: 'USD', GB: 'GBP', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
    SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF',
    RO: 'RON', BG: 'BGN', HR: 'HRK',
    SA: 'SAR', AE: 'AED', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
    EG: 'EGP', MA: 'MAD', TN: 'TND',
    JP: 'JPY', KR: 'KRW', IN: 'INR', BR: 'BRL', MX: 'MXN',
    FR: 'EUR', DE: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR',
    AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR', LU: 'EUR', GR: 'EUR',
    SK: 'EUR', SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', CY: 'EUR', MT: 'EUR',
  };

  const LANG_FALLBACK = { fr: 'EUR', en: 'USD', ar: 'SAR' };

  function regionFromTag(tag) {
    try {
      const loc = new Intl.Locale(tag);
      if (loc.region) return loc.region.toUpperCase();
    } catch (_) {}
    const part = (tag || '').split('-')[1];
    return part ? part.toUpperCase() : '';
  }

  function detectCurrency() {
    const tags = navigator.languages?.length
      ? [...navigator.languages]
      : [navigator.language || 'fr-FR'];
    for (const tag of tags) {
      const region = regionFromTag(tag);
      if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    }
    if (global.MD3Lang && typeof global.MD3Lang.getLang === 'function') {
      const fb = LANG_FALLBACK[global.MD3Lang.getLang()];
      if (fb) return fb;
    }
    return BASE;
  }

  let activeCurrency = detectCurrency();

  function refreshCurrency() {
    activeCurrency = detectCurrency();
  }

  function getCurrency() {
    return activeCurrency;
  }

  function convertFromEur(amountEur) {
    const n = Number(amountEur);
    if (!Number.isFinite(n)) return 0;
    const rate = RATES[activeCurrency];
    if (!rate) return n;
    return n * rate;
  }

  function formatPrice(amountEur) {
    const value = convertFromEur(amountEur);
    const locale =
      (navigator.languages && navigator.languages[0]) ||
      navigator.language ||
      'fr-FR';
    const noCents = activeCurrency === 'JPY' || activeCurrency === 'KRW';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: activeCurrency,
        minimumFractionDigits: noCents ? 0 : 0,
        maximumFractionDigits: noCents ? 0 : 2,
      }).format(value);
    } catch (_) {
      return `${value.toFixed(noCents ? 0 : 2)} ${activeCurrency}`;
    }
  }

  global.MD3Currency = {
    BASE,
    RATES,
    formatPrice,
    convertFromEur,
    getCurrency,
    refreshCurrency,
    detectCurrency,
  };
})(typeof window !== 'undefined' ? window : globalThis);
