import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import equipment from './routes/equipment.js';
import customers from './routes/customers.js';
import availabilityRoute from './routes/availability.js';
import orders from './routes/orders.js';
import rentals from './routes/rentals.js';
import returns from './routes/returns.js';
import stats from './routes/stats.js';
import auth from './routes/auth.js';
import users from './routes/users.js';
import reports from './routes/reports.js';
import settings from './routes/settings.js';
import { requireAuth, requireAdmin } from './utils/auth.js';
import payments from './routes/payments.js';
import invoices from './routes/invoices.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
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
app.use('/api/reports', requireAdmin, reports);
// Next steps: /api/customers, /api/orders, /api/rentals, /api/returns, /api/payments, /api/invoices

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || (err.name === 'ValidationError' ? 400 : 500)).json({ error: err.message });
});

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/camping_lodge';
mongoose.connect(uri)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(process.env.PORT || 5000, () => console.log('API on port ' + (process.env.PORT || 5000)));
  })
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
