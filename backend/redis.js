/* ================================
   JAIFORE — REDIS CLIENT
   backend/redis.js
   ================================ */
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  // Don't crash the whole app if Redis is briefly unavailable —
  // cache failures should degrade gracefully, never break the site.
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redis.on('connect', () => {
  console.log('✅ Redis connected');
});

/**
 * Get a cached value, parsed from JSON. Returns null if missing or on error.
 * Never throws — caching failures should fall through to the DB silently.
 */
async function cacheGet(key) {
  try {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error(`Cache GET failed for ${key}:`, err.message);
    return null;
  }
}

/**
 * Set a cached value with a TTL in seconds. Never throws.
 */
async function cacheSet(key, value, ttlSeconds) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.error(`Cache SET failed for ${key}:`, err.message);
  }
}

/**
 * Delete one or more cache keys (supports wildcards via SCAN, since Redis
 * KEYS is blocking and unsafe for production use at scale).
 */
async function cacheInvalidate(pattern) {
  try {
    if (!pattern.includes('*')) {
      await redis.del(pattern);
      return;
    }
    const stream = redis.scanStream({ match: pattern, count: 100 });
    const keysToDelete = [];
    for await (const keys of stream) {
      keysToDelete.push(...keys);
    }
    if (keysToDelete.length) {
      await redis.del(...keysToDelete);
    }
  } catch (err) {
    console.error(`Cache invalidate failed for ${pattern}:`, err.message);
  }
}

module.exports = { redis, cacheGet, cacheSet, cacheInvalidate };