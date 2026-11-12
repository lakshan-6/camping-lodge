import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {Link} from 'react-router-dom';
import {EmptyState} from '../components/UI.jsx';
import {can} from '../permissions.js';
export default function Billing({me}){
 const [invoices,setInvoices]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [status,setStatus]=useState('');
 const load=()=>api('/invoices').then(setInvoices).catch(e=>setError(e.message)).finally(()=>setLoading(false));
 useEffect(()=>{load();},[]);
 const visible=status?invoices.filter(invoice=>invoice.status===status):invoices;
 return <>
  {error&&<p className="bad" role="alert">{error}</p>}
  <div className="bar filter-panel"><label>Invoice status<select value={status} onChange={e=>setStatus(e.target.value)}>
   <option value="">All invoices</option><option value="issued">Issued</option><option value="paid">Paid</option><option value="void">Void</option>
  </select></label></div>
  {loading?<p role="status">Loading invoices…</p>:!visible.length?<EmptyState icon="report" title={status?'No invoices with this status':'No invoices yet'}>
   {!status&&can(me,'orders.write')&&<Link className="btn" to="/orders">Go to orders</Link>}
  </EmptyState>:<div className="tablewrap"><ResponsiveTable>
   <thead><tr><th>Invoice</th><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead>
   <tbody>{visible.map(invoice=><tr key={invoice._id}><td><b>{invoice.invoiceNo}</b></td><td>{invoice.order?.orderNo}</td>
    <td>{invoice.customer?.name}</td><td>{lkr(invoice.total)}</td><td>{invoice.status}</td>
    <td>{invoice.order&&<button onClick={()=>setSelected(invoice.order._id)}>Open order</button>}</td></tr>)}</tbody>
  </ResponsiveTable></div>}
  {selected&&<OrderWorkspace id={selected} me={me} onClose={()=>setSelected(null)} onSaved={load}/>}
 </>;
}
