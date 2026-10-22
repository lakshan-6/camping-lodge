# Camping Lodge Management System
Camping Lodge · 071 552 4499 · LKR

## Run
1. Install MongoDB locally (or create a free MongoDB Atlas cluster).
2. Server:  `cd server && cp .env.example .env && npm install && npm run dev`  (http://localhost:5000)
3. Client:  `cd client && npm install && npm run dev`  (http://localhost:5173, proxies /api to the server)

## Structure
- server/models/index.js: Equipment, Customer, Order, OrderItem, Rental, Return, ReturnItem, Payment, Invoice, InventoryTransaction
- server/routes/: one file per feature (equipment done; add orders, rentals, returns, ... next)
- client/src/pages/: one file per page (Inventory done; others are placeholders)
