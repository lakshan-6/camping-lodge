import crypto from 'node:crypto';
import { gzipSync,gunzipSync } from 'node:zlib';
import mongoose from 'mongoose';
import * as models from '../models/index.js';
import { transaction,exclusive,audit } from './operations.js';
import { httpErr } from './availability.js';
import { localDate } from './businessTime.js';
const EJSON=mongoose.mongo.BSON.EJSON;
const collections=Object.entries(models).filter(([name])=>name!=='Backup');
function key(){const raw=process.env.BACKUP_ENCRYPTION_KEY;if(!raw||raw.length<32)throw httpErr(503,'Backups need BACKUP_ENCRYPTION_KEY in the server environment (32 or more characters).');return crypto.createHash('sha256').update(raw).digest();}
export function encryptSnapshot(data){const plain=Buffer.from(EJSON.stringify(data));if(plain.length>32*1024*1024)throw httpErr(413,'Backup exceeds the 32 MB uncompressed snapshot limit. Configure external backups before growing further.');const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv),payload=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()]);if(payload.length>8*1024*1024)throw httpErr(413,'Backup exceeds the 8 MB snapshot limit. Export data and configure external backups before growing further.');return {payload,iv,tag:cipher.getAuthTag(),size:payload.length};}
export function backupEnvelope(row){return {format:'camping-lodge-encrypted-v1',iv:row.iv.toString('base64'),tag:row.tag.toString('base64'),data:row.payload.toString('base64')};}
export function decryptSnapshot(envelope){try{if(envelope.format!=='camping-lodge-encrypted-v1'||typeof envelope.data!=='string'||envelope.data.length>12*1024*1024)throw new Error();const decipher=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));const plain=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);return EJSON.parse(gunzipSync(plain,{maxOutputLength:32*1024*1024}).toString());}catch(e){if(e.status===503)throw e;throw httpErr(400,'Backup is invalid, damaged, or encrypted with a different key');}}
async function snapshot(session){const data={version:1,createdAt:new Date(),collections:{}};for(const [name,model]of collections)data.collections[name]=await model.find().session(session).lean();return data;}
async function storeSnapshot(label){const data=await transaction(session=>snapshot(session));const encrypted=encryptSnapshot(data);const row=await models.Backup.findOneAndUpdate({day:label},{$set:encrypted},{upsert:true,new:true});const stale=await models.Backup.find().sort({createdAt:-1}).skip(7).select('_id');if(stale.length)await models.Backup.deleteMany({_id:{$in:stale.map(x=>x._id)}});return row;}
export const createBackup=label=>exclusive(()=>storeSnapshot(label||'manual-'+Date.now()));
function verifyKey(supplied){const expected=process.env.PAST_ORDER_DELETE_KEY;const hash=v=>crypto.createHash('sha256').update(v).digest();if(!expected||expected.length<12||expected.length>128)throw httpErr(503,'Configure a valid owner access key before restoring backups');if(typeof supplied!=='string'||supplied.length>128||!crypto.timingSafeEqual(hash(expected),hash(supplied.trim())))throw httpErr(403,'Incorrect owner access key');}
export async function restoreBackup(envelope,confirmation,accessKey,user){
 verifyKey(accessKey);if(confirmation!=='RESTORE')throw httpErr(400,'Type RESTORE to confirm');
 const data=decryptSnapshot(envelope);if(data.version!==1||!data.collections)throw httpErr(400,'Unsupported backup');
 for(const [name,model]of collections){const rows=data.collections[name];if(!Array.isArray(rows)||rows.length>50000)throw httpErr(400,'Invalid backup collection: '+name);const ids=new Set();for(const row of rows){if(!row._id||ids.has(String(row._id)))throw httpErr(400,'Missing or duplicate record id');ids.add(String(row._id));await new model(row).validate();}}
 if(!data.collections.User.some(u=>u.role==='owner'&&u.active))throw httpErr(400,'Backup must include an active owner');
 const has=(name,id)=>data.collections[name].some(r=>String(r._id)===String(id));
 for(const [name,field,target]of [['Order','customer','Customer'],['OrderItem','order','Order'],['OrderItem','equipment','Equipment'],['Rental','order','Order'],['Return','rental','Rental'],['ReturnItem','return','Return'],['Invoice','order','Order'],['Payment','order','Order'],['DepositTransaction','order','Order']])for(const row of data.collections[name])if(!has(target,row[field]))throw httpErr(400,`Broken ${name} reference in backup`);
 return exclusive(async()=>{
  await storeSnapshot('before-restore-'+Date.now());
  await transaction(async session=>{
   const currentUsers=await models.User.find().session(session).select('_id sessionVersion').lean();
   const versions=new Map(currentUsers.map(row=>[String(row._id),row.sessionVersion||0]));
   for(const [,model]of collections)await model.deleteMany({},{session});
   for(const [name,model]of collections){const rows=data.collections[name].map(row=>name==='User'?{...row,sessionVersion:Math.max(row.sessionVersion||0,versions.get(String(row._id))||0)+1}:row);if(rows.length)await model.insertMany(rows,{session,ordered:true});}
   await audit(session,user,'backup.restored','database',null,{backupDate:data.createdAt});
  });return {ok:true,loginRequired:true};
 });
}
export function startBackupSchedule(){if(!process.env.BACKUP_ENCRYPTION_KEY)return;const run=async()=>{try{const day='auto-'+localDate(new Date());if(await models.User.exists({role:'owner',active:true})&&!await models.Backup.exists({day}))await createBackup(day);}catch(e){console.error('Automatic backup failed:',e.status?e.message:'Check backup configuration and database availability');}};const initial=setTimeout(run,60000);initial.unref();const interval=setInterval(run,3600000);interval.unref();}
