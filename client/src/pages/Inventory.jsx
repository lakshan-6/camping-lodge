import ResponsiveTable from '../components/ResponsiveTable.jsx';
import { useCallback, useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import {can} from '../permissions.js';
import {PageIntro,EmptyState} from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import EquipmentUnits from '../components/EquipmentUnits.jsx';

const blank = { name: '', category: '', sku: '', totalQuantity: 1, periodRate: '', deposit: 0, damagedQty: 0, condition: 'good', notes: '',trackUnits:false,unitPrefix:'' };
const condLabel = { good: 'Good', fair: 'Fair', needs_repair: 'Needs repair' };

export default function Inventory({me}) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [archived,setArchived]=useState(false);
  const [unitItem,setUnitItem]=useState(null);

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
      <PageIntro eyebrow="Equipment & stock" title="Adventure starts with good gear." description="Keep equipment organised, check your stock and prepare every item for its next rental."/>
      <div className="bar filter-panel">
        <div className="search-field"><Icon name="search" size={18}/><input aria-label="Search equipment" type="search" placeholder="Search name or SKU" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select aria-label="Equipment category" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Archived items</label>
        {can(me,'inventory.manage')&&<button className="btn" onClick={() => { setErr(''); setForm({...blank,requestId:crypto.randomUUID()}); }}><Icon name="plus" size={17}/>Add equipment</button>}
      </div>
      {err && !form && <p className="bad">{err}</p>}
      {items.length === 0 ? (
        <EmptyState icon="tent" title="No equipment found" description={q||cat?'Try another search or choose a different category.':'Add your first item to start building your inventory.'}/>
      ) : (
        <div className="tablewrap"><ResponsiveTable>
          <thead><tr><th>Item</th><th>Category</th><th>Units</th><th>Rate / 36h</th><th>Deposit</th><th>Condition</th><th></th></tr></thead>
          <tbody>{items.map(i => (
            <tr key={i._id}>
              <td data-l="Item"><b>{i.name}</b>{i.sku && <small> {i.sku}</small>}</td>
              <td data-l="Category">{i.category}</td>
              <td data-l="Units">{i.totalQuantity}{i.damagedQty > 0 && <small>{i.damagedQty} damaged</small>}{i.trackUnits&&<small>Individually labelled</small>}</td>
              <td data-l="Rate / 36h">{lkr(i.periodRate)}</td>
              <td data-l="Deposit">{lkr(i.deposit)}</td>
              <td data-l="Condition"><span className={'tag ' + i.condition}>{condLabel[i.condition]}</span></td>
              <td className="acts">
                {i.trackUnits&&<button onClick={()=>{setErr('');setUnitItem(i);}}>Unit codes</button>}
                {can(me,'inventory.manage')&&<><button onClick={() => { setErr(''); setForm({...i,requestId:crypto.randomUUID()}); }}>Edit</button>
                {archived?<button onClick={()=>api(`/equipment/${i._id}/restore`,{method:'POST',body:{requestId:crypto.randomUUID()}}).then(load).catch(e=>setErr(e.message))}>Restore item</button>:<button onClick={() => archive(i)}>Archive</button>}</>}
              </td>
            </tr>))}</tbody>
        </ResponsiveTable></div>
      )}
      {unitItem&&<EquipmentUnits item={unitItem} me={me} onClose={()=>setUnitItem(null)} onSaved={load}/>}
      {form && (
        <div className="modal" onClick={() => setForm(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save}>
            <h2>{form._id ? 'Edit equipment' : 'Add equipment'}</h2>
            <label>Name<input required value={form.name} onChange={set('name')} /></label>
            <label>Category<input required list="cats" value={form.category} onChange={set('category')} placeholder="Tents, Sleeping, Cooking…" /></label>
            <datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
            <label>SKU (optional)<input value={form.sku || ''} onChange={set('sku')} /></label>
            <label className="check"><input type="checkbox" disabled={!!items.find(i=>i._id===form._id)?.trackUnits} checked={!!form.trackUnits} onChange={e=>setForm({...form,trackUnits:e.target.checked})}/>Track each physical unit with its own code</label>
            {form.trackUnits&&<><label>Unit code prefix<input required pattern="[A-Za-z0-9]{2,12}" minLength={2} maxLength={12} placeholder="SB" disabled={!!items.find(i=>i._id===form._id)?.trackUnits} value={form.unitPrefix||''} onChange={e=>setForm({...form,unitPrefix:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'')})}/></label><p className="hint">Example: SB-001, SB-002. Existing codes stay permanent. Print and attach labels from Unit codes after saving.</p></>}
            <div className="row">
              <label>Total units<input type="number" step="1" min={items.find(i=>i._id===form._id)?.trackUnits?items.find(i=>i._id===form._id).totalQuantity:0} required value={form.totalQuantity} onChange={set('totalQuantity')} /></label>
              <label>Condition<select value={form.condition} onChange={set('condition')}>
                {Object.entries(condLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            </div>
            <div className="row">
              <label>Rate per 36h (LKR)<input type="number" min="0" required value={form.periodRate} onChange={set('periodRate')} /></label>
              <label>Deposit (LKR)<input type="number" min="0" value={form.deposit} onChange={set('deposit')} /></label>
            </div>
            <label>Damaged / in repair (units)<input type="number" step="1" min="0" disabled={!!items.find(i=>i._id===form._id)?.trackUnits} value={form.damagedQty || 0} onChange={set('damagedQty')} /></label>
            {items.find(i=>i._id===form._id)?.trackUnits&&<p className="hint">Increase the total to create more labels. To record damage, loss or retirement, choose the exact code under Unit codes.</p>}
            <label>Pickup / return checklist (one part per line)<textarea rows="3" placeholder={'Poles\nPegs\nCarry bag'} value={(form.checklist||[]).join('\n')} onChange={e=>setForm({...form,checklist:e.target.value.split('\n')})}/></label>
            <label>Notes<textarea rows="2" value={form.notes || ''} onChange={set('notes')} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Save</button></div>
          </form>
        </div>)}
    </>
  );
}
