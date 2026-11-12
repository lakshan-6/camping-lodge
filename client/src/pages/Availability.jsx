import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {businessISO} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import { can } from '../permissions.js';
import NewOrderDialog from '../components/NewOrderDialog.jsx';

export default function Availability({me}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [equipment,setEquipment]=useState(''),[quantity,setQuantity]=useState(1),[draft,setDraft]=useState(null);
  const [notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(() => {
    setErr(''); setData(null);
    if (!start || !end) return;
    if(start>=end){setErr('Return must be after pickup.');return;}
    let active=true;
    const p = new URLSearchParams({ start: businessISO(start), end: businessISO(end) });
    api('/availability?' + p).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setErr(e.message);});
    return ()=>{active=false;};
  }, [start, end, refresh]);
  const selected=data?.items.find(item=>item._id===equipment);
  const quotable=selected&&Number.isInteger(Number(quantity))&&Number(quantity)>=1&&Number(quantity)<=selected.available;
  return (
    <>
      <div className="bar">
        <label>From (Sri Lanka time)<input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label>To (Sri Lanka time)<input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      {err && <p className="bad">{err}</p>}
      {notice&&<p className="notice" role="status">{notice}</p>}
      {!data && !err && <div className="empty"><h2>Pick a start and end time</h2><p>You'll see how many units of each item are free for those times.</p></div>}
      {data && <p>{data.periods} rental period{data.periods > 1 ? 's' : ''} (36 hours each)</p>}
      {data && (data.items.length === 0 ? <div className="empty"><h2>No equipment yet</h2><p>Add items in Inventory first.</p></div> :
        <div className="tablewrap"><ResponsiveTable>
          <thead><tr><th>Item</th><th>Category</th><th>Rate / 36h</th><th>Available</th></tr></thead>
          <tbody>{data.items.map(i => (
            <tr key={i._id}><td data-l="Item"><b>{i.name}</b></td><td data-l="Category">{i.category}</td>
              <td>{lkr(i.periodRate)}</td>
              <td data-l="Available"><b className={i.available > 0 ? 'ok' : 'bad'}>{i.available}</b></td></tr>))}</tbody>
        </ResponsiveTable></div>)}
      {data?.items.some(item=>item.available>0)&&<section className="card quote-card">
        <h3>Rental quote</h3>
        <div className="row">
          <label>Equipment<select value={equipment} onChange={e=>{setEquipment(e.target.value);setQuantity(1);}}>
            <option value="">Choose equipment</option>
            {data.items.filter(item=>item.available>0).map(item=><option key={item._id} value={item._id}>{item.name}</option>)}
          </select></label>
          <label>Quantity<input type="number" min="1" step="1" max={selected?.available} disabled={!selected} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
        </div>
        {quotable&&<div className="bar"><b>Rental total · {lkr(selected.periodRate*Number(quantity)*data.periods)}</b>
          {can(me,'orders.write')&&can(me,'payments.record')&&<button className="btn" onClick={()=>setDraft({start,end,item:{equipment,quantity:Number(quantity)}})}>Continue to booking</button>}
        </div>}
      </section>}
      {draft&&<NewOrderDialog me={me} draft={draft} onClose={()=>setDraft(null)} onSaved={order=>{setDraft(null);setNotice(`${order.orderNo} saved.`);setRefresh(n=>n+1);}}/>}
    </>
  );
}
