import ResponsiveTable from './ResponsiveTable.jsx';
import {businessDate} from '../businessTime.js';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from './OrderWorkspace.jsx';
export default function CustomerHistory({customer,me,onClose}){
 const [data,setData]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState('');
 useEffect(()=>{api(`/customers/${customer._id}/history`).then(setData).catch(e=>setError(e.message));},[customer._id]);
 return <div className="modal" onClick={onClose}><div className="workspace" onClick={e=>e.stopPropagation()}><div className="bar"><h2>{customer.name}</h2><button onClick={onClose}>Close</button></div>{error&&<p className="bad">{error}</p>}{data&&<><p>{data.customer.phone} · NIC: {data.customer.nic||'Not recorded'}</p><p>{data.orders.length} bookings · Outstanding rental balance <b>{lkr(data.outstanding)}</b></p><ResponsiveTable><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Items</th><th>Balance</th><th></th></tr></thead><tbody>{data.orders.map(o=><tr key={o._id}><td>{o.orderNo}</td><td>{new Date(o.startDate).toLocaleDateString('en-LK',{timeZone:'Asia/Colombo'})}</td><td>{o.status}</td><td>{o.items.map(i=>`${i.quantity}× ${i.equipment?.name}`).join(', ')}</td><td>{lkr(o.balance)}</td><td><button onClick={()=>setSelected(o._id)}>Open order</button></td></tr>)}</tbody></ResponsiveTable><h3>Return and fee history</h3>{data.returns.length?data.returns.map(r=><p key={r._id}>{new Date(r.returnedAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})} · {r.partial?'Partial':'Complete'} · Late: {lkr(r.lateFee)} · Damage/loss: {lkr(r.damageFee)}</p>):<p>No returns recorded.</p>}</>}{selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)}/>}</div></div>;
}
