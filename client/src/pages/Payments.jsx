import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {SecurityStatus} from '../components/SecurityDeposit.jsx';
export default function Payments({me}){
 const [rows,setRows]=useState([]),[history,setHistory]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 const [filter,setFilter]=useState('follow_up');
 const load=()=>{api('/payments/balances').then(setRows).catch(e=>setError(e.message));api('/payments').then(setHistory).catch(e=>setError(e.message));};useEffect(()=>{load();},[]);
 const visible=rows.filter(o=>{
  if(filter==='all')return true;
  if(filter==='balance')return o.balance>0;
  if(filter==='refund')return o.refundDue>0;
  if(filter==='deposit')return o.securityHeld>0;
  return o.status==='settlement_pending'||o.balance>0||o.refundDue>0||o.securityHeld>0;
 });
 return <>{error&&<p className="bad">{error}</p>}
 <div className="bar filter-panel"><label>Show<select value={filter} onChange={e=>setFilter(e.target.value)}>
  <option value="follow_up">Needs follow-up</option><option value="balance">Rental balance due</option><option value="refund">Rental refund due</option><option value="deposit">Money deposits held</option><option value="all">All orders</option>
 </select></label></div>
 {!visible.length?<p>No orders match this filter.</p>:<div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Rental total</th><th>Paid</th><th>Balance / refund due</th><th>Security held</th><th></th></tr></thead><tbody>{visible.map(o=><tr key={o._id}><td>{o.orderNo}</td><td>{o.customer?.name}</td><td>{o.status==='settlement_pending'?'Settlement pending':o.status}</td><td>{lkr(o.totalAmount)}</td><td>{lkr(o.paid)}</td><td>{o.status==='cancelled'?'Refund: ':''}{lkr(o.refundDue||o.balance)}</td><td><SecurityStatus order={o}/></td><td><button onClick={()=>setSelected(o._id)}>Open order</button></td></tr>)}</tbody></ResponsiveTable></div>}
 <h3>Payment history</h3><div className="tablewrap"><ResponsiveTable><thead><tr><th>Date</th><th>Order</th><th>Type</th><th>Method</th><th>Amount</th></tr></thead><tbody>{history.map(p=><tr key={p._id}><td>{new Date(p.paidAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</td><td>{p.order?.orderNo}</td><td>{p.type==='deposit'?'Rental advance':p.type}</td><td>{p.method}</td><td>{p.type==='refund'?'-':''}{lkr(p.amount)}</td></tr>)}</tbody></ResponsiveTable></div>
 {selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)} onSaved={load}/>}</>;
}
