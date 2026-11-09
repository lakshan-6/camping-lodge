import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import * as M from '../models/index.js';
import {requireAuth,sign,hashPassword} from '../utils/auth.js';
import {initializeDocumentNumbers} from '../utils/documentNumbers.js';
import {getSettings} from '../routes/settings.js';
import {testDatabase} from './helpers/database.js';
import customerRoutes from '../routes/customers.js';
import equipmentRoutes from '../routes/equipment.js';
import orderRoutes from '../routes/orders.js';
import rentalRoutes from '../routes/rentals.js';
import returnRoutes from '../routes/returns.js';
import paymentRoutes from '../routes/payments.js';
import reports from '../routes/reports.js';
import stats from '../routes/stats.js';
import manage from '../routes/management.js';
import backups from '../routes/backups.js';
import users from '../routes/users.js';
import {createBackup,backupEnvelope,decryptSnapshot} from '../utils/backups.js';
process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.PAST_ORDER_DELETE_KEY='WorkflowKey123@@';process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
test('business workflows against an isolated PostgreSQL database',{timeout:120000},async t=>{
 const cleanup=await testDatabase();t.after(cleanup);await initializeDocumentNumbers();await getSettings();
 const passwordHash=await hashPassword('workflow-test-password');
 const owner=await M.User.create({name:'Owner',username:'owner',passwordHash,role:'owner',lastSeenAt:new Date()});
 const staff=await M.User.create({name:'Staff',username:'staff',passwordHash,role:'staff',lastSeenAt:new Date()});
 let ownerToken=sign(owner),staffToken=sign(staff);
 const app=express();app.use(express.json({limit:'16mb'}));app.use(requireAuth);
 for(const [path,router]of Object.entries({customers:customerRoutes,equipment:equipmentRoutes,orders:orderRoutes,rentals:rentalRoutes,returns:returnRoutes,payments:paymentRoutes,reports,stats,manage,backups,users}))app.use('/'+path,router);
 app.use((e,req,res,next)=>res.status(e.status||(e.name==='ValidationError'?400:500)).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,method='GET',body,token=ownerToken)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};};
 const ok=async(...args)=>{const response=await request(...args);assert.ok(response.status<300,JSON.stringify(response));return response.data;};
 let customer,equipment,order,rental;
 const dates=()=>({startDate:new Date(Date.now()+3600000).toISOString(),endDate:new Date(Date.now()+36*3600000).toISOString()});
 await t.test('customer matching normalizes local/international phones and NIC formats',async()=>{
  customer=await ok('/customers','POST',{name:'Repeat Customer',phone:'0771234567',nic:'123456789v',requestId:crypto.randomUUID()});assert.equal(customer.nic,'123456789V');
  const matches=await ok('/customers/matches?phone=94771234567');assert.equal(matches[0]._id,customer._id);
  assert.equal((await request('/customers','POST',{name:'Duplicate',phone:'94771234567',nic:'200012345678'})).status,409);
  assert.equal((await request('/customers','POST',{name:'Bad',phone:'hello'})).status,400);
  const shared=await ok('/customers','POST',{name:'Family member',phone:'94771234567',nic:'200012345678',confirmDifferentPerson:true});assert.notEqual(shared._id,customer._id);
  assert.equal((await request('/customers/'+shared._id,'PUT',{name:'Family',phone:'0771234567',nic:'123456789V'})).status,409);
 });
 await t.test('inventory only accepts whole consistent quantities and staff cannot change it',async()=>{
  assert.equal((await request('/equipment','POST',{name:'Bad',category:'Tents',totalQuantity:1.5,periodRate:2000})).status,400);
  assert.equal((await request('/equipment','POST',{name:'Bad',category:'Tents',totalQuantity:1,damagedQty:2,periodRate:2000})).status,400);
  equipment=await ok('/equipment','POST',{name:'Tent',category:'Tents',totalQuantity:5,damagedQty:0,periodRate:2000,deposit:1000,checklist:['Poles','Bag']});
  assert.equal((await request('/equipment','PUT',{},staffToken)).status,404);
  assert.equal((await request('/equipment/'+equipment._id,'PUT',{...equipment,totalQuantity:6},staffToken)).status,403);
 });
 await t.test('order/advance are atomic; idempotent retry does not duplicate either',async()=>{
  const body={customer:customer._id,...dates(),items:[{equipment:equipment._id,quantity:3}],advance:{amount:1000,method:'cash'},requestId:crypto.randomUUID()};
  order=await ok('/orders','POST',body);const retry=await ok('/orders','POST',body);assert.equal(retry._id,order._id);assert.equal(await M.Order.countDocuments(),1);assert.equal(await M.Payment.countDocuments(),1);
  const before=await M.Order.countDocuments();assert.equal((await request('/orders','POST',{...body,advance:{amount:100000},requestId:crypto.randomUUID()})).status,409);assert.equal(await M.Order.countDocuments(),before);
  assert.equal((await request('/orders','POST',{...body,items:[{equipment:equipment._id,quantity:1.5}],advance:{amount:0},requestId:crypto.randomUUID()})).status,400);
 });
 await t.test('pickup requires checklist, duplicate/concurrent pickup creates one rental and payment',async()=>{
  const body={order:order._id,payBalance:true,method:'cash',sendVia:'none',securityMethod:'money',securityDeposit:{received:true,amount:1000,method:'cash'},requestId:crypto.randomUUID()};
  assert.equal((await request('/rentals/start','POST',body)).status,400);
  body.checklist=['Tent: Poles','Tent: Bag'].map(label=>({label,checked:true}));
  const results=await Promise.all([request('/rentals/start','POST',body),request('/rentals/start','POST',body)]);assert.deepEqual(results.map(x=>x.status),[201,201]);rental=results[0].data;
  assert.equal(await M.Rental.countDocuments({order:order._id}),1);assert.equal(await M.Payment.countDocuments({order:order._id}),2);
  assert.equal((await request('/rentals/start','POST',{...body,requestId:crypto.randomUUID()})).status,409);
 });
 await t.test('refund and overpayment bounds and security deposits are separate',async()=>{
  assert.equal((await request('/payments','POST',{order:order._id,amount:100000,type:'refund',reason:'test'})).status,409);
  assert.equal((await request('/payments','POST',{order:order._id,amount:1,type:'balance'})).status,409);
  const before=await M.Payment.countDocuments();await ok('/payments/deposits','POST',{order:order._id,type:'collect',amount:2000,requestId:crypto.randomUUID()});assert.equal(await M.Payment.countDocuments(),before);
  assert.equal((await request('/payments/deposits','POST',{order:order._id,type:'refund',amount:3001,reason:'test'})).status,409);
  await ok('/payments/deposits','POST',{order:order._id,type:'refund',amount:500,reason:'Part released',requestId:crypto.randomUUID()});
  const held=await ok('/payments/deposits/'+order._id);assert.equal(held.held,2500);
  assert.equal((await request('/payments','POST',{order:order._id,amount:1,type:'refund',reason:'test'},staffToken)).status,403);
 });
 await t.test('partial returns release only received items; damage/loss and fees are not double-recorded',async()=>{
  const body={rental:rental._id,items:[{equipment:equipment._id,quantityReturned:1,quantityDamaged:0,quantityLost:0}],damageFee:0,requestId:crypto.randomUUID()};
  const result=await ok('/returns','POST',body);assert.equal(result.partial,true);await ok('/returns','POST',body);assert.equal(await M.Return.countDocuments(),1);
  let lines=await M.OrderItem.find({order:order._id});assert.equal(lines[0].returnedQuantity,1);assert.equal((await M.Rental.findById(rental._id)).status,'out');
  const stock=await import('../utils/availability.js');const avail=await stock.availability(new Date(),new Date(Date.now()+1000));assert.equal(avail.find(i=>String(i._id)===equipment._id).available,3);
  const final={rental:rental._id,items:[{equipment:equipment._id,quantityReturned:1,quantityDamaged:1,quantityLost:0}],damageFee:250,checklist:['Tent: Poles','Tent: Bag'].map(label=>({label,checked:true})),requestId:crypto.randomUUID()};
  await ok('/returns','POST',final);assert.equal((await M.Rental.findById(rental._id)).status,'returned');assert.equal((await M.Equipment.findById(equipment._id)).damagedQty,1);assert.equal((await M.Order.findById(order._id)).totalAmount,6250);
  assert.equal((await request('/returns','POST',{...final,requestId:crypto.randomUUID()})).status,409);
 });
 await t.test('repair completion is idempotent, releases stock and records its expense once',async()=>{
  const repair=await ok('/equipment/repairs','POST',{equipment:equipment._id,quantity:1,notes:'Repair poles',requestId:crypto.randomUUID()});
  const body={cost:150,method:'bank_transfer',requestId:crypto.randomUUID()};await ok(`/equipment/repairs/${repair._id}/complete`,'POST',body);await ok(`/equipment/repairs/${repair._id}/complete`,'POST',body);
  assert.equal((await M.Equipment.findById(equipment._id)).damagedQty,0);assert.equal(await M.Expense.countDocuments({repair:repair._id}),1);
  assert.equal((await M.Expense.findOne({repair:repair._id})).method,'bank_transfer');
 });
 await t.test('cancellation with an advance stays visible for refunds until resolved',async()=>{
  const booking=await ok('/orders','POST',{customer:customer._id,...dates(),items:[{equipment:equipment._id,quantity:1}],advance:{amount:500},requestId:crypto.randomUUID()});
  await ok(`/orders/${booking._id}/cancel`,'PATCH',{action:'pending',reason:'Customer cancelled',requestId:crypto.randomUUID()});
  let balances=await ok('/payments/balances');assert.equal(balances.find(b=>b._id===booking._id).refundDue,500);
  assert.equal((await request('/orders/'+booking._id,'DELETE',{})).status,409);
  await ok('/payments','POST',{order:booking._id,type:'refund',amount:500,reason:'Refund received by customer',requestId:crypto.randomUUID()});
  await ok('/orders/'+booking._id,'DELETE',{requestId:crypto.randomUUID()});
 });
 await t.test('late pickup / extension conflicts cannot overbook another reservation',async()=>{
  const eq=await ok('/equipment','POST',{name:'Only tent',category:'Tents',totalQuantity:1,periodRate:100});
  const now=Date.now(),a=await ok('/orders','POST',{customer:customer._id,startDate:new Date(now-36*3600000).toISOString(),endDate:new Date(now-1000).toISOString(),items:[{equipment:eq._id,quantity:1}],requestId:crypto.randomUUID()});
  const b=await ok('/orders','POST',{customer:customer._id,startDate:new Date(now+3600000).toISOString(),endDate:new Date(now+36*3600000).toISOString(),items:[{equipment:eq._id,quantity:1}],requestId:crypto.randomUUID()});
  assert.equal((await request('/rentals/start','POST',{order:a._id,payBalance:false,sendVia:'none',requestId:crypto.randomUUID()})).status,409);
  await ok(`/orders/${b._id}/cancel`,'PATCH',{action:'pending',reason:'test',requestId:crypto.randomUUID()});
  const started=await ok('/rentals/start','POST',{order:a._id,payBalance:false,sendVia:'none',securityMethod:'nic',nicReceived:true,requestId:crypto.randomUUID()});
  const next=await ok('/orders','POST',{customer:customer._id,startDate:new Date(+new Date(started.dueDate)+1000).toISOString(),endDate:new Date(+new Date(started.dueDate)+36*3600000).toISOString(),items:[{equipment:eq._id,quantity:1}],requestId:crypto.randomUUID()});
  assert.equal((await request(`/rentals/${started._id}/extend`,'POST',{periods:1,requestId:crypto.randomUUID()})).status,409);
  await ok(`/orders/${next._id}/cancel`,'PATCH',{action:'pending',reason:'test',requestId:crypto.randomUUID()});
  await ok(`/rentals/${started._id}/extend`,'POST',{periods:1,requestId:crypto.randomUUID()});
 });
 await t.test('reports use Sri Lanka day boundaries; exports neutralize spreadsheet formulas',async()=>{
  await M.Payment.create([{order:order._id,amount:123,type:'rental',paidAt:new Date('2026-11-06T18:31:00Z')},{order:order._id,amount:456,type:'rental',paidAt:new Date('2026-11-07T18:31:00Z')}]);
  const report=await ok('/reports?from=2026-11-07&to=2026-11-07');assert.ok(report.revenue>=123);
  const e=await ok('/manage/expenses','POST',{amount:10,description:'=DANGEROUS()',category:'Other',spentAt:'2026-11-07T12:00:00+05:30',requestId:crypto.randomUUID()});
  const csv=await ok('/manage/export/expenses');assert.ok(csv.includes("'=DANGEROUS()"));
  assert.equal((await request('/reports?from=2026-11-07&to=2026-11-07','GET',undefined,staffToken)).status,403);
  const dashboard=await ok('/stats','GET',undefined,staffToken);assert.equal(dashboard.revenue,null);
 });
 await t.test('owner can grant selected staff permissions without granting owner-only access',async()=>{
  await ok('/users/'+staff._id,'PATCH',{permissions:['orders.write','customers.write','payments.record','returns.write','reports.view']});
  const report=await ok('/reports?from=2026-11-07&to=2026-11-07','GET',undefined,staffToken);assert.ok(Number.isFinite(report.revenue));
  assert.equal((await request('/manage/audit','GET',undefined,staffToken)).status,403);assert.equal((await request('/backups','GET',undefined,staffToken)).status,403);
  const history=await ok('/customers/'+customer._id+'/history');assert.ok(history.orders.length>=2);assert.ok(history.returns.length>=2);
  const audit=await ok('/manage/audit');assert.ok(audit.some(a=>a.action==='order.created'));assert.equal(JSON.stringify(audit).includes(passwordHash),false);
 });
 await t.test('customer deletion checks permissions, all history and idempotent retries',async()=>{
  const createBody={name:'Disposable customer',phone:'0777654321',nic:'200123456789',requestId:crypto.randomUUID()};
  const disposable=await ok('/customers','POST',createBody),path='/customers/'+disposable._id;
  assert.equal((await request(path+'/delete-preview','GET',undefined,staffToken)).status,403);
  assert.equal((await request(path,'DELETE',{},staffToken)).status,403);
  const preview=await ok(path+'/delete-preview');assert.equal(preview.canDelete,true);assert.equal(preview.orders,0);
  const users=await M.User.countDocuments(),stock=await M.Equipment.find().lean(),orders=await M.Order.countDocuments();
  const body={requestId:crypto.randomUUID()};assert.equal((await ok(path,'DELETE',body)).deleted,true);
  assert.equal((await ok(path,'DELETE',body))._replayed,true);
  assert.equal(await M.Customer.findById(disposable._id),null);
  assert.equal(await M.Mutation.countDocuments({'result._id':disposable._id}),0);
  assert.equal((await request(path+'/history')).status,404);assert.equal((await request(path+'/delete-preview')).status,404);
  assert.equal((await request(path,'DELETE',{requestId:crypto.randomUUID()})).status,404);
  assert.equal((await ok('/customers/matches?phone=0777654321')).length,0);
  assert.equal(await M.User.countDocuments(),users);assert.deepEqual(await M.Equipment.find().lean(),stock);assert.equal(await M.Order.countDocuments(),orders);
  assert.equal(await M.AuditEvent.countDocuments({action:'customer.deleted',target:disposable._id}),1);
  assert.equal((await request('/customers/'+customer._id,'DELETE',{})).status,409);
  const guarded=await M.Customer.create({name:'History guard',phone:'0778888888'}),guardPath='/customers/'+guarded._id;
  const hidden=await M.Order.create({orderNo:'DELETE-GUARD',customer:guarded._id,...dates(),status:'cancelled',deletedAt:new Date()});
  assert.equal((await ok(guardPath+'/delete-preview')).orders,1);assert.equal((await request(guardPath,'DELETE',{})).status,409);
  await M.Order.deleteOne({_id:hidden._id});
  await assert.rejects(()=>M.Invoice.create({invoiceNo:'ORPHAN-GUARD',order:hidden._id,customer:guarded._id}),e=>e.code==='23503');
  const invoice=await M.Invoice.create({invoiceNo:'DELETE-GUARD',order:order._id,customer:guarded._id});
  assert.equal((await ok(guardPath+'/delete-preview')).invoices,1);assert.equal((await request(guardPath,'DELETE',{})).status,409);await M.Invoice.deleteOne({_id:invoice._id});
  const rental=await M.Rental.create({order:order._id,customer:guarded._id,dueDate:new Date(),status:'returned'});
  assert.equal((await ok(guardPath+'/delete-preview')).rentals,1);assert.equal((await request(guardPath,'DELETE',{})).status,409);await M.Rental.deleteOne({_id:rental._id});
  await ok('/users/'+staff._id,'PATCH',{permissions:['customers.write','customers.delete']});
  assert.equal((await ok(guardPath,'DELETE',{},staffToken)).deleted,true);
  const rollback=await ok('/customers','POST',{name:'Rollback test',phone:'0779999999',requestId:crypto.randomUUID()});
  const auditCreate=M.AuditEvent.create;
  try{
   M.AuditEvent.create=async()=>{throw new Error('Simulated audit failure');};
   assert.equal((await request('/customers/'+rollback._id,'DELETE',{requestId:crypto.randomUUID()})).status,500);
  }finally{M.AuditEvent.create=auditCreate;}
  assert.ok(await M.Customer.findById(rollback._id));assert.equal(await M.Mutation.countDocuments({'result._id':rollback._id}),1);
  await ok('/customers/'+rollback._id,'DELETE',{requestId:crypto.randomUUID()});
 });
 await t.test('encrypted backups restore atomically and invalidate prior sessions',async()=>{
  const backup=await createBackup('integration-snapshot'),envelope=backupEnvelope(backup),content=decryptSnapshot(envelope);assert.ok(content.collections.Order.length>0);
  const beforeCount=await M.Order.countDocuments();await M.Order.updateOne({_id:order._id},{$set:{notes:'AFTER BACKUP'}});
  await M.User.updateOne({_id:owner._id},{$set:{sessionVersion:5}});ownerToken=sign(await M.User.findById(owner._id));
  assert.equal((await request('/backups/restore','POST',{backup:envelope,confirmation:'wrong',accessKey:process.env.PAST_ORDER_DELETE_KEY})).status,400);
  const corrupted={...envelope,data:Buffer.from('tampered').toString('base64')};assert.equal((await request('/backups/restore','POST',{backup:corrupted,confirmation:'RESTORE',accessKey:process.env.PAST_ORDER_DELETE_KEY})).status,400);
  await ok('/backups/restore','POST',{backup:envelope,confirmation:'RESTORE',accessKey:process.env.PAST_ORDER_DELETE_KEY});assert.equal(await M.Order.countDocuments(),beforeCount);assert.notEqual((await M.Order.findById(order._id)).notes,'AFTER BACKUP');
  assert.equal((await request('/stats')).status,401);ownerToken=sign(await M.User.findById(owner._id));
  assert.equal((await M.User.findById(owner._id)).sessionVersion,6);
  assert.ok((await ok('/manage/audit')).some(a=>a.action==='backup.restored'));
 });
 await t.test('booking identifies customers by NIC and saves new customers with their orders',async()=>{
  const gear=await ok('/equipment','POST',{name:'Booking test lantern',category:'Lighting',totalQuantity:6,periodRate:800,deposit:500});
  const body={...dates(),items:[{equipment:gear._id,quantity:1}],securityMethod:'nic',requestId:crypto.randomUUID()};
  const details={name:'Booking Customer',phone:'0773333333',nic:'987654321v',email:'booking@example.test',address:'Colombo'};
  const beforeCustomers=await M.Customer.countDocuments(),beforeOrders=await M.Order.countDocuments();
  for(const field of ['name','phone','nic'])assert.equal((await request('/orders','POST',{...body,customerDetails:{...details,[field]:' '}})).status,400);
  assert.equal((await request('/orders','POST',{...body,securityMethod:'money',customerDetails:{...details,nic:''}})).status,400);
  assert.equal((await request('/orders','POST',{...body,items:[{equipment:gear._id,quantity:7}],customerDetails:details})).status,409);
  await ok('/users/'+staff._id,'PATCH',{permissions:['orders.write']});
  assert.equal((await request('/orders','POST',{...body,customerDetails:details},sign(await M.User.findById(staff._id)))).status,403);
  assert.equal(await M.Customer.countDocuments(),beforeCustomers);
  assert.equal(await M.Order.countDocuments(),beforeOrders);
  const [created, concurrent]=await Promise.all([
   ok('/orders','POST',{...body,customerDetails:details}),
   ok('/orders','POST',{...body,requestId:crypto.randomUUID(),customerDetails:{...details,nic:details.nic.toUpperCase()}}),
  ]);
  assert.notEqual(created._id,concurrent._id);assert.equal(created.customer,concurrent.customer);
  assert.equal((await ok('/orders','POST',{...body,customerDetails:details}))._id,created._id);
  assert.equal(created.securityMethod,'nic');
  const saved=await M.Customer.findById(created.customer);
  assert.equal(saved.nic,'987654321V');assert.equal(saved.email,details.email);assert.equal(saved.address,details.address);
  const returning=await ok('/orders','POST',{...body,requestId:crypto.randomUUID(),customerDetails:{...details,name:'Unconfirmed change'}},sign(await M.User.findById(staff._id)));
  assert.equal(returning.customer,created.customer);assert.equal((await M.Customer.findById(created.customer)).name,details.name);
  const next=await ok('/orders','POST',{...body,requestId:crypto.randomUUID(),securityMethod:'money',customerDetails:{name:'Optional fields blank',phone:'94773333333',nic:'200411112222'}});
  assert.notEqual(next.customer,created.customer);
  assert.equal(next.securityMethod,'money');assert.equal(await M.DepositTransaction.countDocuments({order:next._id}),0);
  assert.equal(await M.Customer.countDocuments(),beforeCustomers+2);assert.equal(await M.Order.countDocuments(),beforeOrders+4);
  const legacy=await M.Customer.create({name:'Incomplete profile',phone:'0775555555'});
  const newPerson={...body,requestId:crypto.randomUUID(),customerDetails:{name:'Different person',phone:legacy.phone,nic:'200433334444'}};
  assert.equal((await request('/orders','POST',newPerson)).status,409);
  const separate=await ok('/orders','POST',{...newPerson,customerDetails:{...newPerson.customerDetails,confirmDifferentPerson:true}});
  assert.notEqual(separate.customer,legacy._id);assert.equal((await M.Customer.findById(legacy._id)).nic,undefined);
 });
});
