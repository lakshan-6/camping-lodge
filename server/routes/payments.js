import { Router } from 'express';
import { Order, Payment, Invoice } from '../models/index.js';
import { settleInvoice } from '../utils/invoiceMail.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const signed = { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } };

// Every non-cancelled order with what has been paid and what is still owed
r.get('/balances', wrap(async (req, res) => {
  const orders = await Order.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).populate('customer', 'name phone').lean();
  const paid = await Payment.aggregate([{ $group: { _id: '$order', t: signed } }]);
  const m = Object.fromEntries(paid.map(p => [String(p._id), p.t]));
  res.json(orders.map(o => { const p = m[String(o._id)] || 0; return { ...o, paid: p, balance: o.totalAmount - p }; }));
}));

r.get('/', wrap(async (req, res) => {
  res.json(await Payment.find().sort({ paidAt: -1 }).limit(200)
    .populate({ path: 'order', select: 'orderNo customer', populate: { path: 'customer', select: 'name' } }).lean());
}));

r.post('/', wrap(async (req, res) => {
  const { order, amount, method, type, reference } = req.body;
  const o = await Order.findById(order);
  if (!o) throw httpErr(404, 'Order not found');
  const amt = Number(amount);
  if (!(amt > 0)) throw httpErr(400, 'Amount must be greater than 0');
  const p = await Payment.create({ order: o._id, amount: amt, method, type, reference });
  let extra = {};
  if (type !== 'refund') extra = await settleInvoice(o._id).catch(e => ({ emailNote: 'Payment saved, but the invoice step failed: ' + e.message }));
  res.status(201).json({ ...p.toObject(), ...extra });
}));
export default r;
