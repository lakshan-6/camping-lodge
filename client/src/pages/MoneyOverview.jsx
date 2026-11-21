import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {api, lkr} from '../api.js';
import {businessDate} from '../businessTime.js';
import {Metric} from '../components/UI.jsx';
import ResponsiveTable from '../components/ResponsiveTable.jsx';

const methodLabels = {cash: 'Cash', bank_transfer: 'Bank transfer', card: 'Card', other: 'Other'};
const displayDate = value => new Date(value + 'T12:00:00+05:30').toLocaleDateString('en-LK', {
  timeZone: 'Asia/Colombo', dateStyle: 'medium',
});

export default function MoneyOverview() {
  const today = businessDate();
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setError('');
    api('/payments/summary' + query)
      .then(result => { if (active) setData(result); })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, revision]);

  function choosePeriod(value) {
    setPeriod(value);
    const currentDate = businessDate();
    if (value === 'all') setQuery('');
    if (value === 'today') setQuery(`?from=${currentDate}&to=${currentDate}`);
    if (value === 'week') {
      const monday = new Date(currentDate + 'T00:00:00Z');
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      setQuery(`?from=${monday.toISOString().slice(0, 10)}&to=${currentDate}`);
    }
    if (value === 'month') setQuery(`?from=${currentDate.slice(0, 7)}-01&to=${currentDate}`);
    if (value === 'year') setQuery(`?from=${currentDate.slice(0, 4)}-01-01&to=${currentDate}`);
  }

  function showTotals(event) {
    event.preventDefault();
    if (period === 'custom') setQuery('?' + new URLSearchParams({from, to}));
    else choosePeriod(period);
    setRevision(value => value + 1);
  }

  const periodLabel = data?.period.from
    ? `${displayDate(data.period.from)} – ${displayDate(data.period.to)}`
    : 'All time';

  return <>
    <form className="bar filter-panel" onSubmit={showTotals}>
      <label>Period<select value={period} onChange={e => choosePeriod(e.target.value)}>
        <option value="all">All time</option>
        <option value="today">Today</option>
        <option value="week">This week</option>
        <option value="month">This month</option>
        <option value="year">This year</option>
        <option value="custom">Choose dates</option>
      </select></label>
      {period === 'custom' && <>
        <label>From<input type="date" required value={from} max={to || undefined} onChange={e => setFrom(e.target.value)}/></label>
        <label>To<input type="date" required value={to} min={from || undefined} onChange={e => setTo(e.target.value)}/></label>
      </>}
      <button type="submit" disabled={loading}>{period === 'custom' ? 'Show totals' : 'Refresh totals'}</button>
    </form>
    {loading && <p role="status">Loading money totals…</p>}
    {error && <p className="bad" role="alert">{error}</p>}
    {data && <>
      <h3>{periodLabel}</h3>
      <div className="cards report-cards">
        <Metric icon="wallet" label="Rental money received" value={lkr(data.rentalReceipts)} note="Advances and later rental payments"/>
        <Metric icon="returns" label="Rental refunds paid" value={lkr(data.rentalRefunds)}/>
        <Metric icon="receipt" label="Expenses paid" value={lkr(data.expenses)}/>
        <Metric icon="chart" label="Rental receipts less expenses" value={lkr(data.receiptsLessExpenses)} tone="highlight"
          note={`After rental refunds. Includes ${lkr(data.securityApplied)} of security applied to rent.`}/>
      </div>

      <div className="bar"><h3>Current balances</h3><Link to="/money?view=payments">View orders and payments</Link></div>
      <p>Across all dates, including orders that are still in progress.</p>
      <div className="cards report-cards">
        <Metric icon="orders" label="Customers still owe" value={lkr(data.current.outstanding)}/>
        <Metric icon="returns" label="Rental refunds / credits due" value={lkr(data.current.refundDue)}/>
        <Metric icon="shield" label="Security money held" value={lkr(data.current.securityHeld)} note="Refundable customer deposits"/>
      </div>

      <details className="desk-actions">
        <summary>Money received and paid by method</summary>
        <p>Security collected {lkr(data.securityCollected)} · Security refunded {lkr(data.securityRefunds)} · Net recorded money movement <b>{lkr(data.netMovement)}</b></p>
        <div className="tablewrap"><ResponsiveTable>
          <thead><tr><th>Method</th><th>Rental money in</th><th>Security money in</th><th>Refunds paid</th><th>Expenses paid</th><th>Net movement</th></tr></thead>
          <tbody>{data.byMethod.map(row => <tr key={row.method}>
            <td>{methodLabels[row.method] || row.method}</td>
            <td>{lkr(row.rentalReceipts)}</td>
            <td>{lkr(row.securityCollected)}</td>
            <td>{lkr(row.rentalRefunds + row.securityRefunds)}</td>
            <td>{lkr(row.expenses)}</td>
            <td><b>{lkr(row.netMovement)}</b></td>
          </tr>)}</tbody>
        </ResponsiveTable></div>
      </details>
    </>}
  </>;
}
