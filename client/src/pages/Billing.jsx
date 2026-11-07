import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
export default function Billing({me}){
 const [orders,setOrders]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 const load=()=>api('/payments/balances').then(setOrders).catch(e=>setError(e.message));useEffect(()=>{load();},[]);
 return <>{error&&<p className="bad">{error}</p>}<p>Invoices and payments use the same order workspace.</p><div className="tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>{orders.map(o=><tr key={o._id}><td>{o.orderNo}</td><td>{o.customer?.name}</td><td>{lkr(o.totalAmount)}</td><td>{lkr(o.paid)}</td><td>{lkr(o.balance)}</td><td><button onClick={()=>setSelected(o._id)}>Invoices / payments</button></td></tr>)}</tbody></table></div>{selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)} onSaved={load}/>}</>;
}
