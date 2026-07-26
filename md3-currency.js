/**
 * Display prices in the visitor's device currency.
 * Admin always stores amounts in EUR.
 * Auto-detects from device timezone + locale; visitors can still override in the footer.
 */
(function (global) {
  const BASE = 'EUR';
  const STORAGE_KEY = 'md3_currency';
  const MANUAL_KEY = 'md3_currency_manual';

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
    ISK: 150,
    PLN: 4.35,
    CZK: 25.3,
    HUF: 395,
    RON: 4.97,
    BGN: 1.96,
    HRK: 7.53,
    RSD: 117,
    TRY: 35,
    UAH: 44,
    SAR: 4.08,
    AED: 4.0,
    QAR: 3.97,
    KWD: 0.33,
    BHD: 0.41,
    OMR: 0.42,
    EGP: 52,
    MAD: 10.9,
    TND: 3.35,
    ZAR: 20,
    JPY: 163,
    KRW: 1450,
    CNY: 7.9,
    HKD: 8.5,
    SGD: 1.46,
    TWD: 35,
    THB: 39,
    INR: 90,
    IDR: 17200,
    MYR: 5.1,
    PHP: 63,
    VND: 27000,
    BRL: 5.4,
    MXN: 18.5,
    ARS: 980,
    CLP: 1020,
    COP: 4300,
    PEN: 4.1,
  };

  /** Curated picker list (code + short label). */
  const CHOICES = [
    { code: 'EUR', label: 'EUR €' },
    { code: 'USD', label: 'USD $' },
    { code: 'GBP', label: 'GBP £' },
    { code: 'SEK', label: 'SEK kr' },
    { code: 'NOK', label: 'NOK kr' },
    { code: 'DKK', label: 'DKK kr' },
    { code: 'CHF', label: 'CHF' },
    { code: 'CAD', label: 'CAD $' },
    { code: 'AUD', label: 'AUD $' },
    { code: 'SAR', label: 'SAR' },
    { code: 'AED', label: 'AED' },
    { code: 'JPY', label: 'JPY ¥' },
  ];

  const REGION_CURRENCY = {
    US: 'USD', PR: 'USD', GU: 'USD', VI: 'USD', AS: 'USD', MP: 'USD',
    GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP',
    CH: 'CHF', LI: 'CHF',
    CA: 'CAD',
    AU: 'AUD', CX: 'AUD', CC: 'AUD', NF: 'AUD',
    NZ: 'NZD', CK: 'NZD', NU: 'NZD', TK: 'NZD',
    SE: 'SEK',
    NO: 'NOK', SJ: 'NOK',
    DK: 'DKK', FO: 'DKK', GL: 'DKK',
    IS: 'ISK',
    PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', HR: 'EUR',
    RS: 'RSD', TR: 'TRY', UA: 'UAH',
    SA: 'SAR', AE: 'AED', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
    EG: 'EGP', MA: 'MAD', TN: 'TND', ZA: 'ZAR',
    JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', SG: 'SGD', TW: 'TWD',
    TH: 'THB', IN: 'INR', ID: 'IDR', MY: 'MYR', PH: 'PHP', VN: 'VND',
    BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
    FR: 'EUR', DE: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR',
    AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR', LU: 'EUR', GR: 'EUR',
    SK: 'EUR', SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', CY: 'EUR',
    MT: 'EUR', AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR', ME: 'EUR',
    XK: 'EUR',
  };

  /** Device timezone → country (physical location signal). */
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
    'Europe/Reykjavik': 'IS',
    'Europe/Warsaw': 'PL',
    'Europe/Prague': 'CZ',
    'Europe/Budapest': 'HU',
    'Europe/Bucharest': 'RO',
    'Europe/Sofia': 'BG',
    'Europe/Zagreb': 'HR',
    'Europe/Belgrade': 'RS',
    'Europe/Istanbul': 'TR',
    'Europe/Kyiv': 'UA',
    'Europe/Kiev': 'UA',
    'Europe/Zurich': 'CH',
    'Europe/Vaduz': 'LI',
    'Europe/Luxembourg': 'LU',
    'Europe/Malta': 'MT',
    'Europe/Athens': 'GR',
    'Europe/Tallinn': 'EE',
    'Europe/Riga': 'LV',
    'Europe/Vilnius': 'LT',
    'Europe/Bratislava': 'SK',
    'Europe/Ljubljana': 'SI',
    'Europe/Andorra': 'AD',
    'Europe/Monaco': 'MC',
    'Atlantic/Reykjavik': 'IS',
    'Atlantic/Faroe': 'FO',
    'America/New_York': 'US',
    'America/Chicago': 'US',
    'America/Denver': 'US',
    'America/Los_Angeles': 'US',
    'America/Phoenix': 'US',
    'America/Anchorage': 'US',
    'America/Honolulu': 'US',
    'America/Toronto': 'CA',
    'America/Vancouver': 'CA',
    'America/Edmonton': 'CA',
    'America/Winnipeg': 'CA',
    'America/Halifax': 'CA',
    'America/Mexico_City': 'MX',
    'America/Sao_Paulo': 'BR',
    'America/Argentina/Buenos_Aires': 'AR',
    'America/Santiago': 'CL',
    'America/Bogota': 'CO',
    'America/Lima': 'PE',
    'Australia/Sydney': 'AU',
    'Australia/Melbourne': 'AU',
    'Australia/Brisbane': 'AU',
    'Australia/Perth': 'AU',
    'Australia/Adelaide': 'AU',
    'Pacific/Auckland': 'NZ',
    'Asia/Tokyo': 'JP',
    'Asia/Seoul': 'KR',
    'Asia/Shanghai': 'CN',
    'Asia/Hong_Kong': 'HK',
    'Asia/Singapore': 'SG',
    'Asia/Taipei': 'TW',
    'Asia/Bangkok': 'TH',
    'Asia/Kolkata': 'IN',
    'Asia/Jakarta': 'ID',
    'Asia/Kuala_Lumpur': 'MY',
    'Asia/Manila': 'PH',
    'Asia/Ho_Chi_Minh': 'VN',
    'Asia/Dubai': 'AE',
    'Asia/Riyadh': 'SA',
    'Asia/Qatar': 'QA',
    'Asia/Kuwait': 'KW',
    'Asia/Bahrain': 'BH',
    'Asia/Muscat': 'OM',
    'Africa/Cairo': 'EG',
    'Africa/Casablanca': 'MA',
    'Africa/Tunis': 'TN',
    'Africa/Johannesburg': 'ZA',
  };

  function languageTags() {
    if (typeof navigator === 'undefined') return ['fr-FR'];
    if (navigator.languages && navigator.languages.length) return [...navigator.languages];
    return [navigator.language || 'fr-FR'];
  }

  function regionFromTag(tag) {
    if (!tag) return '';
    try {
      const loc = new Intl.Locale(String(tag));
      if (loc.region) return loc.region.toUpperCase();
      if (typeof loc.maximize === 'function') {
        const max = loc.maximize();
        if (max.region) return max.region.toUpperCase();
      }
    } catch (_) {}
    const parts = String(tag).replace('_', '-').split('-');
    for (let i = 1; i < parts.length; i++) {
      if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
    }
    return '';
  }

  function regionFromTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (!tz) return '';
      if (TZ_REGION[tz]) return TZ_REGION[tz];
      // Continent/City fallbacks when exact city isn't mapped
      if (tz === 'Europe/Stockholm' || /Stockholm/i.test(tz)) return 'SE';
      if (tz.startsWith('America/Argentina')) return 'AR';
      if (tz.startsWith('America/')) {
        if (/Toronto|Vancouver|Montreal|Edmonton|Winnipeg|Halifax|Whitehorse|Iqaluit/i.test(tz)) return 'CA';
        if (/Mexico|Monterrey|Cancun|Tijuana|Merida|Chihuahua/i.test(tz)) return 'MX';
        if (/Sao_Paulo|Bahia|Belem|Fortaleza|Manaus|Recife|Noronha/i.test(tz)) return 'BR';
        return 'US';
      }
      if (tz.startsWith('Australia/')) return 'AU';
      if (tz.startsWith('Pacific/Auckland') || tz === 'Pacific/Chatham') return 'NZ';
      if (tz.startsWith('Asia/')) return '';
      if (tz.startsWith('Europe/')) return '';
    } catch (_) {}
    return '';
  }

  function regionFromLanguages() {
    for (const tag of languageTags()) {
      const region = regionFromTag(tag);
      if (region) return region;
    }
    return '';
  }

  /** Prefer device clock timezone (location), then language region settings. */
  function detectRegion() {
    return regionFromTimezone() || regionFromLanguages();
  }

  function detectCurrency() {
    const region = detectRegion();
    if (region && REGION_CURRENCY[region] && RATES[REGION_CURRENCY[region]]) {
      return REGION_CURRENCY[region];
    }
    // Last resort: try maximizing primary locale → region → currency
    try {
      const primary = languageTags()[0];
      const maxRegion = regionFromTag(primary);
      if (maxRegion && REGION_CURRENCY[maxRegion] && RATES[REGION_CURRENCY[maxRegion]]) {
        return REGION_CURRENCY[maxRegion];
      }
    } catch (_) {}
    return BASE;
  }

  function isManualOverride() {
    try {
      return localStorage.getItem(MANUAL_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function readStored() {
    if (!isManualOverride()) return null;
    try {
      const c = localStorage.getItem(STORAGE_KEY);
      if (c && RATES[c]) return c;
    } catch (_) {}
    return null;
  }

  function displayLocale() {
    return languageTags()[0] || 'fr-FR';
  }

  // Drop stale auto-saved currency so each device re-detects
  try {
    if (localStorage.getItem(MANUAL_KEY) !== '1') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (_) {}

  let manualOverride = readStored();
  let activeRegion = detectRegion();
  let activeCurrency = manualOverride || detectCurrency();

  function refreshCurrency() {
    activeRegion = detectRegion();
    manualOverride = readStored();
    activeCurrency = manualOverride || detectCurrency();
    syncSelectors();
  }

  function getCurrency() {
    return activeCurrency;
  }

  function getRegion() {
    return activeRegion;
  }

  function setCurrency(code, opts) {
    const next = String(code || '').toUpperCase();
    if (!RATES[next]) return false;
    activeCurrency = next;
    const auto = !!(opts && opts.auto);
    if (auto) {
      manualOverride = null;
      try {
        localStorage.removeItem(MANUAL_KEY);
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
    } else {
      manualOverride = next;
      try {
        localStorage.setItem(MANUAL_KEY, '1');
        localStorage.setItem(STORAGE_KEY, next);
      } catch (_) {}
    }
    syncSelectors();
    if (!(opts && opts.silent)) {
      try {
        window.dispatchEvent(
          new CustomEvent('md3-currency-changed', { detail: { currency: next } })
        );
      } catch (_) {}
    }
    return true;
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
    const noCents =
      activeCurrency === 'JPY' ||
      activeCurrency === 'KRW' ||
      activeCurrency === 'VND' ||
      activeCurrency === 'IDR' ||
      activeCurrency === 'CLP' ||
      activeCurrency === 'ISK';
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

  function choiceLabel(code) {
    const found = CHOICES.find((c) => c.code === code);
    if (found) return found.label;
    try {
      const parts = new Intl.NumberFormat(displayLocale(), {
        style: 'currency',
        currency: code,
        currencyDisplay: 'narrowSymbol',
      }).formatToParts(0);
      const sym = (parts.find((p) => p.type === 'currency') || {}).value || code;
      return `${code} ${sym}`.trim();
    } catch (_) {
      return code;
    }
  }

  function fillSelect(sel) {
    if (!sel || sel.tagName !== 'SELECT') return;
    const cur = getCurrency();
    if (!sel.options.length) {
      CHOICES.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.code;
        opt.textContent = c.label;
        sel.appendChild(opt);
      });
    }
    if (cur && RATES[cur] && !Array.from(sel.options).some((o) => o.value === cur)) {
      const opt = document.createElement('option');
      opt.value = cur;
      opt.textContent = choiceLabel(cur);
      sel.insertBefore(opt, sel.firstChild);
    }
    if (RATES[cur]) sel.value = cur;
    else sel.value = BASE;
  }

  function onSelectChange(e) {
    const sel = e.target;
    if (!sel || !sel.matches || !sel.matches('[data-md3-currency]')) return;
    setCurrency(sel.value);
  }

  function syncSelectors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    try {
      scope.querySelectorAll('[data-md3-currency]').forEach(fillSelect);
    } catch (_) {}
  }

  function mountSelectors(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('[data-md3-currency]').forEach((sel) => {
      fillSelect(sel);
      if (sel.dataset.md3CurrencyBound === '1') return;
      sel.dataset.md3CurrencyBound = '1';
      sel.addEventListener('change', onSelectChange);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        mountSelectors(document);
      });
    } else {
      mountSelectors(document);
    }
  }

  global.MD3Currency = {
    BASE,
    RATES,
    CHOICES,
    formatPrice,
    formatPriceInSiteLang,
    convertFromEur,
    getCurrency,
    getRegion,
    setCurrency,
    refreshCurrency,
    detectCurrency,
    detectRegion,
    choiceLabel,
    mountSelectors,
    syncSelectors,
  };
})(typeof window !== 'undefined' ? window : globalThis);
