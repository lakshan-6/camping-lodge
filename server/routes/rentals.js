import { Router } from 'express';
import { Customer, Order, OrderItem, Payment, Rental, InventoryTransaction } from '../models/index.js';
import { createInvoice, emailInvoice, paidTotal } from '../utils/invoiceMail.js';
import { Invoice } from '../models/index.js';
import { httpErr, PERIOD_MS } from '../utils/availability.js';

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
  if ((await Customer.findById(o.customer))?.detailsPending) throw httpErr(409, "Add the customer's full details (name and NIC) before handing over the equipment");
  // Balance paid at the counter on pickup: record it so the invoice is "paid in full"
  if (req.body.payBalance) {
    const bal = Math.max(0, o.totalAmount - (await paidTotal(o._id)));
    const method = ['cash', 'bank_transfer', 'card', 'other'].includes(req.body.method) ? req.body.method : 'cash';
    if (bal > 0) await Payment.create({ order: o._id, amount: bal, method, type: 'balance' });
  }
  // The rental clock starts now: due back = hand-over time + the booked 36h period(s), whatever times the order was booked for
  const now = new Date(), dueDate = new Date(+now + (o.periods || 1) * PERIOD_MS);
  const rental = await Rental.create({ order: o._id, customer: o.customer, pickedUpAt: now, dueDate });
  const via = ['email', 'whatsapp', 'both', 'none'].includes(req.body.sendVia) ? req.body.sendVia : 'email';
  o.sendVia = via;
  o.startDate = now; o.endDate = dueDate;   // keeps availability and the calendar in step with the real rental window
  o.status = 'active'; await o.save();
  const items = await OrderItem.find({ order: o._id });
  await InventoryTransaction.insertMany(items.map(i => ({ equipment: i.equipment, type: 'rented_out', quantity: -i.quantity, reference: String(o._id) })));
  // Invoice at pickup: paid in full -> one "paid" invoice; balance left -> invoice with the balance due
  let emailNote, whatsappInvoice;
  try {
    const inv = (await Invoice.findOne({ order: o._id, status: { $ne: 'void' } })) || (await createInvoice(o));
    if (via === 'email' || via === 'both') {
      try { await emailInvoice(inv._id); emailNote = `Invoice ${inv.invoiceNo} (PDF) was emailed to the customer.`; }
      catch (e) { emailNote = `Rental started, but the invoice was not emailed: ${e.message}.`; }
    }
    if (via === 'whatsapp' || via === 'both') whatsappInvoice = inv._id;
    if (via === 'none') emailNote = `Invoice ${inv.invoiceNo} was created and not sent.`;
  } catch (e) { emailNote = `Rental started, but the invoice could not be made: ${e.message}.`; }
  res.status(201).json({ ...rental.toObject(), emailNote, whatsappInvoice });
}));
export default r;
