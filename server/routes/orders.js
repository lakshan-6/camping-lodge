import { Router } from 'express';
import { Order, OrderItem } from '../models/index.js';
import { availability, countPeriods, httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// Runs order creation one at a time so two requests can't both take the last unit
let chain = Promise.resolve();
const serial = fn => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };

r.get('/', wrap(async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).populate('customer', 'name phone').lean();
  const items = await OrderItem.find({ order: { $in: orders.map(o => o._id) } }).populate('equipment', 'name').lean();
  res.json(orders.map(o => ({ ...o, items: items.filter(i => String(i.order) === String(o._id)) })));
}));

r.post('/', wrap(async (req, res) => {
  const { customer, startDate, endDate, items, notes } = req.body;
  const s = new Date(startDate), e = new Date(endDate);
  if (!customer) throw httpErr(400, 'Choose a customer');
  if (isNaN(s) || isNaN(e) || s >= e) throw httpErr(400, 'End time must be after start time');
  const wanted = {};
  (items || []).forEach(i => { wanted[i.equipment] = (wanted[i.equipment] || 0) + Number(i.quantity); });
  if (!Object.keys(wanted).length) throw httpErr(400, 'Add at least one item');

  const order = await serial(async () => {
    const byId = Object.fromEntries((await availability(s, e)).map(a => [String(a._id), a]));
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
    const n = (await Order.countDocuments()) + 1;
    const o = await Order.create({ orderNo: 'CL-' + String(n).padStart(4, '0'), customer, startDate: s, endDate: e,
      periods, totalAmount: total, depositAmount: deposit, notes });
    await OrderItem.insertMany(lines.map(l => ({ ...l, order: o._id })));
    return o;
  });
  res.status(201).json(order);
}));

r.patch('/:id/cancel', wrap(async (req, res) => {
  const o = await Order.findById(req.params.id);
  if (!o) throw httpErr(404, 'Not found');
  if (o.status !== 'reserved') throw httpErr(409, 'Only reserved orders can be cancelled');
  o.status = 'cancelled'; await o.save();
  res.json(o);
}));
export default r;
