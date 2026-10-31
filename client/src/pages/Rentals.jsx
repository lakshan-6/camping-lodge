import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import CustomerDetails from './CustomerDetails.jsx';
import EditOrder from './EditOrder.jsx';
import WhatsAppPrompt from './WhatsAppPrompt.jsx';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
const list = items => items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ');

export default function Rentals() {
  const [ready, setReady] = useState([]);
  const [out, setOut] = useState([]);
  const [err, setErr] = useState('');
  const [details, setDetails] = useState(null);
  const [editing, setEditing] = useState(null);
  const [hand, setHand] = useState(null);
  const [wa, setWa] = useState(null);
  const load = () => {
    Promise.all([api('/orders'), api('/payments/balances')]).then(([o, b]) => {
      const m = Object.fromEntries(b.map(x => [x._id, x]));
      setReady(o.filter(x => x.status === 'reserved').map(x => ({ ...x, paid: m[x._id]?.paid || 0, balance: m[x._id]?.balance ?? x.totalAmount })));
    }).catch(e => setErr(e.message));
    api('/rentals?status=out').then(setOut).catch(e => setErr(e.message));
  };
  useEffect(load, []);

  async function start(e) {
    e.preventDefault();
    try {
      const r = await api('/rentals/start', { method: 'POST', body: { order: hand.order._id, payBalance: hand.pay, method: hand.method, sendVia: hand.via } });
      setHand(null); load(); if (r.emailNote) alert(r.emailNote); if (r.whatsappInvoice) setWa(r.whatsappInvoice);
    } catch (x) { setHand({ ...hand, err: x.message }); }
  }
  return (
    <>
      {err && <p className="bad">{err}</p>}
      {wa && <WhatsAppPrompt invoiceId={wa} onClose={() => setWa(null)} />}
      {details && <CustomerDetails customer={details} onClose={() => setDetails(null)} onSaved={() => { setDetails(null); load(); }} />}
      {editing && <EditOrder order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      <h3>Ready for pickup</h3>
      {ready.length === 0 ? <div className="empty"><p>No reserved orders waiting.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Items</th><th>Total</th><th>Balance</th><th></th></tr></thead>
          <tbody>{ready.map(o => (
            <tr key={o._id}><td data-l="Order"><b>{o.orderNo}</b></td>
              <td data-l="Customer">{o.customer?.name}{o.customer?.detailsPending && <><br /><span className="tag fair">Details pending</span></>}</td>
              <td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Items">{list(o.items)}</td><td data-l="Total">{lkr(o.totalAmount)}</td>
              <td data-l="Balance"><b className={o.balance > 0 ? 'bad' : 'ok'}>{lkr(o.balance)}</b></td>
              <td className="acts">
                {o.customer?.detailsPending && <button onClick={() => setDetails(o.customer)}>Add details</button>}
                <button onClick={() => setEditing(o)}>Change items</button>
                <button className="btn" onClick={() => setHand({ order: o, pay: o.balance > 0, method: 'cash', via: o.customer?.email ? 'email' : 'whatsapp' })}>Start rental</button></td></tr>))}</tbody></table></div>)}
      <h3>Out now</h3>
      {out.length === 0 ? <div className="empty"><p>Nothing is out right now.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th><th>Due back</th><th>Status</th></tr></thead>
          <tbody>{out.map(x => (
            <tr key={x._id}><td data-l="Order"><b>{x.order.orderNo}</b></td><td data-l="Customer">{x.customer?.name}</td><td data-l="Phone">{x.customer?.phone}</td>
              <td data-l="Items">{list(x.items)}</td><td data-l="Due back">{fmt(x.dueDate)}</td>
              <td data-l="Status"><span className={'tag ' + (x.overdue ? 'needs_repair' : '')}>{x.overdue ? 'overdue' : 'out'}</span></td></tr>))}</tbody></table></div>)}
      {hand && (
        <div className="modal" onClick={() => setHand(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={start}>
            <h2>Hand over {hand.order.orderNo}</h2>
            <p>{hand.order.customer?.name}<br /><small>{list(hand.order.items)}</small></p>
            <p>Total {lkr(hand.order.totalAmount)} · Paid {lkr(hand.order.paid)} · <b>Balance {lkr(hand.order.balance)}</b></p>
            {hand.order.balance > 0 && <>
              <label className="check"><input type="checkbox" checked={hand.pay} onChange={e => setHand({ ...hand, pay: e.target.checked })} /> Customer paid the balance now ({lkr(hand.order.balance)})</label>
              {hand.pay ? <label>Paid by<select value={hand.method} onChange={e => setHand({ ...hand, method: e.target.value })}>
                <option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
                : <p className="hint">The balance stays unpaid. It can be paid later, for example when the items are returned.</p>}</>}
            <label>Send the invoice by<select value={hand.via} onChange={e => setHand({ ...hand, via: e.target.value })}>
              <option value="email">Email (PDF)</option><option value="whatsapp">WhatsApp</option><option value="both">Email and WhatsApp</option><option value="none">Do not send</option></select></label>
            {(hand.via === 'email' || hand.via === 'both') && !hand.order.customer?.email && <p className="hint">This customer has no email address yet, so the email will not be sent.</p>}
            {hand.err && <p className="bad">{hand.err}</p>}
            <div className="row end"><button type="button" onClick={() => setHand(null)}>Cancel</button><button className="btn">Start rental</button></div>
          </form>
        </div>)}
    </>
  );
}
