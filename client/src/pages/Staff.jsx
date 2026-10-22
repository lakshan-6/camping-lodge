import { useEffect, useState } from 'react';
import { api } from '../api.js';

const blank = { name: '', username: '', password: '', role: 'staff' };

export default function Staff({ me }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/users').then(setList).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const patch = async (u, body) => { try { await api('/users/' + u._id, { method: 'PATCH', body }); load(); } catch (e) { alert(e.message); } };

  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api('/users', { method: 'POST', body: form }); setForm(null); load(); } catch (x) { setErr(x.message); }
  }
  return (
    <>
      <div className="bar"><button className="btn" onClick={() => { setErr(''); setForm(blank); }}>Add user</button></div>
      <div className="tablewrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map(u => (
          <tr key={u._id}><td data-l="Name"><b>{u.name}</b></td><td data-l="Username">{u.username}</td><td data-l="Role">{u.role}</td>
            <td data-l="Status"><span className={'tag ' + (u.active ? '' : 'needs_repair')}>{u.active ? 'active' : 'disabled'}</span></td>
            <td className="acts">
              <button onClick={() => { const p = prompt('New password for ' + u.username + ' (6+ characters)'); if (p) patch(u, { password: p }); }}>Reset password</button>
              {u._id !== me.id && <button onClick={() => patch(u, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>}
            </td></tr>))}</tbody></table></div>
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>Add user</h2>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <label>Username<input required value={form.username} onChange={set('username')} /></label>
            <label>Password (6+ characters)<input required type="password" value={form.password} onChange={set('password')} /></label>
            <label>Role<select value={form.role} onChange={set('role')}><option value="staff">Staff (no Reports, Settings or Staff Access)</option><option value="admin">Admin (full access)</option></select></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Add user</button></div>
          </form>
        </div>)}
    </>
  );
}
