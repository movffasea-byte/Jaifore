/* ================================
   JAIFORE WEB PUSH
   backend/push.js

   Sends "new order" notifications to every admin device that subscribed
   (routes/push.js). Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY; the
   contact is ADMIN_EMAIL. Without the keys this does nothing, so a missing
   variable never affects orders. Never throws: a push hiccup must not touch
   the order flow.
   ================================ */
const webpush = require('web-push');
const { pool } = require('./database');

const enabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
function configure() {
  if (configured) return true;
  if (!enabled()) return false;
  const contact = process.env.ADMIN_EMAIL ? `mailto:${process.env.ADMIN_EMAIL}` : 'mailto:admin@jaifore.com';
  webpush.setVapidDetails(contact, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  configured = true;
  return true;
}

async function sendAdminPush(payload) {
  try {
    if (!configure()) return { sent: 0, removed: 0 };
    const { rows } = await pool.query(
      `SELECT s.id, s.endpoint, s.p256dh, s.auth
         FROM push_subscriptions s JOIN users u ON u.id = s.user_id
        WHERE u.role = 'admin'`
    );
    const body = JSON.stringify(payload);
    let sent = 0;
    const dead = [];
    await Promise.all(rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60, urgency: 'high' }
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) dead.push(sub.id);
        else console.error('[push] send failed:', err.statusCode || err.message);
      }
    }));
    if (dead.length) await pool.query('DELETE FROM push_subscriptions WHERE id = ANY($1::int[])', [dead]);
    return { sent, removed: dead.length };
  } catch (err) {
    console.error('[push] sendAdminPush failed:', err.message);
    return { sent: 0, removed: 0 };
  }
}

module.exports = { sendAdminPush, pushEnabled: enabled };
