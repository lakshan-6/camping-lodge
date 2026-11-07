import {businessISO,businessInput} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

const local = businessInput;
const periodsOf = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (36 * 3600 * 1000)));

// Change the items (and times) of an order before the customer picks it up
export default function EditOrder({ order, onClose, onSaved }) {
  const [start, setStart] = useState(local(order.startDate));
  const [end, setEnd] = useState(local(order.endDate));
  const [lines, setLines] = useState(order.items.map(i => ({ equipment: i.equipment._id, quantity: i.quantity })));
  const [avail, setAvail] = useState([]);
  const [err, setErr] = useState('');
  const ok = start && end && new Date(start) < new Date(end);
  useEffect(() => {
    if (!ok) return;
    const p = new URLSearchParams({ start: businessISO(start), end: businessISO(end), exclude: order._id });
    api('/availability?' + p).then(d => setAvail(d.items)).catch(e => setErr(e.message));
  }, [start, end]);
  const periods = ok ? periodsOf(start, end) : 0;
  const total = lines.reduce((s, l) => { const a = avail.find(x => x._id === l.equipment); return s + (a ? a.periodRate * l.quantity * periods : 0); }, 0);
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await api('/orders/' + order._id, { method: 'PUT', body: { startDate: businessISO(start), endDate: businessISO(end),
        items: lines.filter(l => l.equipment).map(l => ({ ...l, quantity: +l.quantity })) } });
      onSaved();
    } catch (x) { setErr(x.message); }
  }
  return (
    <div className="modal" onClick={onClose}>
      <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>Change {order.orderNo}</h2>
        <p className="hint">{order.customer?.name}. Change the items or times before the customer picks up.</p>
        <div className="row">
          <label>Pickup (Sri Lanka time)<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>Return (Sri Lanka time)<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        {ok && <p>{periods} rental period{periods > 1 ? 's' : ''} (36 hours each)</p>}
        <div className="lines">
          {lines.map((l, i) => (
            <div className="line" key={i}>
              <select value={l.equipment} onChange={e => setLine(i, 'equipment', e.target.value)}>
                <option value="">Choose item</option>
                {avail.map(a => <option key={a._id} value={a._id} disabled={a.available < 1 && a._id !== l.equipment}>{a.name} ({a.available} free) · {lkr(a.periodRate)}</option>)}</select>
              <input type="number" min="1" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
            </div>))}
          <button type="button" onClick={() => setLines([...lines, { equipment: '', quantity: 1 }])}>Add item</button>
          <p><b>New total: {lkr(total)}</b> <small>(was {lkr(order.totalAmount)})</small></p>
        </div>
        {err && <p className="bad">{err}</p>}
        <div className="row end"><button type="button" onClick={onClose}>Cancel</button><button className="btn">Save changes</button></div>
      </form>
    </div>
  );
}
