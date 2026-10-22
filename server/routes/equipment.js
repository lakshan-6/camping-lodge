import { Router } from 'express';
import { Equipment, InventoryTransaction } from '../models/index.js';

const r = Router();
const wrap = fn => (req, res, next) => fn(req, res).catch(next);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pick = b => ['name','category','sku','totalQuantity','periodRate','deposit','damagedQty','condition','notes']
  .reduce((o, k) => (b[k] !== undefined ? { ...o, [k]: b[k] === '' && k === 'sku' ? undefined : b[k] } : o), {});

r.get('/', wrap(async (req, res) => {
  const { q, category, archived } = req.query;
  const f = { active: archived !== 'true' };
  if (category) f.category = category;
  if (q) f.$or = [{ name: new RegExp(esc(q), 'i') }, { sku: new RegExp(esc(q), 'i') }];
  res.json(await Equipment.find(f).sort({ category: 1, name: 1 }));
}));

r.post('/', wrap(async (req, res) => {
  const item = await Equipment.create(pick(req.body));
  if (item.totalQuantity > 0)
    await InventoryTransaction.create({ equipment: item._id, type: 'initial_stock', quantity: item.totalQuantity });
  res.status(201).json(item);
}));

r.put('/:id', wrap(async (req, res) => {
  const item = await Equipment.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const before = item.totalQuantity;
  item.set(pick(req.body));
  await item.save();
  if (item.totalQuantity !== before)
    await InventoryTransaction.create({ equipment: item._id, type: 'adjustment', quantity: item.totalQuantity - before, note: 'Edited in Inventory' });
  res.json(item);
}));

// Archive instead of deleting, so past orders keep their equipment record
r.delete('/:id', wrap(async (req, res) => {
  const item = await Equipment.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
}));

export default r;
