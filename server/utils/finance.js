import { Order, OrderItem, Payment, Invoice, DepositTransaction, Equipment, Rental } from '../models/index.js';
import { money, methodOf, units } from './operations.js';
import { httpErr, availability, countPeriods } from './availability.js';
import { nextDocumentNumber } from './documentNumbers.js';
import { assertPermission } from './permissions.js';

export async function paidTotal(id, session = null) {
  const payments = await Payment.find({ order: id }).session(session);
  return Math.round(payments.reduce((s,p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0)*100)/100;
}
export async function depositHeld(id, session = null) {
  const rows = await DepositTransaction.find({ order: id }).session(session);
  return Math.round(rows.reduce((s,p) => s + (p.type === 'collect' ? p.amount : -p.amount),0)*100)/100;
}
export async function syncInvoice(order, session, create = false) {
  let invoice = await Invoice.findOne({ order: order._id, status: { $ne: 'void' } }).session(session);
  const items = await OrderItem.find({ order: order._id }).session(session);
  const subtotal = items.reduce((s,i) => s+i.lineTotal,0);
  const status = (await paidTotal(order._id,session)) >= order.totalAmount ? 'paid' : 'issued';
  if (!invoice && create) {
    [invoice] = await Invoice.create([{ invoiceNo: await nextDocumentNumber('invoice',session), order: order._id, customer: order.customer,
      subtotal, fees: order.totalAmount-subtotal, total: order.totalAmount, status, issuedAt: new Date() }], {session});
  } else if (invoice) { invoice.set({ subtotal, fees: order.totalAmount-subtotal, total: order.totalAmount, status }); await invoice.save({session}); }
  return invoice;
}
export async function recordPayment(order, body, user, session) {
  assertPermission(user, body.type === 'refund' ? 'payments.refund' : 'payments.record');
  const amount = money(body.amount), paid = await paidTotal(order._id,session);
  const type = ['deposit','rental','balance','fee','refund'].includes(body.type) ? body.type : 'balance';
  if (type === 'refund') {
    if (!body.reason?.trim()) throw httpErr(400, 'Enter a reason for the refund');
    if (amount > paid) throw httpErr(409, 'Refund cannot exceed net rental payments received');
  } else {
    if (order.status === 'cancelled') throw httpErr(409, 'Cancelled bookings only accept refunds');
    if (amount > Math.max(0, order.totalAmount-paid)) {
      if (!body.allowOverpayment || !body.reason?.trim()) throw httpErr(409, 'Amount exceeds the balance. An admin must approve an overpayment with a reason.');
      assertPermission(user,'payments.refund');
    }
  }
  const [payment] = await Payment.create([{ order: order._id, amount, type, method: methodOf(body.method), reference: [body.reference,body.reason].filter(Boolean).join(' - ') }], {session});
  if (order.status === 'cancelled' && order.cancellation) { order.cancellation.refundPending = Math.max(0,paid-(type==='refund'?amount:-amount)); await order.save({session}); }
  await syncInvoice(order,session);
  return payment;
}
export async function priceItems(body, session, exclude) {
  const start = new Date(body.startDate), end = new Date(body.endDate);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start >= end) throw httpErr(400,'End time must be after pickup');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length>100) throw httpErr(400,'Choose at least one item');
  const wanted = new Map();
  for (const i of body.items) {
    if (!/^[a-f0-9]{24}$/i.test(String(i.equipment))) throw httpErr(400,'Choose valid equipment');
    wanted.set(String(i.equipment), (wanted.get(String(i.equipment)) || 0)+units(i.quantity));
  }
  await Equipment.updateMany({ _id: { $in: [...wanted.keys()] } }, { $inc: { revision: 1 } }, {session});
  const avail = new Map((await availability(start,end,exclude,session)).map(i=>[String(i._id),i]));
  const periods = countPeriods(start,end); let total=0,deposit=0;
  const lines = [...wanted].map(([id,quantity])=>{
    const item=avail.get(id);
    if (!item || quantity>item.available) throw httpErr(409,`${item?.name || 'Equipment'} is not available in the requested quantity`);
    const lineTotal=money(quantity*item.periodRate*periods,'Rental total',true);
    total+=lineTotal;deposit+=quantity*item.deposit;
    return { equipment:id,quantity,periodRate:item.periodRate,periods,lineTotal,returnedQuantity:0 };
  });
  return { start,end,periods,lines,total:money(total,'Total',true),deposit:money(deposit,'Deposit',true) };
}
export async function remainingLines(order, session = null) {
  return (await OrderItem.find({order}).populate('equipment','name checklist').session(session)).map(i=>({
    ...i.toObject(), remaining: Math.max(0,i.quantity-(i.returnedQuantity||0))
  }));
}
