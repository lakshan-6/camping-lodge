import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import CustomerDetails from './CustomerDetails.jsx';
import EditOrder from './EditOrder.jsx';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });
const periodsOf = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (36 * 3600 * 1000)));
const blank = { customer: '', cq: '', newCust: false, pre: false, advance: '', advMethod: 'bank_transfer', nc: { name: '', phone: '', nic: '', email: '' }, start: '', end: '', lines: [{ equipment: '', quantity: 1 }] };

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [avail, setAvail] = useState([]);
  const [form, setForm] = useState(null);
  const [details, setDetails] = useState(null);
  const [editing, setEditing] = useState(null);
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
  const cq = (form?.cq || '').toLowerCase();
  const matches = customers.filter(c => !cq || [c.name, c.phone, c.nic].some(v => (v || '').toLowerCase().includes(cq)));
  const mode = !form ? 'existing' : form.newCust ? (form.pre ? 'pre' : 'new') : 'existing';
  const setNc = (k, v) => setForm({ ...form, nc: { ...form.nc, [k]: v } });
  const setLine = (i, k, v) => setForm({ ...form, lines: form.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      let customer = form.customer;
      if (form.newCust) { const c = await api('/customers', { method: 'POST', body: { ...form.nc, preBooking: form.pre } }); customer = c._id; setCustomers([...customers, c]); }
      await api('/orders', { method: 'POST', body: { customer, startDate: new Date(form.start).toISOString(),
        endDate: new Date(form.end).toISOString(), items: form.lines.filter(l => l.equipment), advance: { amount: +form.advance || 0, method: form.advMethod } } });
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
              <td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}{o.customer?.detailsPending && <><br /><span className="tag fair">Details pending</span></>}</td>
              <td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Return">{fmt(o.endDate)}</td>
              <td data-l="Items">{o.items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ')}</td>
              <td data-l="Total">{lkr(o.totalAmount)}<small>{o.periods}× 36h</small></td>
              <td data-l="Status"><span className={'tag ' + (o.status === 'cancelled' ? 'needs_repair' : '')}>{o.status}</span></td>
              <td className="acts">{o.customer?.detailsPending && <button onClick={() => setDetails(o.customer)}>Add details</button>}{o.status === 'reserved' && <><button onClick={() => setEditing(o)}>Change items</button><button onClick={() => cancel(o)}>Cancel</button></>}</td>
            </tr>))}</tbody>
        </table></div>)}
      {editing && <EditOrder order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {details && <CustomerDetails customer={details} onClose={() => setDetails(null)} onSaved={() => { setDetails(null); load(); api('/customers').then(setCustomers); }} />}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>New order</h2>
            <div className="custbox">
              <div className="row3">
                {[['existing', 'Existing'], ['new', 'New customer'], ['pre', 'WhatsApp pre-booking']].map(([m, l]) => (
                  <button type="button" key={m} className={mode === m ? 'btn' : ''} onClick={() => setForm({ ...form, newCust: m !== 'existing', pre: m === 'pre' })}>{l}</button>))}
              </div>
              {mode === 'existing' ? <>
                <label>Search (name, phone or NIC)<input value={form.cq} onChange={e => setForm({ ...form, cq: e.target.value })} /></label>
                <select required value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })}>
                  <option value="">Choose customer ({matches.length})</option>
                  {matches.map(c => <option key={c._id} value={c._id}>{c.name} · {c.phone}{c.nic ? ' · ' + c.nic : ''}</option>)}</select></> : <>
                {mode === 'pre' && <p className="hint">For bookings made on WhatsApp. Only the WhatsApp number is needed now. Add the full details when the customer comes to the shop.</p>}
                <label>{mode === 'pre' ? 'WhatsApp number' : 'Phone'}<input required value={form.nc.phone} onChange={e => setNc('phone', e.target.value)} /></label>
                <label>Name{mode === 'pre' ? ' (optional)' : ''}<input required={mode !== 'pre'} value={form.nc.name} onChange={e => setNc('name', e.target.value)} /></label>
                <div className="row">
                  {mode !== 'pre' && <label>NIC<input value={form.nc.nic} onChange={e => setNc('nic', e.target.value)} /></label>}
                  <label>Email (invoice is sent here)<input type="email" value={form.nc.email} onChange={e => setNc('email', e.target.value)} /></label>
                </div></>}
            </div>
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
              <div className="row">
                <label>Advance paid (LKR, optional)<input type="number" min="0" value={form.advance} onChange={e => setForm({ ...form, advance: e.target.value })} /></label>
                <label>Paid by<select value={form.advMethod} onChange={e => setForm({ ...form, advMethod: e.target.value })}>
                  <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
              </div>
            </div>}
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn" disabled={!ready}>Create order</button></div>
          </form>
        </div>)}
    </>
  );
}
