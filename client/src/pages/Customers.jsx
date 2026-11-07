import {useCallback,useEffect,useState} from 'react';
import {api} from '../api.js';
import {PhoneInput,NicInput} from '../components/ContactInputs.jsx';
import CustomerMatches from '../components/CustomerMatches.jsx';
import CustomerHistory from '../components/CustomerHistory.jsx';
import {can} from '../permissions.js';
const blank={name:'',phone:'',nic:'',email:'',address:'',notes:''};
export default function Customers({me}){
 const [list,setList]=useState([]),[q,setQ]=useState(''),[form,setForm]=useState(null),[history,setHistory]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(()=>api('/customers?q='+encodeURIComponent(q)).then(setList).catch(e=>setError(e.message)),[q]);useEffect(()=>{load();},[load]);
 const set=k=>e=>setForm({...form,[k]:e.target.value});
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/customers'+(form._id?'/'+form._id:''),{method:form._id?'PUT':'POST',body:form});setForm(null);load();}catch(x){setError(x.message);}finally{setBusy(false);}}
 return <><div className="bar"><input placeholder="Search name, phone or NIC" value={q} onChange={e=>setQ(e.target.value)}/>{can(me,'customers.write')&&<button className="btn" onClick={()=>{setError('');setForm({...blank,requestId:crypto.randomUUID()});}}>Add customer</button>}</div>{error&&!form&&<p className="bad">{error}</p>}
 <div className="tablewrap"><table><thead><tr><th>Name</th><th>Phone</th><th>NIC</th><th>Address</th><th></th></tr></thead><tbody>{list.map(c=><tr key={c._id}><td>{c.name}{c.detailsPending&&<small>Details pending</small>}</td><td>{c.phone}</td><td>{c.nic||'-'}</td><td>{c.address||'-'}</td><td><button onClick={()=>setHistory(c)}>History</button>{can(me,'customers.write')&&<button onClick={()=>{setError('');setForm({...c,requestId:crypto.randomUUID()});}}>Edit</button>}</td></tr>)}</tbody></table></div>
 {form&&<div className="modal"><form onSubmit={save}><h2>{form._id?'Edit customer':'Add customer'}</h2><label>Name<input required value={form.name} onChange={set('name')}/></label><label>Phone<PhoneInput required value={form.phone} onChange={phone=>setForm({...form,phone})}/></label><label>NIC<NicInput value={form.nic} onChange={nic=>setForm({...form,nic})}/></label>
 <CustomerMatches phone={form.phone} nic={form.nic} exclude={form._id} onChoose={c=>{setForm(null);setHistory(c);}} confirmDifferent={form.confirmDifferentPerson} onConfirmDifferent={v=>setForm({...form,confirmDifferentPerson:v})}/>
 <label>Email<input type="email" value={form.email||''} onChange={set('email')}/></label><label>Address<input value={form.address||''} onChange={set('address')}/></label><label>Notes<textarea value={form.notes||''} onChange={set('notes')}/></label>{error&&<p className="bad">{error}</p>}<div className="bar"><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancel</button><button className="btn" disabled={busy}>{busy?'Saving…':'Save'}</button></div></form></div>}
 {history&&<CustomerHistory customer={history} me={me} onClose={()=>setHistory(null)}/>}</>;
}
