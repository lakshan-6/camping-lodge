import fs from 'fs';
import { fileURLToPath } from 'url';
import { Invoice, Order, OrderItem, Payment } from '../models/index.js';
import { getSettings } from '../routes/settings.js';
import { sendMail } from './mail.js';
import { invoicePdf } from './invoicePdf.js';
import { httpErr } from './availability.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lkr = n => 'LKR ' + Number(n || 0).toLocaleString('en-LK');
const logoPath = fileURLToPath(new URL('../assets/logo.png', import.meta.url));
const sumPaid = pays => pays.reduce((s, p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0);

async function load(id) {
  const inv = await Invoice.findById(id).populate('customer').populate('order').lean();
  if (!inv) throw httpErr(404, 'Invoice not found');
  const items = await OrderItem.find({ order: inv.order._id }).populate('equipment', 'name').lean();
  const paid = sumPaid(await Payment.find({ order: inv.order._id }).lean());
  return { inv, items, paid, st: await getSettings() };
}

// A fully paid order gets a "paid" invoice straight away; otherwise it shows the balance due
export async function createInvoice(o) {
  const items = await OrderItem.find({ order: o._id });
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const paid = sumPaid(await Payment.find({ order: o._id }));
  const n = (await Invoice.countDocuments()) + 1;
  return Invoice.create({ invoiceNo: 'INV-' + String(n).padStart(4, '0'), order: o._id, customer: o.customer,
    subtotal, fees: o.totalAmount - subtotal, total: o.totalAmount, status: paid >= o.totalAmount ? 'paid' : 'issued', issuedAt: new Date() });
}

export async function invoicePdfBuffer(id) {
  const d = await load(id);
  return { buffer: await invoicePdf(d), invoiceNo: d.inv.invoiceNo };
}

export async function emailInvoice(id) {
  const d = await load(id);
  const { inv, paid, st } = d;
  if (!inv.customer?.email) throw httpErr(400, 'this customer has no email address');
  const balance = inv.total - paid, done = balance <= 0, hasLogo = fs.existsSync(logoPath);
  const body = done
    ? `<p><b>Your payment is complete. Thank you!</b><br>Your paid invoice <b>${esc(inv.invoiceNo)}</b> for order ${esc(inv.order.orderNo)} is attached as a PDF.</p>`
    : `<p>Your rental for order <b>${esc(inv.order.orderNo)}</b> has started. Your invoice <b>${esc(inv.invoiceNo)}</b> is attached as a PDF.</p>
       <p>Total ${lkr(inv.total)} · Paid ${lkr(paid)} · <b>Balance due ${lkr(balance)}</b></p>
       <p>Once the full payment is received, we will email you a paid invoice.</p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1c2824">
    ${hasLogo ? '<img src="cid:logo" width="100" alt="" style="display:block;margin-bottom:8px">' : ''}
    <h2 style="margin:0">${esc(st.businessName)}</h2><p>Hello ${esc(inv.customer.name)},</p>${body}
    <p style="color:#666">${esc(st.businessName)} · ${esc(st.phone)}</p></div>`;
  await sendMail({ to: inv.customer.email,
    subject: done ? `${st.businessName}: payment completed, invoice ${inv.invoiceNo}` : `${st.businessName}: invoice ${inv.invoiceNo}`, html,
    attachments: [{ filename: inv.invoiceNo + '.pdf', content: await invoicePdf(d), contentType: 'application/pdf' },
      ...(hasLogo ? [{ filename: 'logo.png', path: logoPath, cid: 'logo' }] : [])] });
}

export const paidTotal = async orderId => sumPaid(await Payment.find({ order: orderId }).lean());

// When an issued invoice has been paid in full: mark it paid, then send it the way the order was set up
// (email now, WhatsApp via the returned invoice id, both, or none).
export async function settleInvoice(orderId) {
  const inv = await Invoice.findOne({ order: orderId, status: 'issued' });
  if (!inv || (await paidTotal(orderId)) < inv.total) return {};
  inv.status = 'paid'; await inv.save();
  const via = (await Order.findById(orderId).select('sendVia').lean())?.sendVia || 'email';
  const out = {};
  if (via === 'email' || via === 'both') {
    try { await emailInvoice(inv._id); out.emailNote = `Payment complete. The paid invoice ${inv.invoiceNo} (PDF) was emailed to the customer.`; }
    catch (e) { out.emailNote = `Payment complete, but the paid invoice was not emailed: ${e.message}.`; }
  }
  if (via === 'whatsapp' || via === 'both') { out.whatsappInvoice = inv._id; out.emailNote ||= `Payment complete. Paid invoice ${inv.invoiceNo} is ready to send on WhatsApp.`; }
  if (via === 'none') out.emailNote = `Payment complete. Invoice ${inv.invoiceNo} is now marked paid.`;
  return out;
}
