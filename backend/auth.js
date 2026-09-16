/* ================================
   JAIFORE AUTH ROUTES
   backend/auth.js
   ================================ */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('./database');
const { authenticate } = require('./middleware');
const { cacheGet, cacheSet, cacheInvalidate } = require('./redis');
const { generateOTP, sendOTPEmail, sendAdminNotification, sendWelcomeEmail, sendPasswordResetEmail } = require('./mailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const otpStore = {}; // { email: { otp, expires, userData } }

// Reset links are valid for 30 minutes — long enough for someone to check
// their email and act, short enough that a stale/leaked link doesn't stay
// exploitable indefinitely. Kept in Redis (not otpStore's plain object) so
// a reset link survives a Railway redeploy between "email sent" and
// "link clicked" — otpStore is fine for OTP since that's a same-session,
// few-minutes flow, but password reset can legitimately span longer.
const RESET_TOKEN_TTL_SECONDS = 30 * 60;

// The URL the reset link points to. Frontend is a static site (Vercel),
// so this points at a plain HTML page there, not a backend route — the
// backend only ever handles the API calls that page makes.
const FRONTEND_RESET_URL = process.env.FRONTEND_URL
  ? `${process.env.FRONTEND_URL}/reset-password.html`
  : 'https://jai-fore.vercel.app/reset-password.html';

// REGISTER — Step 1
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const existing = await pool.query('SELECT id, verified FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0 && existing.rows[0].verified) return res.status(409).json({ error: 'An account with this email already exists.' });
    const hashed = await bcrypt.hash(password, 12);
    const otp = generateOTP();
    otpStore[email.toLowerCase().trim()] = { otp, expires: Date.now() + 10 * 60 * 1000, userData: { name: name.trim(), email: email.toLowerCase().trim(), password: hashed } };
    await sendOTPEmail(email, name, otp);
    return res.status(200).json({ message: 'OTP sent to your email.' });
  } catch (err) { console.error('Register error:', err.message, err.stack); return res.status(500).json({ error: err.message }); }
});

// VERIFY OTP — Step 2
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });
  const key = email.toLowerCase().trim();
  const pending = otpStore[key];
  if (!pending) return res.status(400).json({ error: 'No pending registration. Please register again.' });
  if (Date.now() > pending.expires) { delete otpStore[key]; return res.status(400).json({ error: 'OTP expired. Please register again.' }); }
  if (pending.otp !== otp.toString()) return res.status(400).json({ error: 'Invalid OTP. Please try again.' });
  try {
    const { name, email: userEmail, password } = pending.userData;
    const result = await pool.query(
      `INSERT INTO users (name, email, password, verified) VALUES ($1,$2,$3,true)
       ON CONFLICT (email) DO UPDATE SET name=$1, password=$3, verified=true
       RETURNING id, name, email, role, created_at`,
      [name, userEmail, password]
    );
    const user = result.rows[0];
    delete otpStore[key];
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    try { await sendAdminNotification(user); } catch (e) { console.error('Admin notify error:', e.message); }
    sendWelcomeEmail(user.email, user.name).catch(e => console.error('Welcome email error:', e.message));
    return res.status(201).json({ message: 'Account verified.', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { console.error('Verify OTP error:', err.message); return res.status(500).json({ error: 'Server error.' }); }
});

// RESEND OTP
router.post('/resend-otp', async (req, res) => {
  const key = req.body.email?.toLowerCase().trim();
  const pending = otpStore[key];
  if (!pending) return res.status(400).json({ error: 'No pending registration. Please register again.' });
  const otp = generateOTP();
  pending.otp = otp; pending.expires = Date.now() + 10 * 60 * 1000;
  try { await sendOTPEmail(key, pending.userData.name, otp); return res.json({ message: 'New OTP sent.' }); }
  catch (err) { return res.status(500).json({ error: 'Failed to send OTP.' }); }
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = result.rows[0];
    if (!user.verified) return res.status(403).json({ error: 'Please verify your email first.', needsVerification: true, email: user.email });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    return res.status(200).json({ message: 'Login successful.', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) { console.error('Login error:', err.message, err.stack); return res.status(500).json({ error: err.message }); }
});

// GET CURRENT USER
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: result.rows[0] });
  } catch (err) { return res.status(500).json({ error: 'Server error.' }); }
});

// UPDATE PROFILE
router.put('/update-profile', authenticate, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user   = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (newPassword) {
      const match = await bcrypt.compare(currentPassword, user.password);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
      const hashed = await bcrypt.hash(newPassword, 12);
      await pool.query('UPDATE users SET name=$1, password=$2 WHERE id=$3', [name, hashed, req.user.id]);
    } else {
      await pool.query('UPDATE users SET name=$1 WHERE id=$2', [name, req.user.id]);
    }

    const updated = await pool.query('SELECT id, name, email, role FROM users WHERE id=$1', [req.user.id]);
    res.json({ message: 'Profile updated.', user: updated.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── FORGOT PASSWORD — request a reset link ────────────────────────────
// Works for BOTH customers and admins, since they share the same users
// table — the admin panel's "Forgot Password?" modal and the customer
// login page's link both call this exact same route.
//
// Deliberately returns the same success message whether or not the email
// exists — this prevents the endpoint from being usable to check which
// emails have accounts (a common account-enumeration issue with reset
// flows that reply differently for "not found" vs "sent").
router.post('/forgot-password', async (req, res) => {
  const email = req.body.email?.toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  try {
    const result = await pool.query('SELECT id, name, email FROM users WHERE email = $1', [email]);

    if (result.rows.length) {
      const user  = result.rows[0];
      const token = crypto.randomBytes(32).toString('hex'); // 64 hex chars — not guessable

      await cacheSet(`reset:${token}`, { userId: user.id }, RESET_TOKEN_TTL_SECONDS);

      const resetLink = `${FRONTEND_RESET_URL}?token=${token}`;
      await sendPasswordResetEmail(user.email, user.name, resetLink);
    }

    // Same response regardless of whether the account exists — see comment above.
    return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    // Still return the generic success message even on a server error —
    // the alternative (leaking a 500) tells an attacker something went
    // wrong server-side, which is more information than this endpoint
    // should ever reveal either way.
    return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  }
});

// ── VERIFY RESET TOKEN — lets the frontend check before showing the form ──
// So reset-password.html can immediately show "this link is invalid or
// expired" instead of only finding out after the user fills in a new
// password and submits.
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const data = await cacheGet(`reset:${req.params.token}`);
    if (!data) return res.status(400).json({ valid: false, error: 'This reset link is invalid or has expired.' });
    return res.json({ valid: true });
  } catch (err) {
    console.error('Verify reset token error:', err.message);
    return res.status(500).json({ valid: false, error: 'Server error.' });
  }
});

// ── RESET PASSWORD — actually set the new password ────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    const data = await cacheGet(`reset:${token}`);
    if (!data) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, data.userId]);

    // One-time use — invalidate immediately so the same link can't be
    // replayed to set the password again later.
    await cacheInvalidate(`reset:${token}`);

    return res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = { router, authenticate };