/* ================================
   JAIFORE — 3D HERO LOGO
   frontend/scripts/hero-3d.js

   Turns the homepage hero logo (inside .logo-ring) into a glossy 3D badge.
   The flat <img> stays on screen until the first 3D frame is drawn, and stays
   for good if WebGL, three.js or the texture fails, so this is enhancement only.

   - three.js r128 loads from cdn.jsdelivr.net (allowed in the CSP in vercel.json)
     after the page has loaded, with an integrity hash.
   - Texture: logo/jaifore-1024.webp (made by tools/make-logo.js).
   - Stops drawing when the hero is off screen or the tab is hidden.
   - prefers-reduced-motion: drawn once, standing still.
   ================================ */
(function () {
  const ring = document.querySelector('#heroImg .logo-ring');
  const flatImg = ring && ring.querySelector('img');
  if (!ring || !flatImg) return;

  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js';
  const THREE_SRI = 'sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu';
  const TEXTURE = 'logo/jaifore-1024.webp';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function webglOk() {
    try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); }
    catch (e) { return false; }
  }
  if (!webglOk()) return;

  function loadThree() {
    return new Promise((resolve, reject) => {
      if (window.THREE) return resolve(window.THREE);
      const s = document.createElement('script');
      s.src = THREE_URL; s.integrity = THREE_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => (window.THREE ? resolve(window.THREE) : reject(new Error('three.js missing')));
      s.onerror = () => reject(new Error('three.js failed to load'));
      document.head.appendChild(s);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
  }

  function start() {
    Promise.all([loadThree(), loadImage(TEXTURE)])
      .then(([THREE, img]) => build(THREE, img))
      .catch(err => console.warn('[hero-3d] staying with the flat logo:', err && err.message));
  }
  if (document.readyState === 'complete') setTimeout(start, 200);
  else window.addEventListener('load', () => setTimeout(start, 200), { once: true });

  function build(THREE, img) {
    const canvas = document.createElement('canvas');
    canvas.className = 'hero-3d';
    canvas.setAttribute('aria-hidden', 'true');   // the flat img keeps the alt text
    ring.appendChild(canvas);

    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); }
    catch (e) { canvas.remove(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // Body shape from the logo's alpha, smoothed so it reads as one rounded piece
    const G = 512, sc = document.createElement('canvas'); sc.width = sc.height = G;
    const sx = sc.getContext('2d'); sx.drawImage(img, 0, 0, G, G);
    const px = sx.getImageData(0, 0, G, G).data;
    const alpha = new Float32Array(G * G), luma = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) { alpha[i] = px[i * 4 + 3] / 255; luma[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255 * alpha[i]; }
    const blur = (src, r) => {
      const t = new Float32Array(src.length), o = new Float32Array(src.length);
      for (let y = 0; y < G; y++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * G + Math.min(G - 1, Math.max(0, k))];
        for (let x = 0; x < G; x++) { t[y * G + x] = s / (2 * r + 1); s += src[y * G + Math.min(G - 1, x + r + 1)] - src[y * G + Math.max(0, x - r)]; } }
      for (let x = 0; x < G; x++) { let s = 0; for (let k = -r; k <= r; k++) s += t[Math.min(G - 1, Math.max(0, k)) * G + x];
        for (let y = 0; y < G; y++) { o[y * G + x] = s / (2 * r + 1); s += t[Math.min(G - 1, y + r + 1) * G + x] - t[Math.max(0, y - r) * G + x]; } }
      return o;
    };
    let body = alpha; for (let p = 0; p < 3; p++) body = blur(body, 6);
    let soft = luma; for (let p = 0; p < 2; p++) soft = blur(soft, 4);
    const sample = (arr, u, v) => {
      const fx = u * (G - 1), fy = (1 - v) * (G - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(G - 1, x0 + 1), y1 = Math.min(G - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      return (arr[y0 * G + x0] * (1 - ax) + arr[y0 * G + x1] * ax) * (1 - ay) + (arr[y1 * G + x0] * (1 - ax) + arr[y1 * G + x1] * ax) * ay;
    };

    const SIZE = 3.9, FOV = 26;
    function side(sign) {
      const n = 320, pos = [], uv = [], idx = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const u = i / n, v = j / n, h = Math.max(0, Math.min(1, (sample(body, u, v) - 0.5) * 2));
        const dome = Math.sin(Math.min(1, h * 1.4) * Math.PI / 2);
        const relief = sign > 0 ? 0.035 * sample(soft, u, v) : 0;
        pos.push((u - 0.5) * SIZE, (v - 0.5) * SIZE, sign * (0.006 + 0.14 * dome + relief * dome));
        uv.push(sign > 0 ? u : 1 - u, v);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        if (sign > 0) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    }

    // Studio lighting as an environment map: two soft boxes and a gentle floor bounce
    function studio() {
      const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#d9d2e2'); g.addColorStop(0.5, '#5a4b66'); g.addColorStop(1, '#16101c');
      x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
      const box = (cx, cy, w, h, a) => { const r = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h)); r.addColorStop(0, `rgba(255,255,255,${a})`); r.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = r; x.fillRect(cx - w * 1.5, cy - h * 1.5, w * 3, h * 3); };
      box(380, 150, 120, 70, 1); box(700, 190, 90, 60, 0.7); box(520, 60, 260, 40, 0.6);
      const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding;
      const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(t).texture; t.dispose(); pm.dispose();
      return env;
    }

    const front = new THREE.Texture(img); front.encoding = THREE.sRGBEncoding; front.anisotropy = renderer.capabilities.getMaxAnisotropy(); front.needsUpdate = true;
    const bc = document.createElement('canvas'); bc.width = bc.height = 1024; const bx = bc.getContext('2d');
    bx.drawImage(img, 0, 0, 1024, 1024);
    { const d = bx.getImageData(0, 0, 1024, 1024), q = d.data;   // solid dark backing wherever the artwork is mostly opaque
      for (let i = 0; i < q.length; i += 4) { const on = q[i + 3] >= 128; q[i] = 0x14; q[i + 1] = 0x0f; q[i + 2] = 0x1a; q[i + 3] = on ? 255 : 0; }
      bx.putImageData(d, 0, 0); }
    const backTex = new THREE.CanvasTexture(bc); backTex.encoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene(); scene.environment = studio();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
    const key = new THREE.DirectionalLight(0xffffff, 0.5); key.position.set(-2, 3, 5); scene.add(key);

    const logo = new THREE.Group(); scene.add(logo);
    logo.add(new THREE.Mesh(side(1), new THREE.MeshPhysicalMaterial({
      map: front, transparent: true, alphaTest: 0.01, roughness: 0.55, metalness: 0,
      clearcoat: 0.6, clearcoatRoughness: 0.18, envMapIntensity: 0.35, side: THREE.DoubleSide })));
    logo.add(new THREE.Mesh(side(-1), new THREE.MeshStandardMaterial({
      map: backTex, alphaTest: 0.5, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.4, side: THREE.DoubleSide })));

    // Size the camera so the 3D logo covers the same box as the flat img inside the ring
    function resize() {
      const w = ring.clientWidth, h = ring.clientHeight; if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h;
      const fill = Math.min(1, (flatImg.clientWidth || w * 0.88) / w);
      camera.position.z = (SIZE / fill) / 2 / Math.tan(FOV * Math.PI / 360);
      camera.updateProjectionMatrix(); draw(lastT);
    }

    let tx = 0, ty = 0, rx = 0, ry = 0, lastT = 0;
    window.addEventListener('pointermove', e => { const b = ring.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, (e.clientX - b.left) / b.width * 2 - 1)); ty = Math.max(-1, Math.min(1, (e.clientY - b.top) / b.height * 2 - 1)); }, { passive: true });
    window.addEventListener('deviceorientation', e => { if (e.gamma != null) { tx = Math.max(-1, Math.min(1, e.gamma / 35)); ty = Math.max(-1, Math.min(1, (e.beta - 45) / 35)); } });

    const ease = k => 1 - Math.pow(1 - k, 4);
    function draw(t) {
      lastT = t;
      const intro = reduced ? 1 : ease(Math.min(1, t / 1.8));
      rx += (ty * 0.14 - rx) * 0.06; ry += (tx * 0.28 - ry) * 0.06;
      const idle = reduced ? 0 : Math.sin(t * 0.32) * 0.12;
      logo.rotation.set(reduced ? 0 : rx + (1 - intro) * 0.25, reduced ? 0 : (1 - intro) * -0.7 + idle + ry, 0);
      logo.position.y = reduced ? 0 : Math.sin(t * 0.7) * 0.04 + (1 - intro) * -0.25;
      renderer.render(scene, camera);
    }

    let visible = true, raf = 0, t0 = performance.now(), shown = false;
    function tick() {
      raf = 0;
      if (reduced || !visible || document.hidden) return;
      draw((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(tick);
    }
    const wake = () => { if (!raf && !reduced) raf = requestAnimationFrame(tick); };

    new ResizeObserver(resize).observe(ring);
    new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) wake(); }).observe(ring);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

    resize();
    draw(reduced ? 99 : 0);
    if (!shown) { shown = true; ring.classList.add('is-3d'); t0 = performance.now(); }
    wake();
  }
})();
