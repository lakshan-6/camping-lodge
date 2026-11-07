import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {Link} from 'react-router-dom';
import {Metric,EmptyState} from '../components/UI.jsx';
import {can} from '../permissions.js';
export default function Billing({me}){
 const [orders,setOrders]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=()=>api('/payments/balances').then(setOrders).catch(e=>setError(e.message)).finally(()=>setLoading(false));useEffect(()=>{load();},[]);
 const sum=key=>orders.reduce((s,o)=>s+Number(o[key]||0),0),active=orders.filter(o=>o.status!=='cancelled');
 return <>{error&&<p className="bad">{error}</p>}{can(me,'finance.view')&&<div className="cards"><Metric icon="report" label="Rental total" value={loading?'…':lkr(active.reduce((s,o)=>s+o.totalAmount,0))} note="For the orders listed below"/><Metric icon="wallet" label="Rental payments" value={loading?'…':lkr(sum('paid'))} note="Net payments after refunds" tone="highlight"/><Metric icon="clock" label="Outstanding" value={loading?'…':lkr(sum('balance'))} note="Rental balances still to collect"/><Metric icon="shield" label="Security held" value={loading?'…':lkr(sum('securityHeld'))} note="Refundable deposits, kept separate"/></div>}
 <div className="list-summary"><h3>Orders & invoices <span className="count-pill">{orders.length}</span></h3><p>Open an order to view or print its invoice</p></div>
 {loading?<p role="status">Loading invoices…</p>:!orders.length?<EmptyState icon="report" title="Your invoices will appear here" description="Create a booking, then open its order workspace to manage the invoice and payments.">{can(me,'orders.write')&&<Link className="btn" to="/orders">Go to orders</Link>}</EmptyState>:<div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>{orders.map(o=><tr key={o._id}><td><b>{o.orderNo}</b></td><td>{o.customer?.name}</td><td>{lkr(o.totalAmount)}</td><td>{lkr(o.paid)}</td><td><b className={o.balance>0?'bad':'ok'}>{lkr(o.balance)}</b></td><td><button onClick={()=>setSelected(o._id)}>Invoices / payments</button></td></tr>)}</tbody></ResponsiveTable></div>}{selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)} onSaved={load}/>}</>;
}
