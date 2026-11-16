/* ================================
   JAIFORE — HOUSEKEEPING
   backend/maintenance.js

   Small recurring cleanups so tables don't grow forever.
   ================================ */

const SIX_HOURS = 6 * 60 * 60 * 1000;

// A pending checkout is the saved cart behind a Stripe session. A session
// expires after an hour, but Stripe retries an undelivered webhook for up to
// 3 days, and the webhook needs this row to build the order. So keep rows for
// 4 days; only older ones are certainly dead (abandoned or already fulfilled).
const PENDING_CHECKOUT_DAYS = 4;

async function purgeStaleCheckouts(pool, days = PENDING_CHECKOUT_DAYS) {
  const result = await pool.query(
    `DELETE FROM pending_checkouts WHERE created_at < NOW() - make_interval(days => $1)`,
    [days]
  );
  return result.rowCount || 0;
}

// Runs once now and then every six hours. A failure is logged, never thrown:
// housekeeping must not take the server down.
function startMaintenance({ pool, log = console, intervalMs = SIX_HOURS }) {
  const run = async () => {
    try {
      const removed = await purgeStaleCheckouts(pool);
      if (removed) log.log(`[maintenance] Purged ${removed} stale pending checkout(s)`);
    } catch (err) {
      log.error('[maintenance] Purge failed:', err.message);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.(); // never keeps the process alive on its own
  return timer;
}

module.exports = { purgeStaleCheckouts, startMaintenance, PENDING_CHECKOUT_DAYS };
