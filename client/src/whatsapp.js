import { api, getToken, lkr } from './api.js';

// Opens WhatsApp with the customer's number and a ready message, and saves the invoice PDF so it can be attached.
// The chat tab is opened straight away so the browser does not block it.
export async function sendInvoiceWhatsApp(id) {
  const w = window.open('', '_blank');
  try {
    const [i, st] = await Promise.all([api('/invoices/' + id), api('/settings')]);
    const d = String(i.customer?.phone || '').replace(/\D/g, '');
    const num = d.startsWith('94') ? d : d.startsWith('0') ? '94' + d.slice(1) : d;
    const done = i.balance <= 0;
    const msg = `Hello ${i.customer?.name || ''},\n${done ? 'Your payment is complete. Thank you!' : 'Your rental has started.'}\n`
      + `${st.businessName} invoice ${i.invoiceNo} (order ${i.order?.orderNo})\nTotal: ${lkr(i.total)}\nPaid: ${lkr(i.paid)}\n`
      + `${done ? '' : 'Balance due: ' + lkr(i.balance) + '\n'}Thank you for choosing ${st.businessName}.`;
    const url = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
    if (w) w.location.href = url; else window.open(url, '_blank');
    const res = await fetch(`/api/invoices/${id}/pdf`, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (res.ok) { const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = i.invoiceNo + '.pdf'; a.click(); }
  } catch (e) { if (w) w.close(); alert('Could not open WhatsApp: ' + e.message); }
}
