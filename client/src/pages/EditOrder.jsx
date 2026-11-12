import {businessISO,businessInput} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

export default function EditOrder({ order, onClose, onSaved }) {
  const dateOnly = !!order.pickupDate;
  const [start, setStart] = useState(() => order.pickupDate || businessInput(order.startDate));
  const [end, setEnd] = useState(() => dateOnly ? order.plannedReturnDate || '' : businessInput(order.endDate));
  const [lines, setLines] = useState(order.items.map(i => ({ equipment: i.equipment._id, quantity: i.quantity })));
  const [availability, setAvailability] = useState(null);
  const [err, setErr] = useState('');
  const returnDateValid = end ? end >= start : !order.plannedReturnDate;
  const ok = start && (dateOnly ? returnDateValid : end && start < end);
  const timing = ok ? (dateOnly ? { pickupDate: start, plannedReturnDate: end || undefined } : { startDate: businessISO(start), endDate: businessISO(end) }) : null;
  const query = timing ? new URLSearchParams(dateOnly ? { pickupDate: timing.pickupDate, exclude: order._id }
    : { start: timing.startDate, end: timing.endDate, exclude: order._id }).toString() : '';
  useEffect(() => {
    if (!query) return;
    let active = true;
    api('/availability?' + query).then(d => { if (active) setAvailability({ query, ...d }); }).catch(e => { if (active) setErr(e.message); });
    return () => { active = false; };
  }, [query]);
  const preview = availability?.query === query ? availability : null;
  const avail = preview?.items || [];
  const periods = preview?.periods || 0;
  const rateFor=a=>order.items.find(item=>item.equipment._id===a._id)?.periodRate??a.periodRate;
  const total = Math.round(lines.reduce((s, l) => { const a = avail.find(x => x._id === l.equipment); return s + (a ? rateFor(a) * l.quantity * periods : 0); }, 0)*100)/100;
  const [approvedTotal,setApprovedTotal]=useState(null);
  const priceChanged=total!==order.totalAmount;
  const setLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save(e) {
    e.preventDefault(); if (!preview||(priceChanged&&approvedTotal!==total)) return; setErr('');
    try {
      await api('/orders/' + order._id, { method: 'PUT', body: { ...timing, confirmedTotal:total,
        items: lines.filter(l => l.equipment).map(l => ({ ...l, quantity: +l.quantity })) } });
      onSaved();
    } catch (x) { setErr(x.message); }
  }
  return (
    <div className="modal" onClick={onClose}>
      <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>Change {order.orderNo}</h2>
        <p className="hint">{order.customer?.name}</p>
        {dateOnly ? <div className="row">
          <label>Pickup date<input required type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>Planned return date<input required={!!order.plannedReturnDate} type="date" min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div> : <div className="row">
          <label>Pickup (Sri Lanka time)<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>Return (Sri Lanka time)<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>}
        {dateOnly ? <p>Equipment is due back 36 hours after pickup is confirmed.</p> : periods > 0 && <p>{periods} rental period{periods > 1 ? 's' : ''} (36 hours each)</p>}
        <div className="lines">
          {lines.map((l, i) => (
            <div className="line" key={i}>
              <select value={l.equipment} onChange={e => setLine(i, 'equipment', e.target.value)}>
                <option value="">Choose item</option>
                {avail.map(a => <option key={a._id} value={a._id} disabled={a.available < 1 && a._id !== l.equipment}>{a.name} ({a.available} free) · {lkr(rateFor(a))}</option>)}</select>
              <input type="number" min="1" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
            </div>))}
          <button type="button" onClick={() => setLines([...lines, { equipment: '', quantity: 1 }])}>Add item</button>
          {preview&&<p><b>Booking total {lkr(total)}</b>{priceChanged&&<small> · Previously {lkr(order.totalAmount)}</small>}</p>}
          {preview&&priceChanged&&<label className="check"><input type="checkbox" required checked={approvedTotal===total} onChange={e=>setApprovedTotal(e.target.checked?total:null)}/>Confirm the updated booking total</label>}
        </div>
        {err && <p className="bad">{err}</p>}
        <div className="row end"><button type="button" onClick={onClose}>Cancel</button><button className="btn" disabled={!preview}>Save changes</button></div>
      </form>
    </div>
  );
}
