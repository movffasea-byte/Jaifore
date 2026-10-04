/* ================================
   JAIFORE — CURRENCY DETECTOR
   scripts/currency.js

   BASE CURRENCY IS USD. Every price in the database, in the cart, and every
   amount charged through Stripe is in US dollars. Visitors in other countries
   are shown an ESTIMATE in their own currency (live exchange rate), but they
   are always charged in USD (or, at Stripe's own checkout page, in the local
   amount Stripe shows them with Adaptive Pricing enabled).

   - Country + rate are cached in localStorage for 12 hours, so pages don't
     re-fetch on every navigation and prices don't flicker.
   - Both network calls have a timeout, so a slow geo/rate service can never
     hold up a page that waits on JaiforeCurrency.init().
   - init() is idempotent: calling it from several scripts on one page only
     does the work once and every caller gets the same promise.
   ================================ */

const EXCHANGE_API_KEY = '18fefffb14881d99346b100d';
const BASE_CURRENCY    = 'USD'; // all prices stored in USD (database truth)

const FX_CACHE_KEY     = 'jaifore_fx_v1';
const FX_CACHE_TTL_MS  = 12 * 60 * 60 * 1000; // 12 hours
const FX_FAIL_TTL_MS   = 10 * 60 * 1000;      // after a failed lookup, don't retry for 10 min
const FX_TIMEOUT_MS    = 3500;

const USD_INFO = { code: 'USD', symbol: '$', name: 'US Dollar' };

// ── CURRENCY MAP BY COUNTRY ──────────────────────────
const COUNTRY_CURRENCY = {
  US: USD_INFO,
  GB: { code: 'GBP', symbol: '£',  name: 'British Pound' },
  EU: { code: 'EUR', symbol: '€',  name: 'Euro' },
  DE: { code: 'EUR', symbol: '€',  name: 'Euro' },
  FR: { code: 'EUR', symbol: '€',  name: 'Euro' },
  IT: { code: 'EUR', symbol: '€',  name: 'Euro' },
  ES: { code: 'EUR', symbol: '€',  name: 'Euro' },
  NL: { code: 'EUR', symbol: '€',  name: 'Euro' },
  BE: { code: 'EUR', symbol: '€',  name: 'Euro' },
  AT: { code: 'EUR', symbol: '€',  name: 'Euro' },
  IE: { code: 'EUR', symbol: '€',  name: 'Euro' },
  PT: { code: 'EUR', symbol: '€',  name: 'Euro' },
  FI: { code: 'EUR', symbol: '€',  name: 'Euro' },
  GR: { code: 'EUR', symbol: '€',  name: 'Euro' },
  LU: { code: 'EUR', symbol: '€',  name: 'Euro' },
  CA: { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  AU: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  NG: { code: 'NGN', symbol: '₦',  name: 'Nigerian Naira' },
  GH: { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  KE: { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  ZA: { code: 'ZAR', symbol: 'R',  name: 'South African Rand' },
  IN: { code: 'INR', symbol: '₹',  name: 'Indian Rupee' },
  CN: { code: 'CNY', symbol: '¥',  name: 'Chinese Yuan' },
  JP: { code: 'JPY', symbol: '¥',  name: 'Japanese Yen' },
  BR: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  MX: { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
  AE: { code: 'AED', symbol: 'AED', name: 'UAE Dirham' },
  SA: { code: 'SAR', symbol: 'SR', name: 'Saudi Riyal' },
  SG: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  MY: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit' },
  PK: { code: 'PKR', symbol: '₨',  name: 'Pakistani Rupee' },
  EG: { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound' },
  TZ: { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling' },
  UG: { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling' },
  ET: { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr' },
  CM: { code: 'XAF', symbol: 'FCFA', name: 'CFA Franc' },
  SN: { code: 'XOF', symbol: 'CFA', name: 'CFA Franc' },
};

// ── STATE ────────────────────────────────────────────
let exchangeRate        = 1;
let currencyInfo        = USD_INFO;
let currencyReady       = false;
let currencyInitPromise = null;

// ── CACHE HELPERS ────────────────────────────────────
function readFxCache() {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.code || !cached.rate || Date.now() > cached.expires) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeFxCache(code, rate, country, ttlMs = FX_CACHE_TTL_MS) {
  try {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({
      code, rate, country, expires: Date.now() + ttlMs
    }));
  } catch { /* storage full or blocked — just skip caching */ }
}

async function fetchJsonWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function useUSD() {
  exchangeRate = 1;
  currencyInfo = USD_INFO;
}

// ── INIT ─────────────────────────────────────────────
function initCurrency() {
  if (currencyInitPromise) return currencyInitPromise;

  currencyInitPromise = (async () => {
    try {
      const cached = readFxCache();

      if (cached) {
        currencyInfo = Object.values(COUNTRY_CURRENCY).find(c => c.code === cached.code) || USD_INFO;
        exchangeRate = currencyInfo.code === 'USD' ? 1 : cached.rate;
      } else {
        // Step 1 — detect country via IP
        const geoData     = await fetchJsonWithTimeout('https://ipapi.co/json/', FX_TIMEOUT_MS);
        const countryCode = geoData.country_code;

        // Step 2 — currency for that country (unknown country → USD, the base)
        const detected = COUNTRY_CURRENCY[countryCode] || USD_INFO;

        if (detected.code === BASE_CURRENCY) {
          useUSD();
          writeFxCache('USD', 1, countryCode);
        } else {
          // Step 3 — live rate from USD to the visitor's currency
          const rateData = await fetchJsonWithTimeout(
            `https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/pair/${BASE_CURRENCY}/${detected.code}`,
            FX_TIMEOUT_MS
          );

          if (rateData.result === 'success' && rateData.conversion_rate > 0) {
            currencyInfo = detected;
            exchangeRate = rateData.conversion_rate;
            writeFxCache(detected.code, exchangeRate, countryCode);
          } else {
            useUSD();
            writeFxCache('USD', 1, countryCode, FX_FAIL_TTL_MS);
          }
        }
      }
    } catch {
      // Geo or rate service failed/timed out — show plain USD, retry in 10 min
      useUSD();
      writeFxCache('USD', 1, null, FX_FAIL_TTL_MS);
    }

    currencyReady = true;
    applyToPage();
    window.dispatchEvent(new CustomEvent('jaifore:currency-ready'));
  })();

  return currencyInitPromise;
}

// ── FORMAT PRICE ─────────────────────────────────────
// amountUSD is the raw database price (always USD, the source of truth).
// For non-USD visitors this is an ESTIMATE — they are charged in USD.
function formatPrice(amountUSD) {
  const amount = Number(amountUSD);
  if (!Number.isFinite(amount)) return `${currencyInfo.symbol}0.00`;

  const converted = amount * exchangeRate;

  if (currencyInfo.code === 'USD') {
    return `${currencyInfo.symbol}${converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const formatted = converted >= 1000
    ? converted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currencyInfo.symbol}${formatted}`;
}

// Exact USD amount — what the customer is actually charged.
function formatUSD(amountUSD) {
  const amount = Number(amountUSD);
  const safe   = Number.isFinite(amount) ? amount : 0;
  return `$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// True when the visitor is being shown an estimate in a non-USD currency.
function isConvertedCurrency() {
  return currencyReady && currencyInfo.code !== 'USD';
}

// ── APPLY TO PAGE ─────────────────────────────────────
// Elements can carry the raw USD amount in data-price-usd. The old
// data-price-ngn attribute is still honoured so existing markup keeps working,
// but the number in it is now treated as USD (the database values are USD).
function applyToPage() {
  document.querySelectorAll('[data-price-usd], [data-price-ngn]').forEach(el => {
    const raw    = el.dataset.priceUsd ?? el.dataset.priceNgn;
    const amount = parseFloat(raw);
    if (!isNaN(amount)) el.textContent = formatPrice(amount);
  });

  const badge = document.getElementById('currencyBadge');
  if (badge) {
    badge.textContent = currencyInfo.code;
    badge.title       = currencyInfo.code === 'USD'
      ? currencyInfo.name
      : `${currencyInfo.name} — estimate only. You are charged in USD.`;
  }
}

// ── EXPOSE GLOBALLY ───────────────────────────────────
window.JaiforeCurrency = {
  init:        initCurrency,
  format:      formatPrice,
  formatUSD:   formatUSD,
  getRate:     () => exchangeRate,
  getInfo:     () => currencyInfo,
  isReady:     () => currencyReady,
  isConverted: isConvertedCurrency,
  note:        () => isConvertedCurrency()
    ? `Prices in ${currencyInfo.code} are estimates. You are charged in USD.`
    : '',
  applyToPage
};