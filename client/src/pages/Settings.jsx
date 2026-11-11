import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Settings({ onSaved }) {
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/settings').then(setF).catch(e => setMsg(e.message)); }, []);
  if (!f) return <p>{msg || 'Loading…'}</p>;
  const set = k => e => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setMsg('');
    try { const s = await api('/settings', { method: 'PUT', body: f }); setF(s); onSaved(s); setMsg('Saved.'); } catch (x) { setMsg(x.message); }
  }
  return (
    <form className="card settings" onSubmit={save}>
      <label>Business name<input required value={f.businessName} onChange={set('businessName')} /></label>
      <label>Phone / WhatsApp<input value={f.phone} onChange={set('phone')} /></label>
      <label>Address (shown on invoices)<input value={f.address} onChange={set('address')} /></label>
      <h3>Late fees</h3>
      <label>Late return grace period (minutes)<input type="number" min="0" max="1440" step="1" value={f.graceMinutes||0} onChange={set('graceMinutes')}/></label>
      <label>Charge interval (hours)<input required type="number" min="0.01" step="0.01" value={f.lateFeeIntervalHours} onChange={set('lateFeeIntervalHours')}/></label>
      <label>Item rate charged per interval (%)<input required type="number" min="0" max="100" step="0.01" value={f.lateFeeStepPercent} onChange={set('lateFeeStepPercent')}/></label>
      <label>Charge the full item rate after (hours)<input required type="number" min="0.01" step="0.01" value={f.lateFeeFullRateAfterHours} onChange={set('lateFeeFullRateAfterHours')}/></label>
      <p>After the grace period, the fee increases for each completed interval, up to one full item rate.</p>
      <p>Rental period length is fixed at 36 hours. Currency is LKR.</p>
      {msg && <p className={msg === 'Saved.' ? 'ok' : 'bad'}>{msg}</p>}
      <div><button className="btn">Save settings</button></div>
    </form>
  );
}
