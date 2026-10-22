import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Availability() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr(''); setData(null);
    if (!start || !end) return;
    const p = new URLSearchParams({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    api('/availability?' + p).then(setData).catch(e => setErr(e.message));
  }, [start, end]);
  return (
    <>
      <div className="bar">
        <label>From<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>To<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      {err && <p className="bad">{err}</p>}
      {!data && !err && <div className="empty"><h2>Pick a start and end time</h2><p>You'll see how many units of each item are free for those times.</p></div>}
      {data && <p>{data.periods} rental period{data.periods > 1 ? 's' : ''} (36 hours each)</p>}
      {data && (data.items.length === 0 ? <div className="empty"><h2>No equipment yet</h2><p>Add items in Inventory first.</p></div> :
        <div className="tablewrap"><table>
          <thead><tr><th>Item</th><th>Category</th><th>Total</th><th>Booked</th><th>Available</th></tr></thead>
          <tbody>{data.items.map(i => (
            <tr key={i._id}><td data-l="Item"><b>{i.name}</b></td><td data-l="Category">{i.category}</td>
              <td data-l="Total">{i.totalQuantity}</td><td data-l="Booked">{i.booked}</td>
              <td data-l="Available"><b className={i.available > 0 ? 'ok' : 'bad'}>{i.available}</b></td></tr>))}</tbody>
        </table></div>)}
    </>
  );
}
