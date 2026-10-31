import { useEffect, useState } from 'react';
import { api, setToken } from '../api.js';

export default function Login({ onLogin }) {
  const [hasUsers, setHasUsers] = useState(null);
  const [f, setF] = useState({ name: '', username: '', password: '' });
  const [err, setErr] = useState('');
  useEffect(() => { api('/auth/status').then(d => setHasUsers(d.hasUsers)).catch(e => setErr(e.message)); }, []);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault(); setErr('');
    try {
      const d = await api(hasUsers ? '/auth/login' : '/auth/setup', { method: 'POST', body: f });
      setToken(d.token); onLogin(d.user);
    } catch (x) { setErr(x.message); }
  }
  if (hasUsers === null) return <div className="login"><p>{err || 'Loading…'}</p></div>;
  return (
    <div className="login">
      <form onSubmit={submit}>
        <img src="/logo.png" alt="Camping Lodge" className="login-logo" />
        <h2>{hasUsers ? 'Log in' : 'Create the owner account'}</h2>
        {!hasUsers && <p>First time setup. This account can add staff later.</p>}
        {!hasUsers && <label>Your name<input required value={f.name} onChange={set('name')} /></label>}
        <label>Username<input required autoFocus value={f.username} onChange={set('username')} /></label>
        <label>Password{!hasUsers && ' (6+ characters)'}<input required type="password" value={f.password} onChange={set('password')} /></label>
        {err && <p className="bad">{err}</p>}
        <button className="btn">{hasUsers ? 'Log in' : 'Create account'}</button>
      </form>
    </div>
  );
}
