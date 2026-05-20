/* ================================
   JAIFORE — HEADER.JS
   frontend/scripts/header.js
   Shared across all pages
   ================================ */
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('jaifore_token');
  const user = JSON.parse(localStorage.getItem('jaifore_user') || 'null');
  const navActions = document.getElementById('nav-actions');
  if (!navActions) return;

  if (token && user) {
    const firstName = user.name.split(' ')[0];
    navActions.innerHTML = `
      <div class="nav-user">
        <span class="nav-greeting">Hi, <strong>${firstName}</strong></span>
        ${user.role === 'admin' ? `<a href="admin/admin-auth.html" class="nav-admin-link">Admin</a>` : ''}
        <button class="nav-logout-btn" id="nav-logout">Logout</button>
      </div>`;
    document.getElementById('nav-logout').addEventListener('click', () => {
      localStorage.removeItem('jaifore_token');
      localStorage.removeItem('jaifore_user');
      window.location.href = 'loginsys.html';
    });
  } else {
    navActions.innerHTML = `<a href="loginsys.html" class="nav-signin-btn">Sign In</a>`;
  }
});

// Call on checkout page to require login
function requireAuth(returnPage = 'checkout.html') {
  const token = localStorage.getItem('jaifore_token');
  if (!token) {
    sessionStorage.setItem('jaifore_return', returnPage);
    window.location.href = 'loginsys.html';
    return false;
  }
  return true;
}