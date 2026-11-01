# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Two independently deployed halves:

- `backend/`: Node 22 + Express 5 (CommonJS) API, deployed on **Railway** (`https://jai-fore-production.up.railway.app`). PostgreSQL via `pg`, Redis via `ioredis`, Stripe, Resend/Nodemailer, Sentry, web-push, Anthropic SDK (Bossy Bot).
- `frontend/`: plain static HTML/CSS/JS, no framework and no build step. Deployed on **Vercel** (`https://jai-fore.vercel.app`). `frontend/package.json` holds build-time image tooling only (`sharp`).

## Commands

Backend (run from `backend/`):

```bash
npm install
cp .env.example .env      # then fill in values
npm run dev               # nodemon server.js
npm start                 # node server.js
npm run test:unit         # mocked suites only (what CI runs)
npm test                  # all suites, including cart.test.js, which needs a real DATABASE_URL
npx jest test/bossy.test.js            # one file
npx jest test/pricing.test.js -t "name" # one test by name
```

Frontend: serve `frontend/` statically. The backend's CORS allowlist expects `http://localhost:5501` or `http://127.0.0.1:5501` (VS Code Live Server). Image tooling: `npm run images` and `npm run logo` in `frontend/`.

CI (`.github/workflows/ci.yml`) runs only `npm run test:unit` in `backend/` on Node 22.

## Backend architecture

- **`expressApp.js` builds the app; `server.js` only runs migrations and calls `listen`.** Tests import `expressApp.js` directly with Supertest. Don't rename it to `app.js`: a casing collision between `app.js` and `App.js` once shipped a stale file to Railway's Linux build.
- Middleware order in `expressApp.js` matters:
  - Sentry init comes first.
  - The Stripe webhook (`/api/stripe/webhook`) is registered with `express.raw` **before** `express.json()` so signature verification sees the raw bytes.
  - `/api/stripe`, `/api/cart` and `/api/wishlist` get a 25mb JSON limit (base64 artwork) and `/api/uploads` gets 8mb. Everything else uses the default.
  - Rate limiters: `authLimiter` (8 per 15 min) on `/api/auth`, `paymentLimiter` (20) only on `/api/stripe/create-checkout-session`, and `generalLimiter` (300) on the rest.
  - When adding a route, mount it there with a limiter. PATCH must stay in the CORS `methods` list.
- **Orders are created by the Stripe webhook**, not by `/api/orders`. Checkout goes through `routes/stripe.js`, which loads the DB rows and calls the pure functions in `pricing.js`. Shipping constants live in `shippingRules.js`, which is shared by checkout and Bossy Bot.
- **Auth** (`auth.js`, `middleware.js`): JWT bearer tokens. `authenticate` sets `req.user`, and `requireAdmin` checks `req.user.role === 'admin'`. Registration is two-step OTP. Pending registrations and password-reset tokens live in Redis (`redis.js`: `cacheGet`/`cacheSet`/`cacheInvalidate`) so they survive Railway restarts.
- **Database schema** lives in `migrations/NNN_*.sql`. `migrate.js` applies unapplied files in order, each in its own transaction, under a Postgres advisory lock. It records them in `schema_migrations` and runs automatically on boot via `initDB()`. Never edit an applied migration; add a new higher-numbered file. RLS is enabled on tables (`004_enable_rls_remaining.sql`).
- **Bossy Bot** (the AI chat assistant): `routes/bossy.js` plus `bossyClient.js` (Anthropic client), `bossyPrompt.js`, `bossyTools.js` (read-only DB tool wrappers that return `{ result, actions }`, where `actions` drive the chat widget UI) and `bossyLog.js` (writes transcripts to `bossy_*` tables). Admins view transcripts through `routes/bossyAdmin.js`. Daily caps come from `BOSSY_USER_DAILY_CAP`/`BOSSY_GUEST_DAILY_CAP` and are counted in Redis.
- Customer artwork uploads go to Supabase Storage (`routes/uploads.js`). Product images are served from Supabase through a Vercel rewrite of `/images/:file` (`frontend/vercel.json`).

## Tests

- Jest config is in `backend/test/jest.config.js`. Tests run with `maxWorkers: 1`, so files run serially because some share DB rows.
- Most suites mock `../database`, `../redis`, `@sentry/node`, `@anthropic-ai/sdk`, `resend` and Stripe with `jest.mock`, and set `process.env.JWT_SECRET` etc. at the top of the file. Follow that pattern so new suites can run in CI without a DB.

## Frontend notes

- Each script in `frontend/scripts/` (and `admin/admin.js`, `data/cart.js`) hardcodes `const API = 'https://jai-fore-production.up.railway.app'`. There is no shared config, so a backend URL change must touch all of them.
- Values duplicated across the stack must stay in sync. For example, `MAX_DESIGNS` in `frontend/scripts/configurator.js` must match `MAX_DESIGNS_PER_LINE` in `backend/pricing.js`. Look for "Keep in sync" comments.
- `sw.js` is a service worker that caches only the app shell and never API traffic. Bump `CACHE_VERSION` when changing cached shell behaviour.
- The admin dashboard is in `frontend/admin/`. The backend also serves it statically at `/admin`.
