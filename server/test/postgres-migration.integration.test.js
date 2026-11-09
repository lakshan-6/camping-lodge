import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as M from '../models/index.js';
import {testDatabase} from './helpers/database.js';
import {query,inTransaction} from '../db/connection.js';
import {definitions} from '../db/definitions.js';
import {importSnapshot} from '../db/importSnapshot.js';
import {hashPassword,checkPassword} from '../utils/auth.js';
import {createBackup,backupEnvelope,decryptSnapshot} from '../utils/backups.js';
import {invoicePdfBuffer} from '../utils/invoiceMail.js';

process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
test('PostgreSQL enforces relations and verifies a lossless migration before cutover',{timeout:120000},async t=>{
 const cleanup=await testDatabase();t.after(cleanup);
 const owner=await M.User.create({name:'Migration Owner',username:'migration_owner',passwordHash:await hashPassword('MigrationPassword123!'),role:'owner'});
 const customer=await M.Customer.create({name:"O'Brien; DROP TABLE customers; --",phone:'0771234567',nic:'123456789V'});
 const equipment=await M.Equipment.create({name:'Migration sleeping bag',category:'Sleeping',totalQuantity:2,damagedQty:1,periodRate:125.50,trackUnits:true,unitPrefix:'SB'});
 await M.Counter.create([{_id:'unit:SB',value:2},{_id:'order',value:42},{_id:'invoice',value:7}]);
 const order=await M.Order.create({orderNo:'CL-0042',customer:customer._id,startDate:new Date('2026-11-08T00:00:00Z'),endDate:new Date('2026-11-10T00:00:00Z'),status:'active',periods:2,totalAmount:251,securityMethod:'nic',nicHeldAt:new Date(),nicHeldBy:owner._id});
 const rental=await M.Rental.create({order:order._id,customer:customer._id,dueDate:order.endDate,status:'out'});
 const units=await M.EquipmentUnit.create([{equipment:equipment._id,code:'SB-001',state:'out',rental:rental._id},{equipment:equipment._id,code:'SB-002',state:'repair'}]);
 await M.OrderItem.create({order:order._id,equipment:equipment._id,quantity:1,periodRate:125.5,periods:2,lineTotal:251,unitAssignments:[{unit:units[0]._id,code:'SB-001',outcome:'out'}]});
 await M.Repair.create({equipment:equipment._id,quantity:1,units:[units[1]._id],status:'open',notes:'Stitching'});
 const invoice=await M.Invoice.create({invoiceNo:'INV-0007',order:order._id,customer:customer._id,total:251,subtotal:251,status:'issued'});
 await M.Payment.create({order:order._id,invoice:invoice._id,amount:100.25,type:'deposit',method:'cash'});
 await M.AuditEvent.create({actor:owner._id,actorName:owner.name,action:'migration.fixture',target:order._id});
 await M.Settings.create({businessName:'Migration Test'});
 const encrypted=await createBackup('before-migration-test');
 await t.test('raw SQL cannot insert orphaned records, negative stock or a second owner',async()=>{
  await assert.rejects(()=>query('INSERT INTO payments("_id","order",amount) VALUES($1,$2,$3)',['012345678901234567890123','000000000000000000000000',1]),e=>e.code==='23503');
  await assert.rejects(()=>query('UPDATE equipment SET "damagedQty"=99 WHERE "_id"=$1',[equipment._id]),e=>e.code==='23514');
  await assert.rejects(()=>query('INSERT INTO users("_id",name,username,"passwordHash",role) VALUES($1,$2,$3,$4,$5)',['012345678901234567890124','Second owner','second_owner','test','owner']),e=>e.code==='23505');
  assert.equal((await M.Customer.findOne({name:customer.name}))._id,customer._id);
  const first=await M.User.findById(owner._id),second=await M.User.findById(owner._id);first.sessionVersion++;await first.save();second.lastSeenAt=new Date();await second.save();assert.equal((await M.User.findById(owner._id)).sessionVersion,1);
 });
 const snapshot={version:1,createdAt:new Date(),collections:{}};
 for(const [name,Model]of Object.entries(M))snapshot.collections[name]=await Model.find().select([...Object.keys(definitions[name].fields),...Object.keys(definitions[name].relations)].join(' ')).lean();
 await inTransaction(async session=>{for(const Model of Object.values(M))await Model.deleteMany({},{session});});
 await t.test('dry run checks every field, timestamp, identifier and foreign key then rolls back',async()=>{
  const check=await importSnapshot(snapshot,{dryRun:true});assert.equal(check.verified,true);assert.equal(check.counts.Customer,1);assert.equal(check.counts.EquipmentUnit,2);assert.equal(await M.User.countDocuments(),0);assert.equal((await query('SELECT * FROM data_migrations')).rows.length,0);
 });
 await t.test('invalid source fails without leaving partial imported records',async()=>{
  const broken=structuredClone(snapshot);broken.collections.Payment[0].order='000000000000000000000000';await assert.rejects(()=>importSnapshot(broken),/reference/);assert.equal(await M.User.countDocuments(),0);
 });
 await t.test('committed migration preserves passwords, labels, money, original times and encrypted backups',async()=>{
  const imported=await importSnapshot(snapshot);assert.equal(imported.verified,true);
  const saved=await M.User.findById(owner._id);assert.ok(await checkPassword('MigrationPassword123!',saved.passwordHash));assert.equal(+saved.createdAt,+owner.createdAt);
  assert.equal((await M.Order.findById(order._id)).orderNo,'CL-0042');assert.equal((await M.Payment.findOne({order:order._id})).amount,100.25);
  const pdf=await invoicePdfBuffer(invoice._id);assert.equal(pdf.invoiceNo,'INV-0007');assert.equal(pdf.buffer.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.buffer.length>1000);
  assert.equal((await M.EquipmentUnit.findById(units[0]._id)).code,'SB-001');assert.equal((await M.EquipmentUnit.findById(units[0]._id)).rental,rental._id);
  const backup=await M.Backup.findById(encrypted._id);assert.equal(backup.payload.toString('hex'),encrypted.payload.toString('hex'));assert.equal(decryptSnapshot(backupEnvelope(backup)).collections.User[0]._id,owner._id);
  assert.equal((await query('SELECT * FROM data_migrations')).rows.length,1);
 });
 await t.test('repeat migration or another snapshot cannot overwrite a populated database',async()=>{
  await assert.rejects(()=>importSnapshot(snapshot),/already completed/);await assert.rejects(()=>importSnapshot(snapshot,{name:'different'}),/not empty/);assert.equal(await M.Payment.countDocuments(),1);
 });
});
