import { Order, OrderItem, Settings } from '../models/index.js';
import { paidTotal } from './finance.js';

const endpoint = 'https://api.brevo.com/v3/smtp/email';
const address = value => typeof value === 'string' ? value.trim() : '';
// Only accept a single mailbox, with no display name, list separators, or control characters.
const isMailbox = value => value.length <= 254 && /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(value) && !/[\x00-\x1f\x7f]/.test(value);
const oneLine = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatDate = new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' });
const formatAmount = new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' });

function confirmation(order, items, settings, paid, recipient, sender) {
  const business = oneLine(settings?.businessName) || 'Camping Lodge';
  const phone = oneLine(settings?.phone);
  const money = amount => formatAmount.format(amount);
  const details = [
    ['Booking', order.orderNo],
    ['Pickup (Sri Lanka time)', formatDate.format(new Date(order.startDate))],
    ['Return (Sri Lanka time)', formatDate.format(new Date(order.endDate))],
    ['Rental total', money(order.totalAmount)],
    ['Rental payment recorded', money(paid)],
    ['Rental balance', money(Math.max(0, order.totalAmount - paid))],
    ['Security at pickup', order.securityMethod === 'nic' ? 'Bring your NIC' : `Refundable money deposit: ${money(order.depositAmount)}`],
  ];
  const greeting = `Hello ${oneLine(order.customer.name)},`;
  const itemLines = items.map(item => `${item.quantity} × ${oneLine(item.equipment?.name) || 'Equipment'} — ${money(item.lineTotal)}`);
  const footer = phone ? `${business} · ${phone}` : business;
  const intro = 'Your rental booking is confirmed. Here are your order details.';
  return {
    sender: { email: sender, name: business }, replyTo: { email: sender, name: business },
    to: [{ email: recipient }], subject: `${business}: booking confirmation ${oneLine(order.orderNo)}`,
    tags: ['booking-confirmation'],
    textContent: [greeting, intro, ...details.map(([label, value]) => `${label}: ${value}`), 'Items:', ...itemLines, footer].join('\n'),
    htmlContent: `<html><body style="font-family:Arial,sans-serif;color:#1c2824">
      <h2>${escape(business)} · Booking confirmation</h2><p>${escape(greeting)}</p><p>${escape(intro)}</p>
      <dl>${details.map(([label, value]) => `<dt><strong>${escape(label)}</strong></dt><dd>${escape(value)}</dd>`).join('')}</dl>
      <h3>Items</h3><ul>${itemLines.map(line => `<li>${escape(line)}</li>`).join('')}</ul><p>${escape(footer)}</p>
    </body></html>`,
  };
}

// Called after the booking transaction commits. A failed provider call never changes the order.
export async function sendBookingConfirmation(orderId) {
  const key = process.env.BREVO_API_KEY?.trim();
  const sender = address(process.env.BOOKING_EMAIL_FROM);
  if (!key || !isMailbox(sender)) return 'not_configured';

  try {
    const order = await Order.findById(orderId).populate('customer', 'name email').lean();
    if (!order || order.status !== 'reserved' || order.deletedAt) return 'not_applicable';
    const recipient = address(order.customer?.email);
    if (!recipient) return 'no_email';
    if (!isMailbox(recipient)) return 'invalid_email';
    const [items, settings, paid] = await Promise.all([
      OrderItem.find({ order: orderId }).populate('equipment', 'name').lean(),
      Settings.findOne().select('businessName phone').lean(),
      paidTotal(orderId),
    ]);
    const response = await fetch(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(confirmation(order, items, settings, paid, recipient, sender)),
    });
    if (response.status !== 201) return 'failed';
    const sent = await response.json();
    return typeof sent.messageId === 'string' && sent.messageId ? 'accepted' : 'failed';
  } catch {
    return 'failed';
  }
}
