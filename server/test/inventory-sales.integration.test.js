import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import * as M from '../models/index.js';
import {requireAuth,sign} from '../utils/auth.js';
import {initializeDocumentNumbers} from '../utils/documentNumbers.js';
import {getSettings} from '../routes/settings.js';
import {testDatabase} from './helpers/database.js';
import equipment from '../routes/equipment.js';
import orders from '../routes/orders.js';
import availability from '../routes/availability.js';
import rentals from '../routes/rentals.js';
import returns from '../routes/returns.js';
import payments from '../routes/payments.js';
import invoices from '../routes/invoices.js';
import reports from '../routes/reports.js';
import {createBackup,backupEnvelope,decryptSnapshot,validateBackup} from '../utils/backups.js';
import {localDate} from '../utils/businessTime.js';

process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');
process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');

test('rental and sale equipment retain separate stock, return and payment behavior',{timeout:120000},async t=>{
 const cleanup=await testDatabase();
 t.after(cleanup);
 await initializeDocumentNumbers();
 await getSettings();
 const owner=await M.User.create({name:'Owner',username:'sales_owner',role:'owner',passwordHash:'unused'});
 const token=sign(owner);
 const customer=await M.Customer.create({name:'Sales customer',phone:'0771234567',nic:'123456789V'});
 const app=express();
 app.use(express.json());
 app.use(requireAuth);
 for(const [path,router]of Object.entries({equipment,orders,availability,rentals,returns,payments,invoices,reports})){
  app.use('/'+path,router);
 }
 app.use((error,req,res,next)=>res.status(error.status||(error.name==='ValidationError'?400:500)).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   ...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
 }
 async function ok(...args){
  const response=await request(...args);
  assert.ok(response.status<300,JSON.stringify(response));
  return response.data;
 }
 let sequence=0;
 const dates=(offsetHours=1,duration=36)=>{
  const start=Date.now()+offsetHours*3600000;
  return {startDate:new Date(start).toISOString(),endDate:new Date(start+duration*3600000).toISOString()};
 };
 const item=(equipment,quantity=1)=>({equipment:equipment._id,quantity});
 async function gear(itemType,extra={}){
  return ok('/equipment','POST',{name:'Inventory sales test '+(++sequence),category:'Camping',
   totalQuantity:5,itemType,...(itemType==='sale'?{sellingPrice:300}:{periodRate:1000}),...extra});
 }
 async function book(items,extra={}){
  return ok('/orders','POST',{customer:customer._id,...dates(),items,
   advance:{amount:1,method:'cash'},requestId:crypto.randomUUID(),...extra});
 }
 async function handover(order,extra={}){
  return ok('/rentals/start','POST',{order:order._id,rentalPayment:{amount:0},requestId:crypto.randomUUID(),...extra});
 }
 async function available(item,offsetHours=1){
  const d=dates(offsetHours);
  const result=await ok('/availability?'+new URLSearchParams({start:d.startDate,end:d.endDate}));
  return result.items.find(row=>row._id===item._id);
 }

 await t.test('sale lines use one selling price while rental prices repeat by 36-hour period',async()=>{
  const tent=await gear('rental'),gas=await gear('sale',{sellingPrice:350});
  const booking=await book([item(tent),item(gas,2)],dates(48,73));
  assert.equal(booking.totalAmount,3700);
  const detail=await ok('/orders/'+booking._id+'/detail');
  const rented=detail.items.find(row=>row.equipment._id===tent._id);
  const sold=detail.items.find(row=>row.equipment._id===gas._id);
  assert.deepEqual([rented.itemType,rented.periods,rented.lineTotal],['rental',3,3000]);
  assert.deepEqual([sold.itemType,sold.periodRate,sold.periods,sold.lineTotal],['sale',350,1,700]);
  const legacy=await ok('/equipment','POST',{name:'Legacy rental type',category:'Camping',totalQuantity:1,periodRate:100});
  assert.equal(legacy.itemType,'rental');
  assert.equal((await request('/equipment','POST',{...gas,name:'Invalid type',sku:undefined,itemType:'other'})).status,400);
 });

 await t.test('sale reservations reserve finite stock across dates and retries cannot oversell',async()=>{
  const gas=await gear('sale',{totalQuantity:3});
  const body={customer:customer._id,...dates(1000),items:[item(gas,2)],
   advance:{amount:1,method:'cash'},requestId:crypto.randomUUID()};
  const competing={...body,...dates(2000),requestId:crypto.randomUUID()};
  const attempts=await Promise.all([
   request('/orders','POST',body),
   request('/orders','POST',competing),
  ]);
  assert.deepEqual(attempts.map(result=>result.status).sort(),[201,409]);
  const winner=attempts.findIndex(result=>result.status===201),reserved=attempts[winner].data;
  const retry=await ok('/orders','POST',winner===0?body:competing);
  assert.equal(retry._id,reserved._id);
  assert.equal((await available(gas,3000)).available,1);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,3);
  await ok('/orders/'+reserved._id+'/cancel','PATCH',{action:'pending',reason:'Customer cancelled before delivery',requestId:crypto.randomUUID()});
  assert.equal((await available(gas,3000)).available,3);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,3);
  assert.equal(await M.InventoryTransaction.countDocuments({equipment:gas._id,type:'sold'}),0);
 });

 await t.test('sale-only delivery deducts stock once, skips rentals and security, and settles an unpaid balance',async()=>{
  const gas=await gear('sale',{totalQuantity:4});
  const saleAvailability=await ok('/availability?'+new URLSearchParams({salesOnly:'true',start:dates().startDate}));
  assert.ok(saleAvailability.items.every(row=>row.itemType==='sale'));
  const paid=await book([item(gas)],{endDate:undefined,advance:{amount:300,method:'cash'}});
  const body={order:paid._id,rentalPayment:{amount:0},requestId:crypto.randomUUID()};
  const delivery=await ok('/rentals/start','POST',body);
  assert.equal(delivery.saleOnly,true);
  assert.equal(delivery.orderStatus,'completed');
  assert.equal((await ok('/rentals/start','POST',body))._replayed,true);
  assert.equal(await M.Rental.countDocuments({order:paid._id}),0);
  assert.equal((await M.Order.findById(paid._id)).nicHeldAt,undefined);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,3);
  assert.equal(await M.InventoryTransaction.countDocuments({equipment:gas._id,type:'sold'}),1);
  assert.equal((await M.InventoryTransaction.findOne({equipment:gas._id,type:'sold'})).quantity,-1);
  assert.equal((await request('/rentals/start','POST',{...body,requestId:crypto.randomUUID()})).status,409);

  const unpaid=await book([item(gas)],{advance:{amount:100,method:'cash'}});
  const delivered=await handover(unpaid);
  assert.equal(delivered.saleOnly,true);
  assert.equal(delivered.orderStatus,'settlement_pending');
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,2);
  assert.equal(await M.Rental.countDocuments({order:unpaid._id}),0);
  const preview=await ok('/returns/settlement/'+unpaid._id);
  assert.equal(preview.balance,200);
  assert.equal(preview.nicHeld,false);
  const settlement={paymentAmount:200,paymentMethod:'bank_transfer',requestId:crypto.randomUUID()};
  assert.equal((await ok('/returns/settlement/'+unpaid._id,'POST',settlement)).orderStatus,'completed');
  assert.equal((await ok('/returns/settlement/'+unpaid._id,'POST',settlement))._replayed,true);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,2);
  assert.equal((await M.Invoice.findOne({order:unpaid._id})).total,300);
 });

 await t.test('mixed handover sells consumables and only rents, extends and returns reusable equipment',async()=>{
  const tent=await gear('rental',{totalQuantity:1}),gas=await gear('sale',{totalQuantity:4});
  const booking=await book([item(tent),item(gas,2)],{...dates(1,73),advance:{amount:3600,method:'cash'}});
  const rented=await handover(booking,{securityMethod:'nic',nicReceived:true});
  assert.equal(await M.Rental.countDocuments({order:booking._id}),1);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,2);
  const preview=await ok('/returns/preview/'+rented._id);
  assert.deepEqual(preview.items.map(row=>row.equipment._id),[tent._id]);
  assert.equal((await request('/returns','POST',{rental:rented._id,items:[{equipment:gas._id,quantityReturned:2}]})).status,400);
  await M.Rental.updateOne({_id:rented._id},{$set:{dueDate:new Date(Date.now()-2.1*3600000)}});
  assert.equal((await ok('/returns/preview/'+rented._id)).lateFee,100);
  const extension=await ok('/rentals/'+rented._id+'/extend','POST',{periods:1,requestId:crypto.randomUUID()});
  assert.equal(extension.extra,1100);
  const returned=await ok('/returns','POST',{rental:rented._id,items:[{equipment:tent._id,quantityReturned:1}],
   paid:{balance:true},method:'cash',returnNic:true,requestId:crypto.randomUUID()});
  assert.equal(returned.orderStatus,'completed');
  assert.equal((await M.Equipment.findById(tent._id)).totalQuantity,1);
  assert.equal((await M.Equipment.findById(gas._id)).totalQuantity,2);
  assert.equal(await M.ReturnItem.countDocuments({equipment:gas._id}),0);
  assert.equal((await M.OrderItem.findOne({order:booking._id,equipment:gas._id})).returnedQuantity,0);
 });

 await t.test('converting tracked equipment requires cleared bookings and retains retired labels and order snapshots',async()=>{
  const bag=await gear('rental',{totalQuantity:2,trackUnits:true,unitPrefix:'SC'});
  const originalUnits=(await ok('/equipment/'+bag._id+'/units')).units;
  const booking=await book([item(bag)]);
  const conversion={...bag,itemType:'sale',sellingPrice:450,trackUnits:false};
  assert.equal((await request('/equipment/'+bag._id,'PUT',conversion)).status,409);
  await ok('/orders/'+booking._id+'/cancel','PATCH',{action:'pending',reason:'Conversion test',requestId:crypto.randomUUID()});
  const activeBooking=await book([item(bag)]);
  const active=await handover(activeBooking,{securityMethod:'nic',nicReceived:true,
   unitSelections:[{equipment:bag._id,units:[originalUnits[0]._id]}]});
  assert.equal((await request('/equipment/'+bag._id,'PUT',conversion)).status,409);
  await ok('/returns','POST',{rental:active._id,items:[{equipment:bag._id,units:[{unit:originalUnits[0]._id,condition:'good'}]}],
   paid:{balance:true},method:'cash',returnNic:true,requestId:crypto.randomUUID()});
  await ok('/equipment/'+bag._id+'/units/'+originalUnits[1]._id,'PATCH',{state:'damaged',reason:'Check conversion while in repair',requestId:crypto.randomUUID()});
  const repair=await ok('/equipment/repairs','POST',{equipment:bag._id,quantity:1,units:[originalUnits[1]._id],requestId:crypto.randomUUID()});
  assert.equal((await request('/equipment/'+bag._id,'PUT',conversion)).status,409);
  await ok('/equipment/repairs/'+repair._id+'/complete','POST',{cost:0,requestId:crypto.randomUUID()});
  const converted=await ok('/equipment/'+bag._id,'PUT',conversion);
  assert.equal(converted.itemType,'sale');
  assert.equal(converted.trackUnits,false);
  assert.equal(converted.totalQuantity,2);
  const retained=(await ok('/equipment/'+bag._id+'/units')).units;
  assert.deepEqual(retained.map(unit=>unit._id).sort(),originalUnits.map(unit=>unit._id).sort());
  assert.ok(retained.every(unit=>unit.state==='retired'));
  assert.equal((await M.OrderItem.findOne({order:booking._id})).itemType,'rental');
  const historical=await M.OrderItem.findOne({order:activeBooking._id});
  assert.equal(historical.itemType,'rental');
  assert.equal(historical.unitAssignments[0].unit,originalUnits[0]._id);
  assert.equal((await available(bag)).available,2);
 });

 await t.test('advances, receipts and refunds allocate sale income once and reports keep sold units out of rentals',async()=>{
  const before=await ok('/payments/summary');
  const tent=await gear('rental',{totalQuantity:1}),gas=await gear('sale',{totalQuantity:2,sellingPrice:400});
  const booking=await book([item(tent),item(gas)],{advance:{amount:200,method:'cash'}});
  assert.equal((await M.Payment.findOne({order:booking._id,type:'deposit'})).saleAmount,200);
  const rented=await handover(booking,{securityMethod:'nic',nicReceived:true,rentalPayment:{amount:1200,method:'cash'}});
  assert.equal((await M.Payment.findOne({order:booking._id,type:'balance'})).saleAmount,200);
  await ok('/returns','POST',{rental:rented._id,items:[{equipment:tent._id,quantityReturned:1}],returnNic:true,requestId:crypto.randomUUID()});
  const refund=await ok('/payments','POST',{order:booking._id,type:'refund',amount:140,method:'cash',
   reason:'Agreed price adjustment',refundCorrection:'reduce_charge',requestId:crypto.randomUUID()});
  assert.equal(refund.saleAmount,40);
  const summary=await ok('/payments/summary');
  for(const [key,expected]of Object.entries({
   salesReceipts:400,salesRefunds:40,salesNet:360,rentalReceipts:1000,rentalRefunds:100,rentalNet:900,
   totalReceipts:1400,totalRefunds:140,receiptsLessExpenses:1260,
  }))assert.equal(Math.round((summary[key]-before[key])*100)/100,expected,key);
  const invoice=await M.Invoice.findOne({order:booking._id});
  assert.equal(invoice.total,1260);
  const details=await ok('/invoices/'+invoice._id);
  assert.deepEqual(details.items.map(line=>line.itemType).sort(),['rental','sale']);
  const day=localDate(new Date()),report=await ok('/reports?'+new URLSearchParams({from:day,to:day}));
  assert.equal(report.salesNet,summary.salesNet);
  assert.equal(report.rentalNet,summary.rentalNet);
  assert.equal(report.sales.find(row=>row._id===gas._id).units,1);
  assert.equal(report.sales.find(row=>row._id===gas._id).charged,400);
  assert.equal(report.top.some(row=>row._id===gas._id),false);
  assert.equal(report.top.find(row=>row._id===tent._id).handedOutUnits,1);
 });

 await t.test('applied deposits allocate sale income without duplicating external receipts and legacy payments remain rental income',async()=>{
  const before=await ok('/payments/summary');
  const tent=await gear('rental',{totalQuantity:1}),gas=await gear('sale',{totalQuantity:2,sellingPrice:400});
  const booking=await book([item(tent),item(gas)],{advance:{amount:100,method:'cash'}});
  const rented=await handover(booking,{securityMethod:'money',securityDeposit:{received:true,amount:300,method:'cash'}});
  await ok('/returns','POST',{rental:rented._id,items:[{equipment:tent._id,quantityReturned:1}],deferSettlement:true,requestId:crypto.randomUUID()});
  const settlement=await ok('/returns/settlement/'+booking._id,'POST',{
   applyDeposit:300,paymentAmount:1000,paymentMethod:'cash',requestId:crypto.randomUUID(),
  });
  assert.equal(settlement.orderStatus,'completed');
  const applied=await M.Payment.findOne({order:booking._id,reference:/^Applied security deposit/});
  assert.equal(applied.amount,300);
  assert.equal(applied.saleAmount,300);
  const summary=await ok('/payments/summary');
  for(const [key,expected]of Object.entries({
   rentalReceipts:1000,salesReceipts:100,totalReceipts:1100,securityApplied:300,
   rentalNet:1000,salesNet:400,receiptsLessExpenses:1400,
  }))assert.equal(Math.round((summary[key]-before[key])*100)/100,expected,key);

  const legacy=await M.Order.create({orderNo:'LEGACY-SALES-TEST',customer:customer._id,...dates(),status:'completed',totalAmount:50});
  const oldPayment=await M.Payment.create({order:legacy._id,amount:50,type:'balance',method:'cash',paidAt:new Date()});
  assert.equal(oldPayment.saleAmount,0);
  const afterLegacy=await ok('/payments/summary');
  assert.equal(afterLegacy.rentalReceipts-summary.rentalReceipts,50);
  assert.equal(afterLegacy.salesReceipts,summary.salesReceipts);
 });

 await t.test('editing an uncollected mixed order reclassifies advances and refunds while preserving cash history',async()=>{
  const baseline=await ok('/payments/summary');
  const tent=await gear('rental',{totalQuantity:1}),gas=await gear('sale',{totalQuantity:3,sellingPrice:400});
  const booking=await book([item(tent),item(gas)],{advance:{amount:200,method:'cash'}});
  await ok('/payments','POST',{order:booking._id,type:'balance',amount:401,method:'bank_transfer',requestId:crypto.randomUUID()});
  await ok('/payments','POST',{order:booking._id,type:'refund',amount:0.03,method:'card',reason:'Small correction',requestId:crypto.randomUUID()});
  const history=async()=>M.Payment.find({order:booking._id}).sort({paidAt:1,createdAt:1,_id:1}).lean();
  const retainedCashHistory=rows=>rows.map(({saleAmount,...unchanged})=>unchanged);
  const original=await history();
  const net=async()=>{
   const summary=await ok('/payments/summary');
   return Object.fromEntries(['salesNet','rentalNet','totalReceipts','totalRefunds'].map(key=>
    [key,Math.round((summary[key]-baseline[key])*100)/100]));
  };
  assert.deepEqual(await net(),{salesNet:399.98,rentalNet:200.99,totalReceipts:601,totalRefunds:0.03});

  const edit=async(lines,total)=>ok('/orders/'+booking._id,'PUT',{items:lines,confirmedTotal:total,requestId:crypto.randomUUID()});
  await edit([item(tent)],1000);
  assert.deepEqual(await net(),{salesNet:0,rentalNet:600.97,totalReceipts:601,totalRefunds:0.03});
  assert.deepEqual(retainedCashHistory(await history()),retainedCashHistory(original));
  await edit([item(tent),item(gas)],1400);
  assert.deepEqual(await net(),{salesNet:399.98,rentalNet:200.99,totalReceipts:601,totalRefunds:0.03});
  await edit([item(tent),item(gas,2)],1800);
  assert.deepEqual(await net(),{salesNet:600.97,rentalNet:0,totalReceipts:601,totalRefunds:0.03});
  const beforeRepeatedEdit=(await history()).map(row=>[row._id,row.saleAmount]);
  const audited=await M.AuditEvent.countDocuments({action:'payment.allocations_reclassified',target:String(booking._id)});
  assert.equal(audited,3);
  await edit([item(tent),item(gas,2)],1800);
  assert.deepEqual((await history()).map(row=>[row._id,row.saleAmount]),beforeRepeatedEdit);
  assert.equal(await M.AuditEvent.countDocuments({action:'payment.allocations_reclassified',target:String(booking._id)}),audited);
  assert.deepEqual(retainedCashHistory(await history()),retainedCashHistory(original));
 });

 await t.test('sale snapshots and stock history remain present in a validated encrypted backup',async()=>{
  const envelope=backupEnvelope(await createBackup('inventory-sales-regression'));
  const validated=await validateBackup(envelope);
  assert.ok(validated.summary.collections.Equipment>0);
  const snapshot=decryptSnapshot(envelope).collections;
  assert.ok(snapshot.Equipment.some(row=>row.itemType==='sale'&&row.sellingPrice===450));
  assert.ok(snapshot.OrderItem.some(row=>row.itemType==='sale'&&row.periods===1));
  assert.ok(snapshot.InventoryTransaction.some(row=>row.type==='sold'&&row.quantity<0));
  assert.ok(snapshot.Payment.some(row=>row.saleAmount>0));
 });
});
