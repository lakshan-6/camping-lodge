import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import {Link} from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import {Metric,EmptyState} from '../components/UI.jsx';
import {can} from '../permissions.js';
import {formatBusinessTime as fmt, formatPickup} from '../businessTime.js';
import NewOrderDialog from '../components/NewOrderDialog.jsx';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {PickupDialog} from './Rentals.jsx';
import {ReturnDialog} from './Returns.jsx';
import {emailStatusMessage} from '../emailStatus.js';
function remind(customer,orderNo,due){const d=String(customer?.phone||'').replace(/\D/g,'');const number=d.startsWith('94')?d:d.startsWith('0')?'94'+d.slice(1):d;const text=`Hello ${customer?.name||''}, a reminder that your Camping Lodge rental ${orderNo} is due back on ${fmt(due)}. Please contact us if you need an extension. Thank you.`;window.open('https://wa.me/'+number+'?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');}
export default function Today({me}){const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);const load=()=>{setLoading(true);setError('');return api('/stats/today').then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));};useEffect(()=>{load();},[]);
 const [creating,setCreating]=useState(false),[pickup,setPickup]=useState(null),[receiving,setReceiving]=useState(null),[workspace,setWorkspace]=useState(null),[notice,setNotice]=useState('');
 const [recentOrder,setRecentOrder]=useState(null);
 const saved=(message,orderId)=>{setCreating(false);setPickup(null);setReceiving(null);setNotice(message);setRecentOrder(orderId??null);load();};
 const overdueIds=new Set(data?.overdue.map(row=>row._id));
 const dueToday=data?.returns.filter(row=>!overdueIds.has(row._id))||[];
 const hour=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Colombo',hour:'numeric',hourCycle:'h23'}).format(new Date())),greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
 const sections=data?[['Today’s pickups',data.pickups,'pickup','pickup','No pickups scheduled','Your next scheduled pickups will appear here.'],['Today’s returns',dueToday,'return','returns','No upcoming returns today','Overdue rentals appear below.'],['Overdue rentals',data.overdue,'return','alert','No overdue rentals','All current rentals are within their return time.'],...(can(me,'finance.view')?[['Unpaid rental balances',data.unpaid,'payment','wallet','No unpaid balances','There are no outstanding rental balances to follow up.']]:[])]:[];
 return <><section className="welcome-banner"><div><h2>{greeting}, {me?.name?.split(' ')[0]||'there'}.</h2><p>Pickups, returns and balances to follow up today.</p></div><div className="bar">
   {can(me,'orders.write')&&can(me,'payments.record')&&<button className="btn btn-amber" onClick={()=>setCreating(true)}><Icon name="plus" size={18}/>New order</button>}
   <Link className="btn" to="/availability">Check availability</Link>
 </div></section>
 {error&&<p className="bad" role="alert">{error}</p>}{notice&&<div className="notice bar"><span role="status">{notice}</span>{recentOrder&&<button onClick={()=>setWorkspace(recentOrder)}>View saved order</button>}</div>}<div className="cards">{[['Pickups today',data?.pickups.length,'pickup'],['Returns due today',data?dueToday.length:null,'returns'],['Overdue rentals',data?.overdue.length,'clock'],...(can(me,'finance.view')?[['Unpaid orders',data?.unpaid.length,'wallet']]:[])].map(([label,value,icon])=><Metric key={label} label={label} value={value??'…'} icon={icon} note={label==='Overdue rentals'?'Follow up on late equipment':label==='Unpaid orders'?'Across outstanding orders':'Sri Lanka business day'} tone={label==='Overdue rentals'&&value>0?'warning':''}/>)}</div>
 <div className="section-head"><h3>Today at the lodge</h3><button onClick={load} disabled={loading}><Icon name="refresh" size={15}/>{loading?'Refreshing…':'Refresh'}</button></div>{loading&&!data&&<p role="status">Loading today’s work…</p>}
 <div className="task-grid">{sections.map(([title,rows,type,icon,emptyTitle,description])=><section className="card task-panel" key={title}><div className="section-head"><h3 className="section-title"><Icon name={icon} size={18}/>{title}</h3><span className="count-pill">{rows.length}</span></div>{rows.length?<div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>{type==='payment'?'Balance':'Time'}</th><th></th></tr></thead><tbody>{rows.map(row=><tr key={row._id}><td><b>{row.order?.orderNo||row.orderNo}</b></td><td>{row.customer?.name}<small>{row.customer?.phone}</small></td><td>{type==='payment'?lkr(row.balance):(type==='pickup'?formatPickup(row):fmt(row.dueDate))}</td><td className="acts">
  {type==='pickup'&&can(me,'rentals.write')&&<button onClick={()=>setPickup(row)}>Start pickup</button>}
  {type==='return'&&<>{can(me,'returns.write')&&<button onClick={()=>setReceiving(row)}>Receive return</button>}<details className="desk-actions"><summary>More actions</summary><button onClick={()=>remind(row.customer,row.order?.orderNo,row.dueDate)}>WhatsApp reminder</button></details></>}
  {type==='payment'&&<button onClick={()=>setWorkspace(row._id)}>View order</button>}
 </td></tr>)}</tbody></ResponsiveTable></div>:<EmptyState compact icon={icon} title={emptyTitle} description={description}/>}</section>)}</div>
 {creating&&<NewOrderDialog me={me} onClose={()=>setCreating(false)} onSaved={order=>saved(`${order.orderNo} saved. ${emailStatusMessage(order.bookingEmail)}`.trim(),order._id)}/>}
 {pickup&&<PickupDialog order={pickup} me={me} onClose={()=>setPickup(null)} onSaved={message=>saved(message,pickup._id)}/>}
 {receiving&&<ReturnDialog rental={receiving} me={me} onClose={()=>setReceiving(null)} onSaved={message=>saved(message,receiving.order?._id)}/>}
 {workspace&&<OrderWorkspace id={workspace} me={me} onClose={()=>setWorkspace(null)} onSaved={load}/>}
 </>;
}
