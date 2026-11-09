import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {connectDatabase,connectTestDatabase,database,databaseDriver} from './db/connection.js';
import {legacyMigrationGate,freezeLegacySource} from './db/migrationGuard.js';
import {migrateMongo} from './db/migrateMongo.js';
import equipment from './routes/equipment.js';
import customers from './routes/customers.js';
import availabilityRoute from './routes/availability.js';
import orders from './routes/orders.js';
import rentals from './routes/rentals.js';
import returns from './routes/returns.js';
import stats from './routes/stats.js';
import { User } from './models/index.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import reports from './routes/reports.js';
import settings, {getSettings} from './routes/settings.js';
import { requireAuth, requireAdmin, validateAuthConfig } from './utils/auth.js';
import payments from './routes/payments.js';
import invoices from './routes/invoices.js';
import { serveClient } from './utils/production.js';
import { initializeDocumentNumbers } from './utils/documentNumbers.js';
import management from './routes/management.js';
import backups from './routes/backups.js';
import { startBackupSchedule } from './utils/backups.js';
import { requirePermission } from './utils/permissions.js';
import reconciliation from './routes/reconciliation.js';
import security from './routes/security.js';

const localDatabase = process.argv.includes('--local-development') && process.env.NODE_ENV !== 'production'
  && databaseDriver === 'postgres' && !process.env.DATABASE_URL;

validateAuthConfig();
const app = express();
if (process.env.TRUST_PROXY_HOPS) {
  const hops = Number(process.env.TRUST_PROXY_HOPS);
  if (!Number.isInteger(hops) || hops < 1) throw new Error('TRUST_PROXY_HOPS must be a positive integer');
  app.set('trust proxy', hops);
}
app.disable('x-powered-by');
app.use(cors());
app.use('/api',legacyMigrationGate);
app.post('/api/migration/freeze',express.json({limit:'4kb'}),freezeLegacySource);
app.use('/api/backups', requireAuth, backups);
app.use(express.json());

app.get('/api/health', (req, res) =>
  res.json({ ok: database.connected, db: database.connected ? 'connected' : 'disconnected',database:databaseDriver==='postgres'?'postgresql':'mongodb-migration-bridge' }));
app.use('/api/auth', auth);
app.use('/api', requireAuth);   // everything below needs a logged-in user
app.use('/api/equipment', equipment);
app.use('/api/customers', customers);
app.use('/api/availability', availabilityRoute);
app.use('/api/orders', orders);
app.use('/api/rentals', rentals);
app.use('/api/returns', returns);
app.use('/api/stats', stats);
app.use('/api/payments', payments);
app.use('/api/invoices', invoices);
app.use('/api/settings', settings);
app.use('/api/users', requireAdmin, users);
app.use('/api/reports', requirePermission('reports.view'), reports);
app.use('/api/manage', management);
app.use('/api/reconciliation', reconciliation);
app.use('/api/security', security);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
if (process.env.NODE_ENV === 'production') serveClient(app);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || (err.name === 'ValidationError' ? 400 : 500)).json({ error: err.message });
});

// One-time upgrade: the oldest admin becomes the owner when no owner exists yet
async function promoteOwner() {
  if (await User.findOne({ role: 'owner' })) return;
  const a = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (a) { a.role = 'owner'; await a.save(); console.log('Owner account: ' + a.username); }
}

async function openDatabase() {
  if (!localDatabase) return connectDatabase();
  // Development data stays on this machine, with no cloud backups or outgoing email.
  delete process.env.SMTP_HOST;
  for (const key of Object.keys(process.env)) if (key.startsWith('BACKUP_S3_')) delete process.env[key];
  const { PGlite } = await import('@electric-sql/pglite');
  await connectTestDatabase(new PGlite(fileURLToPath(new URL('./.local-postgres', import.meta.url))));
}

openDatabase()
  .then(async () => {
    console.log(localDatabase ? 'Local PostgreSQL connected (server/.local-postgres)' : databaseDriver==='postgres'?'PostgreSQL connected':'MongoDB migration bridge connected');
    if(!localDatabase&&databaseDriver==='postgres'&&process.env.AUTO_MIGRATE_FROM_MONGODB==='true'){
      const result=await migrateMongo();console.log('PostgreSQL migration verified',JSON.stringify(result.counts));
    }
    if(!localDatabase&&databaseDriver==='postgres'&&process.env.MONGODB_URI&&process.env.AUTO_MIGRATE_FROM_MONGODB!=='true'&&!(await User.countDocuments()))throw new Error('Complete the migration before serving an empty PostgreSQL database');
    await promoteOwner();
    await initializeDocumentNumbers();
    await getSettings();
    if(databaseDriver==='postgres')startBackupSchedule();
    const port = Number(process.env.PORT || 5000);
    const host = localDatabase ? '127.0.0.1' : undefined;
    app.listen(port, host, () => console.log('API on port ' + port));
  })
  .catch(error => {
    if (localDatabase) console.error(error.code === 'ERR_MODULE_NOT_FOUND'
      ? 'Local PostgreSQL needs development dependencies. Run npm install in server.'
      : 'Local PostgreSQL could not start. Check that server/.local-postgres is writable and no other development server is using it.');
    else if (databaseDriver === 'postgres' && !process.env.DATABASE_URL)
      console.error('DATABASE_URL is missing. For local development, run npm run dev.');
    else console.error('Database startup failed. Check the connection settings and migration status.');
    process.exit(1);
  });
