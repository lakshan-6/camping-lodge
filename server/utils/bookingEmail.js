import { Order, OrderItem, ReturnItem, Settings } from '../models/index.js';
import { depositHeld, paidTotal } from './finance.js';
import { audit } from './operations.js';

const endpoint = 'https://api.brevo.com/v3/smtp/email';
const address = value => typeof value === 'string' ? value.trim() : '';
// Only accept a single mailbox, with no display name, list separators, or control characters.
const isMailbox = value => value.length <= 254 && /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(value) && !/[\x00-\x1f\x7f]/.test(value);
const oneLine = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatDate = new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' });
const formatPickupDate = new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeZone: 'Asia/Colombo' });
const formatAmount = new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' });
const money = amount => formatAmount.format(Number(amount) || 0);
const date = value => formatDate.format(new Date(value));
const method = value => ({ cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other' }[value] || 'Other');
const paymentLabel = value => ({ deposit: 'Rental advance', rental: 'Rental payment', balance: 'Rental balance payment', fee: 'Fee payment', refund: 'Rental refund' }[value] || 'Rental payment');
const depositLabel = value => ({ collect: 'Security deposit received', refund: 'Security deposit refunded', apply: 'Security deposit applied to rental balance' }[value]);
const paymentLine = payment => {
  const saleAmount=payment.saleAmount||0;
  const kind=saleAmount>=payment.amount?'Sales':'Order';
  const label=saleAmount>0?`${kind} ${payment.type==='refund'?'refund':'payment'}`:paymentLabel(payment.type);
  return [label, `${money(payment.amount)} · ${method(payment.method)}`];
};
const depositLine = deposit => [depositLabel(deposit.type), deposit.type === 'apply' ? money(deposit.amount) : `${money(deposit.amount)} · ${method(deposit.method)}`];
const orderBalance = (order, paid, sales=false) => [sales?'Order balance':'Rental balance', money(order.status === 'cancelled' ? 0 : Math.max(0, order.totalAmount - paid))];
export const bookingEmailConfigured = () => !!process.env.BREVO_API_KEY?.trim() && isMailbox(address(process.env.BOOKING_EMAIL_FROM));

function message(order, settings, recipient, sender, {title, intro, tag, details, itemLines = []}) {
  const business = oneLine(settings?.businessName) || 'Camping Lodge';
  const phone = oneLine(settings?.phone);
  const fields = [['Booking', order.orderNo], ...details];
  const greeting = `Hello ${oneLine(order.customer.name)},`;
  const footer = phone ? `${business} · ${phone}` : business;
  return {
    sender: { email: sender, name: business }, replyTo: { email: sender, name: business },
    to: [{ email: recipient }], subject: `${business}: ${title.toLowerCase()} ${oneLine(order.orderNo)}`,
    tags: [tag],
    textContent: [greeting, intro, ...fields.map(([label, value]) => `${label}: ${value}`), ...(itemLines.length ? ['Items:', ...itemLines] : []), footer].join('\n'),
    htmlContent: `<html><body style="font-family:Arial,sans-serif;color:#1c2824">
      <h2>${escape(business)} · ${escape(title)}</h2><p>${escape(greeting)}</p><p>${escape(intro)}</p>
      <dl>${fields.map(([label, value]) => `<dt><strong>${escape(label)}</strong></dt><dd>${escape(value)}</dd>`).join('')}</dl>
      ${itemLines.length ? `<h3>Items</h3><ul>${itemLines.map(line => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}<p>${escape(footer)}</p>
    </body></html>`,
  };
}

// Called after the booking transaction commits. A failed provider call never changes the order.
async function sendCustomerUpdate(orderId, event, build) {
  const status = await deliverCustomerUpdate(orderId, build);
  if (status !== 'not_applicable') {
    try { await audit(null, null, 'email.' + event, orderId, null, {status}); }
    catch { console.warn('Could not record customer email status for order', String(orderId)); }
  }
  return status;
}

async function deliverCustomerUpdate(orderId, build) {
  const key = process.env.BREVO_API_KEY?.trim();
  const sender = address(process.env.BOOKING_EMAIL_FROM);
  if (!key || !isMailbox(sender)) return 'not_configured';

  try {
    const order = await Order.findById(orderId).populate('customer', 'name email').lean();
    if (!order || order.deletedAt) return 'not_applicable';
    const recipient = address(order.customer?.email);
    if (!recipient) return 'no_email';
    if (!isMailbox(recipient)) return 'invalid_email';
    const [update, settings] = await Promise.all([
      build(order),
      Settings.findOne().select('businessName phone').lean(),
    ]);
    if (!update) return 'not_applicable';
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(message(order, settings, recipient, sender, update)),
    });
    if (response.status !== 201) {
      await response.body?.cancel();
      return [400,401,403,422,429].includes(response.status) ? 'rejected' : 'failed';
    }
    const sent = await response.json();
    return typeof sent.messageId === 'string' && sent.messageId ? 'accepted' : 'failed';
  } catch {
    return 'failed';
  }
}

const orderItems = order => OrderItem.find({ order: order._id }).populate('equipment', 'name').lean();
const itemName = item => oneLine(item.equipment?.name) || 'Equipment';
const hasSales = items => items.some(item=>item.itemType==='sale');
const hasRentals = items => items.some(item=>item.itemType!=='sale');
const itemDescription = item => `${item.quantity} × ${itemName(item)} · ${item.itemType==='sale'
  ?`Sale · ${money(item.periodRate)} each`:`Rental · ${money(item.periodRate)} / 36h × ${item.periods} period(s)`} — ${money(item.lineTotal)}`;

export function sendBookingConfirmation(orderId) {
  return sendCustomerUpdate(orderId, 'booking', async order => {
    if (order.status !== 'reserved') return null;
    const [items, paid] = await Promise.all([orderItems(order), paidTotal(orderId)]);
    const sales=hasSales(items),rentals=hasRentals(items);
    return { title: 'Booking confirmation', tag: 'booking-confirmation', intro: sales?'Your order is confirmed. Here are your order details.':'Your rental booking is confirmed. Here are your order details.', details: [
      ...(order.pickupDate
        ? [['Pickup date (Sri Lanka)', formatPickupDate.format(new Date(order.startDate))],
           ...(rentals&&order.plannedReturnDate ? [['Planned return date (Sri Lanka)', formatPickupDate.format(new Date(order.plannedReturnDate))]] : []),
           ...(rentals?[['Return deadline', '36 hours after pickup']]:[])]
        : [['Pickup (Sri Lanka time)', date(order.startDate)], ...(rentals?[['Return (Sri Lanka time)', date(order.endDate)]]:[])]),
      [sales?'Order total':'Rental total', money(order.totalAmount)], [sales?'Payments recorded':'Rental payment recorded', money(paid)], orderBalance(order, paid, sales),
      ...(rentals?[['Security at pickup', order.securityMethod === 'nic' ? 'Bring your NIC' :
        order.securityMethod === 'money' ? `Refundable money deposit: ${money(order.depositAmount)}` : 'Bring your NIC or a refundable money deposit. Choose at pickup.']]:[]),
    ], itemLines: items.map(itemDescription) };
  });
}

export function sendPaymentUpdate(payment) {
  return sendCustomerUpdate(payment.order, 'payment', async order => {
    const [paid,items] = await Promise.all([paidTotal(order._id),orderItems(order)]);
    const sales=hasSales(items);
    return { title: payment.type === 'refund' ? 'Refund confirmation' : 'Payment confirmation', tag: 'payment-confirmation',
      intro: sales?'A payment transaction has been recorded for your order.':'A rental transaction has been recorded for your booking.', details: [
        paymentLine(payment), ['Recorded (Sri Lanka time)', date(payment.paidAt)], [sales?'Net order payments':'Net rental payments', money(paid)],
        ...(order.status === 'cancelled' ? [['Booking status', 'Cancelled']] : [orderBalance(order, paid, sales)]),
      ] };
  });
}

export function sendDepositUpdate(deposit) {
  return sendCustomerUpdate(deposit.order, 'deposit', async order => {
    const [held, paid,items] = await Promise.all([depositHeld(order._id), paidTotal(order._id),orderItems(order)]);
    return { title: 'Security deposit update', tag: 'security-deposit-update', intro: 'Your refundable security deposit record has been updated.',
      details: [depositLine(deposit), ['Security deposit held', money(held)], orderBalance(order, paid,hasSales(items))] };
  });
}

export function sendSettlementUpdate(orderId,payment,deposits) {
  return sendCustomerUpdate(orderId,'settlement',async order=>{
    const [held,paid,items]=await Promise.all([depositHeld(order._id),paidTotal(order._id),orderItems(order)]);
    return {title:'Return settlement update',tag:'return-settlement',intro:'Payment and security actions for your return have been recorded.',
      details:[...(payment?[paymentLine(payment)]:[]),...deposits.map(depositLine),['Security deposit held',money(held)],orderBalance(order,paid,hasSales(items))]};
  });
}

export function sendPickupUpdate(rental, payment, deposit) {
  return sendCustomerUpdate(rental.order, 'pickup', async order => {
    const [items, paid] = await Promise.all([orderItems(order), paidTotal(order._id)]);
    const rentals=hasRentals(items);
    return { title: 'Pickup confirmation', tag: 'pickup-confirmation', intro: rentals?'Your equipment pickup has been recorded.':'Your purchased items have been handed over.', details: [
      ['Picked up (Sri Lanka time)', date(rental.pickedUpAt)], ...(rentals?[['Due back (Sri Lanka time)', date(rental.dueDate)]]:[]),
      ...(payment ? [paymentLine(payment)] : []), ...(deposit ? [depositLine(deposit)] : []), orderBalance(order, paid,hasSales(items)),
    ], itemLines: items.map(itemDescription) };
  });
}

export function sendReturnUpdate(orderId, record, payments) {
  return sendCustomerUpdate(orderId, 'return', async order => {
    const [items, paid,lines] = await Promise.all([
      ReturnItem.find({ return: record._id }).populate('equipment', 'name').lean(), paidTotal(orderId),orderItems(order),
    ]);
    return { title: record.partial ? 'Partial return confirmation' : 'Return confirmation', tag: 'return-confirmation',
      intro: record.partial ? 'Your partial return was recorded. Other equipment is still due back.' : 'Your equipment return is complete.', details: [
        ['Return recorded (Sri Lanka time)', date(record.returnedAt)], ['Late fee', money(record.lateFee)], ['Damage / loss fee', money(record.damageFee)],
        ...payments.map(paymentLine), orderBalance(order, paid,hasSales(lines)),
      ], itemLines: items.map(item => `${itemName(item)} — ${item.quantityReturned} good, ${item.quantityDamaged} damaged, ${item.quantityLost} lost`) };
  });
}
