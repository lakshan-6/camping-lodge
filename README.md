# Camping Lodge Management System
Camping Lodge · 071 552 4499 · LKR

## Run
1. Install MongoDB locally (or create a free MongoDB Atlas cluster).
2. Server:  `cd server && cp .env.example .env && npm install && npm run configure-auth && npm run dev`  (http://localhost:5000)
3. Client:  `cd client && npm install && npm run dev`  (http://localhost:5173, proxies /api to the server)

## Structure
- server/models/index.js: Equipment, Customer, Order, OrderItem, Rental, Return, ReturnItem, Payment, Invoice, InventoryTransaction
- server/routes/: one file per feature (equipment done; add orders, rentals, returns, ... next)
- client/src/pages/: one file per page (Inventory done; others are placeholders)

## Authentication security
- Run `npm run configure-auth` in `server` before first start to generate AUTH_SECRET and SETUP_KEY in the ignored .env file. Existing strong keys are preserved.
- First owner setup requires SETUP_KEY from server/.env. Keep it private; it is never sent by the status endpoint. Setup is serialized by a MongoDB bootstrap lock across server processes. A crash during setup fails closed; inspect users before manually clearing an abandoned owner-setup lock.
- New and reset passwords require 12 to 128 characters. Existing passwords still work.
- Logout revokes all sessions for that account. Password reset and disabling an account also invalidate existing tokens. Secret rotation logs everyone out.
- Login and setup are limited to 10 attempts per IP per 15 minutes and 60 total per minute per server process. Use a shared limiter store for multiple instances; do not enable trust proxy without configuring trusted proxy addresses.
- Use HTTPS for deployment and keep development servers private.
- Run `npm test` in server for security regression tests.
