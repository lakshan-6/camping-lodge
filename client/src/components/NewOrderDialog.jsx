import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import { businessISO } from '../businessTime.js';
import { can } from '../permissions.js';
import CustomerDetails from '../pages/CustomerDetails.jsx';
import { NicInput, PhoneInput } from './ContactInputs.jsx';

const newLine = () => ({ key: crypto.randomUUID(), equipment: '', quantity: 1 });
const emptyCustomer = { nic: '', name: '', phone: '', email: '', address: '' };
const validNic = value => /^(\d{12}|\d{9}[VX])$/i.test(value || '');
const validPhone = value => /^\d{10,15}$/.test(value || '');
const contactKey = c => validNic(c.nic) ? `${c.nic.toUpperCase()}:${validPhone(c.phone) ? c.phone : ''}` : '';
const complete = c => !!c?.name?.trim() && !c.detailsPending && validNic(c.nic) && validPhone(c.phone);
const Required = () => <span aria-hidden="true" className="required-mark"> *</span>;

export default function NewOrderDialog({ me, onClose, onSaved, draft }) {
  const canWriteCustomers = can(me, 'customers.write');
  const [customer, setCustomer] = useState(emptyCustomer);
  const [lookup, setLookup] = useState(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [confirmDifferent, setConfirmDifferent] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [start, setStart] = useState(draft?.start??''), [end, setEnd] = useState(draft?.end??'');
  const [lines, setLines] = useState(() => [{...newLine(),...draft?.item}]);
  const [availability, setAvailability] = useState(null);
  const [advance, setAdvance] = useState(''), [advanceMethod, setAdvanceMethod] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false), [error, setError] = useState('');

  const lookupKey = contactKey(customer);
  useEffect(() => {
    if (!lookupKey) return;
    let active = true;
    const [nic, phone] = lookupKey.split(':');
    const params = new URLSearchParams({ nic, phone });
    const timer = setTimeout(() => {
      api('/customers/matches?' + params)
        .then(matches => { if (active) setLookup({ key: lookupKey, matches }); })
        .catch(() => { if (active) setLookup({ key: lookupKey, failed: true }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [lookupKey, lookupAttempt]);

  const range = start && end && start < end ? `${start}/${end}` : '';
  useEffect(() => {
    if (!range) return;
    let active = true;
    const params = new URLSearchParams({ start: businessISO(start), end: businessISO(end) });
    api('/availability?' + params).then(data => { if (active) setAvailability({ range, ...data }); })
      .catch(e => { if (active) setAvailability({ range, error: e.message }); });
    return () => { active = false; };
  }, [range, start, end]);

  const dates = availability?.range === range ? availability : null;
  const items = dates?.items || [];
  const chosen = lines.map(line => items.find(i => i._id === line.equipment));
  const itemsReady = !!dates?.items && lines.every((l, i) => chosen[i] && Number.isInteger(+l.quantity) && +l.quantity >= 1 && +l.quantity <= chosen[i].available);
  const total = Math.round(chosen.reduce((sum, item, i) => sum + (item ? item.periodRate * (+lines[i].quantity || 0) * dates.periods : 0), 0) * 100) / 100;
  const lookupResult = lookup?.key === lookupKey ? lookup : null;
  const existing = lookupResult?.matches?.find(c => c.nic?.toUpperCase() === customer.nic.toUpperCase());
  const incompleteMatches = existing ? [] : lookupResult?.matches?.filter(c => !c.nic?.trim()) || [];
  const contact = existing || customer;
  const customerReady = !!lookupResult?.matches && (existing ? complete(existing) : canWriteCustomers && (!incompleteMatches.length || confirmDifferent));
  const setField = (key, value) => {
    const next = { ...customer, [key]: value };
    setCustomer(next);
    if (contactKey(next) !== lookupKey) { setLookup(null); setConfirmDifferent(false); }
  };
  const setLine = (key, values) => setLines(old => old.map(l => l.key === key ? { ...l, ...values } : l));
  const close = () => { if (!saving) onClose(); };

  async function save(e) {
    e.preventDefault();
    if (saving || !itemsReady || !customerReady) return;
    if (!complete(contact)) { setError('Enter a valid NIC, full name and phone number.'); return; }
    setSaving(true); setError('');
    try {
      const saved = await api('/orders', { method: 'POST', body: {
        customerDetails: { nic: customer.nic, name: contact.name, phone: contact.phone,
          email: contact.email, address: contact.address, confirmDifferentPerson: confirmDifferent },
        startDate: businessISO(start), endDate: businessISO(end),
        items: lines.map(({ equipment, quantity }) => ({ equipment, quantity: Number(quantity) })),
        requestId,
        advance: { amount: Number(advance), method: advanceMethod }
      } });
      onSaved(saved);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  return <>
    <div className="modal" onClick={close}>
      <form className="new-order-form" aria-labelledby="new-order-title" onClick={e => e.stopPropagation()} onSubmit={save}>
        <header><h2 id="new-order-title">New order</h2></header>
        <fieldset className="new-order-section" disabled={saving}>
          <legend>Order details</legend>
          <div className="new-order-grid">
            <label><span>Pickup date &amp; time<Required/></span><input required type="datetime-local" value={start} onChange={e => { setStart(e.target.value); setAvailability(null); }} /></label>
            <label><span>Return date &amp; time<Required/></span><input required type="datetime-local" value={end} onChange={e => { setEnd(e.target.value); setAvailability(null); }} /></label>
          </div>
          <p>Sri Lanka time. Each rental period is 36 hours.</p>
          {!range && <p>{start && end ? 'Return must be after pickup.' : 'Choose pickup and return times to check available items.'}</p>}
          {range && !dates && <p role="status">Checking available items…</p>}
          {dates?.error && <p className="bad" role="alert">{dates.error}</p>}
          <div className="lines">
            {lines.map((line, i) => <div className="line new-order-line" key={line.key}>
              <label><span>{i === 0 ? 'Choose item' : `Item ${i + 1}`}<Required/></span><select required disabled={!dates?.items} value={line.equipment} onChange={e => setLine(line.key, { equipment: e.target.value, quantity: 1 })}>
                <option value="">Select equipment</option>
                {line.equipment && !chosen[i] && <option value={line.equipment} disabled>Unavailable for these dates</option>}
                {items.map(item => <option key={item._id} value={item._id} disabled={item.available < 1 || lines.some(l => l.key !== line.key && l.equipment === item._id)}>{item.name} ({item.available} free) · {lkr(item.periodRate)} / 36h</option>)}
              </select></label>
              <label>Quantity<input required aria-label={`Quantity for item ${i + 1}`} type="number" min={1} max={chosen[i]?.available || undefined} step={1} disabled={!chosen[i]} value={line.quantity} onChange={e => setLine(line.key, { quantity: e.target.value })} /></label>
              {lines.length > 1 && <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setLines(old => old.filter(l => l.key !== line.key))}>Remove</button>}
            </div>)}
            <button type="button" disabled={!itemsReady || lines.length >= 100 || !items.some(item => item.available > 0 && !lines.some(l => l.equipment === item._id))} onClick={() => setLines(old => [...old, newLine()])}>Add item</button>
            {itemsReady && <p className="new-order-total">Rental total <strong>{lkr(total)}</strong> · {dates.periods} × 36h</p>}
          </div>
        </fieldset>

        <fieldset className="new-order-section" disabled={saving}>
          <legend>Customer details</legend>
          <div className="new-order-grid">
            <label><span>NIC<Required/></span><NicInput required value={customer.nic} onChange={v => setField('nic', v)} /></label>
            <label><span>Full name<Required/></span><input required readOnly={!!existing} autoComplete="name" value={contact.name} onChange={e => setField('name', e.target.value)} /></label>
            <label><span>Phone number<Required/></span><PhoneInput required readOnly={!!existing} value={contact.phone} onChange={v => setField('phone', v)} /></label>
          </div>
          <details className="desk-actions" onInvalid={e=>{e.currentTarget.open=true;}}>
            <summary>Email and address (optional)</summary>
            <div className="new-order-grid">
            <label>Email address (optional)<input readOnly={!!existing} type="email" autoComplete="email" value={contact.email || ''} onChange={e => setField('email', e.target.value)} /></label>
            <label className="new-order-wide">Address (optional)<textarea rows={2} readOnly={!!existing} autoComplete="street-address" value={contact.address || ''} onChange={e => setField('address', e.target.value)} /></label>
            </div>
          </details>
          {lookupKey && !lookupResult && <p role="status">Checking customer NIC…</p>}
          {lookupResult?.failed && <div className="notice"><p className="bad" role="alert">Could not check the customer.</p><button type="button" onClick={() => { setLookup(null); setLookupAttempt(n => n + 1); }}>Try again</button></div>}
          {existing && <>
            <p role="status">Existing customer found. Their saved details are filled in.</p>
            {!complete(existing) && <p>Complete their required details before booking.{!canWriteCustomers && ' Ask someone with customer editing access to update their profile.'}</p>}
            {canWriteCustomers && <button type="button" onClick={() => setEditingCustomer(existing)}>{complete(existing) ? 'Edit customer details' : 'Complete customer details'}</button>}
          </>}
          {!existing && !!lookupResult?.matches && !canWriteCustomers && <p role="status">No customer found with this NIC. Ask someone with customer editing access to add them.</p>}
          {!existing && canWriteCustomers && incompleteMatches.length > 0 && <div className="notice">
            <p>This phone number matches a profile without an NIC. If it is the same person, complete their profile.</p>
            {incompleteMatches.map(c => <p key={c._id}><button type="button" onClick={() => setEditingCustomer({ ...c, nic: customer.nic })}>Complete details for {c.name}</button></p>)}
            <label className="check"><input type="checkbox" checked={confirmDifferent} onChange={e => setConfirmDifferent(e.target.checked)} /> This is a different person</label>
          </div>}
          {!existing && canWriteCustomers && customerReady && <p role="status">New customer. Their details will be saved when you create the order.</p>}
        </fieldset>

        <fieldset className="new-order-section" disabled={saving}>
          <legend>Rental advance<Required/></legend>
          <div className="new-order-grid">
            <label><span>Advance received (LKR)<Required/></span><input required type="number" min="0.01" max={itemsReady ? total : undefined} step="0.01" value={advance} onChange={e => setAdvance(e.target.value)} /></label>
            <label><span>Payment method<Required/></span><select required value={advanceMethod} onChange={e => setAdvanceMethod(e.target.value)}><option value="">Choose payment method</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
          </div>
          {itemsReady&&<p>Balance after advance <strong>{lkr(Math.max(0,total-Number(advance)))}</strong></p>}
        </fieldset>
        {error && <p className="bad" role="alert">{error}</p>}
        <div className="row end"><button type="button" disabled={saving} onClick={close}>Cancel</button><button className="btn" disabled={saving || !itemsReady || !customerReady}>{saving ? 'Saving…' : 'Create order'}</button></div>
      </form>
    </div>
    {editingCustomer && <CustomerDetails customer={editingCustomer} onClose={() => setEditingCustomer(null)} onSaved={c => {
      const next = { ...customer, nic: c.nic };
      setCustomer(next); setLookup({ key: contactKey(next), matches: [c] }); setConfirmDifferent(false); setEditingCustomer(null); setError('');
    }} />}
  </>;
}
