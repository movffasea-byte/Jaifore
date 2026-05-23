/* ================================
   JAIFORE AUTH ROUTES
   backend/auth.js
   ================================ */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('./database');
const { authenticate } = require('./middleware');
const { generateOTP, sendOTPEmail, sendAdminNotification } = require('./mailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const otpStore = {}; // { email: { otp, expires, userData } }

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
  }  catch (err) { console.error('Register error:', err.message, err.stack); return res.status(500).json({ error: err.message }); }
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
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    try { await sendAdminNotification(user); } catch (e) { console.error('Admin notify error:', e.message); }
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
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
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

module.exports = { router, authenticate };