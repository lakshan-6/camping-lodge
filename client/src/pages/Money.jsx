import Billing from './Billing.jsx';
import Payments from './Payments.jsx';
import {can} from '../permissions.js';
import {CashReconciliation} from './Reconciliation.jsx';
import {useSearchParams} from 'react-router-dom';
export default function Money({me}){const [params,setParams]=useSearchParams(),tab=params.get('view')||'invoices',financial=['finance.view','payments.record','payments.refund'].some(p=>can(me,p)),cash=can(me,'finance.view')||can(me,'finance.close');const tabs=[['invoices','Invoices'],...(financial?[['payments','Payments / deposits']]:[]),...(cash?[['cash','Daily cash close']]:[])];return <><div className="bar" role="tablist" aria-label="Money views">{tabs.map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} className={tab===key?'btn':''} onClick={()=>setParams({view:key})}>{label}</button>)}</div>{tab==='cash'&&cash?<CashReconciliation me={me}/>:tab==='payments'&&financial?<Payments me={me}/>:<Billing me={me}/>}</>;}
