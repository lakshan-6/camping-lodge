import { Order, OrderItem, ReturnItem, Settings } from '../models/index.js';
import { depositHeld, paidTotal } from './finance.js';

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
const paymentLine = payment => [paymentLabel(payment.type), `${money(payment.amount)} · ${method(payment.method)}`];
const depositLine = deposit => [depositLabel(deposit.type), deposit.type === 'apply' ? money(deposit.amount) : `${money(deposit.amount)} · ${method(deposit.method)}`];
const rentalBalance = (order, paid) => ['Rental balance', money(order.status === 'cancelled' ? 0 : Math.max(0, order.totalAmount - paid))];
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
async function sendCustomerUpdate(orderId, build) {
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
    if (response.status !== 201) { await response.body?.cancel(); return 'failed'; }
    const sent = await response.json();
    return typeof sent.messageId === 'string' && sent.messageId ? 'accepted' : 'failed';
  } catch {
    return 'failed';
  }
}

const orderItems = order => OrderItem.find({ order: order._id }).populate('equipment', 'name').lean();
const itemName = item => oneLine(item.equipment?.name) || 'Equipment';

export function sendBookingConfirmation(orderId) {
  return sendCustomerUpdate(orderId, async order => {
    if (order.status !== 'reserved') return null;
    const [items, paid] = await Promise.all([orderItems(order), paidTotal(orderId)]);
    return { title: 'Booking confirmation', tag: 'booking-confirmation', intro: 'Your rental booking is confirmed. Here are your order details.', details: [
      ...(order.pickupDate
        ? [['Pickup date (Sri Lanka)', formatPickupDate.format(new Date(order.startDate))], ['Return deadline', '36 hours after pickup']]
        : [['Pickup (Sri Lanka time)', date(order.startDate)], ['Return (Sri Lanka time)', date(order.endDate)]]),
      ['Rental total', money(order.totalAmount)], ['Rental payment recorded', money(paid)], rentalBalance(order, paid),
      ['Security at pickup', order.securityMethod === 'nic' ? 'Bring your NIC' :
        order.securityMethod === 'money' ? `Refundable money deposit: ${money(order.depositAmount)}` : 'Bring your NIC or a refundable money deposit. Choose at pickup.'],
    ], itemLines: items.map(item => `${item.quantity} × ${itemName(item)} — ${money(item.lineTotal)}`) };
  });
}

export function sendPaymentUpdate(payment) {
  return sendCustomerUpdate(payment.order, async order => {
    const paid = await paidTotal(order._id);
    return { title: payment.type === 'refund' ? 'Refund confirmation' : 'Payment confirmation', tag: 'payment-confirmation',
      intro: 'A rental transaction has been recorded for your booking.', details: [
        paymentLine(payment), ['Recorded (Sri Lanka time)', date(payment.paidAt)], ['Net rental payments', money(paid)],
        ...(order.status === 'cancelled' ? [['Booking status', 'Cancelled']] : [rentalBalance(order, paid)]),
      ] };
  });
}

export function sendDepositUpdate(deposit) {
  return sendCustomerUpdate(deposit.order, async order => {
    const [held, paid] = await Promise.all([depositHeld(order._id), paidTotal(order._id)]);
    return { title: 'Security deposit update', tag: 'security-deposit-update', intro: 'Your refundable security deposit record has been updated.',
      details: [depositLine(deposit), ['Security deposit held', money(held)], rentalBalance(order, paid)] };
  });
}

export function sendPickupUpdate(rental, payment, deposit) {
  return sendCustomerUpdate(rental.order, async order => {
    const [items, paid] = await Promise.all([orderItems(order), paidTotal(order._id)]);
    return { title: 'Pickup confirmation', tag: 'pickup-confirmation', intro: 'Your equipment pickup has been recorded.', details: [
      ['Picked up (Sri Lanka time)', date(rental.pickedUpAt)], ['Due back (Sri Lanka time)', date(rental.dueDate)],
      ...(payment ? [paymentLine(payment)] : []), ...(deposit ? [depositLine(deposit)] : []), rentalBalance(order, paid),
    ], itemLines: items.map(item => `${item.quantity} × ${itemName(item)}`) };
  });
}

export function sendReturnUpdate(orderId, record, payments) {
  return sendCustomerUpdate(orderId, async order => {
    const [items, paid] = await Promise.all([
      ReturnItem.find({ return: record._id }).populate('equipment', 'name').lean(), paidTotal(orderId),
    ]);
    return { title: record.partial ? 'Partial return confirmation' : 'Return confirmation', tag: 'return-confirmation',
      intro: record.partial ? 'Your partial return was recorded. Other equipment is still due back.' : 'Your equipment return is complete.', details: [
        ['Return recorded (Sri Lanka time)', date(record.returnedAt)], ['Late fee', money(record.lateFee)], ['Damage / loss fee', money(record.damageFee)],
        ...payments.map(paymentLine), rentalBalance(order, paid),
      ], itemLines: items.map(item => `${itemName(item)} — ${item.quantityReturned} good, ${item.quantityDamaged} damaged, ${item.quantityLost} lost`) };
  });
}
