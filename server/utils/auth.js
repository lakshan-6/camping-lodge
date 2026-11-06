import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { User } from '../models/index.js';
import { httpErr } from './availability.js';

const scrypt = promisify(crypto.scrypt);
export function validateAuthConfig() {
  const value = process.env.AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32 || value === 'replace-with-a-long-random-text')
    throw new Error('Set AUTH_SECRET to at least 32 random bytes before starting the server');
}
const mac = p => { validateAuthConfig(); return crypto.createHmac('sha256', process.env.AUTH_SECRET).update(p).digest('base64url'); };
const session = u => mac(`${u.passwordHash}:${u.sessionVersion || 0}`);
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12 || pw.length > 128) throw httpErr(400, 'Password must be 12 to 128 characters');
}
export const hashPassword = async pw => {
  validatePassword(pw);
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(pw, salt, 64)).toString('hex');
};
export const checkPassword = async (pw, stored) => {
  if (typeof pw !== 'string' || pw.length > 128 || typeof stored !== 'string') return false;
  const [salt, h] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/.test(h || '')) return false;
  return crypto.timingSafeEqual(await scrypt(pw, salt, 64), Buffer.from(h, 'hex'));
};
export const sign = u => {
  const p = Buffer.from(JSON.stringify({ id: u._id, exp: Date.now() + 12 * 3600 * 1000, session: session(u) })).toString('base64url');
  return p + '.' + mac(p);
};
export async function requireAuth(req, res, next) {
  try {
    const parts = (req.headers.authorization || '').split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer' || parts[1].split('.').length !== 2) throw httpErr(401, 'Please log in');
    const [p, sig] = parts[1].split('.');
    const expected = mac(p);
    if (!p || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw httpErr(401, 'Please log in');
    const d = JSON.parse(Buffer.from(p, 'base64url'));
    if (!Number.isFinite(d.exp) || d.exp <= Date.now()) throw httpErr(401, 'Session expired');
    const u = await User.findById(d.id);
    if (!u || !u.active) throw httpErr(401, 'Account disabled');
    if (d.session !== session(u)) throw httpErr(401, 'Please log in again');
    req.user = u;
    if (!u.lastSeenAt || Date.now() - u.lastSeenAt > 30000) User.updateOne({ _id: u._id }, { lastSeenAt: new Date() }).catch(() => {});
    next();
  } catch (e) { next(e.status ? e : httpErr(401, 'Please log in')); }
}
export const requireAdmin = (req, res, next) => ['owner', 'admin'].includes(req.user.role) ? next() : next(httpErr(403, 'Admin only'));
