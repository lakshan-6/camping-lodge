import { Router } from 'express';
import { Order, OrderItem, Payment, Equipment } from '../models/index.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const signed = { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } };

r.get('/', async (req, res, next) => {
  try {
    const from = new Date(req.query.from), to = new Date(req.query.to);
    if (isNaN(from) || isNaN(to)) throw httpErr(400, 'Choose valid dates');
    to.setHours(23, 59, 59, 999);
    const [pay, orders] = await Promise.all([
      Payment.aggregate([{ $match: { paidAt: { $gte: from, $lte: to } } }, { $group: { _id: '$method', t: signed } }]),
      Order.find({ status: { $ne: 'cancelled' }, startDate: { $gte: from, $lte: to } }).select('_id totalAmount').lean(),
    ]);
    const top = await OrderItem.aggregate([
      { $match: { order: { $in: orders.map(o => o._id) } } },
      { $group: { _id: '$equipment', orders: { $sum: 1 }, units: { $sum: '$quantity' }, revenue: { $sum: '$lineTotal' } } },
      { $sort: { units: -1, revenue: -1 } }]);
    const names = Object.fromEntries((await Equipment.find({ _id: { $in: top.map(t => t._id) } }).select('name')).map(e => [String(e._id), e.name]));
    res.json({
      revenue: pay.reduce((s, p) => s + p.t, 0), byMethod: pay.map(p => ({ method: p._id, total: p.t })),
      orders: orders.length, billed: orders.reduce((s, o) => s + o.totalAmount, 0),
      top: top.map(t => ({ name: names[String(t._id)] || 'Removed item', orders: t.orders, units: t.units, revenue: t.revenue })),
    });
  } catch (e) { next(e); }
});
export default r;
