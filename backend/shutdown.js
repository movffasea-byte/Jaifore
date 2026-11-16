/* ================================
   JAIFORE — GRACEFUL SHUTDOWN
   backend/shutdown.js

   Railway sends SIGTERM when it replaces a deployment. Without handling it the
   process dies mid-request: a customer's checkout or a Stripe webhook can be cut
   off half way. This stops accepting new connections, lets requests already in
   flight finish (up to timeoutMs), then closes the database and Redis.
   ================================ */

function createShutdown({ server, pool, redis, timeoutMs = 10000, exit = process.exit, log = console }) {
  let started = false;

  return async function shutdown(signal) {
    if (started) return; // a second signal while closing is ignored
    started = true;
    log.log(`[shutdown] ${signal} received, finishing in-flight requests`);

    // If something hangs (a slow request, a stuck connection), leave anyway.
    const force = setTimeout(() => {
      log.error(`[shutdown] still busy after ${timeoutMs}ms, forcing exit`);
      exit(1);
    }, timeoutMs);
    force.unref?.();

    let code = 0;
    try {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    } catch (err) {
      log.error('[shutdown] Closing the server failed:', err.message);
      code = 1;
    }
    try { await pool.end(); } catch (err) { log.error('[shutdown] Closing the database failed:', err.message); code = 1; }
    try { await redis?.quit(); } catch (err) { log.error('[shutdown] Closing Redis failed:', err.message); code = 1; }

    clearTimeout(force);
    log.log('[shutdown] done');
    exit(code);
  };
}

module.exports = { createShutdown };
