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
import equipmentRoutes from '../routes/equipment.js';
import orderRoutes from '../routes/orders.js';
import rentalRoutes from '../routes/rentals.js';
import returnRoutes from '../routes/returns.js';
import paymentRoutes from '../routes/payments.js';

process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');

test('late-fee waivers adjust charges atomically while retaining receipts and equipment history',{timeout:120000},async t=>{
 const cleanup=await testDatabase();
 t.after(cleanup);
 await initializeDocumentNumbers();
 await getSettings();
 const passwordHash=await hashPassword('LateFeeWaiverTest123!');
 const owner=await M.User.create({name:'Owner',username:'waiver_owner',role:'owner',passwordHash});
 const staff=await M.User.create({name:'Returns desk',username:'waiver_staff',role:'staff',passwordHash});
 const token=sign(owner),staffToken=sign(staff);
 const customer=await M.Customer.create({name:'Waiver customer',phone:'0771234567',nic:'123456789V'});
 const app=express();
 app.use(express.json());
 app.use(requireAuth);
 for(const [path,router]of Object.entries({equipment:equipmentRoutes,orders:orderRoutes,rentals:rentalRoutes,returns:returnRoutes,payments:paymentRoutes})){
  app.use('/'+path,router);
 }
 app.use((error,req,res,next)=>res.status(error.status||(error.name==='ValidationError'?400:500)).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,method='GET',body,authToken=token){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+authToken},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 }
 async function ok(...args){
  const response=await request(...args);
  assert.ok(response.status<300,JSON.stringify(response));
  return response.data;
 }
 let sequence=0;
 async function startRental(quantity=1){
  const gear=await ok('/equipment','POST',{name:'Waiver tent '+(++sequence),category:'Tents',totalQuantity:quantity,periodRate:1000});
  const booking=await ok('/orders','POST',{customer:customer._id,startDate:new Date(Date.now()+3600000).toISOString(),
   endDate:new Date(Date.now()+36*3600000).toISOString(),items:[{equipment:gear._id,quantity}],
   advance:{amount:quantity*1000,method:'cash'},requestId:crypto.randomUUID()});
  const rental=await ok('/rentals/start','POST',{order:booking._id,securityMethod:'nic',nicReceived:true,rentalPayment:{amount:0},requestId:crypto.randomUUID()});
  return {gear,booking,rental};
 }
 async function setHoursLate(rental,hours){
  await M.Rental.updateOne({_id:rental._id},{$set:{dueDate:new Date(Date.now()-hours*3600000)}});
 }
 function receipt(fixture,quantity=1){
  return {rental:fixture.rental._id,items:[{equipment:fixture.gear._id,quantityReturned:quantity}],requestId:crypto.randomUUID()};
 }
 async function ledgerSnapshot(fixture){
  return {
   payments:await M.Payment.find({order:fixture.booking._id}).sort({_id:1}).lean(),
   transactions:await M.InventoryTransaction.find({equipment:fixture.gear._id}).sort({_id:1}).lean(),
   equipment:await M.Equipment.findById(fixture.gear._id).lean(),
   items:await M.OrderItem.find({order:fixture.booking._id}).lean(),
   rental:await M.Rental.findById(fixture.rental._id).lean(),
  };
 }

 await t.test('normal returns waive the freshly computed fee and preserve charging progress through partial returns',async()=>{
  const fixture=await startRental(2);
  await setHoursLate(fixture.rental,1.9);
  assert.equal((await ok('/returns/preview/'+fixture.rental._id)).lateFee,0);
  await setHoursLate(fixture.rental,2.1);
  const quoted={...receipt(fixture),expectedLateFee:0};
  const unchanged=await ledgerSnapshot(fixture);
  assert.equal((await request('/returns','POST',quoted)).status,409);
  assert.equal(await M.Return.countDocuments({rental:fixture.rental._id}),0);
  assert.deepEqual(await ledgerSnapshot(fixture),unchanged);
  const partial={...quoted,waiveAllLateFee:true,waiverReason:'Courtesy after pickup delay'};
  assert.equal((await request('/returns','POST',partial,staffToken)).status,403);
  assert.equal((await request('/returns','POST',{...partial,waiverReason:'   '})).status,400);
  assert.equal(await M.Return.countDocuments({rental:fixture.rental._id}),0);
  assert.equal((await M.OrderItem.findOne({order:fixture.booking._id})).returnedQuantity,0);
  const first=await ok('/returns','POST',partial);
  assert.equal(first.lateFee,0);
  assert.equal(first.waivedFee,200);
  assert.equal(first.partial,true);
  assert.equal((await ok('/returns','POST',partial))._replayed,true);
  assert.equal(await M.Return.countDocuments({rental:fixture.rental._id}),1);
  assert.equal((await M.Order.findById(fixture.booking._id)).totalAmount,2000);
  assert.equal((await M.Rental.findById(fixture.rental._id)).lateFeePercentCharged,10);

  await setHoursLate(fixture.rental,4.1);
  assert.equal((await ok('/returns/preview/'+fixture.rental._id)).lateFee,100);
  const second=await ok('/returns','POST',{...receipt(fixture),returnNic:true,waiveAllLateFee:true,waiverReason:'Final courtesy adjustment'});
  assert.equal(second.lateFee,0);
  assert.equal(second.waivedFee,100);
  assert.equal(second.orderStatus,'completed');
  assert.equal((await M.Rental.findById(fixture.rental._id)).lateFeePercentCharged,20);
  assert.equal((await M.OrderItem.findOne({order:fixture.booking._id})).returnedQuantity,2);
  assert.equal(await M.Payment.countDocuments({order:fixture.booking._id}),1);
  assert.equal((await M.Invoice.findOne({order:fixture.booking._id})).total,2000);
 });

 await t.test('waiving a saved unpaid return closes settlement when its remaining charge is resolved',async()=>{
  const fixture=await startRental();
  await setHoursLate(fixture.rental,4.1);
  const returned=await ok('/returns','POST',{...receipt(fixture),returnNic:true,deferSettlement:true});
  assert.equal(returned.lateFee,200);
  assert.equal(returned.orderStatus,'settlement_pending');
  const before=await ledgerSnapshot(fixture);
  const corrected=await ok('/returns/'+returned._id+'/waive-late-fee','POST',{
   waiveAll:true,reason:'Owner waived remaining late charge',expectedLateFee:200,requestId:crypto.randomUUID(),
  });
  assert.equal(corrected.lateFee,0);
  assert.equal(corrected.waivedFee,200);
  assert.equal(corrected.orderStatus,'completed');
  assert.equal(corrected.refundDue,0);
  assert.equal((await M.Order.findById(fixture.booking._id)).totalAmount,1000);
  assert.equal((await M.Invoice.findOne({order:fixture.booking._id})).status,'paid');
  assert.deepEqual(await ledgerSnapshot(fixture),before);
 });

 await t.test('saved paid return corrections preserve ledgers, expose credits and reject stale or unauthorized changes',async()=>{
  const fixture=await startRental();
  await setHoursLate(fixture.rental,4.1);
  const returned=await ok('/returns','POST',{...receipt(fixture),returnNic:true,paid:{late:true},latePaymentAmount:200,method:'card'});
  assert.equal(returned.lateFee,200);
  assert.equal(returned.orderStatus,'completed');
  const endpoint='/returns/'+returned._id+'/waive-late-fee';
  const before=await ledgerSnapshot(fixture);
  const correction={amount:50,reason:'Reduce the late charge',expectedLateFee:200,requestId:crypto.randomUUID()};
  assert.equal((await request(endpoint,'POST',correction,staffToken)).status,403);
  assert.equal((await request(endpoint,'POST',{...correction,reason:''})).status,400);
  assert.equal((await request(endpoint,'POST',{...correction,expectedLateFee:undefined})).status,400);
  assert.equal((await request(endpoint,'POST',{...correction,expectedLateFee:100})).status,409);
  for(const amount of [0,-1,201,0.001,'invalid']){
   assert.equal((await request(endpoint,'POST',{...correction,amount})).status,400,String(amount));
  }
  assert.equal((await M.Return.findById(returned._id)).lateFee,200);
  const saved=await ok(endpoint,'POST',correction);
  assert.equal(saved.lateFee,150);
  assert.equal(saved.waivedFee,50);
  assert.equal(saved.refundDue,50);
  assert.equal((await ok(endpoint,'POST',correction))._replayed,true);
  const events=await M.AuditEvent.find({action:'return.late_fee_waived',target:String(fixture.booking._id)}).lean();
  assert.equal(events.length,1);
  assert.equal(events[0].after.reason,correction.reason);
  assert.equal(events[0].after.amount,50);
  assert.equal((await request(endpoint,'POST',{...correction,amount:51})).status,409);
  assert.equal((await request(endpoint,'POST',{...correction,amount:1,requestId:crypto.randomUUID()})).status,409);
  let invoice=await M.Invoice.findOne({order:fixture.booking._id});
  assert.equal(invoice.total,1150);
  assert.equal(invoice.status,'paid');
  let detail=await ok('/orders/'+fixture.booking._id+'/detail');
  let returnFee=detail.returnFees.find(row=>row._id===returned._id);
  assert.equal(returnFee.lateFee,150);
  assert.equal(returnFee.waivedFee,50);
  assert.deepEqual(await ledgerSnapshot(fixture),before);
  const balance=(await ok('/payments/balances')).find(row=>row._id===fixture.booking._id);
  assert.equal(balance.refundDue,50);
  const summary=await ok('/payments/summary');
  assert.equal(summary.current.refundDue,50);
  assert.equal(summary.rentalRefunds,0);
  assert.equal(summary.rentalReceipts,4200);

  const full=await ok(endpoint,'POST',{waiveAll:true,expectedLateFee:150,reason:'Waive the rest',requestId:crypto.randomUUID()});
  assert.equal(full.lateFee,0);
  assert.equal(full.waivedFee,200);
  assert.equal(full.refundDue,200);
  invoice=await M.Invoice.findOne({order:fixture.booking._id});
  assert.equal(invoice.total,1000);
  assert.equal(invoice.fees,0);
  detail=await ok('/orders/'+fixture.booking._id+'/detail');
  returnFee=detail.returnFees.find(row=>row._id===returned._id);
  assert.equal(returnFee.lateFee,0);
  assert.equal(returnFee.waivedFee,200);
  assert.equal((await ok('/payments/summary')).current.refundDue,200);
  assert.equal(await M.AuditEvent.countDocuments({action:'return.late_fee_waived',target:String(fixture.booking._id)}),2);
  assert.deepEqual(await ledgerSnapshot(fixture),before);
  assert.equal((await request(endpoint,'POST',{waiveAll:true,expectedLateFee:0,reason:'Duplicate new request',requestId:crypto.randomUUID()})).status,409);
 });
});
