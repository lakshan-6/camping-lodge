import ResponsiveTable from '../components/ResponsiveTable.jsx';
import { useEffect, useState, useRef } from 'react';
import { api, lkr } from '../api.js';
import CustomerDetails from './CustomerDetails.jsx';
import EditOrder from './EditOrder.jsx';
import NewOrderDialog from '../components/NewOrderDialog.jsx';
import OrderWorkspace from '../components/OrderWorkspace.jsx';
import { can } from '../permissions.js';
import {PageIntro,EmptyState} from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';

const fmt = d => new Date(d).toLocaleString('en-LK', { timeZone:'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });
const emailNotes = {
  accepted: 'The booking confirmation was sent for delivery.',
  no_email: 'No confirmation email was sent because this customer has no email address.',
  invalid_email: 'No confirmation email was sent because the customer’s email address is invalid.',
  not_configured: 'Confirmation email is not set up yet.',
  failed: 'Email delivery could not be confirmed. Check the sending account before sending again.',
  already_processed: 'This booking was already saved. No duplicate email was sent.',
};

export default function Orders({ me }) {
  const [orders, setOrders] = useState([]);
  const [creating, setCreating] = useState(false);
  const [bookingNotice, setBookingNotice] = useState('');
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
  const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[totalRows,setTotalRows]=useState(0),[loading,setLoading]=useState(true);
  const requestSequence=useRef(0);
  useEffect(() => {
    if (!pastDelete) return;
    let active = true;
    api(`/orders/${pastDelete._id}/past-delete-preview`).then(data => { if (active) setDeletePreview(data); })
      .catch(x => { if (active) setDeleteError(x.message); });
    return () => { active = false; };
  }, [pastDelete?._id]);
  const closePastDelete = () => { if (!deleting) { setPastDelete(null); setAccessKey(''); setDeleteError(''); setConfirmation(''); setDeletePreview(null); } };
  const load=()=>{const sequence=++requestSequence.current;setLoading(true);const params=new URLSearchParams({paged:'true',page:String(page),pageSize:String(pageSize),q:search,status,from,to,deleted:String(showDeleted)});return api('/orders?'+params).then(d=>{if(sequence!==requestSequence.current)return;setOrders(d.rows);setTotalRows(d.total);setErr('');const max=Math.max(1,Math.ceil(d.total/pageSize));if(page>max)setPage(max);}).catch(e=>{if(sequence===requestSequence.current)setErr(e.message);}).finally(()=>{if(sequence===requestSequence.current)setLoading(false);});};
  useEffect(()=>{setLoading(true);const timer=setTimeout(load,250);return()=>{clearTimeout(timer);requestSequence.current++;};},[showDeleted,search,status,from,to,page,pageSize]);
  async function cancel(o) {
    setCancelling({order:o,action:'pending',method:'cash',reason:'',requestId:crypto.randomUUID()});
  }
  async function remove(o) {
    if (!confirm(`Hide booking ${o.orderNo} from the list and calendar? Reserved stock will be released. Bookings with unresolved money must be cancelled and settled first.`)) return;
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
      <PageIntro eyebrow="Bookings & rentals" title="The next adventure starts here." description="Create bookings, find an existing order and keep every pickup and return on schedule."/>
      <div className="bar">{can(me,'orders.write')&&(can(me,'payments.record')?<button className="btn" onClick={() => { setErr(''); setBookingNotice(''); setCreating(true); }}><Icon name="plus" size={17}/>New order</button>:<p>Ask someone with payment recording access to create the order and record the advance.</p>)}
        {me?.role === 'owner' && <label className="check"><input type="checkbox" checked={showDeleted} onChange={e => {setShowDeleted(e.target.checked);setStatus('');setPage(1);}} /> Previously hidden past orders</label>}
      </div>
      <div className="bar filter-panel"><label>Search orders<input type="search" placeholder="Order no., customer, phone or NIC" maxLength={80} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><label>Status<select value={status} disabled={showDeleted} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{['reserved','active','completed','cancelled'].map(s=><option key={s} value={s}>{s}</option>)}</select></label><label>Pickup from<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></label><label>Pickup to<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></label><button onClick={()=>{setSearch('');setStatus('');setFrom('');setTo('');setPage(1);}}>Clear filters</button></div>
      {err && !creating && <p className="bad">{err}</p>}
      {bookingNotice && <div className="notice" role="status">{bookingNotice}</div>}
      {loading&&<p role="status">Loading orders…</p>}
      {orders.length === 0 ? <EmptyState title={loading?'Loading your orders…':'No matching orders'} description="Adjust the filters or create a new order to get started."/> : (
        <div className="tablewrap"><ResponsiveTable>
          <thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Return</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>{orders.map(o => (
            <tr key={o._id}>
              <td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}{o.customer?.detailsPending && <><br /><span className="tag fair">Details pending</span></>}</td>
              <td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Return">{fmt(o.endDate)}</td>
              <td data-l="Items">{o.items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ')}</td>
              <td data-l="Total">{lkr(o.totalAmount)}<small>{o.periods}× 36h</small></td>
              <td data-l="Status"><span className={'tag ' + (o.status === 'cancelled' ? 'needs_repair' : '')}>{o.status}</span></td>
              <td className="acts"><button onClick={()=>setWorkspace(o._id)}>View order</button>{o.customer?.detailsPending && can(me,'customers.write') && <button onClick={() => setDetails(o.customer)}>Add details</button>}{o.status === 'reserved' && can(me,'orders.write') && <><button onClick={() => setEditing(o)}>Change items</button><button onClick={() => cancel(o)}>Cancel booking</button></>}{['reserved', 'cancelled'].includes(o.status) && can(me,'orders.write') && <button onClick={() => remove(o)}>Hide from list</button>}{o.status === 'completed' && me?.role === 'owner' && <button onClick={() => openPastDelete(o)}>Delete permanently</button>}</td>
            </tr>))}</tbody>
        </ResponsiveTable></div>)}
      <div className="bar"><span>{totalRows} matching orders · Page {page} of {Math.max(1,Math.ceil(totalRows/pageSize))}</span><button disabled={loading||page<=1} onClick={()=>setPage(page-1)}>Previous</button><button disabled={loading||page*pageSize>=totalRows} onClick={()=>setPage(page+1)}>Next</button><label>Per page<select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label></div>
      {editing && <EditOrder order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {workspace&&<OrderWorkspace id={workspace} me={me} onClose={()=>setWorkspace(null)} onSaved={load} showPaymentActions={false}/>}
      {cancelling&&<div className="modal"><form onSubmit={async e=>{e.preventDefault();if(saving)return;setSaving(true);try{await api(`/orders/${cancelling.order._id}/cancel`,{method:'PATCH',body:cancelling});setCancelling(null);load();}catch(x){setErr(x.message);}finally{setSaving(false);}}}><h2>Cancel {cancelling.order.orderNo}</h2><p>No bank transfer is made by this form. Choose what actually happened to the advance.</p><label>Advance payment action<select value={cancelling.action} onChange={e=>setCancelling({...cancelling,action:e.target.value})}><option value="pending">Refund pending</option>{can(me,'payments.refund')&&<><option value="refund">Refund has been paid to customer</option><option value="keep">Keep advance as agreed cancellation fee</option></>}</select></label><label>Reason<input required value={cancelling.reason} onChange={e=>setCancelling({...cancelling,reason:e.target.value})}/></label><label>Refund method<select value={cancelling.method} onChange={e=>setCancelling({...cancelling,method:e.target.value})}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>{err&&<p className="bad">{err}</p>}<div className="bar"><button type="button" disabled={saving} onClick={()=>setCancelling(null)}>Close</button><button className="btn" disabled={saving}>Confirm cancellation</button></div></form></div>}
      {details && <CustomerDetails customer={details} onClose={() => setDetails(null)} onSaved={() => { setDetails(null); load(); }} />}
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
              <button className="btn btn-danger" disabled={deleting || !deletePreview || !accessKey.trim() || confirmation !== pastDelete.orderNo}>{deleting ? 'Deleting…' : 'Delete permanently'}</button></div>
          </form>
        </div>
      )}
      {creating && <NewOrderDialog me={me} onClose={() => setCreating(false)} onSaved={saved => { setBookingNotice(`${saved.orderNo} saved. ${emailNotes[saved.bookingEmail] || ''}`.trim()); setCreating(false); setPage(1); load(); }} />}
    </>
  );
}
