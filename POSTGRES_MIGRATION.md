# MongoDB to PostgreSQL migration

The default backend is PostgreSQL. React URLs and existing 24-character record IDs are preserved. Business data uses typed tables, numeric money columns, SQL indexes and deferred foreign keys. Individual order/return unit allocations and repair memberships use child tables. JSONB is reserved for variable metadata, checklists and audit/retry data. `server/models/validation.js` retains Mongoose only for validation/casting and the temporary legacy bridge; PostgreSQL repositories compile supported filters/aggregates into parameterized SQL. The PostgreSQL runtime never falls back to MongoDB when DATABASE_URL is missing.

## Free hosting

Keep the existing Render Free web service. Create a Neon **Free** project; do not select a paid compute plan. Match its region to the existing Render service where available. Keep the generated DATABASE_URL private and use the pooled Node/PostgreSQL connection option. This app uses a five-connection pool and validates TLS certificates for remote connections. Free quotas and sleep behaviour remain provider-specific; check https://neon.com/pricing and https://render.com/docs/free before creating resources. Render's free Postgres service has a time-limited lifetime, so it is not used for this migration.

## Phase 1: deploy the MongoDB bridge

1. On the existing Render service add **DB_DRIVER=mongodb**, leaving MONGODB_URI and all existing authentication/encryption keys unchanged.
2. Deploy the migration commit. Confirm `/api/health` reports `database: mongodb-migration-bridge` and the existing application still reads its existing data.
3. Create/download a recovery backup through Backups. Retain the exact original BACKUP_ENCRYPTION_KEY privately.

Do not regenerate AUTH_SECRET, SETUP_KEY, PAST_ORDER_DELETE_KEY or BACKUP_ENCRYPTION_KEY. Password hashes, account IDs, session versions and encrypted MFA secrets are preserved by the import.

## Phase 2: switch to PostgreSQL

Set these environment values together on the **existing** Render service, then deploy the same tested commit:

```text
DB_DRIVER=postgres
DATABASE_URL=<private Neon PostgreSQL URL>
AUTO_MIGRATE_FROM_MONGODB=true
MIGRATION_SOURCE_URL=https://camping-lodge.onrender.com
```

Retain the existing MONGODB_URI during this step. Do not put any private connection URL or keys in Git, screenshots, chat or shell output.

At startup, before exposing the new application, the migration:

1. Opens an isolated, read-only MongoDB snapshot and tries an exact import into the empty PostgreSQL target, including all deferred FK checks. This rehearsal rolls back.
2. Sends a short-lived signed request to the existing bridge. The bridge rejects invalid signatures, waits for existing requests to finish, creates an encrypted `before-postgres-...` backup and writes a persistent source-freeze marker. API traffic then receives a temporary migration message.
3. Reads the final frozen snapshot, imports every application model and its existing encrypted backup history in one PostgreSQL transaction, checks foreign keys and compares record counts and canonical per-table hashes. IDs, timestamps, monetary values, physical unit allocations and authentication material must match.
4. Commits a migration marker and only then starts the application. Failure rolls back the target; it never removes MongoDB business data. The importer refuses nonempty unrelated targets. Signed freeze retries and startup retries are idempotent after success.

Render's ordinary deployment flow keeps the old instance serving until its replacement is healthy. The brief source freeze is deliberate: nobody can create an order on MongoDB after its final snapshot. Keep a single service instance while the existing login rate limiter is in memory. Do not bypass a failed preflight by removing references, clearing tables or creating another owner.

## Verify and finish

- Render reports the tested commit Live. `/api/health` must report `database: postgresql` and `db: connected`.
- Compare customer, inventory, order, invoice, payment and unit counts with the migration summary. Confirm important balances, unit states and normal owner/staff login.
- Check an existing order's payment/return/invoice history and print an existing invoice. Create a new PostgreSQL backup and use the non-destructive backup verification control.
- Keep the MongoDB source frozen as a recovery copy. Do not delete the Atlas cluster as part of this migration.
- After verification, remove AUTO_MIGRATE_FROM_MONGODB, MIGRATION_SOURCE_URL and MONGODB_URI from Render; keep DB_DRIVER=postgres, DATABASE_URL and the existing private keys. A regular PostgreSQL startup no longer needs Atlas.
- Update the Blueprint's environment names to PostgreSQL only after cutover. Never perform a Blueprint sync that removes source credentials before the import.

## Failure and recovery

A failed preflight leaves the source writable and the target unchanged. A failure after the freeze deliberately leaves MongoDB read-only. Correct the target connection/configuration and retry the PostgreSQL deployment; the same signed freeze request returns the existing recovery backup and the importer retries atomically. Do not casually revert DB_DRIVER to mongodb or clear the freeze marker after PostgreSQL has accepted new writes: that would send users back to stale data. Preserve both databases and reconcile changes first if a post-cutover rollback is required.

If the target contains unrelated data, choose a separate empty Neon database/branch; never delete it automatically. SQL reports a missing related record as an error instead of importing an orphan. Review the source and resolve a genuine inconsistency before retrying.

## Local verification

`npm test --prefix server` runs the application suites against disposable PGlite PostgreSQL databases without reading server/.env or production settings. It verifies actual PostgreSQL foreign keys, money values, transactional rollback, idempotency, staff permissions, MFA, backups and migration. PGlite exercises the PostgreSQL engine but does not replace a final verification of the hosted TLS connection and connection pool.

For the optional complete native MongoDB-to-PostgreSQL bridge test, set TEST_MONGOD_PATH to a trusted installed mongod executable and run `node --test server/test/mongo-cutover.integration.test.js`. The test creates its own temporary replica set and starts a child bridge with an empty dotenv path. It never touches the live source or external backup storage.

`npm run migrate:postgres --prefix server` is a rehearsal by default. `-- --apply` also freezes and imports the source; use it only with the private source/target settings and the deployed bridge. Production startup performs the same reviewed process when AUTO_MIGRATE_FROM_MONGODB=true. The script never prints connection credentials or record contents.
