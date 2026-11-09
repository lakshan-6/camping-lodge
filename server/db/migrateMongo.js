import crypto from 'node:crypto';
import mongoose from 'mongoose';
import * as validation from '../models/validation.js';
import {normalize} from './repository.js';
import {importSnapshot,verifyImportSource} from './importSnapshot.js';
import {migrationSignature} from './migrationGuard.js';
import {query} from './connection.js';

export async function readMongoSnapshot(uri,{mustBeFrozen=false}={}){
 if(!uri||!/^mongodb(\+srv)?:\/\//.test(uri))throw new Error('A private MongoDB source URI is required');
 const client=new mongoose.mongo.MongoClient(uri,{serverSelectionTimeoutMS:15000});
 try{
  await client.connect();const db=client.db();
  if(mustBeFrozen&&!(await db.collection('migration_locks').findOne({_id:'postgres-cutover'}))?.frozen)throw new Error('The source must be frozen before the final import');
  const snapshot={version:1,createdAt:new Date(),collections:{}},session=client.startSession();
  try{await session.withTransaction(async()=>{for(const [name,Model]of Object.entries(validation))snapshot.collections[name]=normalize(await db.collection(Model.collection.name).find({},{session}).toArray());},{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});}finally{await session.endSession();}
  return snapshot;
 }finally{await client.close();}
}
export async function migrateMongo({preflight=false}={}){
 const existing=await query('SELECT name,summary FROM data_migrations WHERE name=$1',['mongodb-to-postgres-v1']);
 if(existing.rows.length)return {alreadyMigrated:true,verified:true,counts:existing.rows[0].summary};
 const source=process.env.MONGODB_URI;
 const checked=await importSnapshot(await readMongoSnapshot(source),{dryRun:true});
 if(preflight)return checked;
 const origin=process.env.MIGRATION_SOURCE_URL||process.env.RENDER_EXTERNAL_URL;
 if(!origin)throw new Error('Set MIGRATION_SOURCE_URL to the existing HTTPS application');
 const parsed=new URL(origin),local=process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
 if(parsed.protocol!=='https:'&&!(local&&parsed.protocol==='http:'))throw new Error('Migration source must use HTTPS');
 const timestamp=Date.now(),nonce=crypto.randomBytes(16).toString('hex'),signature=migrationSignature('freeze',timestamp,nonce);
 const response=await fetch(new URL('/api/migration/freeze',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timestamp,nonce,signature}),signal:AbortSignal.timeout(60000)});
 const result=await response.json();if(!response.ok||result.frozen!==true)throw new Error('Source freeze could not be confirmed; no final import was started');
 const snapshot=await readMongoSnapshot(source,{mustBeFrozen:true});await verifyImportSource(snapshot);
 return importSnapshot(snapshot);
}
