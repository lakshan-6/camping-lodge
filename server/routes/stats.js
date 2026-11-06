import { Router } from 'express';
import { Customer, Order, Rental, Payment, Return } from '../models/index.js';
import { availability } from '../utils/availability.js';

const r = Router();
const signed = { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } };
const net = from => Payment.aggregate([...(from ? [{ $match: { paidAt: { $gte: from } } }] : []), { $group: { _id: null, t: signed } }]).then(x => x[0]?.t || 0);

r.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1), yearStart = new Date(now.getFullYear(), 0, 1);
    const [customers, activeOrders, rentalsOut, overdue, orders, paidBy, lateBy, lateMonth, revenue, monthRevenue, yearRevenue, recent, avail] = await Promise.all([
      Customer.countDocuments(),
      Order.countDocuments({ status: { $in: ['reserved', 'active'] } }),
      Rental.countDocuments({ status: 'out' }),
      Rental.countDocuments({ status: 'out', dueDate: { $lt: now } }),
      Order.find({ status: { $ne: 'cancelled' } }).select('totalAmount').lean(),
      Payment.aggregate([{ $group: { _id: '$order', t: signed } }]),
      Return.aggregate([{ $lookup: { from: 'rentals', localField: 'rental', foreignField: '_id', as: 'r' } }, { $unwind: '$r' },
        { $group: { _id: '$r.order', t: { $sum: '$lateFee' } } }]),
      Return.aggregate([{ $match: { returnedAt: { $gte: monthStart } } }, { $group: { _id: null, t: { $sum: '$lateFee' } } }]),
      net(), net(monthStart), net(yearStart),
      Order.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(5).populate('customer', 'name').lean(),
      availability(now, new Date(+now + 1)),
    ]);
    const paid = Object.fromEntries(paidBy.map(p => [String(p._id), p.t]));
    const late = Object.fromEntries(lateBy.map(p => [String(p._id), p.t]));
    // Outstanding leaves late fees out; they are shown separately
    const outstanding = orders.reduce((s, o) => s + Math.max(0, o.totalAmount - (late[String(o._id)] || 0) - (paid[String(o._id)] || 0)), 0);
    res.json({
      customers, activeOrders, rentalsOut, overdue, revenue, monthRevenue, yearRevenue, outstanding, recent,
      lateFees: lateBy.reduce((s, x) => s + x.t, 0), lateFeesMonth: lateMonth[0]?.t || 0,
      equipmentItems: avail.length,
      totalUnits: avail.reduce((s, i) => s + i.totalQuantity, 0),
      availableUnits: avail.reduce((s, i) => s + i.available, 0),
      low: avail.filter(i => i.totalQuantity > 0 && i.available <= Math.ceil(i.totalQuantity * 0.25))
        .map(i => ({ _id: i._id, name: i.name, available: i.available, total: i.totalQuantity })),
    });
  } catch (e) { next(e); }
});
// Revenue and new-customer count for a month, a year, or since the business started
r.get('/summary', async (req, res, next) => {
  try {
    const { period, value } = req.query;
    let from, to;
    if (period === 'month' && /^\d{4}-\d{2}$/.test(value)) { const [y, m] = value.split('-').map(Number); from = new Date(y, m - 1, 1); to = new Date(y, m, 1); }
    else if (period === 'year' && /^\d{4}$/.test(value)) { from = new Date(+value, 0, 1); to = new Date(+value + 1, 0, 1); }
    const range = f => (from ? { [f]: { $gte: from, $lt: to } } : {});
    const [pay, customers, first] = await Promise.all([
      Payment.aggregate([{ $match: range('paidAt') }, { $group: { _id: null, t: signed } }]),
      Customer.countDocuments(range('createdAt')),
      Order.findOne({ deletedAt: null }).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    res.json({ revenue: pay[0]?.t || 0, customers, since: first?.createdAt || null });
  } catch (e) { next(e); }
});

export default r;
