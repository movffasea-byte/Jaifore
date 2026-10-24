/* ================================
   JAIFORE ADMIN — NEW ORDER ALERTS
   frontend/admin/order-alerts.js

   Polls GET /api/orders every 30 s while the dashboard is open and tells
   the admin when a new order id appears: toast, Orders badge, chime, tab
   title count and (once permitted) a system notification.
   With the page closed, alerts come from web push (backend/push.js): the
   Enable alerts button subscribes this device via /api/push/subscribe.
   Relies on admin.js globals: API, token, authHeaders, fetchJson,
   formatMoney, switchTab.
   ================================ */
(function () {
  const POLL_MS = 30000;
  const KEY_LAST = 'jaifore_admin_last_order';
  const KEY_MUTE = 'jaifore_admin_alert_mute';
  const BASE_TITLE = document.title;

  let timer = null;
  let lastId = null;     // highest order id already announced
  let unseen = 0;
  let audioCtx = null;
  let busy = false;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  const muted = () => store.get(KEY_MUTE) === '1';

  // ── Sound (Web Audio; browsers need a tap first, see unlockAudio) ──
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }
  function chime() {
    if (muted() || !audioCtx || audioCtx.state !== 'running') return;
    [[880, 0], [1174.7, 0.18], [1568, 0.36]].forEach(([freq, at]) => {
      const t = audioCtx.currentTime + at;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }
  ['click', 'touchstart', 'keydown'].forEach(ev =>
    document.addEventListener(ev, unlockAudio, { once: false, passive: true }));

  // ── Badge, title, toast ──
  function paintBadge() {
    const nav = document.querySelector('.nav-item[data-tab="orders"]');
    if (!nav) return;
    let badge = nav.querySelector('.nav-badge');
    if (!unseen) { if (badge) badge.remove(); }
    else {
      if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; nav.appendChild(badge); }
      badge.textContent = unseen > 99 ? '99+' : String(unseen);
    }
    document.title = unseen ? `(${unseen}) ${BASE_TITLE}` : BASE_TITLE;
  }
  function clearUnseen() { unseen = 0; paintBadge(); }

  function toast(text, onClick) {
    let box = document.getElementById('orderToasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'orderToasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'order-toast';
    el.textContent = text;
    el.addEventListener('click', () => { el.remove(); onClick(); });
    box.appendChild(el);
    setTimeout(() => el.remove(), 12000);
  }

  async function systemNotify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'jaifore-order',
                   renotify: true, vibrate: [200, 100, 200], data: { url: '/admin/admin.html' } };
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) { await reg.showNotification(title, opts); return; }
      new Notification(title, opts);
    } catch (e) { /* some mobile browsers only allow the service-worker route */ }
  }

  // ── Polling ──
  function announce(fresh) {
    const newest = fresh[0];
    const who = newest.customer_name ? ` — ${newest.customer_name}` : '';
    const money = formatMoney(newest.total, newest.currency);
    const text = fresh.length === 1
      ? `New order #${newest.id} — ${money}${who}`
      : `${fresh.length} new orders (latest #${newest.id} — ${money})`;
    unseen += fresh.length;
    paintBadge();
    toast(text, () => switchTab('orders'));
    chime();
    systemNotify("Jai'fore — new order", text);
    // keep open lists fresh
    const active = document.querySelector('.nav-item.active')?.dataset.tab;
    if (active === 'orders' || active === 'overview') switchTab(active);
  }

  async function tick() {
    if (busy || !token || document.getElementById('dashboard').classList.contains('hidden')) return;
    busy = true;
    try {
      const orders = await fetchJson(`${API}/api/orders`, { headers: authHeaders() });
      const maxId = orders.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
      if (lastId === null) {
        const stored = Number(store.get(KEY_LAST));
        lastId = stored > 0 ? stored : maxId;      // first ever run: no alert for old orders
      }
      const fresh = orders.filter(o => Number(o.id) > lastId).sort((a, b) => b.id - a.id);
      if (maxId > lastId) { lastId = maxId; store.set(KEY_LAST, String(maxId)); }
      if (fresh.length) announce(fresh);
    } catch (e) { /* offline or token expired: try again next tick */ }
    busy = false;
  }

  // ── Web push (works with the page closed) ──
  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !token) return;
    if (Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { publicKey } = await fetchJson(`${API}/api/push/key`, { headers: authHeaders() });
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      }
      await fetch(`${API}/api/push/subscribe`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
    } catch (e) { /* push not configured yet or unsupported: in-page alerts still work */ }
  }

  // ── Header controls ──
  function paintControls() {
    const enable = document.getElementById('alertEnable');
    const mute = document.getElementById('alertMute');
    if (!enable || !mute) return;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    enable.hidden = perm === 'granted' && audioCtx && audioCtx.state === 'running';
    enable.textContent = perm === 'denied' ? 'Alerts blocked in browser' : 'Enable alerts';
    enable.disabled = perm === 'denied';
    mute.textContent = muted() ? '🔕' : '🔔';
    mute.setAttribute('aria-label', muted() ? 'Unmute order sound' : 'Mute order sound');
    mute.title = mute.getAttribute('aria-label');
  }

  document.getElementById('alertEnable')?.addEventListener('click', async () => {
    unlockAudio();
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    subscribePush();
    const wasMuted = muted();
    store.set(KEY_MUTE, '0');
    chime();                                   // test sound
    if (wasMuted) store.set(KEY_MUTE, '1');
    paintControls();
  });
  document.getElementById('alertMute')?.addEventListener('click', () => {
    store.set(KEY_MUTE, muted() ? '0' : '1');
    unlockAudio();
    if (!muted()) chime();
    paintControls();
  });
  document.querySelector('.nav-item[data-tab="orders"]')?.addEventListener('click', clearUnseen);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); paintControls(); }
  });

  window.startOrderAlerts = function () {
    paintControls();
    subscribePush();   // refreshes the saved subscription (silent if not permitted)
    if (timer) return;
    setTimeout(tick, 1500);
    timer = setInterval(tick, POLL_MS);
  };
  window.stopOrderAlerts = function () {
    clearInterval(timer); timer = null; lastId = null; clearUnseen();
  };
})();
