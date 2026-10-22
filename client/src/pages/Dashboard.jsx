import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, lkr } from '../api.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' });

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/stats').then(setS).catch(e => setErr(e.message)); }, []);
  if (err) return <p className="bad">Could not load dashboard: {err}</p>;
  if (!s) return <p>Loading…</p>;
  const cards = [
    ['Equipment items', s.equipmentItems, `${s.availableUnits} of ${s.totalUnits} units available`],
    ['Active orders', s.activeOrders, 'Reserved or in progress'],
    ['Rentals out', s.rentalsOut, `${s.overdue} overdue`],
    ['Total revenue', lkr(s.revenue), 'From all payments'],
    ['Outstanding', lkr(s.outstanding), 'Unpaid balances'],
    ['Total customers', s.customers, ''],
  ];
  return (
    <>
      <div className="cards">{cards.map(([l, v, n]) => <div className="card" key={l}><span>{l}</span><b>{v}</b><span>{n}</span></div>)}</div>
      <div className="duo">
        <div className="card"><h3>Recent orders <Link to="/orders">View all</Link></h3>
          {s.recent.length === 0 ? <p>No orders yet.</p> : s.recent.map(o => (
            <p key={o._id}><b>{o.orderNo}</b> · {o.customer?.name}<br /><small>{fmt(o.startDate)} → {fmt(o.endDate)} · {o.status} · {lkr(o.totalAmount)}</small></p>))}
        </div>
        <div className="card"><h3>Low availability</h3>
          {s.low.length === 0 ? <p>All items well stocked.</p> : s.low.map(i => <p key={i._id}>{i.name}: <b className="bad">{i.available}</b> of {i.total} free</p>)}
          <h3>Quick actions</h3>
          <div className="bar"><Link className="btn" to="/inventory">Add equipment</Link><Link className="btn" to="/orders">New order</Link><Link className="btn" to="/customers">Add customer</Link></div>
        </div>
      </div>
    </>
  );
}
