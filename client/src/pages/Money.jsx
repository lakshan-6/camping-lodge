import Billing from './Billing.jsx';
import Payments from './Payments.jsx';
import {can} from '../permissions.js';
import {CashReconciliation} from './Reconciliation.jsx';
import {useSearchParams} from 'react-router-dom';
import {PageIntro} from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
export default function Money({me}){
 const [params,setParams]=useSearchParams(),financial=can(me,'finance.view')||can(me,'payments.refund'),cash=can(me,'finance.view')||can(me,'finance.close');
 const tabs=[...(financial?[['invoices','Invoices','report'],['payments','Payments & deposits','wallet']]:[]),...(cash?[['cash','Daily cash close','clipboard']]:[])];
 const tab=tabs.some(t=>t[0]===params.get('view'))?params.get('view'):tabs[0]?.[0];
 function change(key){setParams({view:key});}
 function move(e,index){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;change(tabs[next][0]);document.getElementById('money-tab-'+tabs[next][0])?.focus();}
 return <><PageIntro eyebrow="Your finances" title="Every payment. A clear picture." description="Manage invoices, rental payments and security deposits in one place."/>
 <div className="section-tabs" role="tablist" aria-label="Money views">{tabs.map(([key,label,icon],index)=><button key={key} id={'money-tab-'+key} role="tab" aria-selected={tab===key} aria-controls="money-panel" tabIndex={tab===key?0:-1} onKeyDown={e=>move(e,index)} onClick={()=>change(key)}><Icon name={icon} size={16}/>{label}</button>)}</div>
 <section role="tabpanel" id="money-panel" aria-labelledby={'money-tab-'+tab}>{tab==='cash'&&cash?<CashReconciliation me={me}/>:tab==='payments'&&financial?<Payments me={me}/>:<Billing me={me}/>}</section></>;
}
