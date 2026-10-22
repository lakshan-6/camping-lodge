import { Router } from 'express';
import { Customer, Order, Rental, Payment } from '../models/index.js';
import { availability } from '../utils/availability.js';

const r = Router();
r.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const [customers, activeOrders, rentalsOut, overdue, billed, paid, recent, avail] = await Promise.all([
      Customer.countDocuments(),
      Order.countDocuments({ status: { $in: ['reserved', 'active'] } }),
      Rental.countDocuments({ status: 'out' }),
      Rental.countDocuments({ status: 'out', dueDate: { $lt: now } }),
      Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, t: { $sum: '$totalAmount' } } }]),
      Payment.aggregate([{ $group: { _id: null, t: { $sum: { $cond: [{ $eq: ['$type', 'refund'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } }]),
      Order.find().sort({ createdAt: -1 }).limit(5).populate('customer', 'name').lean(),
      availability(now, new Date(+now + 1)),
    ]);
    const revenue = paid[0]?.t || 0;
    res.json({
      customers, activeOrders, rentalsOut, overdue, revenue, recent,
      outstanding: Math.max(0, (billed[0]?.t || 0) - revenue),
      equipmentItems: avail.length,
      totalUnits: avail.reduce((s, i) => s + i.totalQuantity, 0),
      availableUnits: avail.reduce((s, i) => s + i.available, 0),
      low: avail.filter(i => i.totalQuantity > 0 && i.available <= Math.ceil(i.totalQuantity * 0.25))
        .map(i => ({ _id: i._id, name: i.name, available: i.available, total: i.totalQuantity })),
    });
  } catch (e) { next(e); }
});
export default r;
