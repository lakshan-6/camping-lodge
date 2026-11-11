import { Order, OrderItem, Payment, Invoice, DepositTransaction, Equipment, Rental } from '../models/index.js';
import { money, methodOf, units, audit } from './operations.js';
import { httpErr, availability, bookingWindow } from './availability.js';
import { nextDocumentNumber } from './documentNumbers.js';
import { assertPermission } from './permissions.js';

export async function paidTotal(id, session = null) {
  const payments = await Payment.find({ order: id }).session(session);
  return Math.round(payments.reduce((s,p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0)*100)/100;
}
export const rentalBalanceDue = (total, paid) => Math.max(0, Math.round((total-paid)*100)/100);
export async function depositHeld(id, session = null) {
  const rows = await DepositTransaction.find({ order: id }).session(session);
  return Math.round(rows.reduce((s,p) => s + (p.type === 'collect' ? p.amount : -p.amount),0)*100)/100;
}
export async function recordSecurityDeposit(order,body,user,session){
  const type=body.type;if(!['collect','refund','apply'].includes(type))throw httpErr(400,'Choose a deposit action');
  assertPermission(user,type==='collect'?'payments.record':'payments.refund');
  const amount=money(body.amount),held=await depositHeld(order._id,session);
  if(type==='collect'&&order.status==='reserved'&&!order.securityMethod)throw httpErr(409,'Choose and confirm security during pickup');
  if(type==='collect'&&(order.securityMethod==='nic'||(order.nicHeldAt&&!order.nicReturnedAt)))throw httpErr(409,'This order uses NIC security. Return any held NIC and choose money security before collecting a deposit.');
  if(type==='collect'&&(order.status==='cancelled'||Math.round(amount*100)>Math.round((order.depositAmount-held)*100)))throw httpErr(409,'Deposit collection exceeds the required deposit or this booking is cancelled');
  if(type!=='collect'&&amount>held)throw httpErr(409,'Amount exceeds the held security deposit');
  if(type!=='collect'&&!body.reason?.trim())throw httpErr(400,'Enter a reason');
  if(type==='apply')await recordPayment(order,{amount,type:'balance',method:'other',reference:'Applied security deposit',reason:body.reason},{...user,role:user.role,permissions:[...(user.permissions||[]),'payments.record']},session);
  const [row]=await DepositTransaction.create([{order:order._id,type,amount,method:methodOf(body.method),reason:body.reason,actor:user._id}],{session});
  await audit(session,user,'security_deposit.'+type,order._id,{held},{amount,held:held+(type==='collect'?amount:-amount)});return row;
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
    if (amount > rentalBalanceDue(order.totalAmount, paid)) {
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
  const window = bookingWindow(body.pickupDate,body.startDate,body.endDate);
  const { start,end,periods } = window;
  if (!Array.isArray(body.items) || !body.items.length || body.items.length>100) throw httpErr(400,'Choose at least one item');
  const wanted = new Map();
  for (const i of body.items) {
    if (!/^[a-f0-9]{24}$/i.test(String(i.equipment))) throw httpErr(400,'Choose valid equipment');
    wanted.set(String(i.equipment), (wanted.get(String(i.equipment)) || 0)+units(i.quantity));
  }
  await Equipment.updateMany({ _id: { $in: [...wanted.keys()] } }, { $inc: { revision: 1 } }, {session});
  const avail = new Map((await availability(start,end,exclude,session)).map(i=>[String(i._id),i]));
  let total=0,deposit=0;
  const lines = [...wanted].map(([id,quantity])=>{
    const item=avail.get(id);
    if (!item || quantity>item.available) throw httpErr(409,`${item?.name || 'Equipment'} is not available in the requested quantity`);
    const lineTotal=money(quantity*item.periodRate*periods,'Rental total',true);
    total+=lineTotal;deposit+=quantity*item.deposit;
    return { equipment:id,quantity,periodRate:item.periodRate,periods,lineTotal,returnedQuantity:0 };
  });
  return { ...window,lines,total:money(total,'Total',true),deposit:money(deposit,'Deposit',true) };
}
export async function remainingLines(order, session = null) {
  return (await OrderItem.find({order}).populate('equipment','name checklist trackUnits').session(session)).map(i=>({
    ...i.toObject(), remaining: Math.max(0,i.quantity-(i.returnedQuantity||0))
  }));
}
