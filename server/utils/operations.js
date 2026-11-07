import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { AuditEvent, Mutation } from '../models/index.js';
import { httpErr } from './availability.js';
let queue = Promise.resolve();
export async function exclusive(fn) {
  const run = queue.catch(() => {}).then(fn); queue = run;
  return run;
}
export async function transaction(fn) {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => fn(session), { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); }
  catch (e) { if (e.code === 20) throw httpErr(503, 'This operation requires MongoDB Atlas or a local replica set. No changes were saved.'); throw e; }
  finally { await session.endSession(); }
}
export async function audit(session, user, action, target, before, after) {
  const clean = value => value == null ? undefined : JSON.parse(JSON.stringify(value, (key, data) => /password|secret|accesskey|token|mfa|recovery|codes/i.test(key) ? undefined : data));
  await AuditEvent.create([{ actor: user?._id, actorName: user?.name, action, target: String(target), before: clean(before), after: clean(after) }], { session });
}
export async function mutate(req, scope, fn) {
  return exclusive(() => transaction(async session => {
    const requestId = req.headers?.['idempotency-key'] || req.body?.requestId;
    if (requestId && (typeof requestId !== 'string' || requestId.length > 100)) throw httpErr(400, 'Invalid request identifier');
    const id = requestId ? `${req.user._id}:${scope}:${requestId}` : null;
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
    if (id) {
      const prior = await Mutation.findById(id).session(session);
      if (prior) { if (prior.fingerprint !== fingerprint) throw httpErr(409, 'This request was already used. Refresh the form.'); return {...prior.result,_replayed:true}; }
    }
    const result = await fn(session);
    const plain = JSON.parse(JSON.stringify(result));
    if (id) await Mutation.create([{ _id: id, fingerprint, result: plain }], { session });
    return plain;
  }));
}
export function money(value, label = 'Amount', allowZero = false) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < (allowZero ? 0 : 0.01) || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw httpErr(400, `${label} must be a valid amount with at most two decimals`);
  return Math.round(amount * 100) / 100;
}
export function units(value, allowZero = false) {
  const n = Number(value); if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 1000000) throw httpErr(400, 'Quantity must be a whole number'); return n;
}
export const methodOf = value => ['cash','bank_transfer','card','other'].includes(value) ? value : 'cash';
