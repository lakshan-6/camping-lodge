import { useState } from 'react';
import { api } from '../api.js';
import { PhoneInput, NicInput } from '../components/ContactInputs.jsx';

// Completes a WhatsApp pre-booking customer's details when they arrive at the shop
export default function CustomerDetails({ customer, onClose, onSaved }) {
  const [f, setF] = useState({ name: /^WhatsApp /.test(customer.name) ? '' : customer.name, phone: customer.phone,
    nic: customer.nic || '', email: customer.email || '', address: customer.address || '' });
  const [err, setErr] = useState('');
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api('/customers/' + customer._id, { method: 'PUT', body: f }); onSaved(); } catch (x) { setErr(x.message); }
  }
  return (
    <div className="modal" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={save}>
        <h2>Customer details</h2>
        <label>Full name<input required value={f.name} onChange={set('name')} /></label>
        <label>Phone / WhatsApp<PhoneInput required value={f.phone} onChange={phone => setF({ ...f, phone })} /></label>
        <label>NIC<NicInput required value={f.nic} onChange={nic => setF({ ...f, nic })} /></label>
        <label>Email (invoices are sent here)<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Address<input value={f.address} onChange={set('address')} /></label>
        {err && <p className="bad">{err}</p>}
        <div className="row end"><button type="button" onClick={onClose}>Cancel</button><button className="btn">Save details</button></div>
      </form>
    </div>
  );
}
