import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

r.get('/', wrap(async (req, res) => res.json(await User.find().select('-passwordHash').sort({ createdAt: 1 }))));
r.post('/', wrap(async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || password.length < 6) throw httpErr(400, 'Name, username and a password of at least 6 characters are required');
  if (await User.findOne({ username: username.toLowerCase().trim() })) throw httpErr(409, 'That username is taken');
  const u = await User.create({ name, username, passwordHash: hashPassword(password), role: role === 'admin' ? 'admin' : 'staff' });
  res.status(201).json({ _id: u._id, name: u.name, username: u.username, role: u.role, active: u.active });
}));
r.patch('/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr(404, 'Not found');
  const self = String(u._id) === String(req.user._id);
  if (req.body.active === false && self) throw httpErr(400, "You can't disable your own account");
  if (typeof req.body.active === 'boolean') u.active = req.body.active;
  if (req.body.password) {
    if (req.body.password.length < 6) throw httpErr(400, 'Password must be at least 6 characters');
    u.passwordHash = hashPassword(req.body.password);
  }
  await u.save();
  res.json({ _id: u._id, name: u.name, username: u.username, role: u.role, active: u.active });
}));
export default r;
