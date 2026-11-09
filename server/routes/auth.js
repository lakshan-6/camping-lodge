import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { User } from '../models/index.js';
import { hashPassword, checkPassword, sign, requireAuth } from '../utils/auth.js';
import { httpErr } from '../utils/availability.js';
import { permissionsOf } from '../utils/permissions.js';
import {exclusive,transaction,audit} from '../utils/operations.js';
import {verifyFactor,consumeCode,securityFields} from '../utils/mfa.js';

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
  const u=await exclusive(()=>transaction(async session=>{
    if(await User.countDocuments().session(session))throw httpErr(409,'Setup is already complete or in progress');
    return (await User.create([{name,username,passwordHash,role:'owner'}],{session}))[0];
  }));
  res.status(201).json({ token: sign(u), user: pub(u) });
}));
r.post('/login', limit, globalLimit, wrap(async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== 'string' || username.length > 64 || typeof password !== 'string' || password.length > 128)
    throw httpErr(401, 'Wrong username or password');
  const u = await User.findOne({ username: username.toLowerCase().trim() });
  const valid = await checkPassword(password, u?.passwordHash || dummyHash);
  if (!u || !u.active || !valid) throw httpErr(401, 'Wrong username or password');
  if(u.mfaEnabled){
    if(!req.body.code)return res.json({mfaRequired:true});
    const verified=await exclusive(()=>transaction(async session=>{
      const fresh=await User.findById(u._id).select(securityFields).session(session);
      if(!fresh?.active||fresh.passwordHash!==u.passwordHash||fresh.sessionVersion!==u.sessionVersion)throw httpErr(401,'Please log in again');
      verifyFactor(fresh,req.body.code);await fresh.save({session});return fresh;
    }));return res.set('Cache-Control','no-store').json({token:sign(verified),user:pub(verified)});
  }
  res.set('Cache-Control','no-store').json({ token: sign(u), user: pub(u) });
}));
const recoveryLimit=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many recovery attempts. Try again in 15 minutes.'}});
r.post('/recover',recoveryLimit,globalLimit,wrap(async(req,res)=>{
  const {username,newPassword,recoveryCode,code}=req.body;
  if(typeof username!=='string'||username.length>64||typeof recoveryCode!=='string'||recoveryCode.length>100)throw httpErr(401,'Account recovery could not be verified');
  const passwordHash=await hashPassword(newPassword);
  await exclusive(()=>transaction(async session=>{
    const u=await User.findOne({username:username.toLowerCase().trim(),role:'owner',active:true}).select(securityFields).session(session);
    if(!u||!consumeCode(u,'accountRecoveryHashes',recoveryCode))throw httpErr(401,'Account recovery could not be verified');
    verifyFactor(u,code);u.passwordHash=passwordHash;u.sessionVersion++;await u.save({session});
    await audit(session,u,'security.account_recovered',u._id,null,{sessionsRevoked:true});
  }));res.set('Cache-Control','no-store').json({ok:true});
}));
r.post('/logout', requireAuth, wrap(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $inc: { sessionVersion: 1 }, $set: { lastSeenAt: new Date(0) } });
  res.json({ ok: true });
}));
r.get('/me', requireAuth, (req, res) => res.json(pub(req.user)));
export default r;
