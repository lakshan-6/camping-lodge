import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {can} from '../permissions.js';
export default function Payments({me}){
 const [rows,setRows]=useState([]),[history,setHistory]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 const load=()=>{api('/payments/balances').then(setRows).catch(e=>setError(e.message));if(can(me,'finance.view')||can(me,'payments.record')||can(me,'payments.refund'))api('/payments').then(setHistory).catch(e=>setError(e.message));};useEffect(()=>{load();},[]);
 return <>{error&&<p className="bad">{error}</p>}<p>Rental payments and refundable security deposits are separate. Open an order to record payments, refunds, deposit actions or print its invoice.</p><div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Rental total</th><th>Paid</th><th>Balance / refund due</th><th>Security held</th><th></th></tr></thead><tbody>{rows.map(o=><tr key={o._id}><td>{o.orderNo}</td><td>{o.customer?.name}</td><td>{o.status}</td><td>{lkr(o.totalAmount)}</td><td>{lkr(o.paid)}</td><td>{o.status==='cancelled'?'Refund: ':''}{lkr(o.refundDue||o.balance)}</td><td>{lkr(o.securityHeld)}</td><td><button onClick={()=>setSelected(o._id)}>Open order</button></td></tr>)}</tbody></table></div>
 <h3>Payment history</h3><div className="tablewrap"><table><thead><tr><th>Date</th><th>Order</th><th>Type</th><th>Method</th><th>Amount</th></tr></thead><tbody>{history.map(p=><tr key={p._id}><td>{new Date(p.paidAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</td><td>{p.order?.orderNo}</td><td>{p.type==='deposit'?'Rental advance':p.type}</td><td>{p.method}</td><td>{p.type==='refund'?'-':''}{lkr(p.amount)}</td></tr>)}</tbody></table></div>
 {selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)} onSaved={load}/>}</>;
}
