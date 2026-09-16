/* ================================
   JAIFORE — RESET PASSWORD PAGE
   frontend/scripts/reset-password.js
   ================================ */
const API = 'https://jai-fore-production.up.railway.app';

const params = new URLSearchParams(window.location.search);
const token  = params.get('token');

function showSection(id) {
  ['checking-section', 'invalid-section', 'reset-section', 'success-section'].forEach(sec => {
    document.getElementById(sec).classList.toggle('hidden', sec !== id);
  });
}

function showMsg(text, type) {
  const el = document.getElementById('reset-msg');
  el.textContent = text;
  el.className   = `msg ${type}`;
}

function setLoading(on) {
  const form    = document.getElementById('reset-form');
  const btn     = form.querySelector('.btn-primary');
  btn.disabled  = on;
  btn.querySelector('.btn-text').classList.toggle('hidden', on);
  btn.querySelector('.btn-loader').classList.toggle('hidden', !on);
}

// ── VERIFY THE TOKEN ON LOAD ─────────────────────────
// Checks validity immediately, before the user fills anything in, so a
// dead link (expired, already used, or malformed) shows a clear message
// right away rather than only failing after the form is submitted.
async function verifyToken() {
  if (!token) {
    showSection('invalid-section');
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/verify-reset-token/${token}`);
    const data = await res.json();

    if (!res.ok || !data.valid) {
      showSection('invalid-section');
      return;
    }

    showSection('reset-section');
  } catch {
    showSection('invalid-section');
  }
}

// Password toggle — same pattern as loginsys.js
document.querySelectorAll('.toggle-pw').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    input.type = input.type === 'password' ? 'text' : 'password';
    btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
  });
});

document.getElementById('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const newPassword = document.getElementById('new-password').value;
  const confirm      = document.getElementById('confirm-password').value;

  if (newPassword.length < 8) { showMsg('Password must be at least 8 characters.', 'error'); return; }
  if (newPassword !== confirm) { showMsg('Passwords do not match.', 'error'); return; }

  setLoading(true);
  showMsg('', '');

  try {
    const res  = await fetch(`${API}/api/auth/reset-password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, newPassword })
    });
    const data = await res.json();

    if (!res.ok) { showMsg(data.error || 'Failed to reset password.', 'error'); setLoading(false); return; }

    showSection('success-section');
  } catch {
    showMsg('Network error. Please try again.', 'error');
    setLoading(false);
  }
});

verifyToken();