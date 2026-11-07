import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { User } from '../models/index.js';
import { hashPassword, checkPassword, sign, requireAuth } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';
import { permissionsOf } from '../utils/permissions.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const pub = u => ({ id: u._id, username: u.username, name: u.name, role: u.role, permissions: permissionsOf(u) });
const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' } });
// Bound total password work even when requests come from many addresses.
const globalLimit = rateLimit({ windowMs: 60 * 1000, limit: 60, keyGenerator: () => 'auth',
  standardHeaders: false, legacyHeaders: false, message: { error: 'Login is busy. Try again shortly.' } });
const dummyHash = '0'.repeat(32) + ':' + '0'.repeat(128);
function identity(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 ||
      typeof body.username !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(body.username))
    throw httpErr(400, 'Enter a name and a username of 3 to 64 letters, numbers, dots, underscores or hyphens');
}
r.get('/status', wrap(async (req, res) => res.json({ hasUsers: (await User.countDocuments()) > 0 })));
r.post('/setup', limit, globalLimit, wrap(async (req, res) => {
  const expected = process.env.SETUP_KEY;
  const supplied = req.body.setupKey;
  if (!expected || typeof supplied !== 'string' || supplied.length > 256 ||
      !crypto.timingSafeEqual(crypto.createHash('sha256').update(expected).digest(), crypto.createHash('sha256').update(supplied).digest()))
    throw httpErr(403, 'Enter the setup key from server/.env');
  if (await User.countDocuments()) throw httpErr(403, 'Setup is already done');
  identity(req.body);
  const { name, username, password } = req.body;
  const passwordHash = await hashPassword(password);
  // MongoDB's unique _id arbitrates setup across concurrent requests and server processes.
  const locks = User.db.collection('bootstrap_locks');
  try { await locks.insertOne({ _id: 'owner-setup' }); }
  catch (e) { if (e.code === 11000) throw httpErr(409, 'Setup is already complete or in progress'); throw e; }
  let u;
  try {
    if (await User.countDocuments()) throw httpErr(403, 'Setup is already done');
    u = await User.create({ name, username, passwordHash, role: 'owner' });
  } catch (e) { await locks.deleteOne({ _id: 'owner-setup' }); throw e; }
  res.status(201).json({ token: sign(u), user: pub(u) });
}));
r.post('/login', limit, globalLimit, wrap(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || username.length > 64 || typeof password !== 'string' || password.length > 128)
    throw httpErr(401, 'Wrong username or password');
  const u = await User.findOne({ username: username.toLowerCase().trim() });
  const valid = await checkPassword(password, u?.passwordHash || dummyHash);
  if (!u || !u.active || !valid) throw httpErr(401, 'Wrong username or password');
  res.json({ token: sign(u), user: pub(u) });
}));
r.post('/logout', requireAuth, wrap(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { sessionVersion: 1 }, $set: { lastSeenAt: new Date(0) } });
  res.json({ ok: true });
}));
r.get('/me', requireAuth, (req, res) => res.json(pub(req.user)));
export default r;
