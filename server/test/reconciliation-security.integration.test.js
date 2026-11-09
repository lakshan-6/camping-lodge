import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {once} from 'node:events';
import * as M from '../models/index.js';
import {requireAuth,sign,hashPassword,checkPassword} from '../utils/auth.js';
import {base32,totp} from '../utils/mfa.js';
import {backupEnvelope,createBackup,decryptSnapshot,restoreBackup} from '../utils/backups.js';
import {localDate} from '../utils/businessTime.js';
import {testDatabase} from './helpers/database.js';
import auth from '../routes/auth.js';
import security from '../routes/security.js';
import reconciliation from '../routes/reconciliation.js';
import orders from '../routes/orders.js';
import backups from '../routes/backups.js';
import users from '../routes/users.js';
process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');process.env.PAST_ORDER_DELETE_KEY='RestoreTestKey123!';
for(const key of Object.keys(process.env))if(key.startsWith('BACKUP_S3_'))delete process.env[key];
test('reconciliation, search, owner recovery and MFA use isolated real transactions',{timeout:120000},async t=>{
 const cleanup=await testDatabase();t.after(cleanup);
 const password='OwnerPassword123!',owner=await M.User.create({username:'owner',name:'Owner',role:'owner',passwordHash:await hashPassword(password)}),staff=await M.User.create({username:'staff',name:'Staff',role:'staff',passwordHash:owner.passwordHash});
 let token=sign(owner);const staffToken=sign(staff);
 const app=express();app.use(express.json({limit:'16mb'}));app.use('/auth',auth);app.use(requireAuth);for(const [path,router]of Object.entries({security,reconciliation,orders,backups,users}))app.use('/'+path,router);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 async function req(path,method='GET',body,authToken=token){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+authToken},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
 async function ok(...args){const response=await req(...args);assert.ok(response.status<300,JSON.stringify(response));return response.data;}
 const customer=await M.Customer.create({name:'Search Customer',phone:'0771234567',nic:'123456789V'}),equipment=await M.Equipment.create({name:'Tent',category:'Tents',totalQuantity:10,damagedQty:2,periodRate:100});
 const order=await M.Order.create({orderNo:'CL-1001',customer:customer._id,startDate:new Date('2026-11-07T05:00:00Z'),endDate:new Date('2026-11-08T17:00:00Z'),status:'active',periods:1,totalAmount:1000,depositAmount:500});
 await M.OrderItem.create({order:order._id,equipment:equipment._id,quantity:3,returnedQuantity:1,periodRate:100,periods:1,lineTotal:300});
 await t.test('server search, status/date filters, pagination and regex escaping',async()=>{
   for(const q of ['CL-1001','Search','0771234567','123456789V']){const result=await ok('/orders?paged=true&pageSize=1&q='+encodeURIComponent(q));assert.equal(result.total,1);assert.equal(result.rows.length,1);}
   assert.equal((await ok('/orders?paged=true&q='+encodeURIComponent('.*'))).total,0);
   assert.equal((await ok('/orders?paged=true&status=reserved')).total,0);
   assert.equal((await ok('/orders?paged=true&from=2026-11-07&to=2026-11-07')).total,1);
   assert.equal((await req('/orders?paged=true&page=-1')).status,400);assert.equal((await req('/orders?paged=true&pageSize=1000')).status,400);
 });
 await t.test('physical counts include outstanding equipment, retain repairs and block stale/invalid counts',async()=>{
   assert.equal((await req('/reconciliation/stock/'+equipment._id,'GET',undefined,staffToken)).status,403);
   let snapshot=await ok('/reconciliation/stock/'+equipment._id);assert.equal(snapshot.outQuantity,2);assert.equal(snapshot.expectedGood,6);
   const body={signature:snapshot.signature,countedGood:5,countedDamaged:2,reason:'One missing after physical count',requestId:crypto.randomUUID()};
   await ok('/reconciliation/stock/'+equipment._id,'POST',body);await ok('/reconciliation/stock/'+equipment._id,'POST',body);
   assert.equal(await M.StockCount.countDocuments(),1);assert.equal((await M.Equipment.findById(equipment._id)).totalQuantity,9);
   assert.equal((await req('/reconciliation/stock/'+equipment._id,'POST',{...body,requestId:crypto.randomUUID()})).status,409);
   snapshot=await ok('/reconciliation/stock/'+equipment._id);await M.Repair.create({equipment:equipment._id,quantity:2,status:'open'});
   assert.equal((await req('/reconciliation/stock/'+equipment._id,'POST',{signature:snapshot.signature,countedGood:5,countedDamaged:1,reason:'Invalid',requestId:crypto.randomUUID()})).status,409);
   snapshot=await ok('/reconciliation/stock/'+equipment._id);
   assert.equal((await req('/reconciliation/stock/'+equipment._id,'POST',{signature:snapshot.signature,countedGood:5,countedDamaged:1,reason:'Invalid',requestId:crypto.randomUUID()})).status,409);
   const future=await M.Order.create({orderNo:'CL-1002',customer:customer._id,status:'reserved',startDate:new Date(Date.now()+86400000),endDate:new Date(Date.now()+2*86400000)});await M.OrderItem.create({order:future._id,equipment:equipment._id,quantity:5,periodRate:100,periods:1,lineTotal:500});snapshot=await ok('/reconciliation/stock/'+equipment._id);
   assert.equal((await req('/reconciliation/stock/'+equipment._id,'POST',{signature:snapshot.signature,countedGood:0,countedDamaged:2,reason:'Cannot fulfil bookings',requestId:crypto.randomUUID()})).status,409);
 });
 await t.test('cash close separates real cash movements from transfers and requires review of later changes',async()=>{
   const paidAt=new Date(),day=localDate(paidAt);
   await M.Payment.create([{order:order._id,amount:1000,type:'rental',method:'cash',paidAt},{order:order._id,amount:100,type:'refund',method:'cash',paidAt},{order:order._id,amount:200,type:'balance',method:'other',paidAt},{order:order._id,amount:999,type:'balance',method:'bank_transfer',paidAt}]);
   await M.DepositTransaction.create([{order:order._id,amount:500,type:'collect',method:'cash'},{order:order._id,amount:100,type:'refund',method:'cash'},{order:order._id,amount:200,type:'apply',method:'cash'}]);
   await M.Expense.create([{amount:50,method:'cash',spentAt:paidAt,description:'Cash expense'},{amount:700,method:'card',spentAt:paidAt,description:'Card expense'}]);
   let summary=await ok('/reconciliation/cash?day='+day);assert.equal(summary.netMovement,1250);
   assert.equal((await req('/reconciliation/cash?day='+day,'GET',undefined,staffToken)).status,403);
   await M.User.updateOne({_id:staff._id},{$set:{permissions:['finance.view']}});assert.equal((await req('/reconciliation/cash?day='+day,'GET',undefined,staffToken)).status,200);
   const body={day,ledgerHash:summary.ledgerHash,openingCash:100,cashRemoved:200,countedCash:1150,requestId:crypto.randomUUID()};
   assert.equal((await req('/reconciliation/cash','POST',body,staffToken)).status,403);
   const close=await ok('/reconciliation/cash','POST',body);assert.equal(close.expectedCash,1150);assert.equal(close.difference,0);await ok('/reconciliation/cash','POST',body);assert.equal(await M.CashClose.countDocuments(),1);
   await M.Payment.create({order:order._id,amount:10,type:'fee',method:'cash',paidAt});summary=await ok('/reconciliation/cash?day='+day);assert.equal(summary.ledgerChanged,true);
   assert.equal((await req('/reconciliation/cash','POST',{...body,requestId:crypto.randomUUID()})).status,409);
   const correction=await ok('/reconciliation/cash','POST',{...body,ledgerHash:summary.ledgerHash,countedCash:1160,reason:'Late cash entry reviewed',requestId:crypto.randomUUID()});assert.equal(correction.revision,2);assert.equal(await M.CashClose.countDocuments(),2);
 });
 let secret,mfaCodes,accountCodes,enrolledCode,recoveryEnvelope;
 await t.test('owner MFA enrolment requires password and a valid code; secrets stay private',async()=>{
   assert.equal((await req('/security','GET',undefined,staffToken)).status,403);
   assert.equal((await req('/users/'+owner._id,'PATCH',{password:'AnotherPassword123!'})).status,403);
   assert.equal((await req('/security/mfa/start','POST',{currentPassword:'wrong'})).status,403);
   const enrollment=await ok('/security/mfa/start','POST',{currentPassword:password});secret=enrollment.secret;
   const bad=await req('/security/mfa/enable','POST',{currentPassword:password,enrollmentCode:'wrong'});assert.equal(bad.status,400);
   enrolledCode=totp(secret);const enabled=await ok('/security/mfa/enable','POST',{currentPassword:password,enrollmentCode:enrolledCode});token=enabled.token;mfaCodes=enabled.codes;assert.equal(mfaCodes.length,8);
   const stored=await M.User.findById(owner._id);assert.equal(stored.mfaSecret,undefined);assert.equal(stored.mfaRecoveryHashes,undefined);
   const info=await ok('/security');assert.equal(info.mfaEnabled,true);assert.equal(JSON.stringify(info).includes(secret),false);
   const kit=await ok('/security/account-recovery-codes','POST',{currentPassword:password,code:mfaCodes[0]});token=kit.token;accountCodes=kit.codes;
 });
 await t.test('password alone does not log in; OTP and backup-code replay are blocked',async()=>{
   const baseBody={username:'owner',password};const passwordOnly=await ok('/auth/login','POST',baseBody);assert.equal(passwordOnly.mfaRequired,true);assert.equal(passwordOnly.token,undefined);
   assert.equal((await req('/auth/login','POST',{...baseBody,code:enrolledCode})).status,401);
   const futureCode=totp(secret,Date.now()+30000),logged=await ok('/auth/login','POST',{...baseBody,code:futureCode});assert.ok(logged.token);
   assert.equal((await req('/auth/login','POST',{...baseBody,code:futureCode})).status,401);
   assert.ok((await ok('/auth/login','POST',{...baseBody,code:mfaCodes[1]})).token);
   assert.equal((await req('/auth/login','POST',{...baseBody,code:mfaCodes[1]})).status,401);
 });
 await t.test('forgotten-password recovery requires both recovery factors and is atomic and single-use',async()=>{
   const recovery={username:'owner',newPassword:'RecoveredPassword123!',recoveryCode:accountCodes[0]};
   assert.equal((await req('/auth/recover','POST',recovery)).status,401);
   await ok('/auth/recover','POST',{...recovery,code:mfaCodes[2]});assert.equal((await req('/security')).status,401);
   assert.equal((await req('/auth/recover','POST',{...recovery,code:mfaCodes[3]})).status,401);
   assert.equal(await checkPassword(recovery.newPassword,(await M.User.findById(owner._id)).passwordHash),true);
   const logged=await ok('/auth/login','POST',{username:'owner',password:recovery.newPassword,code:mfaCodes[3]});token=logged.token;
 });
 await t.test('backup dry-run validates the full schema and includes encrypted owner MFA credentials',async()=>{
   const backup=await createBackup('new-features-test'),envelope=backupEnvelope(backup),snapshot=decryptSnapshot(envelope),saved=snapshot.collections.User.find(u=>u.role==='owner');assert.ok(saved.mfaSecret);assert.notEqual(saved.mfaSecret,secret);assert.ok(saved.accountRecoveryHashes.length);
   recoveryEnvelope=envelope;
   const checked=await ok('/backups/verify','POST',{backup:envelope});assert.equal(checked.valid,true);assert.equal(checked.collections.CashClose,2);assert.equal(await M.CashClose.countDocuments(),2);
   const modified={...envelope,data:Buffer.from('tampered').toString('base64')};assert.equal((await req('/backups/verify','POST',{backup:modified})).status,400);
   const events=await M.AuditEvent.find().lean();const audit=JSON.stringify(events);assert.equal(audit.includes(secret),false);assert.equal(audit.includes(mfaCodes[0]),false);assert.equal(audit.includes(accountCodes[0]),false);
 });
 await t.test('factor changes require re-authentication, revoke sessions and survive an actual backup restore',async()=>{
   const currentPassword='RecoveredPassword123!';
   assert.equal((await req('/security/mfa/disable','POST',{currentPassword,code:mfaCodes[0]})).status,403);
   const oldToken=token,disabled=await ok('/security/mfa/disable','POST',{currentPassword,code:mfaCodes[4]});token=disabled.token;
   assert.equal((await req('/security','GET',undefined,oldToken)).status,401);assert.equal((await ok('/security')).mfaEnabled,false);
   await restoreBackup(recoveryEnvelope,'RESTORE',process.env.PAST_ORDER_DELETE_KEY,await M.User.findById(owner._id));
   assert.equal((await req('/security')).status,401);assert.equal((await ok('/auth/login','POST',{username:'owner',password:currentPassword})).mfaRequired,true);
   const logged=await ok('/auth/login','POST',{username:'owner',password:currentPassword,code:mfaCodes[5]});token=logged.token;assert.equal((await ok('/security')).mfaEnabled,true);
 });
});
test('TOTP matches RFC 6238 SHA-1 reference vectors',()=>{
 const secret=base32(Buffer.from('12345678901234567890'));
 for(const [seconds,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037']])assert.equal(totp(secret,seconds*1000,8),expected);
});
