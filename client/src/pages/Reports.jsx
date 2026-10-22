import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';

const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Reports() {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    api(`/reports?from=${from}&to=${to}`).then(setD).catch(e => setErr(e.message));
  }, [from, to]);
  return (
    <>
      <div className="bar">
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {err && <p className="bad">{err}</p>}
      {d && <>
        <div className="cards">
          <div className="card"><span>Revenue (payments received)</span><b>{lkr(d.revenue)}</b></div>
          <div className="card"><span>Orders (by pickup date)</span><b>{d.orders}</b></div>
          <div className="card"><span>Total billed</span><b>{lkr(d.billed)}</b></div>
        </div>
        <h3>Most rented equipment</h3>
        {d.top.length === 0 ? <div className="empty"><p>No rentals in this period.</p></div> : (
          <div className="tablewrap"><table><thead><tr><th>Item</th><th>Orders</th><th>Units rented</th><th>Revenue</th></tr></thead>
            <tbody>{d.top.map(t => <tr key={t.name}><td data-l="Item"><b>{t.name}</b></td><td data-l="Orders">{t.orders}</td><td data-l="Units rented">{t.units}</td><td data-l="Revenue">{lkr(t.revenue)}</td></tr>)}</tbody></table></div>)}
        <h3>Revenue by payment method</h3>
        {d.byMethod.length === 0 ? <div className="empty"><p>No payments in this period.</p></div> : (
          <div className="tablewrap"><table><thead><tr><th>Method</th><th>Amount</th></tr></thead>
            <tbody>{d.byMethod.map(m => <tr key={m.method}><td data-l="Method">{m.method.replace('_', ' ')}</td><td data-l="Amount">{lkr(m.total)}</td></tr>)}</tbody></table></div>)}
      </>}
    </>
  );
}
