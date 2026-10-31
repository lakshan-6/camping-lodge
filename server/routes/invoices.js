import { Router } from 'express';
import { Order, OrderItem, Invoice, Payment } from '../models/index.js';
import { createInvoice, emailInvoice, invoicePdfBuffer } from '../utils/invoiceMail.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

r.get('/', wrap(async (req, res) => {
  res.json(await Invoice.find().sort({ createdAt: -1 }).populate('customer', 'name').populate('order', 'orderNo').lean());
}));

r.get('/:id', wrap(async (req, res) => {
  const inv = await Invoice.findById(req.params.id).populate('customer').populate('order').lean();
  if (!inv) throw httpErr(404, 'Invoice not found');
  const items = await OrderItem.find({ order: inv.order._id }).populate('equipment', 'name').lean();
  const pays = await Payment.find({ order: inv.order._id }).lean();
  const paid = pays.reduce((s, p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0);
  res.json({ ...inv, items, paid, balance: inv.total - paid });
}));

// Create after the return is recorded, so late/damage fees are included in the total
r.post('/', wrap(async (req, res) => {
  const o = await Order.findById(req.body.order);
  if (!o) throw httpErr(404, 'Order not found');
  if (await Invoice.findOne({ order: o._id, status: { $ne: 'void' } })) throw httpErr(409, 'This order already has an invoice');
  res.status(201).json(await createInvoice(o));
}));

r.get('/:id/pdf', wrap(async (req, res) => {
  const { buffer, invoiceNo } = await invoicePdfBuffer(req.params.id);
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${invoiceNo}.pdf"`).send(buffer);
}));

r.post('/:id/email', wrap(async (req, res) => { await emailInvoice(req.params.id); res.json({ ok: true }); }));

r.patch('/:id/void', wrap(async (req, res) => {
  const inv = await Invoice.findByIdAndUpdate(req.params.id, { status: 'void' }, { new: true });
  inv ? res.json(inv) : res.status(404).json({ error: 'Not found' });
}));
export default r;
