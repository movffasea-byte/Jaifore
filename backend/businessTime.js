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

// The business's calendar date for an instant, as "2026-11-26".
function businessDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// n business days (Mon-Fri) after the business's date for `from`, as "YYYY-MM-DD".
// Weekends are skipped; public holidays are not (carriers vary, so estimates stay ranges).
function addBusinessDays(from, n) {
  const [y, m, d] = businessDateString(from).split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  let left = n;
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return cursor.toISOString().slice(0, 10);
}

// "Wed, Nov 26" from a "YYYY-MM-DD" string or a Date stored from a DATE column.
// Calendar dates carry no zone, so they are read as UTC to avoid shifting a day.
function formatDateOnly(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric',
  });
}

// ── SQL: group and filter by the business's calendar, not UTC ───────────
// created_at columns are TIMESTAMP (no zone) holding UTC wall time, because the
// database runs in UTC. Reading them as UTC and converting to the business zone
// makes "today" and a day's orders follow Texas midnight. The zone is checked
// against a strict pattern before it is placed in SQL (it comes from config,
// never from a request).
const SQL_ZONE = /^[A-Za-z0-9_+\-\/]+$/.test(BUSINESS_TIMEZONE) ? BUSINESS_TIMEZONE : 'America/Chicago';

const sqlLocal = (column) => `((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${SQL_ZONE}')`;
const sqlNowLocal = () => `(NOW() AT TIME ZONE '${SQL_ZONE}')`;

module.exports = { BUSINESS_TIMEZONE, formatDateTime, formatDate, businessDateString, addBusinessDays, formatDateOnly, sqlLocal, sqlNowLocal };
