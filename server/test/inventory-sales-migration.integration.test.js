import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {connectTestDatabase,closeDatabase,query} from '../db/connection.js';

test('schema upgrade from version six preserves existing rental and payment records',{timeout:120000},async t=>{
 const engine=new PGlite();
 t.after(closeDatabase);
 await engine.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 await engine.exec(`
  ALTER TABLE equipment DROP COLUMN "itemType", DROP COLUMN "sellingPrice";
  ALTER TABLE order_items DROP COLUMN "itemType";
  ALTER TABLE orders DROP COLUMN "fulfilledAt";
  ALTER TABLE payments DROP COLUMN "saleAmount";
  ALTER TABLE inventory_transactions DROP CONSTRAINT inventory_transactions_type_check;
  ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_type_check
   CHECK (type IN ('initial_stock','adjustment','rented_out','returned','damaged','lost','repaired'));
  CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
  INSERT INTO schema_migrations(version) SELECT generate_series(1,6);
 `);
 const id={
  customer:'012345678901234567890101',equipment:'012345678901234567890102',
  order:'012345678901234567890103',line:'012345678901234567890104',
  payment:'012345678901234567890105',transaction:'012345678901234567890106',
 };
 const createdAt=new Date('2026-11-01T05:00:00Z');
 await engine.query('INSERT INTO customers("_id",name,phone,nic,"createdAt") VALUES($1,$2,$3,$4,$5)',
  [id.customer,'Legacy renter','0771234567','123456789V',createdAt]);
 await engine.query('INSERT INTO equipment("_id",name,category,"totalQuantity","damagedQty","periodRate","createdAt") VALUES($1,$2,$3,$4,$5,$6,$7)',
  [id.equipment,'Legacy tent','Camping',2,0,125.50,createdAt]);
 await engine.query('INSERT INTO orders("_id","orderNo",customer,"startDate","endDate",status,periods,"totalAmount","createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [id.order,'CL-LEGACY-7',id.customer,createdAt,new Date(+createdAt+72*3600000),'active',2,251,createdAt]);
 await engine.query('INSERT INTO order_items("_id","order",equipment,quantity,"returnedQuantity","periodRate",periods,"lineTotal","createdAt") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [id.line,id.order,id.equipment,1,0,125.50,2,251,createdAt]);
 await engine.query('INSERT INTO payments("_id","order",amount,type,method,"paidAt","createdAt") VALUES($1,$2,$3,$4,$5,$6,$7)',
  [id.payment,id.order,100.25,'deposit','cash',createdAt,createdAt]);
 await engine.query('INSERT INTO inventory_transactions("_id",equipment,type,quantity,reference,"createdAt") VALUES($1,$2,$3,$4,$5,$6)',
  [id.transaction,id.equipment,'rented_out',-1,id.order,createdAt]);
 const retainedTables=['customers','equipment','orders','order_items','payments','inventory_transactions'];
 const before=Object.fromEntries(await Promise.all(retainedTables.map(async table=>
  [table,(await engine.query('SELECT * FROM '+table+' ORDER BY "_id"')).rows])));

 await connectTestDatabase(engine);
 const additions={
  equipment:{itemType:'rental',sellingPrice:'0.00'},
  orders:{fulfilledAt:null},
  order_items:{itemType:'rental'},
  payments:{saleAmount:'0.00'},
 };
 for(const table of retainedTables){
  const rows=(await query('SELECT * FROM '+table+' ORDER BY "_id"')).rows;
  for(const [field,value]of Object.entries(additions[table]||{})){
   assert.equal(rows[0][field],value,table+'.'+field);
   delete rows[0][field];
  }
  assert.deepEqual(rows,before[table],table+' retains prior values');
 }
 assert.deepEqual((await query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row=>row.version),[1,2,3,4,5,6,7]);
 await query('UPDATE equipment SET "itemType"=$1,"sellingPrice"=$2 WHERE "_id"=$3',['sale',350,id.equipment]);
 assert.equal((await query('SELECT "itemType",periods,"periodRate","lineTotal" FROM order_items WHERE "_id"=$1',[id.line])).rows[0].itemType,'rental');
 await query('UPDATE equipment SET "itemType"=$1 WHERE "_id"=$2',['rental',id.equipment]);
 await connectTestDatabase(engine);
 assert.equal((await query('SELECT count(*)::int AS count FROM schema_migrations WHERE version=7')).rows[0].count,1);
 assert.equal((await query('SELECT "saleAmount" FROM payments WHERE "_id"=$1',[id.payment])).rows[0].saleAmount,'0.00');
});
