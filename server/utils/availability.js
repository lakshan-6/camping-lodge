import { Equipment, Order, OrderItem } from '../models/index.js';

export const PERIOD_MS = 36 * 3600 * 1000;
// Up to 36h = 1 period, 37-72h = 2, 73-108h = 3 ...
export const countPeriods = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / PERIOD_MS));
export const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Units booked by reserved/active orders overlapping [start, end). Back-to-back bookings are allowed.
export async function availability(start, end, excludeOrder) {
  // Active (picked-up) orders stay booked until returned, even when overdue
  const orders = await Order.find({ startDate: { $lt: end }, $or: [
    { status: 'reserved', endDate: { $gt: start } },
    { status: 'active', $or: [{ endDate: { $gt: start } }, { endDate: { $lt: new Date() } }] }] }).select('_id');
  const ids = orders.map(o => o._id).filter(id => String(id) !== String(excludeOrder));
  const booked = await OrderItem.aggregate([
    { $match: { order: { $in: ids } } }, { $group: { _id: '$equipment', qty: { $sum: '$quantity' } } }]);
  const map = Object.fromEntries(booked.map(b => [String(b._id), b.qty]));
  const items = await Equipment.find({ active: true }).sort({ category: 1, name: 1 });
  return items.map(i => {
    const b = map[i.id] || 0;
    return { ...i.toObject(), booked: b, available: Math.max(0, i.totalQuantity - i.damagedQty - b) };
  });
}
