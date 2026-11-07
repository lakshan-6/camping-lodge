import { useCallback, useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import {can} from '../permissions.js';

const blank = { name: '', category: '', sku: '', totalQuantity: 1, periodRate: '', deposit: 0, damagedQty: 0, condition: 'good', notes: '' };
const condLabel = { good: 'Good', fair: 'Fair', needs_repair: 'Needs repair' };

export default function Inventory({me}) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [archived,setArchived]=useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams({ q, category: cat,archived:String(archived) });
    api('/equipment?' + p).then(setItems).catch(e => setErr(e.message));
  }, [q, cat,archived]);
  useEffect(load, [load]);

  const categories = [...new Set(items.map(i => i.category))];
  const set = k => e => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      const body = { ...form, totalQuantity: +form.totalQuantity, periodRate: +form.periodRate, deposit: +form.deposit, damagedQty: +form.damagedQty || 0 };
      await (form._id ? api('/equipment/' + form._id, { method: 'PUT', body }) : api('/equipment', { method: 'POST', body }));
      setForm(null); load();
    } catch (e2) { setErr(e2.message); }
  }
  async function archive(i) {
    if (confirm(`Archive "${i.name}"? It will be hidden from Inventory.`)) { await api('/equipment/' + i._id, { method: 'DELETE' }); load(); }
  }

  return (
    <>
      <div className="bar">
        <input placeholder="Search name or SKU" value={q} onChange={e => setQ(e.target.value)} />
        <select value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Archived items</label>
        {can(me,'inventory.manage')&&<button className="btn" onClick={() => { setErr(''); setForm({...blank,requestId:crypto.randomUUID()}); }}>Add equipment</button>}
      </div>
      {err && !form && <p className="bad">{err}</p>}
      {items.length === 0 ? (
        <div className="empty"><h2>No equipment found</h2><p>Add your first item to start building your inventory.</p></div>
      ) : (
        <div className="tablewrap"><table>
          <thead><tr><th>Item</th><th>Category</th><th>Units</th><th>Rate / 36h</th><th>Deposit</th><th>Condition</th><th></th></tr></thead>
          <tbody>{items.map(i => (
            <tr key={i._id}>
              <td data-l="Item"><b>{i.name}</b>{i.sku && <small> {i.sku}</small>}</td>
              <td data-l="Category">{i.category}</td>
              <td data-l="Units">{i.totalQuantity}{i.damagedQty > 0 && <small>{i.damagedQty} damaged</small>}</td>
              <td data-l="Rate / 36h">{lkr(i.periodRate)}</td>
              <td data-l="Deposit">{lkr(i.deposit)}</td>
              <td data-l="Condition"><span className={'tag ' + i.condition}>{condLabel[i.condition]}</span></td>
              <td className="acts">
                {can(me,'inventory.manage')&&<><button onClick={() => { setErr(''); setForm({...i,requestId:crypto.randomUUID()}); }}>Edit</button>
                {archived?<button onClick={()=>api(`/equipment/${i._id}/restore`,{method:'POST',body:{requestId:crypto.randomUUID()}}).then(load).catch(e=>setErr(e.message))}>Restore item</button>:<button onClick={() => archive(i)}>Archive</button>}</>}
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>{form._id ? 'Edit equipment' : 'Add equipment'}</h2>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <label>Category<input required list="cats" value={form.category} onChange={set('category')} placeholder="Tents, Sleeping, Cooking…" /></label>
            <datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <label>SKU (optional)<input value={form.sku || ''} onChange={set('sku')} /></label>
            <div className="row">
              <label>Total units<input type="number" min="0" required value={form.totalQuantity} onChange={set('totalQuantity')} /></label>
              <label>Condition<select value={form.condition} onChange={set('condition')}>
                {Object.entries(condLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            </div>
            <div className="row">
              <label>Rate per 36h (LKR)<input type="number" min="0" required value={form.periodRate} onChange={set('periodRate')} /></label>
              <label>Deposit (LKR)<input type="number" min="0" value={form.deposit} onChange={set('deposit')} /></label>
            </div>
            <label>Damaged / in repair (units)<input type="number" min="0" value={form.damagedQty || 0} onChange={set('damagedQty')} /></label>
            <label>Pickup / return checklist (one part per line)<textarea rows="3" placeholder={'Poles\nPegs\nCarry bag'} value={(form.checklist||[]).join('\n')} onChange={e=>setForm({...form,checklist:e.target.value.split('\n')})}/></label>
            <label>Notes<textarea rows="2" value={form.notes || ''} onChange={set('notes')} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Save</button></div>
          </form>
        </div>)}
    </>
  );
}
