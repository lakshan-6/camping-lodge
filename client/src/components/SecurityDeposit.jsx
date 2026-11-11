import {useState} from 'react';
import {api,lkr} from '../api.js';
import {can} from '../permissions.js';

export const holdsNic=order=>!!order?.nicHeldAt&&!order?.nicReturnedAt;
export function SecurityStatus({order}){
 if(holdsNic(order))return <span className="tag fair">NIC held · return pending</span>;
 if(order?.securityMethod==='nic')return <span className="tag">{order.nicReturnedAt?'NIC returned':'NIC · collect at pickup'}</span>;
 if(order?.status==='reserved'&&!order.securityMethod)return <span className="tag">Choose at pickup</span>;
 return <span>Money deposit{Number.isFinite(order?.securityHeld)&&<> <b>{lkr(order.securityHeld)}</b></>}</span>;
}

export default function SecurityDeposit({order,me,onSaved}){
 const [action,setAction]=useState(''),[method,setMethod]=useState(order.securityMethod||'money'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const held=holdsNic(order),open=(next)=>{setAction(next);setMethod(order.securityMethod||'money');setConfirmed(false);setError('');};
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api(`/orders/${order._id}/security`,{method:'POST',body:{action,method,confirmed,requestId:crypto.randomUUID()}});setAction('');await onSaved?.();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="card security-card"><div className="bar"><h3>Security for this rental</h3><SecurityStatus order={order}/></div>
 <p>{held?(order.status==='active'?'Confirm that the physical NIC was handed back when settling the final return.':'Record the physical NIC hand-back once the customer receives it.'):order.securityMethod==='nic'?'The NIC number in the customer profile and the physical NIC held as security are recorded separately.':order.status==='reserved'&&!order.securityMethod?'Choose and confirm NIC or money when handing over the equipment.':'The refundable money deposit is separate from rental charges.'}</p>
 {order.nicHeldAt&&<small>NIC received: {new Date(order.nicHeldAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}{order.nicReturnedAt&&<> · Returned: {new Date(order.nicReturnedAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</>}</small>}
 <div className="bar">{order.status==='reserved'&&order.securityMethod&&can(me,'orders.write')&&<button onClick={()=>open('set')}>Change security type</button>}
 {!held&&['reserved','active'].includes(order.status)&&order.securityMethod==='nic'&&can(me,'rentals.write')&&<button onClick={()=>open('receive')}>Record NIC received</button>}
 {held&&order.status!=='active'&&can(me,'returns.write')&&<button onClick={()=>open('return')}>Record NIC returned</button>}</div>
 {action&&<form onSubmit={save}><h4>{action==='set'?'Choose security type':action==='receive'?'Receive customer NIC':'Return customer NIC'}</h4>
 {action==='set'?<label>Security type<select value={method} onChange={e=>setMethod(e.target.value)}><option value="nic">Customer NIC</option><option value="money">Refundable money deposit</option></select></label>:<label className="check"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{action==='receive'?'I physically received this customer’s NIC.':'I physically returned the NIC to this customer.'}</label>}
 {error&&<p className="bad" role="alert">{error}</p>}<div className="bar"><button type="button" disabled={busy} onClick={()=>setAction('')}>Cancel</button><button className="btn" disabled={busy}>{busy?'Saving…':'Save security record'}</button></div></form>}
 </section>;
}
