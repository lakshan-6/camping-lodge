import {writeFile} from 'node:fs/promises';
import {definitions,tableNames,quote as q} from '../db/definitions.js';
const ddl=['-- PostgreSQL schema v1. Generated from validation definitions; reviewed constraints below.'];
const foreign=[];
for(const d of Object.values(definitions)){
 const columns=[];
 for(const [key,f]of Object.entries(d.fields)){
  let line=q(key)+' '+f.type;
  if(key==='_id')line+=' PRIMARY KEY';else if(f.path.isRequired)line+=' NOT NULL';
  if(key==='_id'&&!['Counter','Mutation'].includes(d.name))line+=" CHECK (\"_id\" ~ '^[a-f0-9]{24}$')";
  if(f.path.options.min!==undefined)line+=` CHECK (${q(key)} >= ${Number(f.path.options.min)})`;
  if(f.path.options.max!==undefined)line+=` CHECK (${q(key)} <= ${Number(f.path.options.max)})`;
  if(f.path.enumValues?.length)line+=` CHECK (${q(key)} IN (${f.path.enumValues.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')}))`;
  columns.push(line);
  if(f.ref)foreign.push(`ALTER TABLE ${q(d.table)} ADD CONSTRAINT ${q(d.table+'_'+key+'_fk')} FOREIGN KEY (${q(key)}) REFERENCES ${q(tableNames[f.ref])}("_id")${f.ref==='User'?' ON DELETE SET NULL':''} DEFERRABLE INITIALLY DEFERRED;`);
 }
 if(d.name==='Equipment')columns.push('CHECK ("damagedQty" <= "totalQuantity")');
 if(d.name==='Order')columns.push('CHECK ("endDate" > "startDate")');
 if(d.name==='OrderItem')columns.push('CHECK ("returnedQuantity" <= "quantity")');
 ddl.push(`CREATE TABLE ${q(d.table)} (\n  ${columns.join(',\n  ')}\n);`);
 for(const [key,f]of Object.entries(d.fields)){
  if(f.path.options.unique)ddl.push(`CREATE UNIQUE INDEX ${q(d.table+'_'+key+'_unique')} ON ${q(d.table)} (${q(key)});`);
  else if(f.ref||f.path.options.index)ddl.push(`CREATE INDEX ${q(d.table+'_'+key+'_idx')} ON ${q(d.table)} (${q(key)});`);
 }
}
ddl.push(...foreign);
for(const [model,d]of Object.entries(definitions))for(const [key,r]of Object.entries(d.relations)){
 const extra=r.ids?'':key==='unitAssignments'?', "code" text NOT NULL, "outcome" text NOT NULL CHECK ("outcome" IN (\'out\',\'good\',\'damaged\',\'lost\')), "returnedAt" timestamptz':', "code" text NOT NULL, "condition" text NOT NULL CHECK ("condition" IN (\'good\',\'damaged\',\'lost\'))';
 ddl.push(`CREATE TABLE ${q(r.table)} (${q(r.parent)} text NOT NULL REFERENCES ${q(d.table)}("_id") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED, "unit" text NOT NULL REFERENCES equipment_units("_id") DEFERRABLE INITIALLY DEFERRED, "position" integer NOT NULL${r.ids?'':', "_id" text'}${extra}, PRIMARY KEY (${q(r.parent)}, "unit"));`);
 ddl.push(`CREATE INDEX ${q(r.table+'_unit_idx')} ON ${q(r.table)}("unit");`);
}
ddl.push('CREATE UNIQUE INDEX users_single_owner ON users ((role)) WHERE role=\'owner\';',
 'CREATE UNIQUE INDEX customers_nic_unique ON customers (upper(nic)) WHERE nic IS NOT NULL AND nic <> \'\';',
 'CREATE UNIQUE INDEX cash_close_revision_unique ON cash_closes(day,revision);',
 'CREATE INDEX orders_status_dates_idx ON orders(status,"startDate","endDate");',
 'CREATE INDEX rentals_status_due_idx ON rentals(status,"dueDate");',
 'CREATE INDEX payments_paid_at_idx ON payments("paidAt");',
 'CREATE INDEX equipment_units_state_idx ON equipment_units(equipment,state);',
 'CREATE INDEX audit_events_created_idx ON audit_events("createdAt");',
 'CREATE INDEX mutations_result_idx ON mutations USING gin(result);',
 'CREATE UNIQUE INDEX unit_single_outstanding_allocation ON order_item_units(unit) WHERE outcome=\'out\';',
 'CREATE UNIQUE INDEX customer_single_held_nic ON orders(customer) WHERE "nicHeldAt" IS NOT NULL AND "nicReturnedAt" IS NULL;',
 'CREATE TABLE data_migrations (name text PRIMARY KEY, summary jsonb NOT NULL, completed_at timestamptz NOT NULL DEFAULT now());');
await writeFile(new URL('../db/schema.sql',import.meta.url),ddl.join('\n\n')+'\n');
console.log('PostgreSQL schema generated');
