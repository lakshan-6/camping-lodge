import * as validation from '../models/validation.js';

export const tableNames={Counter:'counters',Equipment:'equipment',EquipmentUnit:'equipment_units',Customer:'customers',Order:'orders',OrderItem:'order_items',Rental:'rentals',Return:'returns',ReturnItem:'return_items',Payment:'payments',Invoice:'invoices',InventoryTransaction:'inventory_transactions',User:'users',Settings:'settings',DepositTransaction:'deposit_transactions',AuditEvent:'audit_events',Mutation:'mutations',Repair:'repairs',Expense:'expenses',Backup:'backups',CashClose:'cash_closes',StockCount:'stock_counts'};
export const relations={
 OrderItem:{unitAssignments:{table:'order_item_units',parent:'orderItem',fields:['unit','code','outcome','returnedAt']}},
 ReturnItem:{units:{table:'return_item_units',parent:'returnItem',fields:['unit','code','condition']}},
 Repair:{units:{table:'repair_units',parent:'repair',fields:['unit'],ids:true}}
};
const integerFields=new Set(['value','totalQuantity','damagedQty','revision','securityRevision','periods','quantity','returnedQuantity','latePeriodsCharged','quantityReturned','quantityDamaged','quantityLost','sessionVersion','mfaLastStep','graceMinutes','size','countedGood','countedDamaged','outQuantity']);
export const quote=name=>'"'+String(name).replaceAll('"','""')+'"';
export const definitions=Object.fromEntries(Object.entries(validation).map(([name,Validator])=>{
 const fields=Object.fromEntries(Object.entries(Validator.schema.paths).filter(([key])=>key!=='__v'&&!relations[name]?.[key]).map(([key,path])=>{
  let type=path.instance==='Number'?(integerFields.has(key)?'bigint':'numeric(16,2)'):path.instance==='Date'?'timestamptz':path.instance==='Boolean'?'boolean':path.instance==='Buffer'?'bytea':['Array','Mixed','Embedded'].includes(path.instance)?'jsonb':'text';
  return [key,{path,type,ref:path.options.ref,private:path.options.select===false}];
 }));
 return [name,{name,table:tableNames[name],Validator,fields,relations:relations[name]||{}}];
}));
