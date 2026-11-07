import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {externalConfig,externalStatus,signS3,uploadAndReadBack} from '../utils/externalBackups.js';
import {encryptSnapshot,backupEnvelope,decryptSnapshot} from '../utils/backups.js';
test('private external backup transport signs HTTPS requests and verifies encrypted read-back',async t=>{
 process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
 Object.assign(process.env,{BACKUP_S3_ENDPOINT:'https://backup.example.test',BACKUP_S3_BUCKET:'private-backups',BACKUP_S3_REGION:'auto',BACKUP_S3_PREFIX:'camping-lodge',BACKUP_S3_ACCESS_KEY_ID:'test-access',BACKUP_S3_SECRET_ACCESS_KEY:'test-secret'});
 t.after(()=>{for(const key of Object.keys(process.env))if(key.startsWith('BACKUP_S3_'))delete process.env[key];});
 const envelope=backupEnvelope(encryptSnapshot({version:1,collections:{privateData:'not plaintext in storage'}})),key='camping-lodge/test.encrypted.json';
 let uploaded,puts=0,gets=0;
 const send=async(url,options)=>{
   assert.equal(url,'https://backup.example.test/private-backups/camping-lodge/test.encrypted.json');assert.equal(options.redirect,'error');assert.ok(options.signal);
   assert.match(options.headers.authorization,/^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
   if(options.method==='PUT'){puts++;uploaded=options.body;assert.equal(uploaded.includes('not plaintext in storage'),false);assert.equal(crypto.createHash('sha256').update(uploaded).digest('hex'),options.headers['x-amz-content-sha256']);return new Response('',{status:200});}
   gets++;return new Response(uploaded,{status:200});
 };
 const copy=await uploadAndReadBack(envelope,key,send);assert.deepEqual(decryptSnapshot(copy),{version:1,collections:{privateData:'not plaintext in storage'}});assert.equal(puts,1);assert.equal(gets,1);
 const signed=signS3({method:'GET',key,config:externalConfig(),now:new Date('2026-11-07T00:00:00Z')});assert.equal(signed.headers['x-amz-date'],'20261107T000000Z');assert.equal(signed.url.includes('test-secret'),false);
 await assert.rejects(uploadAndReadBack(envelope,key,async(url,options)=>new Response(options.method==='PUT'?'':'tampered',{status:200})),{status:502});
 await assert.rejects(uploadAndReadBack(envelope,key,async()=>new Response('Access denied',{status:403})),{status:502});
 await assert.rejects(uploadAndReadBack(envelope,key,async()=>{throw new Error('secret server details');}),e=>e.status===502&&!e.message.includes('secret server details'));
 process.env.BACKUP_S3_ENDPOINT='http://backup.example.test';assert.equal(externalStatus().configured,false);assert.throws(externalConfig,{status:503});
});
