import { Router } from 'express';
import { Customer } from '../models/index.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = b => ({ name: b.name, phone: b.phone, nic: b.nic, address: b.address, notes: b.notes });

r.get('/', wrap(async (req, res) => {
  const q = req.query.q;
  const f = q ? { $or: [{ name: new RegExp(esc(q), 'i') }, { phone: new RegExp(esc(q), 'i') }] } : {};
  res.json(await Customer.find(f).sort({ name: 1 }));
}));
r.post('/', wrap(async (req, res) => res.status(201).json(await Customer.create(pick(req.body)))));
r.put('/:id', wrap(async (req, res) => {
  const c = await Customer.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
  c ? res.json(c) : res.status(404).json({ error: 'Not found' });
}));
export default r;
