import {businessISO,businessInput} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import CustomerDetails from './CustomerDetails.jsx';
import EditOrder from './EditOrder.jsx';
import { PhoneInput, NicInput } from '../components/ContactInputs.jsx';
import CustomerMatches from '../components/CustomerMatches.jsx';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import { can } from '../permissions.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { timeZone:'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });
const periodsOf = (s, e) => Math.max(1, Math.ceil((new Date(e) - new Date(s)) / (36 * 3600 * 1000)));
const blank = { customer: '', cq: '', newCust: false, pre: false, advance: '', advMethod: 'bank_transfer', nc: { name: '', phone: '', nic: '', email: '' }, start: '', end: '', lines: [{ equipment: '', quantity: 1 }] };

export default function Orders({ me }) {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [avail, setAvail] = useState([]);
  const [form, setForm] = useState(null);
  const [details, setDetails] = useState(null);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');
  const [pastDelete, setPastDelete] = useState(null);
  const [accessKey, setAccessKey] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletePreview, setDeletePreview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [workspace,setWorkspace] = useState(null);
  const [cancelling,setCancelling] = useState(null);
  const [saving,setSaving] = useState(false);
  useEffect(() => {
    if (!pastDelete) return;
    let active = true;
    api(`/orders/${pastDelete._id}/past-delete-preview`).then(data => { if (active) setDeletePreview(data); })
      .catch(x => { if (active) setDeleteError(x.message); });
    return () => { active = false; };
  }, [pastDelete?._id]);
  const closePastDelete = () => { if (!deleting) { setPastDelete(null); setAccessKey(''); setDeleteError(''); setConfirmation(''); setDeletePreview(null); } };
  const load = () => api('/orders' + (showDeleted ? '?deleted=true' : '')).then(setOrders).catch(e => setErr(e.message));
  useEffect(() => { load(); }, [showDeleted]);
  useEffect(() => { api('/customers').then(setCustomers); }, []);

  const ready = form && form.start && form.end && new Date(form.start) < new Date(form.end);
  useEffect(() => {
    if (!ready) return setAvail([]);
    const p = new URLSearchParams({ start: businessISO(form.start), end: businessISO(form.end) });
    api('/availability?' + p).then(d => setAvail(d.items)).catch(e => setErr(e.message));
  }, [form?.start, form?.end]);

  const periods = ready ? periodsOf(form.start, form.end) : 0;
  const total = !ready ? 0 : form.lines.reduce((s, l) => {
    const a = avail.find(x => x._id === l.equipment); return s + (a ? a.periodRate * l.quantity * periods : 0);
  }, 0);
  const cq = (form?.cq || '').toLowerCase();
  const matches = customers.filter(c => !cq || [c.name, c.phone, c.nic].some(v => (v || '').toLowerCase().includes(cq)));
  const mode = !form ? 'existing' : form.newCust ? (form.pre ? 'pre' : 'new') : 'existing';
  const setNc = (k, v) => setForm({ ...form, nc: { ...form.nc, [k]: v } });
  const setLine = (i, k, v) => setForm({ ...form, lines: form.lines.map((l, j) => j === i ? { ...l, [k]: v } : l) });

  async function save(e) {
    e.preventDefault(); if(saving)return;setSaving(true);setErr('');
    try {
      let customer = form.customer;
      if (form.newCust) { const c = await api('/customers', { method: 'POST', body: { ...form.nc, preBooking: form.pre, confirmDifferentPerson:form.confirmDifferentPerson,requestId:form.customerRequestId } }); customer = c._id; setCustomers([...customers.filter(x=>x._id!==c._id), c]); }
      await api('/orders', { method: 'POST', body: { customer, startDate: businessISO(form.start),
        endDate: businessISO(form.end), items: form.lines.filter(l => l.equipment), advance: { amount: +form.advance || 0, method: form.advMethod },requestId:form.requestId } });
      setForm(null); load();
    } catch (x) { setErr(x.message); } finally { setSaving(false); }
  }
  async function cancel(o) {
    setCancelling({order:o,action:'pending',method:'cash',reason:'',requestId:crypto.randomUUID()});
  }
  async function remove(o) {
    if (!confirm(`Delete booking ${o.orderNo}? It will be removed from Orders and the calendar, and its reserved stock will be released. Any payments already recorded will be kept; refunds must be recorded separately.`)) return;
    try { await api(`/orders/${o._id}`, { method: 'DELETE' }); load(); } catch (x) { setErr(x.message); }
  }
  async function removePast(e) {
    e.preventDefault();
    if (deleting) return;
    setDeleting(true); setDeleteError('');
    try {
      await api(`/orders/${pastDelete._id}/past`, { method: 'DELETE', body: { accessKey, confirmation } });
      setPastDelete(null); setAccessKey(''); setConfirmation(''); setDeletePreview(null); load();
    } catch (x) { setDeleteError(x.message); }
    finally { setDeleting(false); }
  }
  function openPastDelete(o) {
    setPastDelete(o); setAccessKey(''); setConfirmation(''); setDeleteError(''); setDeletePreview(null);
  }

  return (
    <>
      <div className="bar">{can(me,'orders.write')&&<button className="btn" onClick={() => { setErr(''); setForm({...blank,requestId:crypto.randomUUID(),customerRequestId:crypto.randomUUID()}); }}>New order</button>}
        {me?.role === 'owner' && <label className="check"><input type="checkbox" checked={showDeleted} onChange={e => setShowDeleted(e.target.checked)} /> Previously hidden past orders</label>}
      </div>
      {err && !form && <p className="bad">{err}</p>}
      {orders.length === 0 ? <div className="empty"><h2>No orders yet</h2><p>Create an order after adding a customer and some equipment.</p></div> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Return</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>{orders.map(o => (
            <tr key={o._id}>
              <td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}{o.customer?.detailsPending && <><br /><span className="tag fair">Details pending</span></>}</td>
              <td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Return">{fmt(o.endDate)}</td>
              <td data-l="Items">{o.items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ')}</td>
              <td data-l="Total">{lkr(o.totalAmount)}<small>{o.periods}× 36h</small></td>
              <td data-l="Status"><span className={'tag ' + (o.status === 'cancelled' ? 'needs_repair' : '')}>{o.status}</span></td>
              <td className="acts"><button onClick={()=>setWorkspace(o._id)}>View order</button>{o.customer?.detailsPending && can(me,'customers.write') && <button onClick={() => setDetails(o.customer)}>Add details</button>}{o.status === 'reserved' && can(me,'orders.write') && <><button onClick={() => setEditing(o)}>Change items</button><button onClick={() => cancel(o)}>Cancel</button></>}{['reserved', 'cancelled'].includes(o.status) && can(me,'orders.write') && <button onClick={() => remove(o)}>Remove booking</button>}{o.status === 'completed' && me?.role === 'owner' && <button onClick={() => openPastDelete(o)}>Delete past order</button>}</td>
            </tr>))}</tbody>
        </table></div>)}
      {editing && <EditOrder order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {workspace&&<OrderWorkspace id={workspace} me={me} onClose={()=>setWorkspace(null)} onSaved={load}/>}
      {cancelling&&<div className="modal"><form onSubmit={async e=>{e.preventDefault();if(saving)return;setSaving(true);try{await api(`/orders/${cancelling.order._id}/cancel`,{method:'PATCH',body:cancelling});setCancelling(null);load();}catch(x){setErr(x.message);}finally{setSaving(false);}}}><h2>Cancel {cancelling.order.orderNo}</h2><p>No bank transfer is made by this form. Choose what actually happened to the advance.</p><label>Advance payment action<select value={cancelling.action} onChange={e=>setCancelling({...cancelling,action:e.target.value})}><option value="pending">Refund pending</option>{can(me,'payments.refund')&&<><option value="refund">Refund has been paid to customer</option><option value="keep">Keep advance as agreed cancellation fee</option></>}</select></label><label>Reason<input required value={cancelling.reason} onChange={e=>setCancelling({...cancelling,reason:e.target.value})}/></label><label>Refund method<select value={cancelling.method} onChange={e=>setCancelling({...cancelling,method:e.target.value})}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>{err&&<p className="bad">{err}</p>}<div className="bar"><button type="button" disabled={saving} onClick={()=>setCancelling(null)}>Close</button><button className="btn" disabled={saving}>Confirm cancellation</button></div></form></div>}
      {details && <CustomerDetails customer={details} onClose={() => setDetails(null)} onSaved={() => { setDetails(null); load(); api('/customers').then(setCustomers); }} />}
      {pastDelete && (
        <div className="modal" onClick={closePastDelete}>
          <form onClick={e => e.stopPropagation()} onSubmit={removePast}>
            <h2>Permanently delete {pastDelete.orderNo}</h2>
            <p className="bad">This permanently deletes the order and its payments, invoices, rental, returns and stock transaction history. This cannot be undone. Revenue and report totals will change.</p>
            <p>The customer and equipment remain. Physical stock quantities stay unchanged. Deletion does not refund money or remove PDFs already downloaded or sent.</p>
            {!deletePreview && !deleteError && <p>Loading records to be deleted…</p>}
            {deletePreview && <div className="card">
              <p>Order total: <b>{lkr(deletePreview.totalAmount)}</b> · Net recorded payments: <b>{lkr(deletePreview.netPayments)}</b></p>
              <p>{deletePreview.counts.orderItems} order items · {deletePreview.counts.payments} payments · {deletePreview.counts.invoices} invoices</p>
              <p>{deletePreview.counts.rentals} rentals · {deletePreview.counts.returns} returns · {deletePreview.counts.returnItems} return items · {deletePreview.counts.stockTransactions} stock transactions · {deletePreview.counts.securityDeposits||0} deposit entries</p>
            </div>}
            <label>Owner delete access key (12–128 characters)<input required autoFocus type="password" autoComplete="off" minLength={12} maxLength={128}
              value={accessKey} onChange={e => setAccessKey(e.target.value)} disabled={deleting} /></label>
            <label>Type {pastDelete.orderNo} to confirm<input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={deleting} /></label>
            {deleteError && <p className="bad" role="alert">{deleteError}</p>}
            <div className="row end"><button type="button" disabled={deleting} onClick={closePastDelete}>Cancel</button>
              <button className="btn" disabled={deleting || !deletePreview || !accessKey.trim() || confirmation !== pastDelete.orderNo}>{deleting ? 'Deleting…' : 'Delete permanently'}</button></div>
          </form>
        </div>
      )}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>New order</h2>
            <div className="custbox">
              <div className="row3">
                {[['existing', 'Existing'], ...(can(me,'customers.write')?[['new', 'New customer'], ['pre', 'WhatsApp pre-booking']]:[])].map(([m, l]) => (
                  <button type="button" key={m} className={mode === m ? 'btn' : ''} onClick={() => setForm({ ...form, newCust: m !== 'existing', pre: m === 'pre' })}>{l}</button>))}
              </div>
              {mode === 'existing' ? <>
                <label>Search (name, phone or NIC)<input value={form.cq} onChange={e => setForm({ ...form, cq: e.target.value })} /></label>
                <select required value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })}>
                  <option value="">Choose customer ({matches.length})</option>
                  {matches.map(c => <option key={c._id} value={c._id}>{c.name} · {c.phone}{c.nic ? ' · ' + c.nic : ''}</option>)}</select></> : <>
                {mode === 'pre' && <p className="hint">For bookings made on WhatsApp. Only the WhatsApp number is needed now. Add the full details when the customer comes to the shop.</p>}
                <label>{mode === 'pre' ? 'WhatsApp number' : 'Phone'}<PhoneInput required value={form.nc.phone} onChange={v => setNc('phone', v)} /></label>
                <CustomerMatches phone={form.nc.phone} nic={form.nc.nic} onChoose={c=>{setCustomers([...customers.filter(x=>x._id!==c._id),c]);setForm({...form,customer:c._id,newCust:false,pre:false});}} confirmDifferent={form.confirmDifferentPerson} onConfirmDifferent={v=>setForm({...form,confirmDifferentPerson:v})}/>
                <label>Name{mode === 'pre' ? ' (optional)' : ''}<input required={mode !== 'pre'} value={form.nc.name} onChange={e => setNc('name', e.target.value)} /></label>
                <div className="row">
                  {mode !== 'pre' && <label>NIC<NicInput value={form.nc.nic} onChange={v => setNc('nic', v)} /></label>}
                  <label>Email (invoice is sent here)<input type="email" value={form.nc.email} onChange={e => setNc('email', e.target.value)} /></label>
                </div></>}
            </div>
            <div className="row">
              <label>Pickup (Sri Lanka time)<input required type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} /></label>
              <label>Return (Sri Lanka time)<input required type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} /></label>
            </div>
            {ready ? <p>{periods} rental period{periods > 1 ? 's' : ''} (36 hours each)</p> : <p>Choose pickup and return times to see available items.</p>}
            {ready && <div className="lines">
              {form.lines.map((l, i) => (
                <div className="line" key={i}>
                  <select value={l.equipment} onChange={e => setLine(i, 'equipment', e.target.value)}>
                    <option value="">Choose item</option>
                    {avail.map(a => <option key={a._id} value={a._id} disabled={a.available < 1}>{a.name} ({a.available} free) · {lkr(a.periodRate)}</option>)}</select>
                  <input type="number" min="1" value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value)} />
                  <button type="button" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>Remove</button>
                </div>))}
              <button type="button" onClick={() => setForm({ ...form, lines: [...form.lines, { equipment: '', quantity: 1 }] })}>Add item</button>
              <p><b>Total: {lkr(total)}</b></p>
              <div className="row">
                {can(me,'payments.record')&&<label>Rental advance paid (LKR, optional)<input type="number" min="0" step="0.01" value={form.advance} onChange={e => setForm({ ...form, advance: e.target.value })} /></label>}
                <label>Paid by<select value={form.advMethod} onChange={e => setForm({ ...form, advMethod: e.target.value })}>
                  <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
              </div>
            </div>}
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" disabled={saving} onClick={() => setForm(null)}>Cancel</button><button className="btn" disabled={!ready||saving}>{saving?'Saving…':'Create order'}</button></div>
          </form>
        </div>)}
    </>
  );
}
