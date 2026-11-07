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
test('business workflows against an isolated real MongoDB replica set',{skip:!process.env.TEST_MONGOD_PATH,timeout:120000},async t=>{
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
  const body={order:order._id,payBalance:true,method:'cash',sendVia:'none',requestId:crypto.randomUUID()};
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
  assert.equal((await request('/payments/deposits','POST',{order:order._id,type:'refund',amount:2001,reason:'test'})).status,409);
  await ok('/payments/deposits','POST',{order:order._id,type:'refund',amount:500,reason:'Part released',requestId:crypto.randomUUID()});
  const held=await ok('/payments/deposits/'+order._id);assert.equal(held.held,1500);
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
  const started=await ok('/rentals/start','POST',{order:a._id,payBalance:false,sendVia:'none',requestId:crypto.randomUUID()});
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
});
