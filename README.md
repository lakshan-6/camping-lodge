# Camping Lodge Management System
Camping Lodge · 071 552 4499 · LKR

## Run
1. Use MongoDB Atlas, or configure your local MongoDB as a replica set. Business writes require transactions; a standalone MongoDB cannot save them safely.
2. Server:  `cd server && cp .env.example .env && npm install && npm run configure-auth && npm run dev`  (http://localhost:5000)
3. Client:  `cd client && npm install && npm run dev`  (http://localhost:5173, proxies /api to the server)

## Structure

The interface adapts to phones, tablets and desktops. Desktop navigation is grouped by task; phones have a menu drawer and quick links at the bottom. Tables become labelled cards on narrow screens. Dialogs support keyboard focus, Escape where a safe close action exists, and focus return. Money tabs support arrow-key navigation. Motion preferences and printable invoice layouts are respected.

- server/models/index.js: database models for rentals, inventory, finance, access, audit and backups.
- server/routes/: authenticated feature APIs with permissions and transactional business writes.
- client/src/pages/: application screens. See [WORKFLOWS.md](WORKFLOWS.md) for daily use and [DEPLOYMENT.md](DEPLOYMENT.md) for deployment.

## Authentication security
- Run `npm run configure-auth` in `server` before first start to generate AUTH_SECRET and SETUP_KEY in the ignored .env file. Existing strong keys are preserved.
- First owner setup requires SETUP_KEY from server/.env. Keep it private; it is never sent by the status endpoint. Setup is serialized by a MongoDB bootstrap lock across server processes. A crash during setup fails closed; inspect users before manually clearing an abandoned owner-setup lock.
- New and reset passwords require 12 to 128 characters. Existing passwords still work.
- Logout revokes all sessions for that account. Password reset and disabling an account also invalidate existing tokens. Secret rotation logs everyone out.
- Login and setup are limited to 10 attempts per IP per 15 minutes and 60 total per minute per server process. Use a shared limiter store for multiple instances; do not enable trust proxy without configuring trusted proxy addresses.
- Use HTTPS for deployment and keep development servers private.
- Run `npm test` in server for security regression tests.

## Full verification

Set `TEST_MONGOD_PATH` to an installed `mongod.exe`, then run `npm test` in `server`. The integration suites create isolated temporary replica sets, verify real transactions and clean them up; they do not read the application `.env` or connect to its database. Without this variable, integration suites are explicitly skipped. Build the frontend with `npm run build` in `client`.

For a disposable browser smoke test, build the frontend, set `TEST_MONGOD_PATH`, and run `node scripts/smoke-app.js` from `server`. It listens on loopback port 5099 using temporary fixtures only (login `smoke_owner`, password `SmokeTestOnly123!`). Enter any line in that terminal to stop and clean up the temporary database. These credentials are test fixtures and never create a production account.
