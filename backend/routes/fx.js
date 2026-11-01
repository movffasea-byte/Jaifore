/* ================================
   JAIFORE — EXCHANGE RATES
   backend/routes/fx.js

   GET /api/fx -> { base: 'USD', rates: { EUR: 0.92, ... }, updatedAt }

   The exchange-rate API key stays on the server (EXCHANGE_RATE_API_KEY).
   Rates are fetched at most once per FX_TTL_SECONDS for the whole site and
   kept in Redis, with an in-memory copy so a Redis outage doesn't turn into
   one upstream call per visitor. Prices shown with these rates are estimates;
   customers are always charged in USD.
   ================================ */
const express = require('express');
const Sentry = require('@sentry/node');
const { cacheGet, cacheSet } = require('../redis');

const router = express.Router();

const FX_CACHE_KEY = 'fx:usd';
const FX_TTL_SECONDS = 12 * 60 * 60;
const FAIL_RETRY_MS = 10 * 60 * 1000; // after an upstream failure, wait before trying again
const UPSTREAM_TIMEOUT_MS = 5000;

let memory = null;      // { rates, updatedAt, expires }
let inflight = null;    // shared upstream request while one is running
let lastFailure = 0;

async function fetchUpstream() {
  const key = process.env.EXCHANGE_RATE_API_KEY;
  if (!key) throw new Error('EXCHANGE_RATE_API_KEY is not set');
  const res = await fetch(`https://v6.exchangerate-api.com/v6/${encodeURIComponent(key)}/latest/USD`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (data.result !== 'success' || !data.conversion_rates) {
    throw new Error(`exchange-rate API: ${data['error-type'] || `HTTP ${res.status}`}`);
  }
  return { rates: data.conversion_rates, updatedAt: new Date().toISOString() };
}

async function loadRates() {
  if (memory && Date.now() < memory.expires) return memory;

  const cached = await cacheGet(FX_CACHE_KEY);
  if (cached?.rates) {
    memory = { ...cached, expires: Date.now() + FX_TTL_SECONDS * 1000 };
    return memory;
  }

  if (Date.now() - lastFailure < FAIL_RETRY_MS) return null;
  if (!inflight) {
    inflight = fetchUpstream()
      .then(async (fresh) => {
        await cacheSet(FX_CACHE_KEY, fresh, FX_TTL_SECONDS);
        memory = { ...fresh, expires: Date.now() + FX_TTL_SECONDS * 1000 };
        return memory;
      })
      .catch((err) => {
        lastFailure = Date.now();
        console.error('FX rates fetch failed:', err.message);
        Sentry.captureException(err, { tags: { area: 'fx' } });
        return null;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

router.get('/', async (req, res) => {
  const data = await loadRates();
  if (!data) return res.status(503).json({ error: 'Exchange rates are unavailable right now.' });
  res.set('Cache-Control', 'public, max-age=3600');
  return res.json({ base: 'USD', rates: data.rates, updatedAt: data.updatedAt });
});

router.resetState = () => { memory = null; inflight = null; lastFailure = 0; }; // tests only

module.exports = router;
