import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
const list = items => items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ');

export default function Rentals() {
  const [ready, setReady] = useState([]);
  const [out, setOut] = useState([]);
  const [err, setErr] = useState('');
  const load = () => {
    api('/orders').then(o => setReady(o.filter(x => x.status === 'reserved'))).catch(e => setErr(e.message));
    api('/rentals?status=out').then(setOut).catch(e => setErr(e.message));
  };
  useEffect(load, []);
  async function start(o) {
    if (!confirm(`Hand over ${o.orderNo} to ${o.customer?.name} now?`)) return;
    try { await api('/rentals/start', { method: 'POST', body: { order: o._id } }); load(); } catch (e) { setErr(e.message); }
  }
  return (
    <>
      {err && <p className="bad">{err}</p>}
      <h3>Ready for pickup</h3>
      {ready.length === 0 ? <div className="empty"><p>No reserved orders waiting.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Items</th><th>Total</th><th></th></tr></thead>
          <tbody>{ready.map(o => (
            <tr key={o._id}><td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}</td><td data-l="Pickup">{fmt(o.startDate)}</td>
              <td data-l="Items">{list(o.items)}</td><td data-l="Total">{lkr(o.totalAmount)}</td>
              <td className="acts"><button className="btn" onClick={() => start(o)}>Start rental</button></td></tr>))}</tbody></table></div>)}
      <h3>Out now</h3>
      {out.length === 0 ? <div className="empty"><p>Nothing is out right now.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th><th>Due back</th><th>Status</th></tr></thead>
          <tbody>{out.map(x => (
            <tr key={x._id}><td data-l="Order"><b>{x.order.orderNo}</b></td><td data-l="Customer">{x.customer?.name}</td><td data-l="Phone">{x.customer?.phone}</td>
              <td data-l="Items">{list(x.items)}</td><td data-l="Due back">{fmt(x.dueDate)}</td>
              <td data-l="Status"><span className={'tag ' + (x.overdue ? 'needs_repair' : '')}>{x.overdue ? 'overdue' : 'out'}</span></td></tr>))}</tbody></table></div>)}
    </>
  );
}
