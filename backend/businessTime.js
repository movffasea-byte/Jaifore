/* ================================
   JAIFORE — BUSINESS TIME ZONE
   backend/businessTime.js

   One source of truth for the business's clock (Texas, US Central).
   Railway runs in UTC, so anything a person reads as a date or time, or
   anything that resets "daily", goes through here: emails (mailer.js)
   and Bossy Bot's daily caps (routes/bossy.js).
   ================================ */

const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Chicago';

// "Nov 1, 2026, 6:22 AM CST"
function formatDateTime(date = new Date()) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: BUSINESS_TIMEZONE, timeZoneName: 'short',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// "November 1, 2026"
function formatDate(date = new Date()) {
  return new Date(date).toLocaleDateString('en-US', {
    timeZone: BUSINESS_TIMEZONE, month: 'long', day: 'numeric', year: 'numeric',
  });
}

module.exports = { BUSINESS_TIMEZONE, formatDateTime, formatDate };
