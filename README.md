# Camping Lodge Management System
Camping Lodge · 071 552 4499 · LKR

## Run
1. Use PostgreSQL (local or a private Neon database) and set DATABASE_URL in server/.env. DB_DRIVER defaults to postgres. Existing Atlas deployments must follow [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) before switching.
2. Server:  `cd server && cp .env.example .env && npm install && npm run configure-auth && npm run dev`  (http://localhost:5000)
3. Client:  `cd client && npm install && npm run dev`  (http://localhost:5173, proxies /api to the server)

## Structure

The interface adapts to phones, tablets and desktops. Desktop navigation is grouped by task; phones have a menu drawer and quick links at the bottom. Tables become labelled cards on narrow screens. Dialogs support keyboard focus, Escape where a safe close action exists, and focus return. Money tabs support arrow-key navigation. Motion preferences and printable invoice layouts are respected.

- server/db/: PostgreSQL schema, parameterized repositories, pooling, transactions and verified migration.
- server/models/index.js: repository exports; validation.js retains existing schema validation and the explicit temporary MongoDB bridge.
- server/routes/: authenticated feature APIs with permissions and transactional business writes.
- client/src/pages/: application screens. See [WORKFLOWS.md](WORKFLOWS.md) for daily use and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment.

## Authentication security
- Run `npm run configure-auth` in `server` before first start to generate AUTH_SECRET and SETUP_KEY in the ignored .env file. Existing strong keys are preserved.
- First owner setup requires SETUP_KEY from server/.env. Keep it private; it is never sent by the status endpoint. Setup is serialized by a PostgreSQL transaction/advisory lock and a unique owner constraint.
- New and reset passwords require 12 to 128 characters. Existing passwords still work.
- Logout revokes all sessions for that account. Password reset and disabling an account also invalidate existing tokens. Secret rotation logs everyone out.
- Login and setup are limited to 10 attempts per IP per 15 minutes and 60 total per minute per server process. Use a shared limiter store for multiple instances; do not enable trust proxy without configuring trusted proxy addresses.
- Use HTTPS for deployment and keep development servers private.
- Run `npm test` in server for security regression tests.

## Full verification

Run `npm test` in `server`. Integration suites use isolated PGlite PostgreSQL databases with actual SQL constraints and rollback, without reading the application `.env` or connecting to its database. The optional MongoDB source-bridge test needs TEST_MONGOD_PATH; see POSTGRES_MIGRATION.md. Build the frontend with `npm run build` in `client`.

For a disposable browser smoke test, build the frontend and run `node scripts/smoke-app.js` from `server`. It listens on loopback port 5099 using temporary fixtures only (login `smoke_owner`, password `SmokeTestOnly123!`). Enter any line in that terminal to stop and clean up the temporary database. These credentials are test fixtures and never create a production account.
