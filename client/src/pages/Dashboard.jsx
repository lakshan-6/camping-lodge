import {businessDate, formatPickup, formatReturn} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, lkr } from '../api.js';
import {can} from '../permissions.js';
import {PageIntro,Metric,EmptyState} from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';


function RevenueCard() {
  const now = new Date(businessDate()+'T12:00:00');
  const [period, setPeriod] = useState('month');
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [d, setD] = useState(null);
  useEffect(() => {
    const value = period === 'month' ? month : period === 'year' ? year : '';
    api(`/stats/summary?period=${period}&value=${value}`).then(setD).catch(() => setD(null));
  }, [period, month, year]);
  return (
    <div className="card revcard">
      <span>Revenue and customers</span>
      <div className="seg">
        {[['month', 'Monthly'], ['year', 'Yearly'], ['all', 'Since start']].map(([p, l]) =>
          <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{l}</button>)}
      </div>
      {period === 'month' && <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />}
      {period === 'year' && <input type="number" min="2000" max={now.getFullYear()} value={year} onChange={e => setYear(e.target.value)} />}
      <b>{d ? lkr(d.revenue) : '…'}</b>
      <span>{d ? (period === 'all' ? `${d.customers} customers in total` : `${d.customers} new customers`) : ''}</span>
      {period === 'all' && d?.since && <span>Since {new Date(d.since).toLocaleDateString('en-LK', { timeZone:'Asia/Colombo', dateStyle: 'medium' })}</span>}
    </div>
  );
}

export default function Dashboard({me}) {
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/stats').then(setS).catch(e => setErr(e.message)); }, []);
  if (err) return <p className="bad">Could not load dashboard: {err}</p>;
  if (!s) return <p>Loading…</p>;
  const cards = [
    ['Equipment items', s.equipmentItems, `${s.availableUnits} of ${s.totalUnits} units available`,'box'],
    ['Active orders', s.activeOrders, 'Reserved or in progress','orders'],
    ['Rentals out', s.rentalsOut, `${s.overdue} overdue`,'pickup'],
    ...(can(me,'finance.view')?[['Outstanding', lkr(s.outstanding), 'Unpaid rental balances, including fees','wallet']]:[]),
  ];
  return (
    <>
      <PageIntro eyebrow="Business overview" title="Your lodge, at a glance." description="A clear view of revenue, equipment and the rentals keeping your business moving."/>
      <div className={'cards'+(can(me,'finance.view')?' dashboard-cards':'')}>{can(me,'finance.view')&&<RevenueCard />}{cards.map(([l,v,n,icon])=><Metric key={l} label={l} value={v} note={n} icon={icon}/>)}</div>
      <div className="duo">
        <div className="card"><h3>Recent orders <Link to="/orders">View all</Link></h3>
          {s.recent.length === 0 ? <EmptyState compact title="Ready for your first booking" description="New orders will appear here as your business grows."/> : s.recent.map(o => (
            <p key={o._id}><b>{o.orderNo}</b> · {o.customer?.name}<br /><small>{formatPickup(o)} → {formatReturn(o)} · {o.status} · {lkr(o.totalAmount)}</small></p>))}
        </div>
        <div className="card"><h3>Low availability</h3>
          {s.low.length === 0 ? <p className="helper-note"><Icon name="check" size={17}/>All items well stocked.</p> : s.low.map(i => <p key={i._id}>{i.name}: <b className="bad">{i.available}</b> of {i.total} free</p>)}
          <h3>Quick actions</h3>
          <div className="bar"><Link className="btn" to="/inventory">Add equipment</Link><Link className="btn" to="/orders">New order</Link><Link className="btn" to="/customers">Add customer</Link></div>
        </div>
      </div>
    </>
  );
}
