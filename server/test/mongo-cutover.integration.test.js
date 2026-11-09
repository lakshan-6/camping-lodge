import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import * as source from '../models/validation.js';
import * as target from '../models/index.js';
import {testMongoSource} from './helpers/mongo-source.js';
import {testDatabase} from './helpers/database.js';
import {migrateMongo} from '../db/migrateMongo.js';
import {migrationSignature} from '../db/migrationGuard.js';
import {hashPassword,sign,checkPassword} from '../utils/auth.js';
process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
test('native MongoDB bridge freezes requests and moves verified records to PostgreSQL',{skip:!process.env.TEST_MONGOD_PATH,timeout:120000},async t=>{
 const mongo=await testMongoSource();t.after(mongo.cleanup);const close=await testDatabase();t.after(close);
 const owner=await source.User.create({name:'Bridge Owner',username:'bridge_owner',role:'owner',passwordHash:await hashPassword('BridgePassword123!')});
 const customer=await source.Customer.create({name:'Existing Mongo Customer',phone:'0771234567',nic:'123456789V'});
 const eq=await source.Equipment.create({name:'Existing tent',category:'Tents',totalQuantity:3,periodRate:750});
 const order=await source.Order.create({orderNo:'CL-0044',customer:customer._id,startDate:new Date('2026-11-08T00:00:00Z'),endDate:new Date('2026-11-09T12:00:00Z'),status:'completed',periods:1,totalAmount:750});
 await source.OrderItem.create({order:order._id,equipment:eq._id,quantity:1,returnedQuantity:1,periodRate:750,periods:1,lineTotal:750});
 await source.Payment.create({order:order._id,amount:750,type:'balance',method:'cash'});
 const listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,DOTENV_CONFIG_PATH:new URL('./no-env-for-tests',import.meta.url).pathname,DB_DRIVER:'mongodb',MONGODB_URI:mongo.uri,PORT:String(port),AUTO_MIGRATE_FROM_MONGODB:'false',NODE_ENV:'test'},windowsHide:true,stdio:'ignore'});t.after(async()=>{child.kill();if(child.exitCode===null)await once(child,'exit');});
 const base=`http://127.0.0.1:${port}`;let ready=false;for(let n=0;n<120;n++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'bridge server must start');
 process.env.MONGODB_URI=mongo.uri;process.env.MIGRATION_SOURCE_URL=base;
 await t.test('unauthenticated freeze cannot pause the live source',async()=>{
  assert.equal((await fetch(base+'/api/migration/freeze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/customers',{headers:{Authorization:'Bearer '+sign(owner)}})).status,200);
 });
 await t.test('preflight verifies an exact SQL import while the source stays available',async()=>{
  const preflight=await migrateMongo({preflight:true});assert.equal(preflight.verified,true);assert.equal(preflight.dryRun,true);assert.equal(await target.User.countDocuments(),0);assert.equal((await fetch(base+'/api/auth/status')).status,200);
 });
 await t.test('final migration retains source records, makes a recovery backup, freezes writes and verifies target',async()=>{
  const migrated=await migrateMongo();assert.equal(migrated.verified,true);assert.equal(migrated.counts.Order,1);assert.ok(migrated.counts.Backup>=1);
  assert.equal(await source.Order.countDocuments(),1);assert.equal(await target.Order.countDocuments(),1);assert.equal((await target.Order.findOne())._id,String(order._id));
  assert.equal((await target.Payment.findOne()).amount,750);assert.ok(await checkPassword('BridgePassword123!',(await target.User.findOne()).passwordHash));
  assert.equal((await fetch(base+'/api/customers',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sign(owner)},body:JSON.stringify({name:'Must not save',phone:'0777654321'})})).status,503);
  assert.equal(await source.Customer.countDocuments(),1);assert.equal((await fetch(base+'/api/auth/status')).status,503);
 });
 await t.test('signed retries and restarts are idempotent after cutover',async()=>{
  const timestamp=Date.now(),nonce=crypto.randomBytes(16).toString('hex'),signature=migrationSignature('freeze',timestamp,nonce);
  const response=await fetch(base+'/api/migration/freeze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,nonce,signature})});assert.equal(response.status,200);assert.equal((await response.json()).frozen,true);
  const retry=await migrateMongo();assert.equal(retry.alreadyMigrated,true);assert.equal(await target.Payment.countDocuments(),1);
 });
});
