import { Counter, Order, Invoice } from '../models/index.js';

const kinds = { order: { model: Order, field: 'orderNo', prefix: 'CL-' }, invoice: { model: Invoice, field: 'invoiceNo', prefix: 'INV-' } };

// Preserve a high-water mark even when the newest document is permanently deleted.
export async function initializeDocumentNumbers() {
  for (const [kind, { model, field, prefix }] of Object.entries(kinds)) {
    const rows = await model.aggregate([
      { $match: { [field]: new RegExp('^' + prefix + '[0-9]+$') } },
      { $project: { number: { $convert: { input: { $substrBytes: ['$' + field, prefix.length, 32] }, to: 'double', onError: 0, onNull: 0 } } } },
      { $group: { _id: null, max: { $max: '$number' } } }
    ]);
    const update = { $max: { value: rows[0]?.max || 0 } };
    try { await Counter.findOneAndUpdate({ _id: kind }, update, { upsert: true }); }
    catch (e) { if (e.code !== 11000) throw e; await Counter.updateOne({ _id: kind }, update); }
  }
}

export async function nextDocumentNumber(kind, session = null) {
  const counter = await Counter.findOneAndUpdate({ _id: kind }, { $inc: { value: 1 } }, { new: true, session });
  if (!counter || !kinds[kind]) throw new Error('Document counters have not been initialized');
  return kinds[kind].prefix + String(counter.value).padStart(4, '0');
}
