import { useState } from 'react';
import { api } from '../api.js';
import { PhoneInput, NicInput } from '../components/ContactInputs.jsx';

// Edit the details of a returning customer or complete a prior booking's contact record.
export default function CustomerDetails({ customer, onClose, onSaved }) {
  const [f, setF] = useState({ name: /^WhatsApp /.test(customer.name) ? '' : customer.name, phone: customer.phone,
    nic: customer.nic || '', email: customer.email || '', address: customer.address || '', ...(customer.notes === undefined ? {} : { notes: customer.notes }) });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const close = () => { if (!saving) onClose(); };
  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErr('');
    try { onSaved(await api('/customers/' + customer._id, { method: 'PUT', body: f })); }
    catch (x) { setErr(x.message); }
    finally { setSaving(false); }
  }
  return (
    <div className="modal" onClick={close}>
      <form onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>Customer details</h2>
        <label>Full name<input required disabled={saving} value={f.name} onChange={set('name')} /></label>
        <label>Phone / WhatsApp<PhoneInput required disabled={saving} value={f.phone} onChange={phone => setF({ ...f, phone })} /></label>
        <label>NIC<NicInput required disabled={saving} value={f.nic} onChange={nic => setF({ ...f, nic })} /></label>
        <label>Email (optional)<input type="email" disabled={saving} value={f.email} onChange={set('email')} /></label>
        <label>Address (optional)<input disabled={saving} value={f.address} onChange={set('address')} /></label>
        {err && <p className="bad" role="alert">{err}</p>}
        <div className="row end"><button type="button" disabled={saving} onClick={close}>Cancel</button><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button></div>
      </form>
    </div>
  );
}
