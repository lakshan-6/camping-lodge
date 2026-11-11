import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import {can} from '../permissions.js';
import CustomerDetails from './CustomerDetails.jsx';
import EditOrder from './EditOrder.jsx';
import WhatsAppPrompt from './WhatsAppPrompt.jsx';
import {SecurityStatus} from '../components/SecurityDeposit.jsx';
import {emailStatusMessage} from '../emailStatus.js';
import {formatBusinessTime as fmt, formatPickup} from '../businessTime.js';
export default function Rentals({me}){
 const [ready,setReady]=useState([]),[out,setOut]=useState([]),[hand,setHand]=useState(null),[extend,setExtend]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(null),[editing,setEditing]=useState(null),[wa,setWa]=useState(null),[email,setEmail]=useState(false);
 const [notice,setNotice]=useState('');
 const load=()=>{Promise.all([api('/orders'),api('/payments/balances')]).then(([orders,balances])=>{const map=new Map(balances.map(x=>[x._id,x]));setReady(orders.filter(o=>o.status==='reserved').map(o=>({...o,paid:map.get(o._id)?.paid||0,balance:map.get(o._id)?.balance??o.totalAmount})));}).catch(e=>setError(e.message));api('/rentals?status=out').then(setOut).catch(e=>setError(e.message));};
 useEffect(()=>{load();api('/settings').then(s=>setEmail(s.emailConfigured&&!s.bookingEmailConfigured));},[]);
 async function openHandover(order){if(busy)return;setBusy(true);setError('');try{const preview=await api('/rentals/pickup-preview/'+order._id);const depositDue=Math.max(0,Math.round((preview.depositAmount-preview.securityHeld)*100)/100);setHand({order,preview,securityMethod:preview.securityMethod??'',nicReceived:false,securityDeposit:{received:false,amount:preview.securityMethod?(depositDue||''):'',method:'cash'},unitSelections:preview.items.filter(i=>i.equipment.trackUnits).map(i=>({equipment:i.equipment._id,units:[]})),paymentReceived:false,paymentAmount:'',paymentMethod:'',via:'whatsapp',requestId:crypto.randomUUID(),checklist:preview.checklist||[]});}catch(e){setError(e.message);}finally{setBusy(false);}}
 function selectUnit(equipment,unit,checked){setHand({...hand,unitSelections:hand.unitSelections.map(s=>s.equipment===equipment?{...s,units:checked?[...s.units,unit]:s.units.filter(u=>u!==unit)}:s)});}
 async function start(e){
  e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const rentalPayment=hand.paymentReceived?{amount:Number(hand.paymentAmount),method:hand.paymentMethod}:undefined;
   const result=await api('/rentals/start',{method:'POST',body:{order:hand.order._id,rentalPayment,sendVia:hand.via,checklist:hand.checklist,securityMethod:hand.securityMethod,nicReceived:hand.nicReceived,securityDeposit:hand.securityMethod==='money'?hand.securityDeposit:undefined,unitSelections:hand.unitSelections,requestId:hand.requestId}});
   setHand(null);load();setNotice(`Pickup saved. Due back ${fmt(result.dueDate)} (Sri Lanka time). ${result.emailNote||emailStatusMessage(result.notificationEmail)}`.trim());if(result.whatsappInvoice)setWa(result.whatsappInvoice);
  }catch(x){setError(x.message);}finally{setBusy(false);}
 }
 const remainingBalance=hand&&Math.max(0,Math.round((hand.preview.balance-Number(hand.paymentAmount))*100)/100);
 const itemList=items=>items.map(i=>`${i.remaining??i.quantity}× ${i.equipment?.name}`).join(', ');
 return <>{error&&!hand&&!extend&&<p className="bad">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}{wa&&<WhatsAppPrompt invoiceId={wa} onClose={()=>setWa(null)}/>}<h3>Ready for pickup</h3><div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Booked pickup</th><th>Items</th><th>Balance</th><th></th></tr></thead><tbody>{ready.map(o=><tr key={o._id}><td>{o.orderNo}</td><td>{o.customer?.name}{o.customer?.detailsPending&&<small>Details pending</small>}</td><td>{formatPickup(o)}</td><td>{itemList(o.items)}</td><td>{lkr(o.balance)}</td><td>{o.customer?.detailsPending&&can(me,'customers.write')&&<button onClick={()=>setDetails(o.customer)}>Add details</button>}{can(me,'orders.write')&&<button onClick={()=>setEditing(o)}>Change booking</button>}{can(me,'rentals.write')&&<button className="btn" disabled={busy} onClick={()=>openHandover(o)}>Start rental</button>}</td></tr>)}</tbody></ResponsiveTable></div>
 <h3>Out now</h3><div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Remaining items</th><th>Due back</th><th>Status</th><th></th></tr></thead><tbody>{out.map(r=><tr key={r._id}><td>{r.order?.orderNo}</td><td>{r.customer?.name} · {r.customer?.phone}</td><td>{itemList(r.items)}</td><td>{fmt(r.dueDate)}</td><td>{r.overdue?'Overdue':'Out'}<small><SecurityStatus order={r.order}/></small></td><td>{can(me,'rentals.write')&&<button onClick={()=>{setError('');setExtend({rental:r,periods:1,requestId:crypto.randomUUID()});}}>Extend rental</button>}</td></tr>)}</tbody></ResponsiveTable></div>
 {details&&<CustomerDetails customer={details} onClose={()=>setDetails(null)} onSaved={()=>{setDetails(null);load();}}/>}{editing&&<EditOrder order={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);load();}}/>}
 {hand&&<div className="modal"><form onSubmit={start}><h2>Hand over {hand.order.orderNo}</h2><p>{hand.order.customer?.name}</p><p>The return time starts from this handover. Availability is checked again before saving.</p>
 <section className="card">
  <p className="rental-balance-due">Rental balance due <strong>{lkr(hand.preview.balance)}</strong></p>
  {hand.preview.balance>0&&can(me,'payments.record')&&<>
   <label className="check"><input type="checkbox" checked={hand.paymentReceived} onChange={e=>setHand({...hand,paymentReceived:e.target.checked})}/>I received a rental payment at pickup</label>
   {hand.paymentReceived?<><div className="row">
    <label>Amount received (LKR)<input required type="number" min="0" max={hand.preview.balance} step="0.01" value={hand.paymentAmount} onChange={e=>setHand({...hand,paymentAmount:e.target.value})}/></label>
    <label>Rental payment method<select required={Number(hand.paymentAmount)>0} disabled={Number(hand.paymentAmount)<=0} value={hand.paymentMethod} onChange={e=>setHand({...hand,paymentMethod:e.target.value})}><option value="">Choose payment method</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
   </div>{hand.paymentAmount!==''&&Number(hand.paymentAmount)>=0&&Number(hand.paymentAmount)<=hand.preview.balance&&<p>Remaining rental balance <strong>{lkr(remainingBalance)}</strong></p>}</>:
   <p className="hint">Leave unchecked if the customer will pay the balance at return.</p>}
  </>}
 </section>
 <section className="card security-card">
 <h3>Security deposit</h3>
 <label>Security type<select required value={hand.securityMethod} disabled={hand.preview.nicHeld||hand.preview.securityHeld>0}
 onChange={e=>setHand({...hand,securityMethod:e.target.value,nicReceived:false,securityDeposit:{...hand.securityDeposit,received:false}})}>
 <option value="" disabled>Choose NIC or money</option><option value="nic">NIC</option><option value="money">Money</option>
 </select></label>
 {hand.securityMethod==='nic'&&(hand.preview.nicHeld?<p className="good">Customer NIC is already recorded as held.</p>:
 <label className="check"><input type="checkbox" required checked={hand.nicReceived} onChange={e=>setHand({...hand,nicReceived:e.target.checked})}/>I physically received the customer NIC as security.</label>)}
 {hand.securityMethod==='money'&&<>
 {hand.preview.securityHeld>0&&<p>Money deposit already held: <b>{lkr(hand.preview.securityHeld)}</b></p>}
 {can(me,'payments.record')?<>
 {!hand.preview.securityMethod&&hand.preview.depositAmount>0&&<p className="hint">Suggested deposit: {lkr(hand.preview.depositAmount)}</p>}
 <label>Security deposit received (LKR)<input required={hand.preview.securityHeld<=0||hand.securityDeposit.received} type="number" min="0.01" max="1000000000" step="0.01" value={hand.securityDeposit.amount} onChange={e=>setHand({...hand,securityDeposit:{...hand.securityDeposit,amount:e.target.value}})}/></label>
 <label>Deposit payment method<select value={hand.securityDeposit.method} onChange={e=>setHand({...hand,securityDeposit:{...hand.securityDeposit,method:e.target.value}})}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
 <label className="check"><input type="checkbox" required={hand.preview.securityHeld<=0} checked={hand.securityDeposit.received} onChange={e=>setHand({...hand,securityDeposit:{...hand.securityDeposit,received:e.target.checked}})}/>I received this money deposit.</label>
 </>:hand.preview.securityHeld<=0&&<p>A staff member with payment access must confirm a money deposit.</p>}
 </>}
 <p className="hint">Rental payments are separate from the security deposit.</p>
 </section>
 {hand.preview.items.filter(i=>i.equipment.trackUnits).map(i=>{const selected=hand.unitSelections.find(s=>s.equipment===i.equipment._id)?.units||[];return <fieldset className="unit-picker" key={i._id}><legend>{i.equipment.name} · choose {i.quantity} unit codes</legend><p>{selected.length} of {i.quantity} selected. Match these codes to the labels on the equipment.</p><div className="unit-grid">{i.availableUnits.map(u=><label className="check unit-choice" key={u._id}><input type="checkbox" checked={selected.includes(u._id)} disabled={!selected.includes(u._id)&&selected.length>=i.quantity} onChange={e=>selectUnit(i.equipment._id,u._id,e.target.checked)}/><b>{u.code}</b></label>)}</div>{i.availableUnits.length<i.quantity&&<p className="bad">Not enough labelled units are ready. Check inventory.</p>}</fieldset>;})}
 {hand.checklist.length>0&&<><h3>Handover checklist</h3><p className="hint">Tick the accessories handed to the customer.</p>{hand.checklist.map((c,i)=><label className="check" key={c.key}><input type="checkbox" checked={c.checked} onChange={e=>setHand({...hand,checklist:hand.checklist.map((x,j)=>i===j?{...x,checked:e.target.checked}:x)})}/>{c.label}</label>)}</>}
 <p>Pickup confirmation emails are automatic when configured. Choose whether to share the invoice separately.</p><label>Invoice delivery<select value={hand.via} onChange={e=>setHand({...hand,via:e.target.value})}><option value="whatsapp">WhatsApp (review and send yourself)</option><option value="none">No extra invoice delivery</option>{email&&<><option value="email">Email invoice</option><option value="both">Email invoice and WhatsApp</option></>}</select></label>{error&&<p className="bad">{error}</p>}<div className="bar"><button type="button" disabled={busy} onClick={()=>setHand(null)}>Cancel</button><button className="btn" disabled={busy}>{busy?'Saving…':'Confirm handover'}</button></div></form></div>}
 {extend&&<div className="modal"><form onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);try{const result=await api(`/rentals/${extend.rental._id}/extend`,{method:'POST',body:extend});setExtend(null);load();alert('Rental extended. Extra charge: '+lkr(result.extra));}catch(x){setError(x.message);}finally{setBusy(false);}}}><h2>Extend {extend.rental.order?.orderNo}</h2><p>Current due: {fmt(extend.rental.dueDate)}. Each extra period is 36 hours. Conflicting bookings will block the extension.</p><label>Extra periods<input required type="number" min="1" max="30" step="1" value={extend.periods} onChange={e=>setExtend({...extend,periods:e.target.value})}/></label><p>Extra-period estimate: {lkr(extend.rental.items.reduce((s,i)=>s+i.remaining*i.periodRate,0)*Number(extend.periods))}</p><p>Overdue charges, after the grace period, are added when saving.</p>{error&&<p className="bad">{error}</p>}<div className="bar"><button type="button" disabled={busy} onClick={()=>setExtend(null)}>Cancel</button><button className="btn" disabled={busy}>Confirm extension</button></div></form></div>}</>;
}
