import crypto from 'node:crypto';
import * as models from '../models/index.js';
import {definitions} from './definitions.js';
import {databaseDriver,query,inTransaction} from './connection.js';
import {normalize} from './repository.js';
import {validateBackup,encryptSnapshot,backupEnvelope} from '../utils/backups.js';

function canonical(d,value){
 const raw=normalize(new d.Validator(normalize(value)).toObject());
 const fields=new Set([...Object.keys(d.fields),...Object.keys(d.relations)]);
 const sort=v=>v instanceof Date?v.toISOString():Buffer.isBuffer(v)?{binary:v.toString('base64')}:Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined&&v[k]!==null).map(k=>[k,sort(v[k])])):v;
 return sort(Object.fromEntries(Object.entries(raw).filter(([k])=>fields.has(k))));
}
const digest=(d,rows)=>crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>canonical(d,r)).sort((a,b)=>String(a._id).localeCompare(String(b._id))))).digest('hex');
export async function verifyImportSource(snapshot){
 const normalized=normalize(snapshot);
 for(const name of Object.keys(definitions))if(!Array.isArray(normalized.collections[name]))normalized.collections[name]=[];
 await validateBackup(backupEnvelope(encryptSnapshot(normalized)));
 for(const row of normalized.collections.Backup)await new models.Backup(row).validate();
 return normalized;
}
export async function importSnapshot(snapshot,{name='mongodb-to-postgres-v1',dryRun=false}={}){
 if(databaseDriver!=='postgres')throw new Error('Migration target must be PostgreSQL');
 const data=await verifyImportSource(snapshot),summary={};
 return inTransaction(async session=>{
  if((await query('SELECT name FROM data_migrations WHERE name=$1',[name],session)).rows.length)throw new Error('This migration was already completed; no data was changed');
  for(const Model of Object.values(models))if(await Model.countDocuments().session(session))throw new Error('PostgreSQL target is not empty; no records were replaced');
  for(const [model,Model]of Object.entries(models)){
   const rows=data.collections[model];if(rows.length)await Model.insertMany(rows,{session,preserveTimestamps:true});
  }
  await query('SET CONSTRAINTS ALL IMMEDIATE',[],session);
  for(const [model,Model]of Object.entries(models)){
   const rows=await Model.find().select([...Object.keys(definitions[model].fields),...Object.keys(definitions[model].relations)].join(' ')).session(session).lean();
   if(rows.length!==data.collections[model].length||digest(definitions[model],rows)!==digest(definitions[model],data.collections[model]))throw new Error('Migration verification failed for '+model);
   summary[model]=rows.length;
  }
  if(dryRun)throw Object.assign(new Error('Dry run verified and rolled back'),{verifiedDryRun:true});
  await query('INSERT INTO data_migrations(name,summary) VALUES($1,$2::jsonb)',[name,JSON.stringify(summary)],session);
  return {verified:true,counts:summary};
 }).catch(error=>{if(error.verifiedDryRun)return {verified:true,dryRun:true,counts:summary};throw error;});
}
