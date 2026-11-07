import ResponsiveTable from '../components/ResponsiveTable.jsx';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import {businessDate} from '../businessTime.js';

const fmt = d => new Date(d).toLocaleString('en-LK', { timeZone:'Asia/Colombo', dateStyle: 'medium', timeStyle: 'short' });
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const sod = d => new Date(dayKey(d)+'T00:00:00+05:30');
const eod = d => new Date(dayKey(d)+'T23:59:59.999+05:30');
const todayCell = () => new Date(businessDate()+'T00:00:00');
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Calendar() {
  const [month, setMonth] = useState(() => { const d = todayCell(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(todayCell);
  const [orders, setOrders] = useState([]);
  const [err, setErr] = useState('');
  useEffect(() => { api('/orders').then(o => setOrders(o.filter(x => x.status !== 'cancelled'))).catch(e => setErr(e.message)); }, []);

  const on = d => orders.filter(o => new Date(o.startDate) <= eod(d) && new Date(o.endDate) >= sod(d));
  const pad = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(pad).fill(null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const move = n => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const today = todayCell().getTime();

  return (
    <>
      {err && <p className="bad">{err}</p>}
      <div className="bar cal-nav"><button onClick={() => move(-1)}>‹ Prev</button>
        <h3>{month.toLocaleString('en-LK', { month: 'long', year: 'numeric' })}</h3><button onClick={() => move(1)}>Next ›</button></div>
      <div className="cal">
        {days.map(d => <div className="cal-h" key={d}>{d}</div>)}
        {cells.map((d, i) => !d ? <div key={i} /> : (
          <button key={i} className={'cal-d' + (d.getTime() === sel.getTime() ? ' sel' : '') + (d.getTime() === today ? ' today' : '')} onClick={() => setSel(d)}>
            <span>{d.getDate()}</span>
            {on(d).slice(0, 2).map(o => <i key={o._id} className={'chip ' + o.status}>{o.orderNo}</i>)}
            {on(d).length > 2 && <i className="chip more">+{on(d).length - 2}</i>}
          </button>))}
      </div>
      <h3>{sel.toLocaleDateString('en-LK', { dateStyle: 'full' })}</h3>
      {on(sel).length === 0 ? <div className="empty"><p>No orders on this day.</p></div> : (
        <div className="tablewrap"><ResponsiveTable><thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Return</th><th>Items</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>{on(sel).map(o => (
            <tr key={o._id}><td data-l="Order"><b>{o.orderNo}</b></td><td data-l="Customer">{o.customer?.name}</td><td data-l="Pickup">{fmt(o.startDate)}</td><td data-l="Return">{fmt(o.endDate)}</td>
              <td data-l="Items">{o.items.map(i => `${i.quantity}× ${i.equipment?.name}`).join(', ')}</td><td data-l="Status">{o.status}</td><td data-l="Total">{lkr(o.totalAmount)}</td></tr>))}</tbody></ResponsiveTable></div>)}
    </>
  );
}
