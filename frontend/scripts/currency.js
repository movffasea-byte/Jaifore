/* ================================
   JAIFORE — CURRENCY DETECTOR
   scripts/currency.js
   ================================ */

const EXCHANGE_API_KEY = '18fefffb14881d99346b100d';
const BASE_CURRENCY    = 'USD'; // all prices stored in USD

// ── CURRENCY MAP BY COUNTRY ──────────────────────────
const COUNTRY_CURRENCY = {
  US: { code: 'USD', symbol: '$',  name: 'US Dollar' },
  GB: { code: 'GBP', symbol: '£',  name: 'British Pound' },
  EU: { code: 'EUR', symbol: '€',  name: 'Euro' },
  DE: { code: 'EUR', symbol: '€',  name: 'Euro' },
  FR: { code: 'EUR', symbol: '€',  name: 'Euro' },
  IT: { code: 'EUR', symbol: '€',  name: 'Euro' },
  ES: { code: 'EUR', symbol: '€',  name: 'Euro' },
  NL: { code: 'EUR', symbol: '€',  name: 'Euro' },
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
let exchangeRate  = 1;
currencyInfo  = { code: 'USD', symbol: '$', name: 'US Dollar' };
let currencyReady = false;

// ── INIT ─────────────────────────────────────────────
async function initCurrency() {
  try {
    // Step 1 — detect country via IP
    const geoRes     = await fetch('https://ipapi.co/json/');
    const geoData    = await geoRes.json();
    const countryCode = geoData.country_code || 'NG';

    // Step 2 — get currency for country
    const detected = COUNTRY_CURRENCY[countryCode] || { code: 'USD', symbol: '$', name: 'US Dollar' };
    currencyInfo   = detected;

    // Step 3 — if same as base, rate = 1
    if (detected.code === BASE_CURRENCY) {
      exchangeRate  = 1;
      currencyReady = true;
      applyToPage();
      return;
    }

    // Step 4 — fetch live exchange rate from NGN to target
    const rateRes  = await fetch(`https://v6.exchangerate-api.com/v6/${EXCHANGE_API_KEY}/pair/${BASE_CURRENCY}/${detected.code}`);
    const rateData = await rateRes.json();

    if (rateData.result === 'success') {
      exchangeRate = rateData.conversion_rate;
    } else {
      exchangeRate = 1;
      currencyInfo = { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' };
    }

    currencyReady = true;
    applyToPage();

  } catch {
    // Fallback to NGN
    exchangeRate  = 1;
    currencyInfo  = { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' };
    currencyReady = true;
    applyToPage();
  }
}

// ── FORMAT PRICE ─────────────────────────────────────
function formatPrice(amountInNGN) {
  const converted = amountInNGN * exchangeRate;
  const formatted = converted >= 1000
    ? converted.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currencyInfo.symbol}${formatted}`;
}

// ── APPLY TO PAGE ─────────────────────────────────────
// Converts any element with data-price-ngn attribute
function applyToPage() {
  document.querySelectorAll('[data-price-ngn]').forEach(el => {
    const ngn = parseFloat(el.dataset.priceNgn);
    if (!isNaN(ngn)) el.textContent = formatPrice(ngn);
  });

  // Show currency badge if it exists
  const badge = document.getElementById('currencyBadge');
  if (badge) {
    badge.textContent = currencyInfo.code;
    badge.title       = currencyInfo.name;
  }
}

// ── EXPOSE GLOBALLY ───────────────────────────────────
window.JaiforeCurrency = {
  init:        initCurrency,
  format:      formatPrice,
  getRate:     () => exchangeRate,
  getInfo:     () => currencyInfo,
  isReady:     () => currencyReady,
  applyToPage
};