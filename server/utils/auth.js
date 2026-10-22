import crypto from 'crypto';
import { User } from '../models/index.js';
import { httpErr } from './availability.js';

// Without AUTH_SECRET in .env a random one is used, so everyone is logged out whenever the server restarts
const FALLBACK = crypto.randomBytes(32).toString('hex');
const secret = () => process.env.AUTH_SECRET || FALLBACK;
const mac = p => crypto.createHmac('sha256', secret()).update(p).digest('base64url');

export const hashPassword = pw => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
};
export const checkPassword = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, salt, 64), Buffer.from(h, 'hex'));
};
export const sign = u => {
  const p = Buffer.from(JSON.stringify({ id: u._id, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  return p + '.' + mac(p);
};
export async function requireAuth(req, res, next) {
  try {
    const [p, sig] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
    if (!p || !sig || sig.length !== mac(p).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac(p)))) throw httpErr(401, 'Please log in');
    const d = JSON.parse(Buffer.from(p, 'base64url'));
    if (d.exp < Date.now()) throw httpErr(401, 'Session expired');
    const u = await User.findById(d.id);
    if (!u || !u.active) throw httpErr(401, 'Account disabled');
    req.user = u; next();
  } catch (e) { next(e.status ? e : httpErr(401, 'Please log in')); }
}
export const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : next(httpErr(403, 'Admin only'));
