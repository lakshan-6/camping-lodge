import { Router } from 'express';
import { Customer } from '../models/index.js';
import { httpErr } from '../utils/availability.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = b => ({ name: b.name, phone: b.phone, nic: b.nic, address: b.address, notes: b.notes, email: b.email });

r.get('/', wrap(async (req, res) => {
  const q = req.query.q;
  const f = q ? { $or: [{ name: new RegExp(esc(q), 'i') }, { phone: new RegExp(esc(q), 'i') }, { nic: new RegExp(esc(q), 'i') }] } : {};
  res.json(await Customer.find(f).sort({ name: 1 }));
}));
r.post('/', wrap(async (req, res) => {
  // WhatsApp pre-booking: only a phone number is needed; reuse the customer if that number already exists
  if (req.body.preBooking) {
    const phone = (req.body.phone || '').trim();
    if (!phone) throw httpErr(400, 'WhatsApp number is required');
    const found = await Customer.findOne({ phone });
    if (found) return res.json(found);
    return res.status(201).json(await Customer.create({ ...pick(req.body), phone, name: (req.body.name || '').trim() || 'WhatsApp ' + phone, detailsPending: true }));
  }
  const nic = (req.body.nic || '').trim();
  if (nic && await Customer.findOne({ nic: new RegExp('^' + esc(nic) + '$', 'i') })) throw httpErr(409, 'A customer with this NIC already exists');
  res.status(201).json(await Customer.create(pick(req.body)));
}));
r.put('/:id', wrap(async (req, res) => {
  const c = await Customer.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  c.set(pick(req.body));
  if (c.detailsPending && c.nic && c.name && !/^WhatsApp /.test(c.name)) c.detailsPending = false;
  res.json(await c.save());
}));
export default r;
