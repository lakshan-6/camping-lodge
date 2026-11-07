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

Sync the Blueprint after updating `render.yaml` to generate `PAST_ORDER_DELETE_KEY` for an existing Render service. Find it under the service's Environment settings. Keep it private and separate from `SETUP_KEY`; the frontend never receives it automatically. You can replace it with a private key of 12 to 128 characters, including letters, digits and symbols such as `@`. Save it only in Render's environment settings. For local use, run `npm run configure-auth` in `server`; existing strong authentication keys and valid custom delete keys are preserved.

The owner sees **Delete past order** on completed orders. The dialog previews the counts and net payments to remove, requires the access key and exact order number, and explains that removal cannot be undone. Admins and staff cannot preview or delete even if they know the key. There are five deletion attempts per owner per 15 minutes per server process. Active rentals must be returned first.

Permanent deletion removes the order, order items, payments/refunds, invoices, rentals, returns, return items and related inventory transaction records in one MongoDB transaction. Dashboard, report totals and history update because the underlying records are removed. Shared customer/equipment records and physical stock quantities stay unchanged; no real money is refunded, and PDFs already downloaded or sent cannot be recalled. The **Previously hidden past orders** checkbox lets the owner select old completed orders hidden by an earlier version for permanent deletion. Deploying this feature does not delete any existing data automatically.

All core business writes now require MongoDB transactions (MongoDB Atlas or a replica set). A standalone local MongoDB fails closed with no changes; there is no nontransactional fallback. The current single-service deployment serializes business writes and permanent deletion. Keep one application instance; introduce distributed coordination before scaling out. Persistent counters initialized at startup prevent order/invoice numbers from being reused after removal. Permanent deletion also removes security-deposit ledger entries and related retry records. Audit events and previously created backups remain until their normal retention/removal; deleting an order does not rewrite downloaded copies or historical backups.

Regression tests use model doubles by default. To run the real MongoDB transaction/rollback test locally, set `TEST_MONGOD_PATH` to your installed `mongod.exe` path and run `node --test test/order-deletion.integration.test.js` from `server`. It creates its own temporary replica set and deletes only its temporary test data, without reading `server/.env` or connecting to the application database.

## Updating an existing deployment

After pushing this update, open the existing Render Blueprint and use **Manual sync**. Review that its service remains on the free plan. The Blueprint adds a privately generated `BACKUP_ENCRYPTION_KEY`; do not replace existing `AUTH_SECRET`, `SETUP_KEY` or `PAST_ORDER_DELETE_KEY`. If the build does not start automatically, open the existing web service and choose **Manual Deploy > Deploy latest commit**. No additional paid service is requested by this update.

Keep a secure recovery copy of `BACKUP_ENCRYPTION_KEY` outside Render. Backups require this exact key to decrypt; rotating it makes older snapshots unreadable. Locally, `npm run configure-auth` generates the backup key without overwriting an existing valid one. Manual deployments without a Blueprint must supply a private random backup key of at least 32 characters.

Owners get a Backups screen. Daily snapshots run after startup and then check hourly while the service is awake, retaining the latest seven snapshots in the same MongoDB database. Sleeping free services do not run scheduled work. These snapshots help recover accidental edits; they do not protect against loss of the whole database. Download encrypted copies to separate private storage regularly. Snapshot limits are 8 MB compressed/encrypted and 32 MB uncompressed, with 50,000 documents per collection on restore. Configure external backups before exceeding these limits.

Restore is owner-only, requires the owner delete access key plus the literal confirmation `RESTORE`, validates the encrypted contents, creates a pre-restore snapshot and replaces application collections atomically. All accounts must sign in again. The restored owner/password come from that backup. Keep the backup encryption key independent of the owner access key.

Existing customers, orders and payments are preserved on upgrade. Historical `Payment.type=deposit` entries remain rental advances; they are not automatically converted into the new refundable security-deposit ledger. Staff now receive only booking/customer/pickup/return permissions by default. The owner can grant money collection, refunds, reports, expenses, inventory and fee-waiver permissions individually through **Staff Access > Permissions**. Admin accounts retain broad business access; backup restore and permanent past-order deletion remain owner-only.
