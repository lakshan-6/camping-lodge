import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import * as M from '../models/index.js';
import {requireAuth,sign,hashPassword} from '../utils/auth.js';
import payments from '../routes/payments.js';
import {testDatabase} from './helpers/database.js';
import {query} from '../db/connection.js';

process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');

test('money summary reads the complete ledger and separates receipts, deposits and current obligations',{timeout:120000},async t=>{
 const cleanup=await testDatabase();
 t.after(cleanup);
 const passwordHash=await hashPassword('MoneySummaryTest123!');
 const owner=await M.User.create({name:'Owner',username:'money_owner',role:'owner',passwordHash});
 const staff=await M.User.create({name:'Staff',username:'money_staff',role:'staff',passwordHash});
 const refundStaff=await M.User.create({name:'Refund desk',username:'refund_staff',role:'staff',passwordHash,permissions:['payments.refund']});
 const ownerToken=sign(owner);
 const app=express();
 app.use(requireAuth);
 app.use('/payments',payments);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const server=app.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(path,token=ownerToken){
  const response=await fetch(base+path,{headers:{Authorization:'Bearer '+token}});
  return {status:response.status,data:await response.json()};
 }
 async function summary(query=''){
  const result=await request('/payments/summary'+query);
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.data;
 }
 const customer=await M.Customer.create({name:'Ledger customer',phone:'0771234567',nic:'123456789V'});
 const startDate=new Date('2026-11-10T00:00:00+05:30');
 const endDate=new Date('2026-11-12T00:00:00+05:30');
 const day1=startDate;
 const day2=new Date('2026-11-11T00:00:00+05:30');
 const day3=endDate;
 async function order(orderNo,totalAmount,status='active',cancellation){
  return M.Order.create({orderNo,totalAmount,status,cancellation,customer:customer._id,startDate,endDate});
 }
 const active=await order('CL-SUM-1',1000);
 const credit=await order('CL-SUM-2',100,'completed');
 const cancelled=await order('CL-SUM-3',1000,'cancelled',{action:'pending'});
 const kept=await order('CL-SUM-4',1000,'cancelled',{action:'keep'});
 // Legacy SQL rows can omit nested cancellation fields. The cancellation route's
 // atomic audit event retains the original keep decision for those records.
 await M.AuditEvent.create({action:'order.cancelled',target:String(kept._id),after:{cancellation:{action:'keep'}}});
 await order('CL-SUM-5',200,'reserved');
 const many=await order('CL-SUM-6',3.01,'completed');
 await M.Payment.insertMany([
  {order:active._id,amount:200,type:'deposit',method:'cash',paidAt:day1},
  {order:active._id,amount:400,type:'balance',method:'bank_transfer',paidAt:day2},
  {order:active._id,amount:150,type:'balance',method:'other',reference:'Applied security deposit - Return settlement',paidAt:day2},
  {order:active._id,amount:50,type:'refund',method:'cash',paidAt:day3},
  {order:credit._id,amount:130,type:'rental',method:'card',paidAt:day1},
  {order:cancelled._id,amount:80,type:'deposit',method:'cash',paidAt:day1},
  {order:cancelled._id,amount:20,type:'refund',method:'bank_transfer',paidAt:day2},
  {order:kept._id,amount:40,type:'deposit',method:'other',paidAt:day1},
  ...Array.from({length:301},()=>({order:many._id,amount:0.01,type:'rental',method:'cash',paidAt:day1})),
 ]);
 await M.DepositTransaction.insertMany([
  {order:active._id,amount:500,type:'collect',method:'cash',createdAt:day1},
  {order:active._id,amount:150,type:'apply',method:'other',createdAt:day2},
  {order:active._id,amount:100,type:'refund',method:'bank_transfer',createdAt:day2},
 ]);
 await M.Expense.insertMany([
  {amount:10,method:'cash',spentAt:day1,description:'Earlier cash expense'},
  {amount:20,method:'bank_transfer',spentAt:day1,description:'Earlier transfer expense'},
  {amount:30,method:'cash',spentAt:day2,description:'Cash expense'},
  {amount:40,method:'bank_transfer',spentAt:day2,description:'Transfer expense'},
  {amount:50,method:'card',spentAt:day2,description:'Card expense'},
  {amount:60,method:'other',spentAt:day2,description:'Other expense'},
 ]);

 await t.test('all-time totals include advances and every payment beyond the history limit',async()=>{
  assert.equal((await request('/payments')).data.length,300);
  const result=await summary();
  assert.deepEqual(result.period,{from:null,to:null});
  for(const [key,expected]of Object.entries({
   rentalReceipts:853.01,rentalRefunds:70,securityApplied:150,expenses:210,
   receiptsLessExpenses:723.01,securityCollected:500,securityRefunds:100,netMovement:973.01,
  }))assert.equal(result[key],expected,key);
  assert.deepEqual(result.current,{outstanding:500,refundDue:90,securityHeld:250});
  assert.deepEqual(result.byMethod.map(({method,netMovement})=>[method,netMovement]),[
   ['cash',693.01],['bank_transfer',220],['card',80],['other',-20],
  ]);
  const balances=(await request('/payments/balances')).data;
  assert.equal(balances.find(row=>row._id===kept._id).refundDue,0);
  assert.equal(balances.find(row=>row._id===credit._id).refundDue,30);
  assert.equal(balances.find(row=>row._id===cancelled._id).refundDue,60);
 });

 await t.test('selected dates use transaction dates and Sri Lanka boundaries without changing current balances',async()=>{
  const result=await summary('?from=2026-11-11&to=2026-11-11');
  assert.deepEqual(result.period,{from:'2026-11-11',to:'2026-11-11'});
  for(const [key,expected]of Object.entries({
   rentalReceipts:400,rentalRefunds:20,securityApplied:150,expenses:180,
   receiptsLessExpenses:350,securityCollected:0,securityRefunds:100,netMovement:100,
  }))assert.equal(result[key],expected,key);
  assert.deepEqual(result.current,{outstanding:500,refundDue:90,securityHeld:250});
  assert.deepEqual(result.byMethod.map(({method,expenses,netMovement})=>[method,expenses,netMovement]),[
   ['cash',30,-30],['bank_transfer',40,240],['card',50,-50],['other',60,-60],
  ]);
  const earlier=await summary('?from=2026-11-10&to=2026-11-10');
  assert.equal(earlier.rentalReceipts,453.01);
  assert.equal(earlier.securityCollected,500);
  assert.equal(earlier.securityApplied,0);
  assert.equal(earlier.netMovement,923.01);
  const later=await summary('?from=2026-11-12&to=2026-11-12');
  assert.equal(later.rentalReceipts,0);
  assert.equal(later.rentalRefunds,50);
  assert.equal(later.netMovement,-50);
  const empty=await summary('?from=2026-11-15&to=2026-11-15');
  assert.equal(empty.netMovement,0);
  assert.deepEqual(empty.current,result.current);
 });

 await t.test('only finance viewers can read summary and malformed ranges are rejected',async()=>{
  for(const user of [staff,refundStaff])assert.equal((await request('/payments/summary',sign(user))).status,403);
  await M.User.updateOne({_id:staff._id},{$set:{permissions:['finance.view']}});
  assert.equal((await request('/payments/summary',sign(staff))).status,200);
  for(const query of ['?from=invalid&to=2026-11-11','?from=2026-02-30&to=2026-11-11','?from=2026-11-12&to=2026-11-11','?from=2026-11-11','?to=2026-11-11']){
   assert.equal((await request('/payments/summary'+query)).status,400,query);
  }
 });
 await t.test('a retained cancellation column takes precedence over legacy audit evidence',async()=>{
  await query('UPDATE orders SET "cancellation.action"=$1 WHERE "_id"=$2',['pending',kept._id]);
  assert.equal((await summary()).current.refundDue,130);
  assert.equal((await request('/payments/balances')).data.find(row=>row._id===kept._id).refundDue,40);
  await query('UPDATE orders SET "cancellation.action"=$1 WHERE "_id"=$2',['keep',kept._id]);
  assert.equal((await summary()).current.refundDue,90);
  assert.equal((await request('/payments/balances')).data.find(row=>row._id===kept._id).refundDue,0);
 });
});
