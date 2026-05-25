/* ================================
   JAIFORE — HEADER.JS
   frontend/scripts/header.js
   ================================ */
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('jaifore_token');
  const user  = JSON.parse(localStorage.getItem('jaifore_user') || 'null');
  const navActions = document.getElementById('nav-actions');
  if (!navActions) return;

  if (token && user) {
    const firstName = user.name.split(' ')[0];
    const initials  = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const dashLink  = user.role === 'admin' ? 'admin/admin.html' : 'dashboard.html';

    navActions.innerHTML = `
      <div class="nav-user">
        <a href="${dashLink}" class="nav-profile" title="Go to dashboard">
          <div class="nav-avatar">${initials}</div>
          <span class="nav-username">Hi, <strong>${firstName}</strong></span>
        </a>
      </div>`;
  } else {
    navActions.innerHTML = `<a href="loginsys.html" class="nav-signin-btn">Sign In</a>`;
  }
});

function requireAuth(returnPage = 'checkout.html') {
  const token = localStorage.getItem('jaifore_token');
  if (!token) {
    sessionStorage.setItem('jaifore_return', returnPage);
    window.location.href = 'loginsys.html';
    return false;
  }
  return true;
}