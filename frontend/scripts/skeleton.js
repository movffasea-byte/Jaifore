/* ================================
   JAIFORE SKELETON KIT — helpers
   frontend/scripts/skeleton.js

   Load before the page script. Pairs with styles/skeleton.css.
   Every loader should end in one of three states: data, empty state, or
   showError(...) with a Retry button — never a skeleton that shimmers forever.
   ================================ */

const FETCH_TIMEOUT_MS = 12000;

// fetch() that gives up after `ms` so an unreachable server can't hang a loader
async function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// fetchWithTimeout + JSON, throwing on a non-2xx response
async function fetchJson(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const res = await fetchWithTimeout(url, opts, ms);
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

// Turns a thrown error into a sentence a person can act on
function friendlyError(err) {
  if (err && err.message === 'timeout') return 'The server took too long to respond.';
  if (err instanceof TypeError)         return "Can't reach the server. Check your connection.";
  return (err && err.message) || 'Something went wrong.';
}

function _skelEl(target) {
  return typeof target === 'string' ? document.getElementById(target) : target;
}

// `n` skeleton lines; widths vary a little so it reads as text, not a bar
function skelLines(n = 3) {
  const widths = [90, 70, 82, 60, 76];
  return Array.from({ length: n }, (_, i) =>
    `<span class="skel skel-line" style="width:${widths[i % widths.length]}%"></span>`).join('');
}

function showTableSkeleton(tbodyId, cols, rows = 5) {
  const body = _skelEl(tbodyId);
  if (!body) return;
  const cell = i => `<td><span class="skel skel-line" style="width:${[70, 85, 55, 78, 62][i % 5]}%"></span></td>`;
  body.innerHTML = Array.from({ length: rows }, () =>
    `<tr class="skel-row" aria-hidden="true">${Array.from({ length: cols }, (_, i) => cell(i)).join('')}</tr>`).join('');
}

// Replaces the text of each stat element with a small shimmering bar
function showStatSkeleton(ids) {
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    const el = _skelEl(id);
    if (el) el.innerHTML = '<span class="skel skel-line tall" style="width:60%;min-width:48px"></span>';
  });
}

// Error state with a Retry button. For a <tbody> it renders a full-width row.
function showError(container, message, retryFn) {
  const el = _skelEl(container);
  if (!el) return;

  const box = document.createElement('div');
  box.className = 'load-error';
  box.setAttribute('role', 'alert');

  const icon = document.createElement('span');
  icon.className = 'load-error-icon';
  icon.textContent = '⚠';

  const msg = document.createElement('p');
  msg.className = 'load-error-msg';
  msg.textContent = message || 'Something went wrong.';

  box.append(icon, msg);

  if (typeof retryFn === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'load-error-retry';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => { btn.disabled = true; retryFn(); });
    box.appendChild(btn);
  }

  if (el.tagName === 'TBODY') {
    const cols = el.closest('table')?.querySelectorAll('thead th').length || 1;
    el.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols;
    td.appendChild(box);
    tr.appendChild(td);
    el.appendChild(tr);
  } else {
    el.innerHTML = '';
    el.appendChild(box);
  }
}
