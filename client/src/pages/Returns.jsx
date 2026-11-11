import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import {can} from '../permissions.js';
import {SecurityStatus} from '../components/SecurityDeposit.jsx';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import {emailStatusMessage} from '../emailStatus.js';
const fmt=d=>new Date(d).toLocaleString('en-LK',{timeZone:'Asia/Colombo',dateStyle:'medium',timeStyle:'short'});
const hasEquipmentIssue=items=>items.some(item=>Number(item.quantityDamaged)>0||Number(item.quantityLost)>0);
const amountDue=(amount,credit=0)=>Math.max(0,Math.round((amount-credit)*100)/100);
export default function Returns({me}){
 const [out,setOut]=useState([]),[done,setDone]=useState([]),[form,setForm]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[workspace,setWorkspace]=useState(null);
 const load=()=>{api('/rentals?status=out').then(setOut).catch(e=>setError(e.message));api('/returns').then(setDone).catch(e=>setError(e.message));};useEffect(load,[]);
 async function open(rental){setError('');try{const preview=await api('/returns/preview/'+rental._id);setForm({rental,preview,returnNic:false,items:preview.items.map(i=>({equipment:i.equipment._id,name:i.equipment.name,remaining:i.remaining,trackUnits:i.equipment.trackUnits,units:(i.unitAssignments||[]).filter(u=>u.outcome==='out').map(u=>({unit:u.unit,code:u.code,condition:'good'})),quantityReturned:i.remaining,quantityDamaged:0,quantityLost:0})),checklist:(preview.checklist||[]).map(c=>({...c,checked:false,missing:false,fee:''})),damageFee:0,waivedFee:0,waiverReason:'',notes:'',paid:{balance:false,late:false,damage:false},method:'',requestId:crypto.randomUUID()});}catch(x){setError(x.message);}}
 function updateItems(items){
  setForm({...form,items,damageFee:hasEquipmentIssue(items)?form.damageFee:0});
 }
 const setItem=(index,key,value)=>updateItems(form.items.map((i,n)=>index===n?{...i,[key]:value}:i));
 function setUnit(index,unit,condition){updateItems(form.items.map((i,n)=>{if(n!==index)return i;const units=i.units.map(u=>u.unit===unit?{...u,condition}:u);return {...i,units,quantityReturned:units.filter(u=>u.condition==='good').length,quantityDamaged:units.filter(u=>u.condition==='damaged').length,quantityLost:units.filter(u=>u.condition==='lost').length};}));}
 const complete=form&&form.items.every(i=>Number(i.quantityReturned)+Number(i.quantityDamaged)+Number(i.quantityLost)===i.remaining);
 const equipmentIssue=form&&hasEquipmentIssue(form.items);
 function setAccessory(index,changes){
  setForm({...form,checklist:form.checklist.map((entry,n)=>index===n?{...entry,...changes}:entry)});
 }
 const canRecordPayment=can(me,'payments.record');
 const lateFee=form?amountDue(form.preview.lateFee,Number(form.waivedFee)):0;
 const accessoryFee=form?form.checklist.reduce((cents,entry)=>entry.missing?cents+Math.round(Number(entry.fee)*100):cents,0)/100:0;
 const damageFee=form?(Math.round(Number(form.damageFee)*100)+Math.round(accessoryFee*100))/100:0;
 const paymentCredit=form?.preview.paymentCredit??0;
 const paymentOptions=form?[
  ['balance','Rental balance received',form.preview.balance],
  ['late','Late fee received',amountDue(lateFee,paymentCredit)],
  ['damage','Damage / loss charge received',amountDue(damageFee,amountDue(paymentCredit,lateFee))]
 ].filter(([, ,amount])=>amount>0):[];
 const totalDue=amountDue(paymentOptions.reduce((sum,[,,amount])=>sum+amount,0));
 const needsPaymentAccess=complete&&totalDue>0&&!canRecordPayment;
 async function save(e){
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try{
   const paid=Object.fromEntries(paymentOptions.map(([key])=>[key,form.paid[key]]));
   const confirmedAmounts=Object.fromEntries(paymentOptions.filter(([key])=>paid[key]).map(([key,,amount])=>[key+'PaymentAmount',amount]));
   const result=await api('/returns',{method:'POST',body:{...form,paid,...confirmedAmounts,items:form.items.map(i=>({...i,units:i.trackUnits?i.units.filter(u=>u.condition!=='out'):undefined})),returnNic:complete&&form.returnNic,rental:form.rental._id,damageFee:Number(form.damageFee),waivedFee:Number(form.waivedFee)}});
   setForm(null);load();alert(`${result.emailNote} ${emailStatusMessage(result.notificationEmail)}`.trim());
  }catch(x){setError(x.message);}finally{setBusy(false);}
 }
 return <>{error&&!form&&<p className="bad">{error}</p>}<h3>Waiting to be returned</h3><div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Due back</th><th>Remaining items</th><th></th></tr></thead><tbody>{out.map(r=><tr key={r._id}><td>{r.order?.orderNo}</td><td>{r.customer?.name}</td><td>{fmt(r.dueDate)} {r.overdue&&<b className="bad">Overdue</b>}</td><td>{r.items.filter(i=>i.remaining>0).map(i=>`${i.remaining}× ${i.equipment?.name}`).join(', ')}</td><td>{can(me,'returns.write')&&<button onClick={()=>open(r)}>Receive return</button>}</td></tr>)}</tbody></ResponsiveTable></div><h3>Return history</h3><div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Returned</th><th>Type</th><th>Late fee</th><th>Damage / loss fee</th><th>Security</th><th></th></tr></thead><tbody>{done.map(r=><tr key={r._id}><td>{r.rental?.order?.orderNo}</td><td>{fmt(r.returnedAt)}</td><td>{r.partial?'Partial':'Complete'}</td><td>{lkr(r.lateFee)}</td><td>{lkr(r.damageFee)}{r.checklist?.filter(item=>item.missing).map(item=><small key={item.key??item.label}>{item.label} · Missing{item.fee>0&&` · ${lkr(item.fee)}`}</small>)}</td><td><SecurityStatus order={r.rental?.order}/></td><td>{r.rental?.order&&<button onClick={()=>setWorkspace(r.rental.order._id)}>View order</button>}</td></tr>)}</tbody></ResponsiveTable></div>
 {workspace&&<OrderWorkspace id={workspace} me={me} onClose={()=>setWorkspace(null)} onSaved={load}/>}
 {form&&<div className="modal"><form style={{maxWidth:650}} onSubmit={save}>
 <h2>Return {form.rental.order?.orderNo}</h2>
 {form.checklist.length>0&&<section className="card" aria-labelledby="return-checklist-title">
  <h3 id="return-checklist-title">Return checklist</h3>
  <div className="return-checklist-group">
   <p className="hint">Mark handed-out accessories as returned or missing. Leave accessories still with the customer unchecked for a partial return.</p>
   {form.checklist.map((entry,index)=><div key={entry.key??entry.label} role="group" aria-label={entry.label}>
    <b>{entry.label}</b>
    <div className="row">
     <label className="check"><input type="checkbox" checked={entry.checked} onChange={e=>setAccessory(index,{checked:e.target.checked,missing:false,fee:''})}/>Returned</label>
     <label className="check"><input type="checkbox" checked={entry.missing} onChange={e=>setAccessory(index,{checked:false,missing:e.target.checked,fee:''})}/>Missing / lost</label>
    </div>
    {entry.missing&&<label>Missing accessory fee (LKR)<input type="number" min="0" max="1000000000" step="0.01" placeholder="0" value={entry.fee} onChange={e=>setAccessory(index,{fee:e.target.value})}/></label>}
   </div>)}
   {accessoryFee>0&&<p>Missing accessory fees <strong>{lkr(accessoryFee)}</strong></p>}
  </div>
 </section>}
 <details className="card equipment-return-details" onInvalid={event=>{event.currentTarget.open=true;}}>
  <summary>Adjust equipment return
   <small>{complete&&!equipmentIssue
    ?'All outstanding equipment will be recorded as returned in good condition.'
    :[!complete&&'Partial return',equipmentIssue&&'Damaged or lost equipment'].filter(Boolean).join(' · ')}</small>
  </summary>
  <div className="return-checklist-group">
   <p className="hint">For a partial return, leave equipment still with the customer outstanding.</p>
   {form.items.map((item,index)=>item.remaining>0&&<div key={item.equipment} role="group" aria-label={item.name}>
    <b>{item.name} · {item.remaining} outstanding</b>
    {item.trackUnits?<div className="unit-return-list">
     {item.units.map(unit=><label key={unit.unit}><b>{unit.code}</b>
      <select aria-label={"Condition for "+unit.code} value={unit.condition} onChange={e=>setUnit(index,unit.unit,e.target.value)}>
       <option value="good">Returned · good</option>
       <option value="damaged">Returned · damaged</option>
       <option value="lost">Lost</option>
       <option value="out">Not returned yet</option>
      </select>
     </label>)}
    </div>:<div className="row3">
     {[['quantityReturned','Good condition'],['quantityDamaged','Damaged'],['quantityLost','Lost']].map(([key,label])=><label key={key}>{label}
      <input type="number" min="0" max={item.remaining} step="1" required value={item[key]} onChange={e=>setItem(index,key,e.target.value)}/>
     </label>)}
    </div>}
   </div>)}
   {equipmentIssue&&<label>Equipment damage / loss charge (LKR)
    <input type="number" min="0" max="1000000000" step="0.01" value={form.damageFee} onChange={e=>setForm({...form,damageFee:e.target.value})}/>
   </label>}
  </div>
 </details>
 <p>Late fee <strong>{lkr(form.preview.lateFee)}</strong>{form.preview.additionalPercent>0&&<> · {form.preview.additionalPercent}% of the outstanding item rates</>}</p>
 {can(me,'fees.waive')&&<><label>Late fee to waive (LKR)<input type="number" min="0" max={form.preview.lateFee} step="0.01" value={form.waivedFee} onChange={e=>setForm({...form,waivedFee:e.target.value})}/></label>{Number(form.waivedFee)>0&&<label>Waiver reason<input required value={form.waiverReason} onChange={e=>setForm({...form,waiverReason:e.target.value})}/></label>}</>}
 <section className="card">
  <p className="rental-balance-due">{complete?'Total due to complete the return':'Total due'} <strong>{lkr(totalDue)}</strong></p>
  {complete&&totalDue>0&&<p className="hint">{needsPaymentAccess?'Ask a staff member with payment access to record the payment and complete this return.':'Confirm each amount received to settle the balance and complete the return.'}</p>}
  {paymentCredit>0&&lateFee+damageFee>0&&<p className="hint">Prepaid credit applied to return fees · {lkr(Math.min(paymentCredit,amountDue(lateFee+damageFee)))}</p>}
  {paymentOptions.map(([key,label,amount])=>canRecordPayment
   ?<label className="check" key={key}><input type="checkbox" required={complete} checked={form.paid[key]} onChange={e=>setForm({...form,paid:{...form.paid,[key]:e.target.checked}})}/>{label} · {lkr(amount)}</label>
   :<p key={key}>{label.replace(' received',' due')} · {lkr(amount)}</p>)}
  {canRecordPayment&&paymentOptions.some(([key])=>form.paid[key])&&<label>Payment method<select required value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="">Choose payment method</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>}
 </section>
 {form.preview.nicHeld&&<section className="card security-card"><h3>Customer NIC is held</h3>{complete?<label className="check"><input type="checkbox" required checked={form.returnNic} onChange={e=>setForm({...form,returnNic:e.target.checked})}/>I physically returned the NIC to the customer.</label>:<p>Keep the NIC until the final return is settled.</p>}</section>}
 <label>Notes<textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>{error&&<p className="bad">{error}</p>}<div className="bar"><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button><button className="btn" disabled={busy||needsPaymentAccess}>{busy?'Saving…':'Confirm return'}</button></div></form></div>}</>;
}
