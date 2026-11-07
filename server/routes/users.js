import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword, validatePassword } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';
import { PERMISSIONS, permissionsOf } from '../utils/permissions.js';
import {audit} from '../utils/operations.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const ONLINE_MS = 2 * 60 * 1000;   // "online" = made a request in the last 2 minutes
const shape = u => ({ _id: u._id, name: u.name, username: u.username, role: u.role, active: u.active, permissions: permissionsOf(u),
  online: u.active && !!u.lastSeenAt && Date.now() - new Date(u.lastSeenAt) < ONLINE_MS });
// The owner manages everyone else; an admin manages staff only; nobody manages the owner or themselves this way
const canManage = (actor, t) => String(actor._id) !== String(t._id) && t.role !== 'owner' && (actor.role === 'owner' || t.role === 'staff');

r.get('/online', wrap(async (req, res) => res.json({
  count: await User.countDocuments({ active: true, lastSeenAt: { $gt: new Date(Date.now() - ONLINE_MS) } }) })));

r.get('/', wrap(async (req, res) => res.json((await User.find().select('-passwordHash').sort({ createdAt: 1 })).map(shape))));

r.post('/', wrap(async (req, res) => {
  const { name, username, password, role } = req.body;
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) throw httpErr(400, 'Enter a valid name and username (3 to 64 characters)');
  validatePassword(password);
  if (await User.findOne({ username: username.toLowerCase().trim() })) throw httpErr(409, 'That username is taken');
  const u = await User.create({ name, username, passwordHash: await hashPassword(password),
    role: req.user.role === 'owner' && role === 'admin' ? 'admin' : 'staff' });
  await audit(null,req.user,'user.created',u._id,null,shape(u));
  res.status(201).json(shape(u));
}));

r.patch('/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr(404, 'Not found');
  const before = shape(u);
  const self = String(u._id) === String(req.user._id);
  if (!self && !canManage(req.user, u)) throw httpErr(403, "You don't have permission to change this account");
  if (req.body.active === false && self) throw httpErr(400, "You can't disable your own account");
  if (typeof req.body.active === 'boolean' && !self) u.active = req.body.active;
  if (req.body.password) {
    validatePassword(req.body.password);
    u.passwordHash = await hashPassword(req.body.password);
  }
  if (req.body.active === false) u.sessionVersion = (u.sessionVersion || 0) + 1;
  if (req.body.permissions !== undefined) {
    if (req.user.role !== 'owner' || u.role !== 'staff') throw httpErr(403, 'Only the owner can set staff permissions');
    if (!Array.isArray(req.body.permissions) || req.body.permissions.some(p => !PERMISSIONS.includes(p))) throw httpErr(400, 'Invalid permissions');
    u.permissions = [...new Set(req.body.permissions)];
  }
  await u.save();
  await audit(null,req.user,req.body.password?'user.password_reset':'user.updated',u._id,before,shape(u));
  res.json(shape(u));
}));

r.delete('/:id', wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr(404, 'Not found');
  if (String(u._id) === String(req.user._id)) throw httpErr(400, "You can't delete your own account");
  if (u.role === 'owner') throw httpErr(403, 'The owner account cannot be deleted');
  if (!canManage(req.user, u)) throw httpErr(403, 'Only the owner can delete admin accounts');
  await u.deleteOne();
  await audit(null,req.user,'user.deleted',u._id,shape(u),null);
  res.json({ ok: true });
}));
export default r;
