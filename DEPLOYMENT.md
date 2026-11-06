# Render + MongoDB Atlas deployment

This configuration runs the React build and Express API on one Render URL. It starts with a new Atlas database; local data is untouched.

1. Push the updated project, including `render.yaml`, to your GitHub repository. Never upload `server/.env`.
2. In MongoDB Atlas, create a cluster and a database user restricted to `readWrite` on `camping_lodge`. Copy the Node.js driver connection string, use the URL-encoded database password, and set the database path to `/camping_lodge` (before any `?` query).
3. In Render, select **New > Blueprint**, connect the GitHub repository and review `render.yaml`. This requests the free web service plan; review the dashboard's current limits before creating it. SMTP invoice delivery is optional and is not configured by this Blueprint.
4. Set `MONGODB_URI` in Render's private environment settings. `AUTH_SECRET` and `SETUP_KEY` are generated privately by Render. Do not paste them in chat or commit them.
5. Find the service's outbound IP ranges in Render and add those ranges to Atlas's Network Access IP list. Retry the deployment if its first attempt could not connect.
6. Wait for a successful deployment, then open `/api/health` on the Render URL and confirm `db` is `connected`.
7. Open the main URL. Copy `SETUP_KEY` from the Render environment dashboard into the first owner setup form and choose a new owner password of 12–128 characters. Local login accounts do not exist in this new database.
8. Verify login, inventory, orders, payments and logout on the live URL. A browser refresh on `/orders` should also work.

Manual web service settings, if not using a Blueprint:

- Root directory: repository root (leave blank).
- Build: `npm ci --prefix server && npm ci --prefix client --include=dev && npm run build --prefix client`
- Start: `npm start --prefix server`
- Health check: `/api/health`
- Node: 24.22.1; `NODE_ENV=production`; `TRUST_PROXY_HOPS=1`.
- Supply `MONGODB_URI`, and independently generated random `AUTH_SECRET` and `SETUP_KEY` (32 bytes or more).

`TRUST_PROXY_HOPS=1` is intended for the Render proxy in front of this service. Recheck the proxy topology before using another host. Run one service instance while the login limiter uses its in-memory store.

Keep the Vite development server private; it is not used for production. Optional invoice email requires SMTP environment variables and a hosting plan that supports your SMTP provider's outbound port. Do not commit SMTP credentials.

## Owner deletion of past orders

Sync the Blueprint after updating `render.yaml` to generate `PAST_ORDER_DELETE_KEY` for an existing Render service. Find it under the service's Environment settings. Keep it private and separate from `SETUP_KEY`; the frontend never receives it automatically. For manual setup, use an independent random value of at least 32 bytes and save it only in Render's environment settings. For local use, run `npm run configure-auth` in `server`; existing strong authentication keys are preserved.

The owner sees **Delete past order** on completed orders and must enter this key on every deletion. Admins and staff cannot use the endpoint even if they know the key. There are five attempts per owner per 15 minutes per server process. Active rentals must be returned first. Deletion hides the completed order from Orders/Calendar while preserving its completed status, financial totals, payments, invoices, returns and inventory records. The deletion time and owner ID are recorded. No existing orders are deleted by deploying this feature.
