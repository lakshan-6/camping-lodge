import { Equipment, Order, OrderItem } from '../models/index.js';
import { dayRange } from './businessTime.js';

export const PERIOD_MS = 36 * 3600 * 1000;
// Up to 36h = 1 period, 37-72h = 2, 73-108h = 3 ...
export const countPeriods = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / PERIOD_MS));
export const httpErr = (status, message) => Object.assign(new Error(message), { status });

export function bookingWindow(pickupDate, startDate, endDate) {
  if (pickupDate !== undefined) {
    const { $gte: start, $lt: nextDay } = dayRange(pickupDate);
    // Hold stock for the full pickup day plus 36 hours for a pickup near midnight.
    const end = new Date(+nextDay + PERIOD_MS);
    return { pickupDate, start, end, reservedUntil:end, periods: 1 };
  }
  const start = new Date(startDate), end = new Date(endDate);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end) throw httpErr(400, 'End time must be after pickup');
  const periods=countPeriods(start,end);
  return { start, end, periods, reservedUntil:new Date(+start+periods*PERIOD_MS) };
}

export const reservedEnd=order=>order.pickupDate?+new Date(order.endDate):
  Math.max(+new Date(order.endDate),+new Date(order.startDate)+(order.periods||1)*PERIOD_MS);

export function peakQuantity(events){
  events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let current=0,peak=0;
  for(const [,change] of events){current+=change;peak=Math.max(peak,current);}
  return peak;
}

// Units booked by reserved/active orders overlapping [start, end). Back-to-back bookings are allowed.
export async function availability(start, end, excludeOrder, session = null) {
  const now=new Date();
  const orders = await Order.find({ startDate: { $lt: end }, $or: [
    { status: 'reserved', endDate: { $gt: new Date(+start-PERIOD_MS) } },
    { status: 'active', $or: [{ endDate: { $gt: start } }, { endDate: { $lte: now } }] }]
  }).select('_id startDate endDate periods pickupDate status').session(session);
  const windows=new Map();
  for(const order of orders){
    if(String(order._id)===String(excludeOrder))continue;
    const until=order.status==='reserved'?reservedEnd(order):order.endDate<=now?Infinity:+order.endDate;
    const from=Math.max(+start,+order.startDate),to=Math.min(+end,until);
    if(from<to)windows.set(String(order._id),[from,to]);
  }
  const lines=windows.size?await OrderItem.find({order:{$in:[...windows.keys()]}}).select('order equipment quantity returnedQuantity').session(session):[];
  const events=new Map();
  for(const line of lines){
    const quantity=line.quantity-(line.returnedQuantity||0);
    if(quantity<=0)continue;
    const key=String(line.equipment),[from,to]=windows.get(String(line.order));
    if(!events.has(key))events.set(key,[]);
    events.get(key).push([from,quantity],[to,-quantity]);
  }
  const items = await Equipment.find({ active: true }).sort({ category: 1, name: 1 }).session(session);
  return items.map(i => {
    const b = peakQuantity(events.get(String(i._id))||[]);
    return { ...i.toObject(), booked: b, available: Math.max(0, i.totalQuantity - i.damagedQty - b) };
  });
}
