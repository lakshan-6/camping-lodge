import {Pool,types} from 'pg';
import {readFile} from 'node:fs/promises';
import mongoose from 'mongoose';

export const databaseDriver=process.env.DB_DRIVER||'postgres';
if(!['postgres','mongodb'].includes(databaseDriver))throw new Error('DB_DRIVER must be postgres or mongodb');

types.setTypeParser(1700,Number);
types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('Database integer exceeds the safe range');return n;});
let pool,testEngine;
let embeddedQueue=Promise.resolve();
const embeddedExclusive=fn=>{const next=embeddedQueue.catch(()=>{}).then(fn);embeddedQueue=next;return next;};

export const database={
 get connected(){return databaseDriver==='mongodb'?mongoose.connection.readyState===1:!!(pool||testEngine);},
 async startSession(){
  if(databaseDriver==='mongodb')return mongoose.startSession();
  if(!pool&&!testEngine)throw new Error('PostgreSQL is not connected');
  const client=pool?await pool.connect():testEngine;
  return {client,active:false,
   async withTransaction(fn){
    const run=async()=>{for(let attempt=0;;attempt++){
     try{await client.query('BEGIN');this.active=true;await client.query('SELECT pg_advisory_xact_lock(19471109)');const value=await fn();await client.query('COMMIT');this.active=false;return value;}
     catch(error){await client.query('ROLLBACK').catch(()=>{});this.active=false;if(['40001','40P01'].includes(error.code)&&attempt<3)continue;throw error;}
    }};
    return testEngine?embeddedExclusive(run):run();
   },
   async endSession(){if(this.active)await client.query('ROLLBACK');if(pool)client.release();}
  };
 }
};
export async function query(text,values=[],session=null){
 const run=async()=>{
  const result=await (session?.client||pool||testEngine)?.query(text,values);
  if(!result)throw new Error('PostgreSQL is not connected');
  return {...result,rowCount:result.rowCount??result.affectedRows??result.rows?.length??0};
 };
 return testEngine&&!session?embeddedExclusive(run):run();
}
export async function inTransaction(fn,session=null){
 if(session)return fn(session);
 const own=await database.startSession();try{return await own.withTransaction(()=>fn(own));}finally{await own.endSession();}
}
async function migrate(){
 const ddl=await readFile(new URL('./schema.sql',import.meta.url),'utf8');
 await inTransaction(async session=>{
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',[],session);
  if(!(await query('SELECT version FROM schema_migrations WHERE version=1',[],session)).rows.length){
   if(testEngine)await testEngine.exec(ddl);else await session.client.query(ddl);
   await query('INSERT INTO schema_migrations(version) VALUES(1)',[],session);
  }
  if(!(await query('SELECT version FROM schema_migrations WHERE version=2',[],session)).rows.length){
   await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "pickupDate" text',[],session);
   await query('INSERT INTO schema_migrations(version) VALUES(2)',[],session);
  }
 });
}
export async function connectDatabase(url=process.env.DATABASE_URL){
 if(databaseDriver==='mongodb'){
  if(!process.env.MONGODB_URI)throw new Error('Legacy bridge needs MONGODB_URI');
  await mongoose.connect(process.env.MONGODB_URI);return;
 }
 if(!url||!/^postgres(ql)?:\/\//.test(url))throw new Error('Set DATABASE_URL to a PostgreSQL connection URL');
 const parsed=new URL(url),local=['localhost','127.0.0.1','::1','[::1]'].includes(parsed.hostname);
 // Remove driver URL SSL overrides and verify certificates for every remote database.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat'])parsed.searchParams.delete(key);
 pool=new Pool({connectionString:parsed.toString(),ssl:local?false:{rejectUnauthorized:true},max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
 pool.on('error',()=>console.error('PostgreSQL connection interrupted'));
 try{await pool.query('SELECT 1');await migrate();}catch(error){await closeDatabase();throw error;}
}
export async function connectTestDatabase(engine){if(process.env.NODE_ENV==='production')throw new Error('Embedded test databases cannot be used in production');testEngine=engine;await migrate();}
export async function closeDatabase(){const current=pool,embedded=testEngine;pool=undefined;testEngine=undefined;if(current)await current.end();if(embedded)await embedded.close();if(databaseDriver==='mongodb')await mongoose.disconnect();}
