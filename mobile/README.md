# Jai'fore mobile (Capacitor)

The phone app is the existing website wrapped by [Capacitor](https://capacitorjs.com).
Nothing is rewritten: `mobile/scripts/build-web.js` copies `frontend/` into `mobile/www/`
and Capacitor packages that folder. The admin panel and the service worker are left out of the app.

Status: **scaffold only.** No `android/` or `ios/` platform is added and no Android SDK is installed —
the cloud workflow below creates the Android project on the fly.

- App name: `Jai'fore` · App id: `com.jaifore.app` (change in `capacitor.config.json` *before* the first store upload — it can't change afterwards)

## 1. PWA first (works today, no store needed)
The site is an installable PWA: `frontend/manifest.webmanifest`, `frontend/sw.js`, `frontend/offline.html`,
icons in `frontend/icons/`, and `frontend/scripts/pwa.js` (loaded by every page) registers the worker.

- Needs **https** (Vercel is) or `localhost`. On Android Chrome: menu → *Install app*.
- The service worker caches pages/scripts/styles (network first) and images/fonts (cache first).
  It **never** caches `/api/*` — `/api/auth`, `/api/cart`, `/api/stripe`, `/api/orders` always hit the network.
- After a change to `sw.js`, bump `CACHE_VERSION` in it.
- Try it locally: `node dev/mock-server.js`, open http://localhost:5173, DevTools → Application → Service Workers.

## 2. Test on a physical Android phone over USB (no emulator, no Android Studio)
Cheapest route is the **cloud APK**:
1. GitHub → *Actions* → **Android debug APK** → *Run workflow* (manual only).
2. Download `jaifore-debug-apk` from the finished run, copy `app-debug.apk` to the phone, open it
   (allow "install unknown apps" once).

To iterate on the **web** side with a USB-connected phone, no app build is needed:
1. Phone: Settings → About → tap *Build number* 7× → Developer options → enable **USB debugging**.
2. Laptop: `sudo apt install adb`, plug in the phone, accept the prompt, check `adb devices`.
3. Run `node dev/mock-server.js` and `adb reverse tcp:5173 tcp:5173`.
4. On the phone open Chrome → `http://localhost:5173`. Inspect it from the laptop at `chrome://inspect`.

Local app build later (only if you install the Android SDK): `cd mobile && npm ci && npm run build:web &&
npx cap add android && npx cap sync android && npx cap run android`.

## 3. Stripe Checkout in the app
Checkout is a hosted Stripe page, so the app opens it in the **in-app browser** (add `@capacitor/browser`
when the platform is added, `Browser.open({ url })`). When the customer returns (`appStateChange`/`resume`
event, or the success URL), call `GET /api/stripe/session-status?session_id=…` — it answers `paid`
(with the order id) or `pending` — and then show the order. Orders are created by the Stripe webhook,
not by the app, so a closed app never loses a paid order.
The success/cancel URLs in `routes/stripe.js` are website URLs; for the app, either keep them (the in-app
browser lands on the site, the user taps back) or add a deep link later.

## 4. Store requirements
- **Google Play:** one-time developer registration fee (US$25) and a signed *release* build (AAB, not the debug APK).
- **Apple App Store:** Apple Developer Program, US$99/year, and a build made on macOS. With no Mac, use a
  cloud Mac (GitHub Actions `macos-latest`, Codemagic, or similar) — a separate workflow to add later.
- Both stores want a privacy policy URL (already in the site), screenshots, and an icon.

## 5. What breaks while the backend is offline
Pages open (they ship inside the app) but everything fetched from the API fails: catalog, login, cart sync,
orders, wishlist, checkout, Stripe. Each loader ends in an error message with a **Retry** button (12-second timeout)
instead of a blank screen or endless shimmer, and a small "You're offline" bar appears when the phone has no
connection. Plain-browser visits to an uncached page show `offline.html`.

## 6. The hard-coded API URL (replacement proposed, not done)
`frontend/scripts/config.js` now exposes `window.JAIFORE_CONFIG.API_BASE`, but the pages don't use it yet.
These files each hard-code `const API = 'https://jai-fore-production.up.railway.app'`:

- `frontend/admin/admin.js`
- `frontend/scripts/category.js`, `checkout.js`, `configurator.js`, `dashboard.js`, `loginsys.js`,
  `reset-password.js`, `services.js`, `wishlist.js`
- `frontend/data/cart.js` (as `CART_API_BASE = '…/api/cart'`)

Proposed change (awaiting approval): add `<script src="scripts/config.js"></script>` before each page's own
script and replace each constant with `const API = window.JAIFORE_CONFIG.API_BASE;`
(cart.js: `` const CART_API_BASE = `${window.JAIFORE_CONFIG.API_BASE}/api/cart`; ``). Then moving the backend is a one-line edit.

## 7. Backend CORS for the app
`backend/expressApp.js` now also allows `capacitor://localhost` (iOS), `https://localhost` (Android) and
`http://localhost`. Not live until the backend is redeployed.
