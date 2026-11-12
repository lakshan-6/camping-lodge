import { api, getToken, lkr } from './api.js';
import { formatBusinessTime, formatPickup, formatReturn } from './businessTime.js';

export function whatsAppLink(phone, message) {
  const digits = String(phone ?? '').replace(/[\s()+.-]/g, '');
  const number = /^0\d{9}$/.test(digits) ? '94' + digits.slice(1) : digits.replace(/^00/, '');
  if (!/^[1-9]\d{9,14}$/.test(number)) return null;
  return 'https://wa.me/' + number + '?text=' + encodeURIComponent(message);
}

const paymentNames = {
  deposit: 'Rental advance',
  rental: 'Rental payment',
  balance: 'Rental payment',
  fee: 'Fee payment',
  refund: 'Rental refund',
};

export function getOrderWhatsAppUpdates(order, businessName = 'Camping Lodge') {
  if (!order?.orderNo || order.deletedAt || !whatsAppLink(order.customer?.phone, '')) return [];

  const updates = [];
  const intro = `Hello, this is ${businessName || 'Camping Lodge'}.\nOrder ${order.orderNo}`;
  const balance = Math.max(0, Math.round((order.totalAmount - order.paid) * 100) / 100);
  const balanceLine = 'Rental balance: ' + lkr(balance);
  const add = (key, label, lines) => {
    const message = [intro, ...lines].join('\n');
    updates.push({ key, label, url: whatsAppLink(order.customer.phone, message) });
  };

  if (order.status === 'reserved') {
    const items = (order.items ?? []).map(item => `${item.quantity} × ${item.equipment?.name || 'Equipment'}`);
    add('booking', 'Booking confirmation', [
      'Your booking is confirmed.',
      'Pickup: ' + formatPickup(order),
      'Return: ' + formatReturn(order),
      ...items,
      'Rental total: ' + lkr(order.totalAmount),
      balanceLine,
    ]);
  }

  if (order.status === 'active') {
    add('pickup', 'Pickup confirmation', [
      'Your equipment pickup has been recorded.',
      'Picked up: ' + formatPickup(order),
      'Due back: ' + formatReturn(order),
      balanceLine,
    ]);
  }

  if (['settlement_pending', 'completed'].includes(order.status)) {
    const outcome = order.status === 'completed' ? 'Your order is complete.' : 'Your return has been recorded. Settlement is still pending.';
    add('return', 'Return update', [outcome, balanceLine]);
  } else if (order.status === 'active' && order.items?.some(item => item.returnedQuantity > 0)) {
    add('return', 'Partial return update', ['A partial return has been recorded. The remaining equipment is still due.', balanceLine]);
  }

  for (const payment of order.payments ?? []) {
    const name = paymentNames[payment.type] || 'Rental payment';
    const amount = lkr(payment.amount);
    const date = formatBusinessTime(payment.paidAt);
    add(payment._id, `${name} · ${amount} · ${date}`, [
      `${name} recorded: ${amount}`,
      'Date: ' + date,
      ...(order.status === 'cancelled' ? [] : [balanceLine]),
    ]);
  }
  return updates;
}

// Opens WhatsApp with the customer's number and a ready message, and saves the invoice PDF so it can be attached.
// The chat tab is opened straight away so the browser does not block it.
export async function sendInvoiceWhatsApp(id) {
  const w = window.open('', '_blank');
  try {
    const [i, st] = await Promise.all([api('/invoices/' + id), api('/settings')]);
    if (i.status === 'void') throw new Error('This invoice is void');
    const done = i.balance <= 0;
    const msg = `Hello ${i.customer?.name || ''},\n${done ? 'Your payment is complete. Thank you!' : 'Your rental has started.'}\n`
      + `${st.businessName} invoice ${i.invoiceNo} (order ${i.order?.orderNo})\nTotal: ${lkr(i.total)}\nPaid: ${lkr(i.paid)}\n`
      + `${done ? '' : 'Balance due: ' + lkr(i.balance) + '\n'}Thank you for choosing ${st.businessName}.`;
    const url = whatsAppLink(i.customer?.phone, msg);
    if (!url) throw new Error('The customer needs a valid phone number');
    if (w) w.location.href = url; else window.open(url, '_blank');
    const res = await fetch(`/api/invoices/${id}/pdf`, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (res.ok) { const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = i.invoiceNo + '.pdf'; a.click(); }
  } catch (e) { if (w) w.close(); alert('Could not open WhatsApp: ' + e.message); }
}
