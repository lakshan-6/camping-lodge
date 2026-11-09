# Render + Neon PostgreSQL deployment

The React build and Express API run on one Render URL. PostgreSQL is the default backend. For the existing MongoDB deployment, follow [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md) first: deploy the explicit MongoDB bridge, rehearse the import, freeze the source and verify the PostgreSQL cutover. Do not point an existing installation at an empty database and create another owner.

## New installation

1. Create a Neon **Free** PostgreSQL project in the same region as the Render service where available. Enable only the PostgreSQL database; this app manages its own accounts and does not use Neon Better Auth. Review the provider's current free quotas before creating resources.
2. Create a Render **Free** web service from this repository. Use the repository root, leaving Root Directory blank.
3. Set the build command to `npm ci --prefix server && npm ci --prefix client --include=dev && npm run build --prefix client`, start command to `npm start --prefix server` and health check path to `/api/health`.
4. Set `DB_DRIVER=postgres`, the private Neon `DATABASE_URL`, `NODE_ENV=production`, `NODE_VERSION=24.22.1` and `TRUST_PROXY_HOPS=1`. Use Neon's pooled connection URL. The application verifies remote TLS certificates and uses up to five database connections.
5. Privately generate separate `AUTH_SECRET`, `SETUP_KEY` and `BACKUP_ENCRYPTION_KEY` values with at least 32 random bytes each. Set `PAST_ORDER_DELETE_KEY` to a private value of 12-128 characters. Never put connection strings or keys in Git or chat. Keep a secure recovery copy of the backup encryption key outside Render.
6. Deploy, then confirm `/api/health` reports `database: postgresql` and `db: connected`.
7. Open the main URL and create the first owner using the private `SETUP_KEY`. Choose an owner password of 12-128 characters. Check login, inventory, orders, payments and a browser refresh on `/orders`.

`render.yaml` configures the free PostgreSQL web service and prompts for the private DATABASE_URL. For a new installation, **New > Blueprint** is an alternative to the manual settings above. For an existing MongoDB installation, use the migration bridge commit and the two-phase procedure before syncing the final PostgreSQL Blueprint. The production cutover was verified on 9 November 2026; keep the frozen Atlas source as a recovery copy.

Keep one application instance while login rate limiting uses an in-memory store. `TRUST_PROXY_HOPS=1` describes the Render proxy topology; review it before changing hosts. The Vite development server is not used in production. Invoice email is optional and uses separate SMTP settings.

## Automatic booking confirmation emails

Render Free blocks common SMTP ports. New order confirmations use the [Brevo transactional HTTPS API](https://developers.brevo.com/docs/send-a-transactional-email) instead.

1. Create or sign in to a Brevo account with transactional sending enabled. [Verify a sender address](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email). An authenticated business domain is recommended for stable sender identity and deliverability.
2. Create a Brevo API key. In the existing Render service's **Environment** settings, set `BREVO_API_KEY` privately and `BOOKING_EMAIL_FROM` to the verified address. Save and deploy the updated code. Do not commit the key or paste it in chat.
3. New bookings with a valid customer email then send a confirmation with the order number, items, Sri Lanka pickup/return times, rental total, recorded payment, balance and security plan. The email omits the customer's NIC number, address and phone number. The order page shows whether the sending service accepted the email. Check delivery in Brevo's transactional logs.

Missing email, missing configuration and provider errors do not undo bookings. A repeated submission with the same request ID does not send again. A rejected or timed-out email is not retried automatically, since a timeout can occur after the provider accepts it. Existing orders are not emailed when this is enabled. The built-in local database mode disables outgoing mail.

## Existing installation updates

Deploy the latest tested commit through the existing Render service. Preserve `AUTH_SECRET`, `SETUP_KEY`, `PAST_ORDER_DELETE_KEY` and `BACKUP_ENCRYPTION_KEY`. Changing the backup key also prevents decryption of existing backups and authenticator secrets. Existing account IDs, password hashes, session versions, orders and monetary history survive PostgreSQL migration.

The owner grants staff permissions through **Staff Access > Permissions**. Admins retain broad business access; backup restore and permanent past-order deletion remain owner-only. Optional owner 2FA is configured in Account security. Historical `Payment.type=deposit` entries remain rental advances; migration does not convert them into refundable security deposits.

## Permanent order deletion

The owner sees **Delete past order** on completed orders. The dialog previews related records and net payments, requires the owner access key and exact order number, and explains that removal cannot be undone. Active rentals must be returned first. There are five deletion attempts per owner per 15 minutes per server process.

Deletion removes the order and its order items, payments/refunds, invoices, rentals, returns, return items, security-deposit ledger entries, inventory transactions and related retry records in one PostgreSQL transaction. Reports update because their underlying records are removed. Shared customers/equipment and physical stock quantities remain. No real money is refunded. Existing PDFs, audit events and previously created backups are not rewritten. Persistent counters prevent order/invoice numbers being reused.

## Backups and recovery

Owners can create, download and verify encrypted backups in Backups. Scheduled snapshots check hourly while the service is awake, retain the latest seven snapshots in the same database and do not run while a free service sleeps. These copies help with accidental edits but do not protect against loss of the whole database. Keep downloaded encrypted copies in separate private storage.

Restore requires the owner access key and the literal confirmation `RESTORE`. It validates references, creates a pre-restore snapshot and replaces application data atomically. All accounts must sign in again using the accounts/passwords from the restored snapshot. Version-1 MongoDB backups remain readable with the original backup encryption key.

Snapshot limits are 8 MB compressed/encrypted and 32 MB uncompressed, with 50,000 records per model on restore. Configure external backups before exceeding these limits. Follow [EXTERNAL_BACKUPS.md](EXTERNAL_BACKUPS.md) for optional private storage. Without those settings, the UI shows external storage as disconnected. Verify a real upload/download after configuring a bucket.

## Verification

Run `npm test --prefix server` for disposable PostgreSQL integration and security tests. Tests do not read `server/.env` or connect to production. The optional native MongoDB bridge test uses `TEST_MONGOD_PATH` and a temporary replica set; see [POSTGRES_MIGRATION.md](POSTGRES_MIGRATION.md). Finish deployment by checking the hosted TLS connection, existing account login, balances, unit allocations and backup verification.

Free hosting has usage and sleep limits. Review [Render Free](https://render.com/docs/free) and [Neon pricing](https://neon.com/pricing); this configuration does not request a paid database or service plan.
