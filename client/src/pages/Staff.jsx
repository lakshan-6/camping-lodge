import ResponsiveTable from '../components/ResponsiveTable.jsx';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {permissionLabels} from '../permissions.js';

const blank = { name: '', username: '', password: '', role: 'staff' };

export default function Staff({ me }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [permissions,setPermissions]=useState(null);
  const load = () => api('/users').then(setList).catch(e => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const isOwner = me.role === 'owner';
  // Owner manages everyone but the owner account; an admin manages staff only
  const canManage = u => u._id !== me.id && u.role !== 'owner' && (isOwner || u.role === 'staff');
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const patch = async (u, body) => { try { await api('/users/' + u._id, { method: 'PATCH', body }); load(); } catch (e) { alert(e.message); } };
  const del = async u => {
    if (!confirm(`Delete ${u.name} (${u.username})? This cannot be undone.`)) return;
    try { await api('/users/' + u._id, { method: 'DELETE' }); load(); } catch (e) { alert(e.message); }
  };
  async function save(e) {
    e.preventDefault(); setErr('');
    try { await api('/users', { method: 'POST', body: form }); setForm(null); load(); } catch (x) { setErr(x.message); }
  }
  return (
    <>
      <div className="bar"><button className="btn" onClick={() => { setErr(''); setForm(blank); }}>Add user</button></div>
      <div className="tablewrap"><ResponsiveTable><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>{list.map(u => (
          <tr key={u._id}><td data-l="Name"><b>{u.name}</b>{u._id === me.id && <small>(you)</small>}</td><td data-l="Username">{u.username}</td><td data-l="Role">{u.role}</td>
            <td data-l="Status"><span className={'dot' + (u.online ? ' on' : '')} />{!u.active ? 'disabled' : u.online ? 'online' : 'offline'}</td>
            <td className="acts">
              {u.role!=='owner'&&(u._id === me.id || canManage(u)) && <button onClick={() => { const p = prompt('New password for ' + u.username + ' (12–128 characters)'); if (p) patch(u, { password: p }); }}>Reset password</button>}
              {canManage(u) && <button onClick={() => patch(u, { active: !u.active })}>{u.active ? 'Disable' : 'Enable'}</button>}
              {canManage(u) && <button onClick={() => del(u)}>Delete</button>}
              {isOwner&&u.role==='staff'&&<button onClick={()=>setPermissions({user:u,selected:u.permissions||[]})}>Permissions</button>}
            </td></tr>))}</tbody></ResponsiveTable></div>
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>Add user</h2>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <label>Username<input required value={form.username} onChange={set('username')} /></label>
            <label>Password (12–128 characters)<input required type="password" value={form.password} onChange={set('password')} /></label>
            {isOwner && <label>Role<select value={form.role} onChange={set('role')}><option value="staff">Staff (no Reports, Settings or Staff Access)</option><option value="admin">Admin (full access, cannot delete other admins)</option></select></label>}
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Add user</button></div>
          </form>
        </div>)}
      {permissions&&<div className="modal"><form onSubmit={async e=>{e.preventDefault();try{await api('/users/'+permissions.user._id,{method:'PATCH',body:{permissions:permissions.selected}});setPermissions(null);load();}catch(x){setErr(x.message);}}}><h2>Permissions: {permissions.user.name}</h2><p>Choose exactly what this staff account can do. Owner-only backup, restore and permanent deletion stay unavailable.</p>{Object.entries(permissionLabels).map(([key,label])=><label className="check" key={key}><input type="checkbox" checked={permissions.selected.includes(key)} onChange={e=>setPermissions({...permissions,selected:e.target.checked?[...permissions.selected,key]:permissions.selected.filter(p=>p!==key)})}/>{label}</label>)}{err&&<p className="bad">{err}</p>}<div className="bar"><button type="button" onClick={()=>setPermissions(null)}>Cancel</button><button className="btn">Save permissions</button></div></form></div>}
    </>
  );
}
