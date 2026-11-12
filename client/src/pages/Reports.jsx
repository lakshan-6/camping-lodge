import ResponsiveTable from '../components/ResponsiveTable.jsx';
import {businessDate} from '../businessTime.js';
import { useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import {downloadFile} from './Management.jsx';
import {PageIntro,Metric} from '../components/UI.jsx';

const iso = businessDate;

export default function Reports() {
  const now = new Date();
  const [from, setFrom] = useState(iso(now).slice(0,7)+'-01');
  const [to, setTo] = useState(iso(now));
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    api(`/reports?from=${from}&to=${to}`).then(setD).catch(e => setErr(e.message));
  }, [from, to]);
  return (
    <>
      <PageIntro eyebrow="Reports & insights" title="See how your business is growing." description="Choose a period to review receipts, expenses and your most popular equipment."/>
      <div className="bar filter-panel">
        <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <div className="bar">{['orders','payments','inventory','customers','expenses'].map(kind=><button key={kind} onClick={()=>downloadFile(`/manage/export/${kind}?from=${from}&to=${to}`,`camping-lodge-${kind}.csv`).catch(e=>setErr(e.message))}>Export {kind} CSV</button>)}</div>
      {err && <p className="bad">{err}</p>}
      {d && <>
        <div className="cards report-cards">
          <Metric icon="wallet" label="Net payments after refunds" value={lkr(d.revenue)} tone="highlight"/>
          <Metric icon="orders" label="Bookings created" value={d.orders}/>
          <Metric icon="report" label="Invoiced in this period" value={lkr(d.billed)}/>
          <Metric icon="receipt" label="Recorded expenses" value={lkr(d.expenses)}/>
          <Metric icon="chart" label="Receipts less expenses" value={lkr(d.netCashAfterExpenses)}/>
          <Metric icon="shield" label="Security deposits held" value={lkr(d.securityDepositsHeld)}/>
        </div>
        <h3>Equipment bookings and pickups</h3>
        {d.top.length === 0 ? <div className="empty"><p>No equipment bookings or pickups in this period.</p></div> : (
          <div className="tablewrap"><ResponsiveTable><thead><tr><th>Item</th><th>Booked units</th><th>Handed-out units</th></tr></thead>
            <tbody>{d.top.map(t => <tr key={t._id}><td data-l="Item"><b>{t.name}</b></td><td data-l="Booked units">{t.bookedUnits}</td><td data-l="Handed-out units">{t.handedOutUnits}</td></tr>)}</tbody></ResponsiveTable></div>)}
        <h3>Net payments by method</h3>
        {d.byMethod.length === 0 ? <div className="empty"><p>No payments in this period.</p></div> : (
          <div className="tablewrap"><ResponsiveTable><thead><tr><th>Method</th><th>Amount</th></tr></thead>
            <tbody>{d.byMethod.map(m => <tr key={m.method}><td data-l="Method">{m.method.replace('_', ' ')}</td><td data-l="Amount">{lkr(m.total)}</td></tr>)}</tbody></ResponsiveTable></div>)}
      </>}
    </>
  );
}
