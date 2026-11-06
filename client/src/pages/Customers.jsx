import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { PhoneInput, NicInput } from '../components/ContactInputs.jsx';

const blank = { name: '', phone: '', nic: '', email: '', address: '', notes: '' };

export default function Customers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api('/customers?q=' + encodeURIComponent(q)).then(setList).catch(e => setErr(e.message)); }, [q]);
  useEffect(load, [load]);
  const set = k => e => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      await (form._id ? api('/customers/' + form._id, { method: 'PUT', body: form }) : api('/customers', { method: 'POST', body: form }));
      setForm(null); load();
    } catch (x) { setErr(x.message); }
  }
  return (
    <>
      <div className="bar">
        <input placeholder="Search name, phone or NIC" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn" onClick={() => { setErr(''); setForm(blank); }}>Add customer</button>
      </div>
      {err && !form && <p className="bad">{err}</p>}
      {list.length === 0 ? <div className="empty"><h2>No customers found</h2><p>Add a customer to start taking orders.</p></div> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Name</th><th>Phone</th><th>NIC</th><th>Address</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c._id}>
              <td data-l="Name"><b>{c.name}</b>{c.detailsPending && <> <span className="tag fair">Details pending</span></>}</td><td data-l="Phone">{c.phone}</td>
              <td data-l="NIC">{c.nic || '-'}</td><td data-l="Address">{c.address || '-'}</td>
              <td className="acts"><button onClick={() => { setErr(''); setForm(c); }}>Edit</button></td>
            </tr>))}</tbody>
        </table></div>)}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>{form._id ? 'Edit customer' : 'Add customer'}</h2>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <label>Phone<PhoneInput required value={form.phone} onChange={phone => setForm({ ...form, phone })} /></label>
            <label>NIC<NicInput value={form.nic} onChange={nic => setForm({ ...form, nic })} /></label>
            <label>Email (invoices are sent here)<input type="email" value={form.email || ''} onChange={set('email')} /></label>
            <label>Address<input value={form.address || ''} onChange={set('address')} /></label>
            <label>Notes<textarea rows="2" value={form.notes || ''} onChange={set('notes')} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Save</button></div>
          </form>
        </div>)}
    </>
  );
}
