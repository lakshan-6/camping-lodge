import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import WhatsAppPrompt from './WhatsAppPrompt.jsx';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });

export default function Payments() {
  const [rows, setRows] = useState([]);
  const [hist, setHist] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [wa, setWa] = useState(null);
  const load = () => {
    api('/payments/balances').then(setRows).catch(e => setErr(e.message));
    api('/payments').then(setHist).catch(e => setErr(e.message));
  };
  useEffect(load, []);
  const open = o => { setErr(''); setForm({ order: o, amount: Math.max(0, o.balance), method: 'cash', type: o.paid === 0 ? 'deposit' : 'balance', reference: '' }); };
  const set = k => e => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErr('');
    try { const p = await api('/payments', { method: 'POST', body: { ...form, order: form.order._id, amount: +form.amount } }); setForm(null); load(); if (p.emailNote) alert(p.emailNote); if (p.whatsappInvoice) setWa(p.whatsappInvoice); }
    catch (x) { setErr(x.message); }
  }
  return (
    <>
      {err && !form && <p className="bad">{err}</p>}
      <h3>Order balances</h3>
      {rows.length === 0 ? <div className="empty"><p>No orders yet.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead>
          <tbody>{rows.map(o => (
            <tr key={o._id}><td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}</td>
              <td data-l="Total">{lkr(o.totalAmount)}</td><td data-l="Paid">{lkr(o.paid)}</td>
              <td data-l="Balance"><b className={o.balance > 0 ? 'bad' : 'ok'}>{lkr(o.balance)}</b></td>
              <td className="acts"><button className="btn" onClick={() => open(o)}>Record payment</button></td></tr>))}</tbody></table></div>)}
      <h3>Payment history</h3>
      {hist.length === 0 ? <div className="empty"><p>No payments recorded yet.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th>Method</th><th>Amount</th></tr></thead>
          <tbody>{hist.map(p => (
            <tr key={p._id}><td data-l="Date">{fmt(p.paidAt)}</td><td data-l="Order"><b>{p.order?.orderNo}</b></td><td data-l="Customer">{p.order?.customer?.name}</td>
              <td data-l="Type">{p.type}</td><td data-l="Method">{p.method.replace('_', ' ')}</td>
              <td data-l="Amount">{p.type === 'refund' ? '−' : ''}{lkr(p.amount)}</td></tr>))}</tbody></table></div>)}
      {wa && <WhatsAppPrompt invoiceId={wa} onClose={() => setWa(null)} />}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>Payment for {form.order.orderNo}</h2>
            <p>Total {lkr(form.order.totalAmount)} · Paid {lkr(form.order.paid)} · Balance {lkr(form.order.balance)}</p>
            <label>Amount (LKR)<input required type="number" min="1" value={form.amount} onChange={set('amount')} /></label>
            <div className="row">
              <label>Type<select value={form.type} onChange={set('type')}>
                {['deposit', 'rental', 'balance', 'fee', 'refund'].map(t => <option key={t}>{t}</option>)}</select></label>
              <label>Method<select value={form.method} onChange={set('method')}>
                {['cash', 'bank_transfer', 'card', 'other'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></label>
            </div>
            <label>Reference (optional)<input value={form.reference} onChange={set('reference')} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Save payment</button></div>
          </form>
        </div>)}
    </>
  );
}
