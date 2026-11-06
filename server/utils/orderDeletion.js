import mongoose from 'mongoose';
import { Order, OrderItem, Payment, Invoice, Rental, Return, ReturnItem, InventoryTransaction } from '../models/index.js';
import { httpErr } from './availability.js';

// Used by the single service instance to keep order writes and deletion in order.
const locks = new Map();
export async function withOrderLock(id, fn) {
  const key = String(id);
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(key, run);
  try { return await run; }
  finally { if (locks.get(key) === run) locks.delete(key); }
}

async function relatedRecords(id, session) {
  const order = await Order.findById(id).session(session).lean();
  if (!order) throw httpErr(404, 'Order not found');
  if (order.status !== 'completed') throw httpErr(409, 'Only completed orders can be permanently deleted. Receive outstanding returns first.');
  const rentals = await Rental.find({ order: order._id }).session(session).lean();
  if (rentals.some(r => r.status !== 'returned')) throw httpErr(409, 'This order still has an outstanding rental. Receive its return first.');
  const returns = await Return.find({ rental: { $in: rentals.map(r => r._id) } }).session(session).lean();
  const invoices = await Invoice.find({ order: order._id }).session(session).lean();
  const paymentFilter = { $or: [{ order: order._id }, { invoice: { $in: invoices.map(i => i._id) } }] };
  const payments = await Payment.find(paymentFilter).session(session).lean();
  const itemsFilter = { order: order._id };
  const returnItemsFilter = { return: { $in: returns.map(r => r._id) } };
  const referenceIds = [order._id, ...rentals.map(r => r._id), ...returns.map(r => r._id), ...invoices.map(i => i._id)].map(String);
  const transactionFilter = { reference: { $in: referenceIds } };
  const orderItems = await OrderItem.countDocuments(itemsFilter).session(session);
  const returnItems = await ReturnItem.countDocuments(returnItemsFilter).session(session);
  const stockTransactions = await InventoryTransaction.countDocuments(transactionFilter).session(session);
  return { order, rentals, returns, invoices, paymentFilter, itemsFilter, returnItemsFilter, transactionFilter,
    summary: { orderNo: order.orderNo, totalAmount: order.totalAmount,
      netPayments: payments.reduce((sum, p) => sum + (p.type === 'refund' ? -p.amount : p.amount), 0),
      counts: { orders: 1, orderItems, payments: payments.length, invoices: invoices.length,
        rentals: rentals.length, returns: returns.length, returnItems, stockTransactions } } };
}

export async function previewOrderDeletion(id) {
  return withOrderLock(id, async () => (await relatedRecords(id, null)).summary);
}

export async function permanentlyDeleteOrder(id, confirmation) {
  return withOrderLock(id, async () => {
    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const data = await relatedRecords(id, session);
        if (confirmation !== data.order.orderNo) throw httpErr(400, 'Type the order number exactly to confirm permanent deletion');
        // Sequential operations on one transaction: any failure rolls back every removal.
        await ReturnItem.deleteMany(data.returnItemsFilter, { session });
        await InventoryTransaction.deleteMany(data.transactionFilter, { session });
        await Payment.deleteMany(data.paymentFilter, { session });
        await Invoice.deleteMany({ order: data.order._id }, { session });
        await Return.deleteMany({ _id: { $in: data.returns.map(r => r._id) } }, { session });
        await Rental.deleteMany({ order: data.order._id }, { session });
        await OrderItem.deleteMany(data.itemsFilter, { session });
        const result = await Order.deleteOne({ _id: data.order._id, status: 'completed' }, { session });
        if (result.deletedCount !== 1) throw httpErr(409, 'Order changed. Refresh and try again.');
        return data.summary;
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } catch (e) {
      if (e.code === 20 || e.codeName === 'IllegalOperation')
        throw httpErr(503, 'Permanent deletion requires a MongoDB replica set, such as MongoDB Atlas. No records were deleted.');
      throw e;
    } finally { await session.endSession(); }
  });
}
