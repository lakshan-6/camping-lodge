import { Router } from 'express';
import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { Order, OrderItem, Payment, Invoice } from '../models/index.js';
import { availability, countPeriods, httpErr } from '../utils/availability.js';
import { nextDocumentNumber } from '../utils/documentNumbers.js';
import { previewOrderDeletion, permanentlyDeleteOrder } from '../utils/orderDeletion.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const ownerOnly = (req, res, next) => req.user?.role === 'owner' ? next() : next(httpErr(403, 'Only the owner can delete past orders'));
const pastDeleteLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5,
  keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many past-order deletion attempts. Try again in 15 minutes.' } });

// Runs order changes one at a time so two requests can't both take the last unit
let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

function parse(body) {
  const s = new Date(body.startDate), e = new Date(body.endDate);
  if (isNaN(s) || isNaN(e) || s >= e) throw httpErr(400, 'End time must be after start time');
  const wanted = {};
  (body.items || []).forEach(i => { if (i.equipment) wanted[i.equipment] = (wanted[i.equipment] || 0) + Number(i.quantity); });
  if (!Object.keys(wanted).length) throw httpErr(400, 'Add at least one item');
  return { s, e, wanted };
}

// Checks stock for the chosen times (ignoring `exclude`, the order being edited) and prices every line
async function priceLines(wanted, s, e, exclude) {
  const byId = Object.fromEntries((await availability(s, e, exclude)).map(a => [String(a._id), a]));
  const periods = countPeriods(s, e);
  let total = 0, deposit = 0;
  const lines = Object.entries(wanted).map(([id, quantity]) => {
    const a = byId[id];
    if (!a) throw httpErr(400, 'Equipment not found');
    if (!(quantity >= 1)) throw httpErr(400, 'Quantity must be at least 1');
    if (quantity > a.available) throw httpErr(409, `Only ${a.available} of "${a.name}" available for those times`);
    const lineTotal = quantity * a.periodRate * periods;
    total += lineTotal; deposit += quantity * a.deposit;
    return { equipment: id, quantity, periodRate: a.periodRate, periods, lineTotal };
  });
  return { lines, total, deposit, periods };
}

r.get('/', wrap(async (req, res) => {
  const hidden = req.query.deleted === 'true';
  if (hidden && req.user.role !== 'owner') throw httpErr(403, 'Owner only');
  const filter = hidden ? { deletedAt: { $ne: null }, status: 'completed' } : { deletedAt: null };
  const orders = await Order.find(filter).sort({ createdAt: -1 }).populate('customer', 'name phone nic address email detailsPending').lean();
  const items = await OrderItem.find({ order: { $in: orders.map(o => o._id) } }).populate('equipment', 'name').lean();
  res.json(orders.map(o => ({ ...o, items: items.filter(i => String(i.order) === String(o._id)) })));
}));

r.post('/', wrap(async (req, res) => {
  const { customer, notes } = req.body;
  if (!customer) throw httpErr(400, 'Choose a customer');
  const { s, e, wanted } = parse(req.body);
  const order = await serial(async () => {
    const { lines, total, deposit, periods } = await priceLines(wanted, s, e);
    const orderNo = await nextDocumentNumber('order');
    const o = await Order.create({ orderNo, customer, startDate: s, endDate: e,
      periods, totalAmount: total, depositAmount: deposit, notes });
    await OrderItem.insertMany(lines.map(l => ({ ...l, order: o._id })));
    return o;
  });
  // Optional advance payment taken when the order is booked
  const adv = Number(req.body.advance?.amount);
  if (adv > 0) await Payment.create({ order: order._id, amount: adv, method: req.body.advance.method || 'cash', type: 'deposit' });
  res.status(201).json(order);
}));

// Change the items and/or times of an order that has not been picked up yet
r.put('/:id', wrap(async (req, res) => {
  const o = await Order.findById(req.params.id);
  if (!o) throw httpErr(404, 'Not found');
  if (o.status !== 'reserved') throw httpErr(409, 'Only orders that have not been picked up can be changed');
  const { s, e, wanted } = parse({ startDate: req.body.startDate || o.startDate, endDate: req.body.endDate || o.endDate, items: req.body.items });
  await serial(async () => {
    const { lines, total, deposit, periods } = await priceLines(wanted, s, e, o._id);
    await OrderItem.deleteMany({ order: o._id });
    await OrderItem.insertMany(lines.map(l => ({ ...l, order: o._id })));
    await Order.updateOne({ _id: o._id }, { startDate: s, endDate: e, periods, totalAmount: total, depositAmount: deposit });
    await Invoice.updateMany({ order: o._id, status: { $ne: 'void' } }, { status: 'void' });  // any old invoice no longer matches
  });
  res.json(await Order.findById(o._id));
}));

r.patch('/:id/cancel', wrap(async (req, res) => {
  const o = await Order.findById(req.params.id);
  if (!o) throw httpErr(404, 'Not found');
  if (o.status !== 'reserved') throw httpErr(409, 'Only reserved orders can be cancelled');
  o.status = 'cancelled'; await o.save();
  res.json(o);
}));

// Owner-only removal of completed orders, with a separate server-side access key.
r.get('/:id/past-delete-preview', ownerOnly, wrap(async (req, res) => {
  res.json(await previewOrderDeletion(req.params.id));
}));

r.delete('/:id/past', ownerOnly, pastDeleteLimit, wrap(async (req, res) => {
  const expected = process.env.PAST_ORDER_DELETE_KEY;
  if (!expected || expected.length < 12 || expected.length > 128)
    throw httpErr(503, 'Set PAST_ORDER_DELETE_KEY to 12 to 128 characters in the server environment.');
  const supplied = req.body?.accessKey;
  const digest = value => crypto.createHash('sha256').update(value).digest();
  if (typeof supplied !== 'string' || supplied.length > 128 || !crypto.timingSafeEqual(digest(supplied.trim()), digest(expected)))
    throw httpErr(403, 'Incorrect delete access key');
  const deleted = await permanentlyDeleteOrder(req.params.id, req.body.confirmation);
  res.json({ ok: true, deleted });
}));

// Hide abandoned bookings while retaining accounting history and order numbers.
r.delete('/:id', wrap(async (req, res) => {
  const o = await Order.findOneAndUpdate({ _id: req.params.id, deletedAt: null,
    status: { $in: ['reserved', 'cancelled'] } }, {
    $set: { status: 'cancelled', deletedAt: new Date(), deletedBy: req.user._id }
  }, { new: true });
  if (!o) {
    const existing = await Order.findById(req.params.id);
    if (!existing || existing.deletedAt) throw httpErr(404, 'Booking not found');
    throw httpErr(409, 'Only bookings that have not been picked up can be deleted');
  }
  res.json({ ok: true });
}));
export default r;
