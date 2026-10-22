import { Router } from 'express';
import { Order, OrderItem, Rental, Return, ReturnItem, Equipment, InventoryTransaction } from '../models/index.js';
import { getSettings } from './settings.js';
import { PERIOD_MS, httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

r.get('/', wrap(async (req, res) => {
  res.json(await Return.find().sort({ returnedAt: -1 }).limit(100)
    .populate({ path: 'rental', populate: [{ path: 'customer', select: 'name' }, { path: 'order', select: 'orderNo' }] }).lean());
}));

r.post('/', wrap(async (req, res) => {
  const rental = await Rental.findById(req.body.rental);
  if (!rental) throw httpErr(404, 'Rental not found');
  if (rental.status === 'returned') throw httpErr(409, 'Already returned');
  const lines = await OrderItem.find({ order: rental.order });
  const rows = lines.map(l => {
    const x = (req.body.items || []).find(i => String(i.equipment) === String(l.equipment)) || {};
    const ok = +x.quantityReturned || 0, dmg = +x.quantityDamaged || 0, lost = +x.quantityLost || 0;
    if (ok < 0 || dmg < 0 || lost < 0 || ok + dmg + lost !== l.quantity)
      throw httpErr(400, 'Returned + damaged + lost must equal the rented quantity for every item');
    return { l, ok, dmg, lost };
  });
  // Late fee: each extra 36h period (rounded up) is charged at the rental rate
  const now = new Date(), late = now - rental.dueDate;
  const extra = late > 0 ? Math.ceil(late / PERIOD_MS) : 0;
  const pct = (await getSettings()).lateFeePercent;
  const lateFee = Math.round(extra * lines.reduce((s, l) => s + l.quantity * l.periodRate, 0) * pct / 100);
  const damageFee = Math.max(0, +req.body.damageFee || 0);

  const ret = await Return.create({ rental: rental._id, returnedAt: now, lateFee, damageFee, notes: req.body.notes });
  await ReturnItem.insertMany(rows.map(({ l, ok, dmg, lost }) =>
    ({ return: ret._id, equipment: l.equipment, quantityReturned: ok, quantityDamaged: dmg, quantityLost: lost })));
  for (const { l, ok, dmg, lost } of rows) {
    const tx = [];
    if (ok) tx.push({ type: 'returned', quantity: ok });
    if (dmg) tx.push({ type: 'damaged', quantity: 0, note: dmg + ' unit(s) damaged' });
    if (lost) tx.push({ type: 'lost', quantity: 0, note: lost + ' unit(s) lost' });
    if (tx.length) await InventoryTransaction.insertMany(tx.map(t => ({ ...t, equipment: l.equipment, reference: String(ret._id) })));
    if (dmg || lost) await Equipment.updateOne({ _id: l.equipment }, { $inc: { damagedQty: dmg, totalQuantity: -lost } });
  }
  rental.status = 'returned'; await rental.save();
  await Order.findByIdAndUpdate(rental.order, { status: 'completed', $inc: { totalAmount: lateFee + damageFee } });
  res.status(201).json(ret);
}));
export default r;
