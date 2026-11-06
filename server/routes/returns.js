import { Router } from 'express';
import { Order, OrderItem, Payment, Rental, Return, ReturnItem, Equipment, Invoice, InventoryTransaction } from '../models/index.js';
import { PERIOD_MS, httpErr } from '../utils/availability.js';
import { getSettings } from './settings.js';
import { paidTotal, settleInvoice } from '../utils/invoiceMail.js';
import { withOrderLock } from '../utils/orderDeletion.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

// Late fee: every extra 36h period (rounded up) costs the order's rental rate x the late-fee % from Settings
async function lateInfo(rental, lines, at = new Date()) {
  const late = at - rental.dueDate;
  const extra = late > 0 ? Math.ceil(late / PERIOD_MS) : 0;
  const pct = (await getSettings()).lateFeePercent;
  return { extra, lateFee: Math.round(extra * lines.reduce((s, l) => s + l.quantity * l.periodRate, 0) * pct / 100) };
}

r.get('/', wrap(async (req, res) => {
  res.json(await Return.find().sort({ returnedAt: -1 }).limit(100)
    .populate({ path: 'rental', populate: [{ path: 'customer', select: 'name' }, { path: 'order', select: 'orderNo' }] }).lean());
}));

// What the customer still owes, shown before the return is confirmed
r.get('/preview/:rental', wrap(async (req, res) => {
  const rental = await Rental.findById(req.params.rental);
  if (!rental || rental.status === 'returned') throw httpErr(404, 'Rental not found');
  const lines = await OrderItem.find({ order: rental.order });
  const ord = await Order.findById(rental.order);
  const { extra, lateFee } = await lateInfo(rental, lines);
  res.json({ extraPeriods: extra, lateFee, balance: Math.max(0, ord.totalAmount - (await paidTotal(ord._id))) });
}));

r.post('/', wrap(async (req, res) => {
  const linked = await Rental.findById(req.body.rental);
  if (!linked) throw httpErr(404, 'Rental not found');
  return withOrderLock(linked.order, async () => {
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
  const now = new Date();
  const { lateFee } = await lateInfo(rental, lines, now);
  const damageFee = Math.max(0, +req.body.damageFee || 0);
  const ord0 = await Order.findById(rental.order);
  const balance0 = Math.max(0, ord0.totalAmount - (await paidTotal(ord0._id)));   // unpaid rental balance before fees

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
  const ord = await Order.findByIdAndUpdate(rental.order, { status: 'completed', $inc: { totalAmount: lateFee + damageFee } }, { new: true });
  // Keep the invoice in step with any late/damage fees added at return
  const inv = await Invoice.findOne({ order: ord._id, status: { $in: ['issued', 'paid'] } });
  if (inv) {
    inv.fees = ord.totalAmount - inv.subtotal; inv.total = ord.totalAmount;
    if (inv.status === 'paid' && lateFee + damageFee > 0) inv.status = 'issued';
    await inv.save();
  }
  // Ticked at the counter: record what the customer paid now
  const pay = req.body.paid || {};
  const method = ['cash', 'bank_transfer', 'card', 'other'].includes(req.body.method) ? req.body.method : 'cash';
  const due = [];
  if (pay.balance && balance0 > 0) due.push({ amount: balance0, type: 'balance' });
  if (pay.late && lateFee > 0) due.push({ amount: lateFee, type: 'fee', reference: 'Late fee' });
  if (pay.damage && damageFee > 0) due.push({ amount: damageFee, type: 'fee', reference: 'Damage / loss fee' });
  if (due.length) await Payment.insertMany(due.map(d => ({ ...d, order: ord._id, method })));
  let extra = {};
  try { extra = await settleInvoice(ord._id); } catch (e) { extra = { emailNote: `Return saved, but the invoice step failed: ${e.message}.` }; }
  res.status(201).json({ ...ret.toObject(), ...extra });
  });
}));
export default r;
