import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });

export default function Returns() {
  const [out, setOut] = useState([]);
  const [done, setDone] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const load = () => {
    api('/rentals?status=out').then(setOut).catch(e => setErr(e.message));
    api('/returns').then(setDone).catch(e => setErr(e.message));
  };
  useEffect(load, []);
  const open = x => { setErr(''); setForm({ rental: x, damageFee: 0, notes: '',
    items: x.items.map(i => ({ equipment: i.equipment._id, name: i.equipment.name, qty: i.quantity, quantityReturned: i.quantity, quantityDamaged: 0, quantityLost: 0 })) }); };
  const setItem = (n, k, v) => setForm({ ...form, items: form.items.map((it, j) => j === n ? { ...it, [k]: v } : it) });

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      const r = await api('/returns', { method: 'POST', body: { rental: form.rental._id, items: form.items, damageFee: +form.damageFee, notes: form.notes } });
      setForm(null); load();
      if (r.lateFee > 0) alert('Late fee added: ' + lkr(r.lateFee));
    } catch (x) { setErr(x.message); }
  }
  return (
    <>
      {err && !form && <p className="bad">{err}</p>}
      <h3>Waiting to be returned</h3>
      {out.length === 0 ? <div className="empty"><p>No rentals are out.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Due back</th><th>Status</th><th></th></tr></thead>
          <tbody>{out.map(x => (
            <tr key={x._id}><td data-l="Order"><b>{x.order.orderNo}</b></td><td data-l="Customer">{x.customer?.name}</td><td data-l="Due back">{fmt(x.dueDate)}</td>
              <td data-l="Status"><span className={'tag ' + (x.overdue ? 'needs_repair' : '')}>{x.overdue ? 'overdue' : 'out'}</span></td>
              <td className="acts"><button className="btn" onClick={() => open(x)}>Receive return</button></td></tr>))}</tbody></table></div>)}
      <h3>Past returns</h3>
      {done.length === 0 ? <div className="empty"><p>No returns recorded yet.</p></div> : (
        <div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Returned</th><th>Late fee</th><th>Damage fee</th></tr></thead>
          <tbody>{done.map(d => (
            <tr key={d._id}><td data-l="Order"><b>{d.rental?.order?.orderNo}</b></td><td data-l="Customer">{d.rental?.customer?.name}</td>
              <td data-l="Returned">{fmt(d.returnedAt)}</td><td data-l="Late fee">{lkr(d.lateFee)}</td><td data-l="Damage fee">{lkr(d.damageFee)}</td></tr>))}</tbody></table></div>)}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>Return {form.rental.order.orderNo}</h2>
            <p>Returned + damaged + lost must equal the rented quantity. Late fees are added automatically.</p>
            {form.items.map((it, n) => (
              <div key={it.equipment}><b>{it.name}</b> (rented {it.qty})
                <div className="row3">
                  <label>Returned<input type="number" min="0" value={it.quantityReturned} onChange={e => setItem(n, 'quantityReturned', e.target.value)} /></label>
                  <label>Damaged<input type="number" min="0" value={it.quantityDamaged} onChange={e => setItem(n, 'quantityDamaged', e.target.value)} /></label>
                  <label>Lost<input type="number" min="0" value={it.quantityLost} onChange={e => setItem(n, 'quantityLost', e.target.value)} /></label>
                </div></div>))}
            <label>Damage / loss fee (LKR)<input type="number" min="0" value={form.damageFee} onChange={e => setForm({ ...form, damageFee: e.target.value })} /></label>
            <label>Notes<textarea rows="2" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Confirm return</button></div>
          </form>
        </div>)}
    </>
  );
}
