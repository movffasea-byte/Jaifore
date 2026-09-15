/* ================================
   JAIFORE — LOGINSYS.JS
   frontend/scripts/loginsys.js
   ================================ */
const API = 'https://jai-fore-production.up.railway.app';
let pendingEmail = '';
let otpTimer = null;

// Redirect if already logged in
const existingToken = localStorage.getItem('jaifore_token');
const existingUser = JSON.parse(localStorage.getItem('jaifore_user') || 'null');
if (existingToken && existingUser) {
  const returnTo = sessionStorage.getItem('jaifore_return');
  if (returnTo) { sessionStorage.removeItem('jaifore_return'); window.location.href = returnTo; }
  else window.location.href = 'services.html';
}

// Tab switching
const tabs = document.querySelectorAll('.tab');
const forms = document.querySelectorAll('.auth-form');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-form`).classList.add('active');
    document.querySelectorAll('.msg').forEach(m => { m.textContent = ''; m.className = 'msg'; });
  });
});

// Password toggle
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
});

function setLoading(form, isLoading) {
  const btn = form.querySelector('.btn-primary');
  btn.disabled = isLoading;
  btn.querySelector('.btn-text').classList.toggle('hidden', isLoading);
  btn.querySelector('.btn-loader').classList.toggle('hidden', !isLoading);
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text; el.className = `msg ${type}`;
}

function redirectAfterLogin(user) {
  const returnTo = sessionStorage.getItem('jaifore_return');
  if (returnTo) { sessionStorage.removeItem('jaifore_return'); window.location.href = returnTo; }
  else window.location.href = 'services.html';
}

// LOGIN
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  setLoading(form, true);
  showMsg('login-msg', '', '');
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('login-email').value.trim(), password: document.getElementById('login-password').value })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.needsVerification) { pendingEmail = data.email; showOTPScreen(data.email); startOTPTimer(); return; }
      showMsg('login-msg', data.error || 'Login failed.', 'error'); return;
    }
    localStorage.setItem('jaifore_token', data.token);
    localStorage.setItem('jaifore_user', JSON.stringify(data.user));
    window.syncCartOnLogin?.(); // item 21 — merge any local (guest) cart into the account's server cart
    showMsg('login-msg', `Welcome back, ${data.user.name.split(' ')[0]}! Redirecting...`, 'success');
    setTimeout(() => redirectAfterLogin(data.user), 1000);
  } catch { showMsg('login-msg', 'Network error. Try again.', 'error'); }
  finally { setLoading(form, false); }
});

// REGISTER
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;
  const email = document.getElementById('reg-email').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  if (password.length < 8) { showMsg('register-msg', 'Password must be at least 8 characters.', 'error'); return; }
  if (password !== confirm) { showMsg('register-msg', 'Passwords do not match.', 'error'); return; }
  setLoading(form, true);
  showMsg('register-msg', '', '');
  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (!res.ok) { showMsg('register-msg', data.error || 'Registration failed.', 'error'); return; }
    pendingEmail = email;
    showOTPScreen(email);
    startOTPTimer();
  } catch { showMsg('register-msg', 'Network error. Try again.', 'error'); }
  finally { setLoading(form, false); }
});

// OTP SCREEN
function showOTPScreen(email) {
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('otp-section').classList.remove('hidden');
  document.getElementById('otp-email-display').textContent = email;
  clearOTPBoxes();
  document.querySelector('.otp-box').focus();
}

function hideOTPScreen() {
  document.getElementById('otp-section').classList.add('hidden');
  document.getElementById('auth-section').classList.remove('hidden');
  clearOTPBoxes();
  clearInterval(otpTimer);
}

document.getElementById('otp-back-btn').addEventListener('click', hideOTPScreen);

// OTP BOXES
const otpBoxes = document.querySelectorAll('.otp-box');
otpBoxes.forEach((box, i) => {
  box.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    box.value = val;
    if (val) {
      box.classList.add('filled');
      if (i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
      else autoVerifyOTP();
    } else { box.classList.remove('filled'); }
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) {
      otpBoxes[i - 1].focus(); otpBoxes[i - 1].value = '';
      otpBoxes[i - 1].classList.remove('filled');
    }
  });
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    pasted.split('').forEach((char, idx) => { if (otpBoxes[idx]) { otpBoxes[idx].value = char; otpBoxes[idx].classList.add('filled'); } });
    if (pasted.length === 4) autoVerifyOTP();
    else otpBoxes[Math.min(pasted.length, 3)].focus();
  });
});

function getOTPValue() { return Array.from(otpBoxes).map(b => b.value).join(''); }
function clearOTPBoxes() { otpBoxes.forEach(b => { b.value = ''; b.className = 'otp-box'; }); showMsg('otp-msg', '', ''); }
function setOTPState(state) { otpBoxes.forEach(b => { b.classList.remove('error', 'success'); if (state) b.classList.add(state); }); }

async function autoVerifyOTP() {
  const otp = getOTPValue();
  if (otp.length < 4) return;
  otpBoxes.forEach(b => b.disabled = true);
  showMsg('otp-msg', 'Verifying...', '');
  try {
    const res = await fetch(`${API}/api/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail, otp })
    });
    const data = await res.json();
    if (!res.ok) {
      setOTPState('error');
      showMsg('otp-msg', data.error || 'Invalid code. Try again.', 'error');
      otpBoxes.forEach(b => b.disabled = false);
      clearOTPBoxes(); otpBoxes[0].focus(); return;
    }
    setOTPState('success');
    clearInterval(otpTimer);
    localStorage.setItem('jaifore_token', data.token);
    localStorage.setItem('jaifore_user', JSON.stringify(data.user));
    window.syncCartOnLogin?.(); // item 21 — merge any local (guest) cart into the account's server cart
    showMsg('otp-msg', `✓ Verified! Welcome, ${data.user.name.split(' ')[0]}!`, 'success');
    setTimeout(() => redirectAfterLogin(data.user), 1200);
  } catch {
    showMsg('otp-msg', 'Network error. Try again.', 'error');
    otpBoxes.forEach(b => b.disabled = false);
  }
}

function startOTPTimer() {
  let seconds = 600;
  const timerEl = document.getElementById('otp-timer');
  const resendBtn = document.getElementById('resend-btn');
  resendBtn.disabled = true;
  clearInterval(otpTimer);
  otpTimer = setInterval(() => {
    seconds--;
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    timerEl.innerHTML = `Code expires in <strong>${m}:${s}</strong>`;
    if (seconds <= 60) timerEl.classList.add('urgent');
    if (seconds <= 0) { clearInterval(otpTimer); timerEl.innerHTML = '<strong style="color:var(--error)">Code expired</strong>'; resendBtn.disabled = false; }
    if (seconds === 570) resendBtn.disabled = false;
  }, 1000);
}

document.getElementById('resend-btn').addEventListener('click', async () => {
  const btn = document.getElementById('resend-btn');
  btn.disabled = true;
  showMsg('otp-msg', 'Sending new code...', '');
  try {
    const res = await fetch(`${API}/api/auth/resend-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail })
    });
    const data = await res.json();
    if (!res.ok) { showMsg('otp-msg', data.error || 'Failed to resend.', 'error'); btn.disabled = false; return; }
    clearOTPBoxes(); otpBoxes[0].focus();
    showMsg('otp-msg', 'New code sent!', 'success');
    startOTPTimer();
  } catch { showMsg('otp-msg', 'Network error. Try again.', 'error'); btn.disabled = false; }
});