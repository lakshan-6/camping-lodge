import {useEffect,useState} from 'react';
import {api,lkr} from '../api.js';
import {can} from '../permissions.js';
import {emailStatusMessage} from '../emailStatus.js';

function PaymentMethod({label,value,onChange}){
 return <label>{label}<select required value={value} onChange={e=>onChange(e.target.value)}>
  <option value="">Choose payment method</option><option value="cash">Cash</option>
  <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option>
 </select></label>;
}

export default function SettlementDialog({order,me,onClose,onSaved}){
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [apply,setApply]=useState(false),[refund,setRefund]=useState(false),[paid,setPaid]=useState(false),[returnNic,setReturnNic]=useState(false);
 const [paymentMethod,setPaymentMethod]=useState(''),[refundMethod,setRefundMethod]=useState('');
 const [requestId]=useState(()=>crypto.randomUUID());
 useEffect(()=>{
  let active=true;
  api('/returns/settlement/'+order._id).then(data=>{if(active)setPreview(data);}).catch(e=>{if(active)setError(e.message);});
  return ()=>{active=false;};
 },[order._id]);
 if(!preview)return <div className="modal" key="settlement-loading"><div className="workspace">
  <h2>Settle {order.orderNo}</h2>{error?<p className="bad" role="alert">{error}</p>:<p role="status">Loading settlement…</p>}
  <button onClick={onClose}>Close</button>
 </div></div>;
 const rounded=n=>Math.round(n*100)/100;
 const applyAmount=Math.min(preview.depositHeld,preview.balance);
 const due=rounded(preview.balance-(apply?applyAmount:0));
 const refundAmount=rounded(preview.depositHeld-(apply?applyAmount:0));
 const canRecord=can(me,'payments.record'),canRefund=can(me,'payments.refund');
 const settled=(!due||paid)&&(!refundAmount||refund)&&(!preview.nicHeld||returnNic);
 async function save(e){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   const result=await api('/returns/settlement/'+order._id,{method:'POST',body:{
    applyDeposit:apply?applyAmount:0,refundDeposit:refund?refundAmount:0,paymentAmount:paid?due:0,
    refundMethod,paymentMethod,returnNic,requestId,
   }});
   const message=result.orderStatus==='completed'?'Settlement saved. Order completed.':'Settlement saved. Follow-up is still due.';
   onSaved((message+' '+emailStatusMessage(result.notificationEmail)).trim());
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <div className="modal"><form onSubmit={save}>
  <h2>Settle {preview.orderNo}</h2>
  <p>Equipment has been received. Finish the payment and security actions below.</p>
  {preview.depositHeld>0&&<section className="card security-card"><h3>Security deposit held · {lkr(preview.depositHeld)}</h3>
   {canRefund?<>{applyAmount>0&&<label className="check"><input type="checkbox" checked={apply} onChange={e=>{setApply(e.target.checked);setRefund(false);setPaid(false);}}/>Apply {lkr(applyAmount)} to rental balance</label>}
    {refundAmount>0&&<label className="check"><input type="checkbox" checked={refund} onChange={e=>setRefund(e.target.checked)}/>Refund recorded · {lkr(refundAmount)}</label>}
    {refund&&<PaymentMethod label="Refund method" value={refundMethod} onChange={setRefundMethod}/>}
   </>:<p>Ask a staff member with deposit refund access to handle the deposit.</p>}
  </section>}
  <section className="card"><p className="rental-balance-due">Remaining rental balance <strong>{lkr(due)}</strong></p>
   {due>0&&(canRecord?<label className="check"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>Payment received · {lkr(due)}</label>:<p>Ask a staff member with payment access to record the balance.</p>)}
   {paid&&<PaymentMethod label="Payment method" value={paymentMethod} onChange={setPaymentMethod}/>}
  </section>
  {preview.nicHeld&&<label className="check"><input type="checkbox" checked={returnNic} onChange={e=>setReturnNic(e.target.checked)}/>I physically returned the NIC to the customer.</label>}
  {error&&<p className="bad" role="alert">{error}</p>}
  <div className="bar"><button type="button" onClick={onClose} disabled={busy}>Close</button>
   <button className="btn" disabled={busy||(!settled&&!apply&&!refund&&!paid&&!returnNic)}>{busy?'Saving…':settled?'Complete order':'Save settlement'}</button>
  </div>
 </form></div>;
}
