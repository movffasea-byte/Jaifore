const API = 'https://jai-fore-website.onrender.com';


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
      el.textContent = text;
      el.className = `msg ${type}`;
    }
 
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      setLoading(form, true);
      try {
        const res = await fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('login-email').value.trim(),
            password: document.getElementById('login-password').value
          })
        });
        const data = await res.json();
        if (!res.ok) { showMsg('login-msg', data.error || 'Login failed.', 'error'); return; }
        localStorage.setItem('jaifore_token', data.token);
        localStorage.setItem('jaifore_user', JSON.stringify(data.user));
        showMsg('login-msg', 'Welcome back! Redirecting...', 'success');
        setTimeout(() => window.location.href = 'dashboard.html', 1000);
      } catch { showMsg('login-msg', 'Network error. Try again.', 'error'); }
      finally { setLoading(form, false); }
    });
 
    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const password = document.getElementById('reg-password').value;
      const confirm = document.getElementById('reg-confirm').value;
      if (password.length < 8) { showMsg('register-msg', 'Password must be at least 8 characters.', 'error'); return; }
      if (password !== confirm) { showMsg('register-msg', 'Passwords do not match.', 'error'); return; }
      setLoading(form, true);
      try {
        const res = await fetch(`${API}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('reg-name').value.trim(),
            email: document.getElementById('reg-email').value.trim(),
            password
          })
        });
        const data = await res.json();
        if (!res.ok) { showMsg('register-msg', data.error || 'Registration failed.', 'error'); return; }
        showMsg('register-msg', 'Account created! Switching to login...', 'success');
        setTimeout(() => { tabs[0].click(); document.getElementById('login-email').value = document.getElementById('reg-email').value; }, 1500);
      } catch { showMsg('register-msg', 'Network error. Try again.', 'error'); }
      finally { setLoading(form, false); }
    });