import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const ONLINE_MS = 2 * 60 * 1000;   // "online" = made a request in the last 2 minutes
const shape = u => ({ _id: u._id, name: u.name, username: u.username, role: u.role, active: u.active,
  online: u.active && !!u.lastSeenAt && Date.now() - new Date(u.lastSeenAt) < ONLINE_MS });
// The owner manages everyone else; an admin manages staff only; nobody manages the owner or themselves this way
const canManage = (actor, t) => String(actor._id) !== String(t._id) && t.role !== 'owner' && (actor.role === 'owner' || t.role === 'staff');

r.get('/online', wrap(async (req, res) => res.json({
  count: await User.countDocuments({ active: true, lastSeenAt: { $gt: new Date(Date.now() - ONLINE_MS) } }) })));

r.get('/', wrap(async (req, res) => res.json((await User.find().select('-passwordHash').sort({ createdAt: 1 })).map(shape))));

r.post('/', wrap(async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || password.length < 6) throw httpErr(400, 'Name, username and a password of at least 6 characters are required');
  if (await User.findOne({ username: username.toLowerCase().trim() })) throw httpErr(409, 'That username is taken');
  const u = await User.create({ name, username, passwordHash: hashPassword(password),
    role: req.user.role === 'owner' && role === 'admin' ? 'admin' : 'staff' });
  res.status(201).json(shape(u));
}));

r.patch('/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr(404, 'Not found');
  const self = String(u._id) === String(req.user._id);
  if (!self && !canManage(req.user, u)) throw httpErr(403, "You don't have permission to change this account");
  if (req.body.active === false && self) throw httpErr(400, "You can't disable your own account");
  if (typeof req.body.active === 'boolean' && !self) u.active = req.body.active;
  if (req.body.password) {
    if (req.body.password.length < 6) throw httpErr(400, 'Password must be at least 6 characters');
    u.passwordHash = hashPassword(req.body.password);
  }
  await u.save();
  res.json(shape(u));
}));

r.delete('/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr(404, 'Not found');
  if (String(u._id) === String(req.user._id)) throw httpErr(400, "You can't delete your own account");
  if (u.role === 'owner') throw httpErr(403, 'The owner account cannot be deleted');
  if (!canManage(req.user, u)) throw httpErr(403, 'Only the owner can delete admin accounts');
  await u.deleteOne();
  res.json({ ok: true });
}));
export default r;
