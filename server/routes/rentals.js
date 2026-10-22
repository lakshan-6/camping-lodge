import { Router } from 'express';
import { Order, OrderItem, Rental, InventoryTransaction } from '../models/index.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

r.get('/', wrap(async (req, res) => {
  const f = req.query.status ? { status: req.query.status } : {};
  const rentals = await Rental.find(f).sort({ dueDate: 1 }).populate('customer', 'name phone').populate('order', 'orderNo startDate endDate').lean();
  const items = await OrderItem.find({ order: { $in: rentals.map(x => x.order._id) } }).populate('equipment', 'name').lean();
  const now = new Date();
  res.json(rentals.map(x => ({ ...x, overdue: x.status === 'out' && new Date(x.dueDate) < now,
    items: items.filter(i => String(i.order) === String(x.order._id)) })));
}));

// Pickup: a reserved order becomes an active rental
r.post('/start', wrap(async (req, res) => {
  const o = await Order.findById(req.body.order);
  if (!o) throw httpErr(404, 'Order not found');
  if (o.status !== 'reserved') throw httpErr(409, 'Only reserved orders can be picked up');
  const rental = await Rental.create({ order: o._id, customer: o.customer, pickedUpAt: new Date(), dueDate: o.endDate });
  o.status = 'active'; await o.save();
  const items = await OrderItem.find({ order: o._id });
  await InventoryTransaction.insertMany(items.map(i => ({ equipment: i.equipment, type: 'rented_out', quantity: -i.quantity, reference: String(o._id) })));
  res.status(201).json(rental);
}));
export default r;
