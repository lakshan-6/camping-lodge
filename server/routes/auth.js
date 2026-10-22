import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword, checkPassword, sign, requireAuth } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const pub = u => ({ id: u._id, username: u.username, name: u.name, role: u.role });

r.get('/status', wrap(async (req, res) => res.json({ hasUsers: (await User.countDocuments()) > 0 })));

// First run only: creates the owner (admin) account
r.post('/setup', wrap(async (req, res) => {
  if (await User.countDocuments()) throw httpErr(403, 'Setup is already done');
  const { name, username, password } = req.body;
  if (!name || !username || !password || password.length < 6) throw httpErr(400, 'Name, username and a password of at least 6 characters are required');
  const u = await User.create({ name, username, passwordHash: hashPassword(password), role: 'admin' });
  res.status(201).json({ token: sign(u), user: pub(u) });
}));

r.post('/login', wrap(async (req, res) => {
  const u = await User.findOne({ username: String(req.body.username || '').toLowerCase().trim() });
  if (!u || !u.active || !checkPassword(String(req.body.password || ''), u.passwordHash)) throw httpErr(401, 'Wrong username or password');
  res.json({ token: sign(u), user: pub(u) });
}));

r.get('/me', requireAuth, (req, res) => res.json(pub(req.user)));
export default r;
