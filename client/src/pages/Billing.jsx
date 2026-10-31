import { useEffect, useState } from 'react';
import { api, getToken, lkr } from '../api.js';
import { sendInvoiceWhatsApp } from '../whatsapp.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });

export default function Billing() {
  const [rows, setRows] = useState([]);
  const [invs, setInvs] = useState([]);
  const [view, setView] = useState(null);
  const [err, setErr] = useState('');
  const [st, setSt] = useState({ businessName: 'Camping Lodge', phone: '071 552 4499' });
  const load = () => {
    api('/settings').then(setSt).catch(() => {});
    api('/payments/balances').then(setRows).catch(e => setErr(e.message));
    api('/invoices').then(setInvs).catch(e => setErr(e.message));
  };
  useEffect(load, []);
  const invOf = o => invs.find(i => String(i.order?._id) === String(o._id) && i.status !== 'void');

  async function create(o) {
    setErr('');
    try { await api('/invoices', { method: 'POST', body: { order: o._id } }); load(); } catch (e) { setErr(e.message); }
  }
  async function show(i) { setView(await api('/invoices/' + i._id)); }
  async function pdfIt(i) {
    const res = await fetch(`/api/invoices/${i._id}/pdf`, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!res.ok) return alert('Could not make the PDF');
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  }
  async function emailIt(i) {
    try { await api(`/invoices/${i._id}/email`, { method: 'POST' }); alert('Invoice emailed to ' + i.customer?.email); } catch (e) { alert('Not emailed: ' + e.message); }
  }
  async function voidIt(i) {
    if (!confirm(`Void ${i.invoiceNo}? You can create a new invoice afterwards.`)) return;
    await api(`/invoices/${i._id}/void`, { method: 'PATCH' }); setView(null); load();
  }
  return (
    <>
      {err && <p className="bad">{err}</p>}
      <p>Create an invoice after the return is recorded, so late and damage fees are included.</p>
      {rows.length === 0 ? <div className="empty"><p>No orders yet.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Order status</th><th>Total</th><th>Invoice</th><th></th></tr></thead>
          <tbody>{rows.map(o => { const i = invOf(o); return (
            <tr key={o._id}><td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}</td><td data-l="Order status">{o.status}</td>
              <td data-l="Total">{lkr(o.totalAmount)}</td>
              <td data-l="Invoice">{i ? <><b>{i.invoiceNo}</b> <span className={'tag ' + (i.status === 'paid' ? '' : 'fair')}>{i.status}</span></> : '-'}</td>
              <td className="acts">{i ? <button onClick={() => show(i)}>View / print</button> : <button className="btn" onClick={() => create(o)}>Create invoice</button>}</td></tr>); })}</tbody></table></div>)}
      {view && (
        <div className="modal" onClick={() => setView(null)}>
          <div className="invoice" onClick={e => e.stopPropagation()}>
            <div className="inv-head"><div className="inv-brand"><img src="/logo.png" alt="" className="inv-logo" /><div><h2>{st.businessName}</h2><p>{st.phone}</p>{st.address && <p>{st.address}</p>}</div></div>
              <div className="inv-r"><h2>{view.invoiceNo}</h2><p>{fmt(view.issuedAt)}</p><span className={'tag ' + (view.status === 'paid' ? '' : 'fair')}>{view.status}</span></div></div>
            <p><b>Bill to:</b> {view.customer?.name} · {view.customer?.phone}<br /><b>Order:</b> {view.order?.orderNo} · {fmt(view.order?.startDate)} → {fmt(view.order?.endDate)}</p>
            <table><thead><tr><th>Item</th><th>Qty</th><th>Rate / 36h</th><th>Periods</th><th>Amount</th></tr></thead>
              <tbody>{view.items.map(i => <tr key={i._id}><td>{i.equipment?.name}</td><td>{i.quantity}</td><td>{lkr(i.periodRate)}</td><td>{i.periods}</td><td>{lkr(i.lineTotal)}</td></tr>)}</tbody></table>
            <div className="inv-tot">
              <p>Subtotal <b>{lkr(view.subtotal)}</b></p>
              {view.fees > 0 && <p>Late / damage fees <b>{lkr(view.fees)}</b></p>}
              <p>Total <b>{lkr(view.total)}</b></p><p>Paid <b>{lkr(view.paid)}</b></p>
              <p className="inv-bal">Balance due <b>{lkr(view.balance)}</b></p>
            </div>
            <div className="row end noprint">
              {view.status !== 'paid' && <button onClick={() => voidIt(view)}>Void</button>}
              <button onClick={() => pdfIt(view)}>Open PDF</button><button onClick={() => sendInvoiceWhatsApp(view._id)}>WhatsApp</button><button onClick={() => emailIt(view)}>Email PDF</button><button onClick={() => setView(null)}>Close</button><button className="btn" onClick={() => window.print()}>Print</button>
            </div>
          </div>
        </div>)}
    </>
  );
}
