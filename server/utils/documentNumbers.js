import { Counter, Order, Invoice, Equipment } from '../models/index.js';

export const shortEquipmentSkuPattern = /^[A-Z]{3}[1-9][0-9]*$/;

const kinds = {
  order: { model: Order, field: 'orderNo', prefix: 'CL-' },
  invoice: { model: Invoice, field: 'invoiceNo', prefix: 'INV-' },
  equipment: {
    model: Equipment, field: 'sku', prefix: 'EQ-', numberWidth: 1,
    additionalFormats: [
      { pattern: /^[A-Z0-9]{3}-[A-Z0-9]{3}-[0-9]+$/, offset: 8 },
      { pattern: shortEquipmentSkuPattern, offset: 3 },
    ],
  },
};

// Preserve a high-water mark even when the newest document is permanently deleted.
export async function initializeDocumentNumbers() {
  for (const [kind, { model, field, prefix, additionalFormats = [] }] of Object.entries(kinds)) {
    const formats = [{ pattern: new RegExp('^' + prefix + '[0-9]+$'), offset: prefix.length }, ...additionalFormats];
    const matches = await Promise.all(formats.map(({pattern,offset})=>model.aggregate([
      { $match: { [field]: pattern } },
      { $project: { number: { $convert: { input: { $substrBytes: ['$' + field, offset, 32] }, to: 'double', onError: 0, onNull: 0 } } } },
      { $group: { _id: null, max: { $max: '$number' } } }
    ])));
    const update = { $max: { value: Math.max(...matches.map(rows=>rows[0]?.max||0)) } };
    try { await Counter.findOneAndUpdate({ _id: kind }, update, { upsert: true }); }
    catch (e) { if (e.code !== 11000) throw e; await Counter.updateOne({ _id: kind }, update); }
  }
}

export async function nextDocumentNumber(kind, session = null, prefix = kinds[kind]?.prefix) {
  const counter = await Counter.findOneAndUpdate({ _id: kind }, { $inc: { value: 1 } }, { new: true, session });
  if (!counter || !kinds[kind]) throw new Error('Document counters have not been initialized');
  return prefix + String(counter.value).padStart(kinds[kind].numberWidth ?? 4, '0');
}
