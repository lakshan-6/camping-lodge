import ResponsiveTable from '../components/ResponsiveTable.jsx';
import { useCallback, useEffect, useState } from 'react';
import { api, lkr } from '../api.js';
import {can} from '../permissions.js';
import {PageIntro,EmptyState} from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import EquipmentUnits from '../components/EquipmentUnits.jsx';

const blank = { name: '', category: '', totalQuantity: 1, periodRate: '', notes: '', trackUnits: true };
const condLabel = { good: 'Good', fair: 'Fair', needs_repair: 'Needs repair' };
const maxNewUnits = 2000;

export default function Inventory({me}) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [archived,setArchived]=useState(false);
  const [unitItem,setUnitItem]=useState(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ q, category: cat,archived:String(archived) });
    api('/equipment?' + p).then(setItems).catch(e => setErr(e.message));
  }, [q, cat,archived]);
  useEffect(load, [load]);

  const loadCategories = useCallback(() => {
    api('/equipment/categories').then(setCategories).catch(e => setErr(e.message));
  }, []);
  useEffect(loadCategories, [loadCategories]);

  function openForm(item) {
    setErr('');
    setForm({
      ...(item || blank), existing: item || null, newCategory: false,
      unitConditions: {}, requestId: crypto.randomUUID(),
    });
  }
  const set = k => e => setForm({ ...form, [k]: e.target.value });
  const categoryIndex = categories.indexOf(form?.category);
  const enteringNewCategory = form?.newCategory || (!!form?.category && categoryIndex < 0);
  const existingTracked = !!form?.existing?.trackUnits;
  const existingUnits = existingTracked ? form.existing.totalQuantity : 0;
  const addedUnits = Number(form?.totalQuantity) - existingUnits;
  const unitConditions = form?.trackUnits && Number.isInteger(addedUnits) && addedUnits >= 0 && addedUnits <= maxNewUnits
    ? Array.from({length:addedUnits}, (_, index) => form.unitConditions[index] ??
      (!existingTracked && index < (form.existing?.damagedQty ?? 0) ? 'damaged' : 'good'))
    : undefined;

  async function save(e) {
    e.preventDefault(); setErr('');
    try {
      if (form.trackUnits && !unitConditions) throw new Error('Enter a valid number of new units.');
      const {name,category,totalQuantity,periodRate,notes,checklist,trackUnits,requestId}=form;
      const body = {name,category,totalQuantity:Number(totalQuantity),periodRate:Number(periodRate),notes,checklist,trackUnits,requestId,unitConditions};
      const saved = await (form._id ? api('/equipment/' + form._id, { method: 'PUT', body }) : api('/equipment', { method: 'POST', body }));
      setCategories(current => [...new Set([...current,saved.category])].sort((a,b)=>a.localeCompare(b)));
      setForm(null); load(); loadCategories();
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
        {can(me,'inventory.manage')&&<button className="btn" onClick={() => openForm()}><Icon name="plus" size={17}/>Add equipment</button>}
      </div>
      {err && !form && <p className="bad">{err}</p>}
      {items.length === 0 ? (
        <EmptyState icon="tent" title="No equipment found" description={q||cat?'Try another search or choose a different category.':'Add your first item to start building your inventory.'}/>
      ) : (
        <div className="tablewrap"><ResponsiveTable>
          <thead><tr><th>Item</th><th>Category</th><th>Units</th><th>Rate / 36h</th><th>Condition</th><th></th></tr></thead>
          <tbody>{items.map(i => (
            <tr key={i._id}>
              <td data-l="Item"><b>{i.name}</b>{i.sku && <small> {i.sku}</small>}</td>
              <td data-l="Category">{i.category}</td>
              <td data-l="Units">{i.totalQuantity}{i.damagedQty > 0 && <small>{i.damagedQty} damaged</small>}{i.trackUnits&&<small>Individually labelled</small>}</td>
              <td data-l="Rate / 36h">{lkr(i.periodRate)}</td>
              <td data-l="Condition">{i.trackUnits
                ?<span className={'tag '+(i.damagedQty?'needs_repair':'good')}>{i.damagedQty?'Units need attention':'No damaged units'}</span>
                :<span className={'tag ' + i.condition}>{condLabel[i.condition]}</span>}</td>
              <td className="acts">
                {i.trackUnits&&<button onClick={()=>{setErr('');setUnitItem(i);}}>Unit codes</button>}
                {can(me,'inventory.manage')&&<><button onClick={() => openForm(i)}>Edit</button>
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
            {categories.length>0&&<label>Category
              <select required value={enteringNewCategory?'new':categoryIndex<0?'':String(categoryIndex)} onChange={e=>{
                const choice=e.target.value;
                setForm({...form,newCategory:choice==='new',category:categories[Number(choice)]??''});
              }}>
                <option value="" disabled>Choose category</option>
                {categories.map((category,index)=><option key={category} value={index}>{category}</option>)}
                <option value="new">Add a new category</option>
              </select>
            </label>}
            {(!categories.length||enteringNewCategory)&&<label>{categories.length?'New category name':'Category'}
              <input required value={form.category} onChange={set('category')} placeholder="Tents, Sleeping, Cooking…" />
            </label>}
            <label>SKU<input readOnly value={form.sku||''} placeholder="Short code from category and name" /></label>
            <div className="row">
              <label>Total units<input type="number" step="1" min={existingUnits} max={form.trackUnits?existingUnits+maxNewUnits:undefined} required value={form.totalQuantity} onChange={set('totalQuantity')} /></label>
              <label>Rate per 36h (LKR)<input type="number" min="0" step="0.01" required value={form.periodRate} onChange={set('periodRate')} /></label>
            </div>
            {form._id&&!existingTracked&&<label className="check">
              <input type="checkbox" checked={!!form.trackUnits} onChange={e=>setForm({...form,trackUnits:e.target.checked})}/>
              Track each existing unit with its own code
            </label>}
            {unitConditions?.length>0&&<fieldset className="unit-picker">
              <legend>{existingTracked?'New unit conditions':'Unit conditions'}</legend>
              <p className="hint">Each unit gets its own code when saved. Damaged units are unavailable for rental.</p>
              <div className="unit-return-list initial-unit-conditions">
                {unitConditions.map((condition,index)=><label key={index}>{existingTracked?'New unit':'Unit'} {index+1}
                  <select value={condition} onChange={e=>setForm({...form,unitConditions:{...form.unitConditions,[index]:e.target.value}})}>
                    <option value="good">Ready</option><option value="damaged">Damaged</option>
                  </select>
                </label>)}
              </div>
            </fieldset>}
            {existingTracked&&<p className="hint">To change conditions for existing units, use <b>Unit codes</b> on the inventory list.</p>}
            <label>Pickup / return checklist (one part per line)<textarea rows="3" placeholder={'Poles\nPegs\nCarry bag'} value={(form.checklist||[]).join('\n')} onChange={e=>setForm({...form,checklist:e.target.value.split('\n')})}/></label>
            <label>Notes<textarea rows="2" value={form.notes || ''} onChange={set('notes')} /></label>
            {err && <p className="bad">{err}</p>}
            <div className="row end"><button type="button" onClick={() => setForm(null)}>Cancel</button><button className="btn">Save</button></div>
          </form>
        </div>)}
    </>
  );
}
