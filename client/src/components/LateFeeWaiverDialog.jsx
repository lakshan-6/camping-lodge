import {useState} from 'react';
import {api, lkr} from '../api.js';

export default function LateFeeWaiverDialog({record, orderNo, onClose, onSaved}) {
  const [waiveAll, setWaiveAll] = useState(true);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const reduction = waiveAll ? record.lateFee : Number(amount || 0);
  const remaining = Math.max(0, Math.round((record.lateFee - reduction) * 100) / 100);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api(`/returns/${record._id}/waive-late-fee`, {
        method: 'POST',
        body: {waiveAll, amount: Number(amount), reason, expectedLateFee: record.lateFee, requestId},
      });
      const creditMessage = result.refundDue > 0 ? ` Customer refund / credit due ${lkr(result.refundDue)}.` : '';
      onSaved(`Late fee updated. Remaining late fee ${lkr(result.lateFee)}.${creditMessage}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal"><form onSubmit={save}>
    <h2>Waive late fee · {orderNo}</h2>
    <p>Recorded late fee <strong>{lkr(record.lateFee)}</strong></p>
    <label className="check"><input type="checkbox" checked={waiveAll} disabled={busy} onChange={e => setWaiveAll(e.target.checked)}/>Waive full late fee</label>
    {!waiveAll && <label>Amount to waive (LKR)<input type="number" required min="0.01" max={record.lateFee} step="0.01" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)}/></label>}
    <label>Waiver reason<input required autoFocus maxLength={500} placeholder="Returned on time, recorded later" value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></label>
    <p>Late fee after waiver <strong>{lkr(remaining)}</strong></p>
    <p className="hint">The waiver updates the order total and invoice. Any extra payment appears as a customer refund / credit due.</p>
    {error && <p className="bad" role="alert">{error}</p>}
    <div className="bar"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Confirm waiver'}</button></div>
  </form></div>;
}
