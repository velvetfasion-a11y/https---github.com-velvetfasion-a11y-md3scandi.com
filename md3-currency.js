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

  const TZ_REGION = {
    'Europe/Paris': 'FR',
    'Europe/Berlin': 'DE',
    'Europe/Madrid': 'ES',
    'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL',
    'Europe/Brussels': 'BE',
    'Europe/Vienna': 'AT',
    'Europe/Lisbon': 'PT',
    'Europe/Dublin': 'IE',
    'Europe/Helsinki': 'FI',
    'Europe/London': 'GB',
    'Europe/Stockholm': 'SE',
    'Europe/Oslo': 'NO',
    'Europe/Copenhagen': 'DK',
    'Europe/Warsaw': 'PL',
    'Europe/Prague': 'CZ',
    'Europe/Budapest': 'HU',
    'Europe/Bucharest': 'RO',
    'Europe/Sofia': 'BG',
    'Europe/Zagreb': 'HR',
    'Europe/Zurich': 'CH',
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Los_Angeles': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    'America/Mexico_City': 'MX',
    'America/Sao_Paulo': 'BR',
    'Australia/Sydney': 'AU',
    'Australia/Melbourne': 'AU',
    'Pacific/Auckland': 'NZ',
    'Asia/Tokyo': 'JP',
    'Asia/Seoul': 'KR',
    'Asia/Kolkata': 'IN',
    'Asia/Dubai': 'AE',
    'Asia/Riyadh': 'SA',
    'Asia/Qatar': 'QA',
    'Asia/Kuwait': 'KW',
    'Asia/Bahrain': 'BH',
    'Asia/Muscat': 'OM',
    'Africa/Cairo': 'EG',
    'Africa/Casablanca': 'MA',
    'Africa/Tunis': 'TN',
  };

  const LANG_FALLBACK = { fr: 'EUR', en: 'USD', ar: 'SAR' };

  function languageTags() {
    if (typeof navigator === 'undefined') return ['fr-FR'];
    if (navigator.languages && navigator.languages.length) return [...navigator.languages];
    return [navigator.language || 'fr-FR'];
  }

  function regionFromTag(tag) {
    try {
      const loc = new Intl.Locale(tag);
      if (loc.region) return loc.region.toUpperCase();
      if (typeof loc.maximize === 'function') {
        const max = loc.maximize();
        if (max.region) return max.region.toUpperCase();
      }
    } catch (_) {}
    const part = (tag || '').split('-')[1];
    return part ? part.toUpperCase() : '';
  }

  function regionFromTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (TZ_REGION[tz]) return TZ_REGION[tz];
      if (tz.startsWith('Europe/')) return 'FR';
      if (tz.startsWith('America/')) return 'US';
      if (tz.startsWith('Australia/')) return 'AU';
      if (tz.startsWith('Pacific/Auckland')) return 'NZ';
    } catch (_) {}
    return '';
  }

  function detectRegion() {
    for (const tag of languageTags()) {
      const region = regionFromTag(tag);
      if (region) return region;
    }
    return regionFromTimezone();
  }

  function detectCurrency() {
    const region = detectRegion();
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    if (global.MD3Lang && typeof global.MD3Lang.getLang === 'function') {
      const fb = LANG_FALLBACK[global.MD3Lang.getLang()];
      if (fb) return fb;
    }
    return BASE;
  }

  function displayLocale() {
    return languageTags()[0] || 'fr-FR';
  }

  let activeCurrency = detectCurrency();
  let activeRegion = detectRegion();

  function refreshCurrency() {
    activeRegion = detectRegion();
    activeCurrency = detectCurrency();
  }

  function getCurrency() {
    return activeCurrency;
  }

  function getRegion() {
    return activeRegion;
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
    const locale = displayLocale();
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

  /** Admin / back-office — always EUR. */
  function formatPriceInSiteLang(amountEur) {
    const n = Number(amountEur);
    if (!Number.isFinite(n)) return '';
    const lang = global.MD3Lang && global.MD3Lang.getLang ? global.MD3Lang.getLang() : 'fr';
    const locale = lang === 'ar' ? 'ar-SA' : lang === 'en' ? 'en-GB' : 'fr-FR';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: BASE,
        minimumFractionDigits: 0,
        maximumFractionDigits: n % 1 === 0 ? 0 : 2,
      }).format(n);
    } catch (_) {
      return `${n} €`;
    }
  }

  global.MD3Currency = {
    BASE,
    RATES,
    formatPrice,
    formatPriceInSiteLang,
    convertFromEur,
    getCurrency,
    getRegion,
    refreshCurrency,
    detectCurrency,
    detectRegion,
  };
})(typeof window !== 'undefined' ? window : globalThis);
