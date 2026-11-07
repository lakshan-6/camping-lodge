import {useEffect,useState} from 'react';
import {api,getToken,lkr} from '../api.js';
import {can} from '../permissions.js';
import {sendInvoiceWhatsApp} from '../whatsapp.js';
const labels={deposit:'Rental advance',rental:'Rental payment',balance:'Rental balance',fee:'Extra charge',refund:'Refund to customer'};
export default function OrderWorkspace({id,me,onClose,onSaved}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[form,setForm]=useState(null),[busy,setBusy]=useState(false),[email,setEmail]=useState(false),[history,setHistory]=useState(null);
 const load=()=>api('/orders/'+id+'/detail').then(setData).catch(e=>setError(e.message));
 useEffect(()=>{load();api('/settings').then(s=>setEmail(s.emailConfigured));},[id]);
 const open=(mode,type)=>{setError('');setForm({mode,type,amount:mode==='security'?(type==='collect'?Math.max(0,data.depositAmount-data.securityHeld):data.securityHeld):type==='refund'?data.paid:Math.max(0,data.totalAmount-data.paid),method:'cash',reason:'',allowOverpayment:false,requestId:crypto.randomUUID()});};
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api(form.mode==='security'?'/payments/deposits':'/payments',{method:'POST',body:{...form,amount:Number(form.amount),order:id}});setForm(null);await load();onSaved?.();}catch(x){setError(x.message);}finally{setBusy(false);}}
 async function pdf(invoice){try{const r=await fetch(`/api/invoices/${invoice._id}/pdf`,{headers:{Authorization:'Bearer '+getToken()}});if(!r.ok)throw new Error('Could not open PDF');const url=URL.createObjectURL(await r.blob());window.open(url,'_blank');}catch(e){setError(e.message);}}
 return <div className="modal" onClick={()=>!busy&&onClose()}><div className="workspace" onClick={e=>e.stopPropagation()}>
 <div className="bar"><h2>{data?.orderNo||'Order details'}</h2><button onClick={onClose} disabled={busy}>Close</button></div>
 {error&&<p className="bad" role="alert">{error}</p>}
 {data&&<><p><b>{data.customer?.name}</b> · {data.customer?.phone} · {data.status}</p><div className="metric-row"><p>Rental total <b>{lkr(data.totalAmount)}</b></p><p>Rental payments <b>{lkr(data.paid)}</b></p><p>Rental balance <b>{lkr(data.status==='cancelled'?0:data.totalAmount-data.paid)}</b></p><p>Security deposit held <b>{lkr(data.securityHeld)}</b></p></div>
 <table><thead><tr><th>Item</th><th>Qty</th><th>Returned</th><th>Amount</th></tr></thead><tbody>{data.items.map(i=><tr key={i._id}><td>{i.equipment?.name}</td><td>{i.quantity}</td><td>{i.returnedQuantity||0}</td><td>{lkr(i.lineTotal)}</td></tr>)}</tbody></table>
 <h3>Payments and refundable security deposit</h3><p>These actions record money received or paid outside this system. They do not charge a card or make a bank transfer.</p><div className="bar">
 {can(me,'payments.record')&&data.status!=='cancelled'&&<><button onClick={()=>open('rental',data.paid===0?'deposit':'balance')}>Record rental payment</button><button onClick={()=>open('security','collect')}>Collect security deposit</button></>}
 {can(me,'payments.refund')&&<><button onClick={()=>open('rental','refund')} disabled={data.paid<=0}>Record rental refund</button><button onClick={()=>open('security','refund')} disabled={data.securityHeld<=0}>Refund security deposit</button><button onClick={()=>open('security','apply')} disabled={data.securityHeld<=0||data.status==='cancelled'}>Apply deposit to rental balance</button></>}
 {(can(me,'finance.view')||can(me,'payments.record')||can(me,'payments.refund'))&&<button onClick={()=>api('/payments/deposits/'+id).then(setHistory).catch(e=>setError(e.message))}>Deposit history</button>}
 </div>
 {history&&<div className="notice">{history.history.length===0?'No security deposit transactions yet.':history.history.map(h=><p key={h._id}>{h.type}: {lkr(h.amount)} · {h.reason||h.method}</p>)}</div>}
 {form&&<form className="card" onSubmit={save}><h3>{form.mode==='security'?'Security deposit: '+form.type:labels[form.type]}</h3><label>Amount (LKR)<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
 <label>Method<select value={form.method} onChange={e=>setForm({...form,method:e.target.value})}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="other">Other</option></select></label>
 <label>Reason / reference<input required={form.type==='refund'||form.type==='apply'||form.allowOverpayment} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
 {form.mode==='rental'&&form.type!=='refund'&&can(me,'payments.refund')&&<label className="check"><input type="checkbox" checked={form.allowOverpayment} onChange={e=>setForm({...form,allowOverpayment:e.target.checked})}/>Approve an overpayment (reason required)</label>}
 <div className="bar"><button type="button" onClick={()=>setForm(null)} disabled={busy}>Cancel</button><button className="btn" disabled={busy}>{busy?'Saving…':'Save transaction'}</button></div></form>}
 {data.payments?.length>0&&<><h3>Rental payment history</h3><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead><tbody>{data.payments.map(p=><tr key={p._id}><td>{new Date(p.paidAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</td><td>{labels[p.type]||p.type}</td><td>{p.type==='refund'?'-':''}{lkr(p.amount)}</td><td>{p.reference||p.method}</td></tr>)}</tbody></table></>}
 <h3>Invoices</h3>{data.invoices.map(i=><div className="notice" key={i._id}><b>{i.invoiceNo}</b> · {i.status} · {lkr(i.total)}<div className="bar"><button onClick={()=>pdf(i)}>PDF / print</button><button onClick={()=>sendInvoiceWhatsApp(i._id)}>WhatsApp</button>{email&&<button onClick={()=>api(`/invoices/${i._id}/email`,{method:'POST'}).catch(e=>setError(e.message))}>Email PDF</button>}{i.status!=='paid'&&i.status!=='void'&&can(me,'payments.refund')&&<button onClick={()=>{if(confirm('Void this invoice? Payment records are kept.'))api(`/invoices/${i._id}/void`,{method:'PATCH'}).then(load).catch(e=>setError(e.message));}}>Void invoice</button>}</div></div>)}
 {!data.invoices.some(i=>i.status!=='void')&&data.status!=='cancelled'&&can(me,'payments.record')&&<button onClick={()=>api('/invoices',{method:'POST',body:{order:id,requestId:crypto.randomUUID()}}).then(load).catch(e=>setError(e.message))}>Create invoice</button>}
 </>}
 </div></div>;
}
