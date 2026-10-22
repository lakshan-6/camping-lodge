import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
const periodsOf = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (36 * 3600 * 1000)));
const blank = { customer: '', start: '', end: '', lines: [{ equipment: '', quantity: 1 }] };

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [avail, setAvail] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/orders').then(setOrders).catch(e => setErr(e.message));
  useEffect(() => { load(); api('/customers').then(setCustomers); }, []);

  const ready = form && form.start && form.end && new Date(form.start) < new Date(form.end);
  useEffect(() => {
    if (!ready) return setAvail([]);
    const p = new URLSearchParams({ start: new Date(form.start).toISOString(), end: new Date(form.end).toISOString() });
    api('/availability?' + p).then(d => setAvail(d.items)).catch(e => setErr(e.message));
  }, [form?.start, form?.end]);

  const periods = ready ? periodsOf(form.start, form.end) : 0;
  const total = !ready ? 0 : form.lines.reduce((s, l) => {
    const a = avail.find(x => x._id === l.equipment); return s + (a ? a.periodRate * l.quantity * periods : 0);
  }, 0);
  const setLine = (i, k, v) => setForm({ ...form, lines: form.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await api('/orders', { method: 'POST', body: { customer: form.customer, startDate: new Date(form.start).toISOString(),
        endDate: new Date(form.end).toISOString(), items: form.lines.filter(l => l.equipment) } });
      setForm(null); load();
    } catch (x) { setErr(x.message); }
  }
  async function cancel(o) {
    if (!confirm(`Cancel order ${o.orderNo}?`)) return;
    try { await api(`/orders/${o._id}/cancel`, { method: 'PATCH' }); load(); } catch (x) { setErr(x.message); }
  }

  return (
    <>
      <div className="bar"><button className="btn" onClick={() => { setErr(''); setForm(blank); }}>New order</button></div>
      {err && !form && <p className="bad">{err}</p>}
      {orders.length === 0 ? <div className="empty"><h2>No orders yet</h2><p>Create an order after adding a customer and some equipment.</p></div> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Return</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>{orders.map(o => (
            <tr key={o._id}>
              <td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}</td>
              <td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Return">{fmt(o.endDate)}</td>
              <td data-l="Items">{o.items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ')}</td>
              <td data-l="Total">{lkr(o.totalAmount)}<small>{o.periods}× 36h</small></td>
              <td data-l="Status"><span className={'tag ' + (o.status === 'cancelled' ? 'needs_repair' : '')}>{o.status}</span></td>
              <td className="acts">{o.status === 'reserved' && <button onClick={() => cancel(o)}>Cancel</button>}</td>
            </tr>))}</tbody>
        </table></div>)}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>New order</h2>
            <label>Customer<select required value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })}>
              <option value="">Choose customer</option>{customers.map(c => <option key={c._id} value={c._id}>{c.name} · {c.phone}</option>)}</select></label>
            <div className="row">
              <label>Pickup<input required type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></label>
              <label>Return<input required type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></label>
            </div>
            {ready ? <p>{periods} rental period{periods > 1 ? 's' : ''} (36 hours each)</p> : <p>Choose pickup and return times to see available items.</p>}
            {ready && <div className="lines">
              {form.lines.map((l, i) => (
                <div className="line" key={i}>
                  <select value={l.equipment} onChange={e => setLine(i, 'equipment', e.target.value)}>
                    <option value="">Choose item</option>
                    {avail.map(a => <option key={a._id} value={a._id} disabled={a.available < 1}>{a.name} ({a.available} free) · {lkr(a.periodRate)}</option>)}</select>
                  <input type="number" min="1" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} />
                  <button type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>Remove</button>
                </div>))}
              <button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, { equipment: '', quantity: 1 }] })}>Add item</button>
              <p><b>Total: {lkr(total)}</b></p>
            </div>}
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn" disabled={!ready}>Create order</button></div>
          </form>
        </div>)}
    </>
  );
}
