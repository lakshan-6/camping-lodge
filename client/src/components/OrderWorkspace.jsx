import ResponsiveTable from './ResponsiveTable.jsx';
import {useEffect,useState} from 'react';
import {api,getToken,lkr} from '../api.js';
import {can} from '../permissions.js';
import {getOrderWhatsAppUpdates,sendInvoiceWhatsApp} from '../whatsapp.js';
import SecurityDeposit from './SecurityDeposit.jsx';
import {emailStatusMessage} from '../emailStatus.js';
import {formatPickup,formatReturn,formatBusinessTime} from '../businessTime.js';
import SettlementDialog from './SettlementDialog.jsx';
import LateFeeWaiverDialog from './LateFeeWaiverDialog.jsx';
const labels={deposit:'Advance',rental:'Payment',balance:'Balance payment',fee:'Extra charge',refund:'Refund to customer'};
const emailLabels={booking:'Order confirmation',pickup:'Handover confirmation',payment:'Payment',deposit:'Security deposit',return:'Equipment return',settlement:'Settlement'};
export default function OrderWorkspace({id,me,onClose,onSaved,showPaymentActions=true,nextAction}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[form,setForm]=useState(null),[busy,setBusy]=useState(false),[settings,setSettings]=useState(null),[history,setHistory]=useState(null);
 const [notice,setNotice]=useState('');
 const [settling,setSettling]=useState(false);
 const [feeWaiver,setFeeWaiver]=useState(null);
 const load=()=>api('/orders/'+id+'/detail').then(setData).catch(e=>setError(e.message));
 useEffect(()=>{load();api('/settings').then(setSettings).catch(()=>{});},[id]);
 const open=(mode,type)=>{setError('');setNotice('');const depositDue=Math.max(0,Math.round((data.depositAmount-data.securityHeld)*100)/100);setForm({mode,type,amount:mode==='security'?(type==='collect'?depositDue:data.securityHeld):type==='refund'?data.paid:Math.max(0,data.totalAmount-data.paid),method:'cash',reason:'',allowOverpayment:false,requestId:crypto.randomUUID()});};
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const saved=await api(form.mode==='security'?'/payments/deposits':'/payments',{method:'POST',body:{...form,amount:Number(form.amount),order:id}});setForm(null);setNotice(`Transaction saved. ${emailStatusMessage(saved.notificationEmail)}`.trim());await load();onSaved?.();}catch(x){setError(x.message);}finally{setBusy(false);}}
 async function pdf(invoice){try{const r=await fetch(`/api/invoices/${invoice._id}/pdf`,{headers:{Authorization:'Bearer '+getToken()}});if(!r.ok)throw new Error('Could not open PDF');const url=URL.createObjectURL(await r.blob());window.open(url,'_blank');}catch(e){setError(e.message);}}
 async function retryBookingEmail(){
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{const result=await api('/orders/'+id+'/retry-booking-email',{method:'POST'});setNotice(emailStatusMessage(result.status));await load();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const whatsappUpdates=data?getOrderWhatsAppUpdates(data,settings?.businessName):[];
 const hasRentalItems=data&&(data.hasRentalItems??data.items.some(item=>item.itemType!=='sale'));
 if(feeWaiver)return <LateFeeWaiverDialog record={feeWaiver} orderNo={data.orderNo} onClose={()=>{setFeeWaiver(null);load();}} onSaved={async message=>{
  setFeeWaiver(null);setNotice(message);await load();onSaved?.();
 }}/>;
 if(settling)return <SettlementDialog order={data} me={me} onClose={()=>setSettling(false)} onSaved={async message=>{
  setSettling(false);setNotice(message);await load();onSaved?.();
 }}/>;
 return <div className="modal" onClick={()=>!busy&&onClose()}><div className="workspace" onClick={e=>e.stopPropagation()}>
 <div className="bar"><h2>{data?.orderNo||'Order details'}</h2><button onClick={onClose} disabled={busy}>Close</button></div>
 {error&&<p className="bad" role="alert">{error}</p>}
 {notice&&<p className="notice" role="status">{notice}</p>}
 {data&&<><div className="bar"><p><b>{data.customer?.name}</b> · {data.customer?.phone} · {data.status}<br/><small>Placed by: <strong>{data.placedByName||'Not recorded'}</strong></small></p>{nextAction?.(data)}</div>
 {!nextAction&&data.status==='settlement_pending'&&can(me,'returns.write')&&<button onClick={()=>setSettling(true)}>Complete settlement</button>}
 <div className="metric-row"><p>{data.fulfilledAt?'Handed over':'Pickup'} <b>{data.fulfilledAt?formatBusinessTime(data.fulfilledAt):formatPickup(data)}</b></p>{hasRentalItems&&<p>Rental return <b>{formatReturn(data)}</b></p>}<p>Order total <b>{lkr(data.totalAmount)}</b></p><p>Order balance <b>{lkr(data.status==='cancelled'?0:data.totalAmount-data.paid)}</b></p></div>
 <ResponsiveTable><thead><tr><th>Item</th><th>Qty</th><th>Return / sale status</th><th>Unit codes</th><th>Amount</th></tr></thead><tbody>{data.items.map(i=><tr key={i._id}><td>{i.equipment?.name}<small>{i.itemType==='sale'?'Sale':'Rental'}</small></td><td>{i.quantity}</td><td>{i.itemType==='sale'?(data.fulfilledAt?'Sold':'Pending handover'):i.returnedQuantity||0}</td><td>{i.itemType==='sale'?'—':i.unitAssignments?.length?i.unitAssignments.map(u=><small key={u.unit}><b>{u.code}</b> · {u.outcome}</small>):'Quantity tracked'}</td><td>{lkr(i.lineTotal)}</td></tr>)}</tbody></ResponsiveTable>
 {data.returnFees?.some(record=>record.lateFee>0||record.waivedFee>0)&&<section className="card">
  <h3>Return late fees</h3>
  {data.returnFees.filter(record=>record.lateFee>0||record.waivedFee>0).map(record=><div className="bar" key={record._id}>
   <p>{new Date(record.returnedAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}<br/>Late fee <strong>{lkr(record.lateFee)}</strong>
    {record.waivedFee>0&&<><br/><small>Waived {lkr(record.waivedFee)} · {record.waiverReason}</small></>}
   </p>
   {record.lateFee>0&&can(me,'fees.waive')&&<button onClick={()=>setFeeWaiver(record)}>Waive late fee</button>}
  </div>)}
 </section>}
 {whatsappUpdates.length>0&&<details className="desk-actions">
  <summary>WhatsApp updates</summary>
  <p className="hint">Review the message in WhatsApp, then press Send.</p>
  <div className="bar">
   {whatsappUpdates.map(({key,label,url})=><a key={key} className="btn" href={url} target="_blank" rel="noopener noreferrer">{label}</a>)}
  </div>
 </details>}
 {(showPaymentActions||!can(me,'finance.view')&&!can(me,'payments.refund'))&&can(me,'payments.record')&&!['cancelled','settlement_pending'].includes(data.status)&&data.totalAmount>data.paid&&<button onClick={()=>open('rental',data.paid===0?'deposit':'balance')}>Record payment</button>}
 {showPaymentActions&&['finance.view','payments.record','payments.refund'].some(permission=>can(me,permission))&&<details className="desk-actions"><summary>More payment actions</summary><div className="bar">
 {can(me,'payments.record')&&can(me,'payments.refund')&&data.status!=='cancelled'&&data.totalAmount<=data.paid&&<button onClick={()=>open('rental','balance')}>Record overpayment</button>}
 {hasRentalItems&&can(me,'payments.record')&&['reserved','active'].includes(data.status)&&data.securityMethod==='money'&&<button onClick={()=>open('security','collect')}>Collect security deposit</button>}
 {can(me,'payments.refund')&&<><button onClick={()=>open('rental','refund')} disabled={data.paid<=0}>Record refund</button>{hasRentalItems&&<><button onClick={()=>open('security','refund')} disabled={data.securityHeld<=0}>Refund security deposit</button><button onClick={()=>open('security','apply')} disabled={data.securityHeld<=0||data.status==='cancelled'}>Apply deposit to order balance</button></>}</>}
 {hasRentalItems&&(can(me,'finance.view')||can(me,'payments.record')||can(me,'payments.refund'))&&<button onClick={()=>api('/payments/deposits/'+id).then(setHistory).catch(e=>setError(e.message))}>Deposit history</button>}
 </div></details>}
 {history&&<div className="notice">{history.history.length===0?'No security deposit transactions yet.':history.history.map(h=><p key={h._id}>{h.type}: {lkr(h.amount)} · {h.reason||h.method}</p>)}</div>}
 {form&&<form className="card" onSubmit={save}><h3>{form.mode==='security'?'Security deposit: '+form.type:labels[form.type]}</h3><label>Amount (LKR)<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
 <label>Method<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
 <label>Reason / reference<input required={form.type==='refund'||form.type==='apply'||form.allowOverpayment} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
 {form.mode==='rental'&&form.type==='refund'&&data.status==='completed'&&Math.round((data.totalAmount-data.paid+Number(form.amount))*100)>0&&<label>Order charge after refund<select required value={form.refundCorrection??''} onChange={e=>setForm({...form,refundCorrection:e.target.value})}><option value="">Choose an action</option><option value="reduce_charge">Reduce the charge and keep the order completed</option><option value="reopen">Keep the charge and reopen the balance</option></select></label>}
 {form.mode==='rental'&&form.type!=='refund'&&can(me,'payments.refund')&&<label className="check"><input type="checkbox" checked={form.allowOverpayment} onChange={e=>setForm({...form,allowOverpayment:e.target.checked})}/>Approve an overpayment (reason required)</label>}
 <div className="bar"><button type="button" onClick={()=>setForm(null)} disabled={busy}>Cancel</button><button className="btn" disabled={busy}>{busy?'Saving…':'Save transaction'}</button></div></form>}
 {hasRentalItems&&<SecurityDeposit key={data._id} order={data} me={me} onSaved={async()=>{await load();onSaved?.();}}/>}
 {data.payments?.length>0&&<details className="desk-actions"><summary>Payment history</summary><ResponsiveTable><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Method / reference</th></tr></thead><tbody>{data.payments.map(p=><tr key={p._id}><td>{new Date(p.paidAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</td><td>{labels[p.type]||p.type}</td><td>{p.type==='refund'?'-':''}{lkr(p.amount)}</td><td>{[p.method,p.reference].filter(Boolean).join(' · ')}</td></tr>)}</tbody></ResponsiveTable></details>}
 <details className="desk-actions"><summary>Invoices and sharing</summary>{data.invoices.map(i=><div className="notice" key={i._id}><b>{i.invoiceNo}</b> · {i.status} · {lkr(i.total)}<div className="bar"><button onClick={()=>pdf(i)}>PDF / print</button>{i.status!=='void'&&<><button onClick={()=>sendInvoiceWhatsApp(i._id)}>WhatsApp</button>{settings?.emailConfigured&&<button onClick={()=>api(`/invoices/${i._id}/email`,{method:'POST'}).catch(e=>setError(e.message))}>Email PDF</button>}</>}</div>{i.status==='issued'&&can(me,'payments.refund')&&<details className="desk-actions"><summary>More invoice actions</summary><button onClick={()=>{if(confirm('Void this invoice? Payment records are kept.'))api(`/invoices/${i._id}/void`,{method:'PATCH'}).then(load).catch(e=>setError(e.message));}}>Void invoice</button></details>}</div>)}
 {!data.invoices.some(i=>i.status!=='void')&&data.status!=='cancelled'&&can(me,'payments.record')&&<button onClick={()=>api('/invoices',{method:'POST',body:{order:id,requestId:crypto.randomUUID()}}).then(load).catch(e=>setError(e.message))}>Create invoice</button>}
 </details>
 {data.emailHistory?.length>0&&<details className="desk-actions"><summary>Customer emails</summary>
  {data.emailHistory.map(row=><p key={row._id}><b>{emailLabels[row.event]}</b> · {new Date(row.createdAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}<br/>{emailStatusMessage(row.status)}</p>)}
  {data.canRetryBookingEmail&&<button onClick={retryBookingEmail} disabled={busy}>Retry booking confirmation</button>}
 </details>}
 </>}
 </div></div>;
}
