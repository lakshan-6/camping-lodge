import {useEffect,useState} from 'react';
import {api} from '../api.js';
export default function CustomerMatches({phone,nic,exclude,onChoose,confirmDifferent,onConfirmDifferent}){
 const [matches,setMatches]=useState([]);
 useEffect(()=>{let active=true;if((phone||'').length<10&&(nic||'').length<10){setMatches([]);return;}
 const timer=setTimeout(()=>api('/customers/matches?'+new URLSearchParams({phone:phone||'',nic:nic||'',...(exclude?{exclude}: {})})).then(x=>{if(active)setMatches(x);}).catch(()=>{}),250);
 return()=>{active=false;clearTimeout(timer);};},[phone,nic,exclude]);
 if(!matches.length)return null;
 return <div className="notice"><b>Existing customer found</b>{matches.map(c=><p key={c._id}>{c.name} · {c.phone} · {c.nic||'NIC pending'} {onChoose&&<button type="button" onClick={()=>onChoose(c)}>Use existing customer</button>}</p>)}
 {onConfirmDifferent&&<label className="check"><input type="checkbox" checked={!!confirmDifferent} onChange={e=>onConfirmDifferent(e.target.checked)}/>This is a different person sharing the phone number (a different NIC is required)</label>}</div>;
}
