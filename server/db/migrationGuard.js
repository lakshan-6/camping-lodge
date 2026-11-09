import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {databaseDriver} from './connection.js';
import {createBackup} from '../utils/backups.js';

let freezing=false,active=0;
export function migrationSignature(action,timestamp,nonce,key=process.env.BACKUP_ENCRYPTION_KEY){
 if(!key||key.length<32)throw new Error('The original backup encryption key is required');
 return crypto.createHmac('sha256',key).update(`camping-lodge-postgres-v1:${action}:${timestamp}:${nonce}`).digest('hex');
}
function authorized(req){
 const {timestamp,nonce,signature}=req.body||{};
 if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>60000||typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce)||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature))return false;
 const expected=migrationSignature('freeze',timestamp,nonce);
 return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
export async function legacyMigrationGate(req,res,next){
 if(databaseDriver!=='mongodb'||req.path==='/health'||req.path==='/migration/freeze')return next();
 try{
  const marker=await mongoose.connection.db.collection('migration_locks').findOne({_id:'postgres-cutover'});
  if(freezing||marker?.frozen)return res.status(503).set('Retry-After','60').json({error:'Database migration is in progress. Please wait before making changes.'});
  active++;let finished=false;const done=()=>{if(!finished){finished=true;active--;}};res.once('finish',done);res.once('close',done);next();
 }catch{res.status(503).json({error:'Database is temporarily unavailable'});}
}
export async function freezeLegacySource(req,res){
 try{
  if(databaseDriver!=='mongodb')return res.status(409).json({error:'This is already the PostgreSQL application'});
  if(!authorized(req))return res.status(403).json({error:'Migration request could not be verified'});
  const previous=await mongoose.connection.db.collection('migration_locks').findOne({_id:'postgres-cutover'});
  if(previous?.frozen)return res.json({frozen:true,backupId:previous.backupId});
  if(freezing)return res.status(409).json({error:'Migration preparation is already running'});
  freezing=true;
  const deadline=Date.now()+30000;while(active){if(Date.now()>deadline)throw new Error('Active requests did not finish');await new Promise(resolve=>setTimeout(resolve,100));}
  const locks=mongoose.connection.db.collection('migration_locks'),existing=await locks.findOne({_id:'postgres-cutover'});
  if(existing?.frozen)return res.json({frozen:true,backupId:existing.backupId});
  const backup=await createBackup('before-postgres-'+Date.now());
  await locks.updateOne({_id:'postgres-cutover'},{$set:{frozen:true,frozenAt:new Date(),backupId:String(backup._id)}},{upsert:true});
  res.json({frozen:true,backupId:String(backup._id)});
 }catch{freezing=false;res.status(503).json({error:'Migration preparation failed; no source data was removed'});}
}
