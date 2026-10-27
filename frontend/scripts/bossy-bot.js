/* ================================
   JAIFORE — BOSSY BOT LAUNCHER AND CHAT
   scripts/bossy-bot.js

   One script tag per page: it injects the animated mascot launcher, the teaser
   bubble and the chat panel itself. The chat mirrors the app (jaifore-mobile
   bossyStore.ts): POST /api/bossy/chat with { message, conversationId }, replies
   carry optional "products" and "open_contact" actions. Everything the customer
   or the bot wrote is rendered with textContent, never innerHTML.

   Launcher states are class names (is-open, is-thinking, bossy-x-*), so a Rive
   state machine can drive them later.
   ================================ */
(function () {
  const API = 'https://jai-fore-production.up.railway.app';
  const IMG = 'images/bossy/';
  const STORAGE_KEY = 'bossy:chat';
  const TEASER_KEY = 'bossy:teaser';
  const KEEP_MESSAGES = 30;
  const MAX_LENGTH = 1000;
  const GREETING = "Bossy Bot here. Tell me what you need and I'll tell you what to buy.";
  const FAIL_TEXT = 'Bossy Bot is taking a breather. Check your connection and try again.';

  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '') || 'index';
  const CALM = page === 'checkout' || page === 'configurator';   // people are paying or designing
  const TEASERS = {
    services:     ['Need help picking a size? Ask me.', 'Not sure what to get? I pick fast.'],
    category:     ['Want me to narrow this down? Just ask.', 'Tell me your budget and I will find it.'],
    configurator: [],
    checkout:     [],
  };
  const DEFAULT_TEASERS = ['Need something? I am right here, boss.', 'Ask me anything about Jai’fore.'];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const picture = (name, w, h, alt, cls) => {
    const pic = el('picture');
    const src = el('source'); src.type = 'image/webp'; src.srcset = `${IMG}${name}.webp`;
    const img = el('img', cls); img.src = `${IMG}${name}.png`;
    img.width = w; img.height = h; img.alt = alt || ''; img.decoding = 'async';
    pic.append(src, img);
    return pic;
  };

  /* ── state ───────────────────────────────────────── */
  let messages = [];            // { role: 'user' | 'bot', text, actions?, retry? }
  let conversationId = null;
  let sending = false;
  let lastFailed = null;
  let panelOpen = false;
  let fullImageLoaded = false;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.messages)) {
      messages = saved.messages.filter(m => m && typeof m.text === 'string');
      conversationId = typeof saved.conversationId === 'string' ? saved.conversationId : null;
    }
  } catch { /* storage is a convenience; the chat works without it */ }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        conversationId,
        messages: messages.filter(m => !m.retry).slice(-KEEP_MESSAGES),
      }));
    } catch { /* ignore */ }
  }

  /* ── markup ──────────────────────────────────────── */
  document.documentElement.classList.toggle('bossy-calm', CALM);

  const launcher = el('button', 'bossy-launcher');
  launcher.id = 'bossyLauncher';
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Chat with Bossy Bot');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'bossyPanel');
  const body = el('span', 'bossy-body');
  body.append(picture('bossy-head', 160, 160, ''));
  const bob = el('span', 'bossy-bob'); bob.append(body);
  const close = el('span', 'bossy-close');
  close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  launcher.append(el('span', 'bossy-glow'), el('span', 'bossy-shadow'), bob, close);

  const teaser = el('button', 'bossy-teaser');
  teaser.type = 'button';
  teaser.setAttribute('aria-hidden', 'true');
  teaser.tabIndex = -1;

  const panel = el('section', 'bossy-panel');
  panel.id = 'bossyPanel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat with Bossy Bot');

  const head = el('header', 'bossy-head');
  const avatarSlot = el('span');           // the full-body image loads here on first open
  const headText = el('div');
  headText.append(el('h2', 'bossy-title', 'Bossy Bot'), el('p', 'bossy-sub', 'Your Jai’fore shopping boss'));
  head.append(avatarSlot, headText);

  const thread = el('div', 'bossy-thread');
  thread.setAttribute('role', 'log');
  thread.setAttribute('aria-live', 'polite');

  const form = el('form', 'bossy-form');
  const input = el('input', 'bossy-input');
  input.type = 'text'; input.maxLength = MAX_LENGTH; input.autocomplete = 'off';
  input.placeholder = 'Ask Bossy anything about Jai’fore';
  input.setAttribute('aria-label', 'Message for Bossy Bot');
  const send = el('button', 'bossy-send', 'Send');
  send.type = 'submit';
  form.append(input, send);

  panel.append(head, thread, form);
  document.body.append(launcher, teaser, panel);

  /* ── rendering ───────────────────────────────────── */
  function priceText(p) {
    if (typeof p.price !== 'number') return p.category === 'design' ? 'Pick a print size at checkout' : 'Enquiry only';
    try { if (window.JaiforeCurrency) return window.JaiforeCurrency.format(p.price); } catch { /* fall through */ }
    return `$${p.price.toFixed(2)}`;
  }

  function productCards(items) {
    const wrap = el('div', 'bossy-cards');
    for (const p of items) {
      const a = el('a', 'bossy-card');
      a.href = p.link;
      const img = el('img');
      img.width = 48; img.height = 48; img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
      if (p.image_url) img.src = typeof window.jfThumb === 'function' ? window.jfThumb(p.image_url) : p.image_url;
      const info = el('span');
      info.append(el('span', 'bossy-card-name', p.name), el('br'), el('span', 'bossy-card-price', priceText(p)));
      a.append(img, info);
      wrap.append(a);
    }
    return wrap;
  }

  function render() {
    thread.replaceChildren();

    const greet = el('div', 'bossy-greet');
    greet.append(picture('bossy-full', 215, 400, 'Bossy Bot', ''), el('span', null, GREETING));
    const gi = greet.querySelector('img'); gi.loading = 'lazy';
    thread.append(greet);

    for (const m of messages) {
      thread.append(el('div', `bossy-msg bossy-msg--${m.role}`, m.text));
      for (const a of m.actions || []) {
        if (a.type === 'products' && Array.isArray(a.items)) thread.append(productCards(a.items));
      }
      if (m.retry) {
        const r = el('button', 'bossy-retry', 'Try again');
        r.type = 'button';
        r.addEventListener('click', retry);
        thread.append(r);
      }
    }
    if (sending) {
      const t = el('div', 'bossy-typing');
      t.append(el('span'), el('span'), el('span'));
      t.setAttribute('aria-label', 'Bossy Bot is typing');
      thread.append(t);
    }
    thread.scrollTop = thread.scrollHeight;
  }

  function setSending(on) {
    sending = on;
    head.classList.toggle('is-thinking', on);
    send.disabled = on;
    render();
  }

  /* ── chat ────────────────────────────────────────── */
  async function request(text) {
    const headers = { 'Content-Type': 'application/json' };
    let token = null;
    try { token = localStorage.getItem('jaifore_token'); } catch { /* guest */ }
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}/api/bossy/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(conversationId ? { message: text, conversationId } : { message: text }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || FAIL_TEXT);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function sendMessage(raw) {
    const text = raw.trim().slice(0, MAX_LENGTH);
    if (!text || sending) return;
    messages = messages.filter(m => !m.retry);
    messages.push({ role: 'user', text });
    lastFailed = null;
    setSending(true);
    try {
      const data = await request(text);
      conversationId = data.conversationId;
      const actions = Array.isArray(data.actions) ? data.actions : [];
      messages.push({ role: 'bot', text: data.reply, actions });
      sending = false;
      persist();
      head.classList.remove('is-thinking'); send.disabled = false;
      render();
      if (actions.some(a => a.type === 'open_contact') && typeof window.openContactPopup === 'function') {
        window.openContactPopup();
      }
    } catch (err) {
      // 429 carries Bossy's own in-character message; show it as a normal reply.
      const limited = err.status === 429;
      if (!limited) lastFailed = text;
      messages.push({ role: 'bot', text: limited ? err.message : FAIL_TEXT, retry: !limited });
      setSending(false);
    }
  }

  function retry() {
    const text = lastFailed;
    if (!text) return;
    messages = messages.filter(m => !m.retry);
    if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
    sendMessage(text);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    sendMessage(text);
  });

  /* ── open and close ──────────────────────────────── */
  function loadFullImage() {
    if (fullImageLoaded) return;
    fullImageLoaded = true;
    avatarSlot.replaceWith(picture('bossy-full', 215, 400, 'Bossy Bot', 'bossy-avatar'));
    render();
  }

  function setOpen(open) {
    panelOpen = open;
    panel.classList.toggle('is-open', open);
    launcher.classList.toggle('is-open', open);
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close chat' : 'Chat with Bossy Bot');
    hideTeaser();
    if (open) {
      loadFullImage();
      render();
      setTimeout(() => input.focus(), 220);
    } else {
      launcher.focus();
    }
  }

  launcher.addEventListener('click', () => {
    if (!reduceMotion.matches && !panelOpen) {
      launcher.classList.add('bossy-boing');
      setTimeout(() => launcher.classList.remove('bossy-boing'), 480);
    }
    setOpen(!panelOpen);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelOpen) setOpen(false); });

  /* ── idle extras: one small move every 8-10 seconds ─ */
  const EXTRAS = ['bossy-x-tilt', 'bossy-x-hop', 'bossy-x-wiggle'];
  let extraTimer = null;
  function scheduleExtra() {
    clearTimeout(extraTimer);
    if (CALM || reduceMotion.matches || document.hidden) return;
    extraTimer = setTimeout(() => {
      if (!panelOpen && !document.hidden) {
        const cls = EXTRAS[Math.floor(Math.random() * EXTRAS.length)];
        launcher.classList.add(cls);
        setTimeout(() => launcher.classList.remove(cls), 1200);
      }
      scheduleExtra();
    }, 8000 + Math.random() * 2000);
  }

  /* ── teaser: once per session, never on checkout ─── */
  let teaserTimer = null;
  let teaserHide = null;
  function hideTeaser() {
    clearTimeout(teaserTimer); clearTimeout(teaserHide);
    teaser.classList.remove('is-shown');
    teaser.setAttribute('aria-hidden', 'true');
  }
  function maybeShowTeaser() {
    if (CALM) return;
    try { if (sessionStorage.getItem(TEASER_KEY)) return; } catch { /* show it; worst case it repeats */ }
    const lines = (TEASERS[page] && TEASERS[page].length) ? TEASERS[page] : DEFAULT_TEASERS;
    // Wait out the first-visit tour and the cookie bar, which sit on top of the corner.
    const blocked = () => document.getElementById('cookieAccept') || document.querySelector('#tourOverlay.open');
    let waited = 0;
    const tryShow = () => {
      if (panelOpen) return;
      if (document.hidden || blocked()) {
        waited += 3000;
        if (waited < 60000) teaserTimer = setTimeout(tryShow, 3000);
        return;
      }
      teaser.textContent = lines[Math.floor(Math.random() * lines.length)];
      teaser.setAttribute('aria-hidden', 'false');
      teaser.classList.add('is-shown');
      try { sessionStorage.setItem(TEASER_KEY, '1'); } catch { /* ignore */ }
      teaserHide = setTimeout(hideTeaser, 6000);
    };
    teaserTimer = setTimeout(tryShow, 10000);
  }
  teaser.addEventListener('click', () => setOpen(true));

  /* ── pause when the tab is hidden ────────────────── */
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('bossy-paused', document.hidden);
    if (document.hidden) clearTimeout(extraTimer); else scheduleExtra();
  });
  reduceMotion.addEventListener('change', scheduleExtra);

  scheduleExtra();
  maybeShowTeaser();
})();
