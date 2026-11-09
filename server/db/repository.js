import {definitions,quote as q} from './definitions.js';
import {query,inTransaction} from './connection.js';
import {Parameters,condition,field} from './filters.js';

const full=Symbol('database row');
const fresh=Symbol('new row');
export const registry={};
export function normalize(value){
 if(value==null||typeof value!=='object')return value;
 if(value instanceof Date)return new Date(value);
 if(Buffer.isBuffer(value)||value instanceof Uint8Array)return Buffer.from(value);
 if(value._bsontype==='ObjectId')return String(value);
 if(value._bsontype==='Binary')return Buffer.from(value.buffer);
 if(Array.isArray(value))return value.map(normalize);
 return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='__v').map(([k,v])=>[k,normalize(v)]));
}
const fromRow=row=>Object.fromEntries(Object.entries(row).filter(([,v])=>v!==null).map(([k,v])=>[k,normalize(v)]));
function typedRow(row,d){const data=fromRow(row);for(const [key,f]of Object.entries(d.fields))if(f.path.instance==='Number'&&data[key]!==undefined)data[key]=Number(data[key]);return data;}
function projection(data,d,selected){
 const parts=typeof selected==='string'?selected.split(/\s+/).filter(Boolean):[],include=parts.filter(p=>!p.startsWith('-')&&!p.startsWith('+'));
 const out={};for(const [key,value]of Object.entries(data)){
  if(include.length&&key!=='_id'&&!include.includes(key))continue;
  if(parts.includes('-'+key)||d.fields[key]?.private&&!parts.includes('+'+key)&&!include.includes(key))continue;
  out[key]=normalize(value);
 }return out;
}
function errorOf(error){
 if(error.code==='23505')return Object.assign(new Error('A record with this identifier already exists'),{status:409,code:11000});
 if(error.code==='23503')return Object.assign(new Error('A related record is missing or still in use. Refresh and resolve its history first.'),{status:409,code:error.code});
 if(['23514','23502','22P02','22003'].includes(error.code))return Object.assign(new Error('Invalid database value: '+(error.column||error.constraint||'check the submitted fields')),{status:400});
 return error;
}
const paramValue=(f,value)=>f.type==='jsonb'?(value===undefined?null:JSON.stringify(normalize(value))):value??null;
async function children(d,rows,session){
 if(!rows.length)return;
 for(const [key,r]of Object.entries(d.relations)){
  const p=new Parameters(),ids=rows.map(row=>p.add(row._id));
  const result=await query(`SELECT * FROM ${q(r.table)} WHERE ${q(r.parent)} IN (${ids.join(',')}) ORDER BY "position"`,p.values,session);
  for(const row of rows)row[key]=result.rows.filter(v=>v[r.parent]===row._id).map(v=>r.ids?v.unit:fromRow(Object.fromEntries(['_id',...r.fields].map(f=>[f,v[f]]))));
 }
}
async function saveChildren(d,data,session){
 for(const [key,r]of Object.entries(d.relations)){
  await query(`DELETE FROM ${q(r.table)} WHERE ${q(r.parent)}=$1`,[data._id],session);
  const rows=data[key]||[];
  for(let i=0;i<rows.length;i++){
   const row=r.ids?{unit:String(rows[i])}:rows[i],keys=[r.parent,'position',...(r.ids?[]:['_id']),...r.fields],values=keys.map(k=>k===r.parent?data._id:k==='position'?i:row[k]??null);
   await query(`INSERT INTO ${q(r.table)} (${keys.map(q).join(',')}) VALUES (${keys.map((_,n)=>'$'+(n+1)).join(',')})`,values,session);
  }
 }
}
async function populate(docs,d,spec,session){
 const cfg=typeof spec==='string'?{path:spec}:spec;
 const names=cfg.path.split(/\s+/);
 for(const path of names){
  const ref=d.fields[path]?.ref||(d.relations[path]?.ids?'EquipmentUnit':null);if(!ref)throw new Error('Unknown relation: '+d.name+'.'+path);
  const ids=[...new Set(docs.flatMap(row=>Array.isArray(row[path])?row[path]:[row[path]]).filter(Boolean).map(v=>String(v._id||v)))];
  if(!ids.length)continue;
  let find=registry[ref].find({_id:{$in:ids}}).session(session);if(cfg.select)find=find.select(cfg.select);if(cfg.populate)for(const nested of Array.isArray(cfg.populate)?cfg.populate:[cfg.populate])find=find.populate(nested);
  const found=await find,byId=new Map(found.map(row=>[String(row._id),row]));
  for(const row of docs)row[path]=Array.isArray(row[path])?row[path].map(id=>byId.get(String(id._id||id))).filter(Boolean):byId.get(String(row[path]?._id||row[path]))||null;
 }
}
class Query{
 constructor(d,filter,kind='find',runner){this.d=d;this.filter=filter;this.kind=kind;this.runner=runner;this.populates=[];}
 session(value){this.tx=value;return this;}
 select(value){this.selection=value;return this;}
 sort(value){this.order=value;return this;}
 skip(value){this.offset=value;return this;}
 limit(value){this.maximum=value;return this;}
 lean(){this.plain=true;return this;}
 populate(spec,select){this.populates.push(typeof spec==='string'?{path:spec,select}:spec);return this;}
 then(resolve,reject){return this.exec().then(resolve,reject);}
 catch(reject){return this.exec().catch(reject);}
 async exec(){try{
  if(this.runner)return await this.runner(this);
  const d=this.d,p=new Parameters(),where=condition(d,this.filter,p);
  if(this.kind==='count')return Number((await query(`SELECT count(*) AS n FROM ${q(d.table)} t WHERE ${where}`,p.values,this.tx)).rows[0].n);
  let sql=`SELECT t.* FROM ${q(d.table)} t WHERE ${where}`;
  if(this.order)sql+=' ORDER BY '+Object.entries(this.order).map(([key,dir])=>field(d,key)+(dir===-1?' DESC NULLS LAST':' ASC NULLS FIRST')).join(',');
  if(this.kind==='one'||this.kind==='exists')sql+=' LIMIT 1';else if(this.maximum!==undefined)sql+=' LIMIT '+p.add(this.maximum);
  if(this.offset)sql+=' OFFSET '+p.add(this.offset);
  const rows=(await query(sql,p.values,this.tx)).rows.map(row=>typedRow(row,d));await children(d,rows,this.tx);
  const docs=rows.map(raw=>registry[d.name].hydrate(raw,this.selection));
  for(const spec of this.populates)await populate(docs,d,spec,this.tx);
  const data=this.plain?docs.map(v=>v.toObject()):docs;
  return this.kind==='one'?data[0]||null:this.kind==='exists'?(data[0]?{_id:data[0]._id}:null):data;
 }catch(error){throw errorOf(error);}}
}
function expression(d,value,p){
 if(typeof value==='string'&&value.startsWith('$'))return field(d,value.slice(1));
 if(value===null)return 'NULL';
 if(typeof value!=='object')return p.add(value)+(typeof value==='number'?'::numeric':'');
 const [op,args]=Object.entries(value)[0];
 if(op==='$cond')return `(CASE WHEN ${expression(d,args[0],p)} THEN ${expression(d,args[1],p)} ELSE ${expression(d,args[2],p)} END)`;
 if(['$eq','$multiply','$subtract'].includes(op))return '('+args.map(v=>expression(d,v,p)).join({$eq:' = ',$multiply:' * ',$subtract:' - '}[op])+')';
 if(op==='$ifNull')return `COALESCE(${args.map(v=>expression(d,v,p)).join(',')})`;
 if(op==='$substrBytes')return `substring(${expression(d,args[0],p)} from ${p.add(args[1]+1)}::integer for ${p.add(args[2])}::integer)`;
 if(op==='$convert'){const input=expression(d,args.input,p);return `(CASE WHEN ${input} ~ '^[0-9]+$' THEN (${input})::numeric ELSE ${p.add(args.onError||0)}::numeric END)`;}
 throw new Error('Unsupported aggregate expression: '+op);
}
async function aggregate(d,pipeline,session){
 const p=new Parameters();let sql=`SELECT * FROM ${q(d.table)}`,shape=d;
 for(const stage of pipeline){
  if(stage.$match)sql=`SELECT t.* FROM (${sql}) t WHERE ${condition(shape,stage.$match,p)}`;
  else if(stage.$project){const fields=Object.entries(stage.$project);sql=`SELECT ${fields.map(([key,v])=>expression(shape,v,p)+' AS '+q(key)).join(',')} FROM (${sql}) t`;shape={fields:Object.fromEntries(fields.map(([key])=>[key,{type:'numeric'}])),relations:{}};}
  else if(stage.$group){const group=stage.$group,id=expression(shape,group._id,p),values=Object.entries(group).filter(([key])=>key!=='_id');sql=`SELECT ${id} AS "_id"${values.map(([key,v])=>{const [op,arg]=Object.entries(v)[0];if(!['$sum','$max'].includes(op))throw new Error('Unsupported aggregate');return ', '+(op==='$sum'?'SUM':'MAX')+'('+expression(shape,arg,p)+') AS '+q(key);}).join('')} FROM (${sql}) t${group._id===null?'':' GROUP BY '+id}`;shape={fields:Object.fromEntries(['_id',...values.map(([key])=>key)].map(key=>[key,{type:'numeric'}])),relations:{}};}
  else if(stage.$sort)sql=`SELECT t.* FROM (${sql}) t ORDER BY `+Object.entries(stage.$sort).map(([key,n])=>field(shape,key)+(n===-1?' DESC':' ASC')).join(',');
  else throw new Error('Unsupported aggregate stage');
 }
 return (await query(sql,p.values,session)).rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k!=='_id'&&v!==null?Number(v):v])));
}
export function createRepository(name){
 const d=definitions[name];
 class Record{
  constructor(data={}){
   const normalized=normalize(new d.Validator(data).toObject());
   Object.defineProperty(this,full,{value:normalized,writable:true});Object.defineProperty(this,fresh,{value:true,writable:true});Object.assign(this,projection(normalized,d));
  }
  static hydrate(raw,selected){const row=Object.create(Record.prototype);Object.defineProperty(row,full,{value:normalize(raw),writable:true});Object.defineProperty(row,fresh,{value:false,writable:true});Object.assign(row,projection(raw,d,selected));return row;}
  get id(){return String(this._id);}
  set(values){Object.assign(this,values);return this;}
  toObject(){return normalize(Object.fromEntries(Object.entries(this)));}
  toJSON(){return this.toObject();}
  deleteOne(options={}){return Record.deleteOne({_id:this._id},options);}
  async validate(){await new d.Validator({...this[full],...this.toObject()}).validate();}
  async save({session=null,preserveTimestamps=false}={}){
   return inTransaction(async tx=>{
    const populated=Object.fromEntries(Object.entries(this).filter(([key,value])=>d.fields[key]?.ref&&value?._id));
    const validator=new d.Validator({...this[full],...this.toObject()}),now=new Date();await validator.validate();
    const data=normalize(validator.toObject());data.createdAt=data.createdAt||now;data.updatedAt=preserveTimestamps&&data.updatedAt?data.updatedAt:now;
    const same=(a,b)=>JSON.stringify(normalize(a))===JSON.stringify(normalize(b));
    const keys=Object.keys(d.fields).filter(key=>this[fresh]||key!=='_id'&&key!=='createdAt'&&!same(data[key],this[full][key]));
    const values=keys.map(key=>paramValue(d.fields[key],data[key]));
    let result;
    if(this[fresh])result=await query(`INSERT INTO ${q(d.table)} (${keys.map(q).join(',')}) VALUES (${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,values,tx);
    else if(keys.length)result=await query(`UPDATE ${q(d.table)} SET ${keys.map((key,i)=>q(key)+'=$'+(i+1)).join(',')} WHERE "_id"=$${values.length+1} RETURNING *`,[...values,data._id],tx);
    else result=await query(`SELECT * FROM ${q(d.table)} WHERE "_id"=$1`,[data._id],tx);
    if(!result.rows[0])throw Object.assign(new Error('This record was removed. Refresh before saving.'),{status:409});
    const changedRelations={...d,relations:Object.fromEntries(Object.entries(d.relations).filter(([key])=>this[fresh]||!same(data[key],this[full][key])))};
    await saveChildren(changedRelations,data,tx);
    const saved=typedRow(result.rows[0],d);await children(d,[saved],tx);this[full]=saved;this[fresh]=false;
    for(const key of Object.keys(this))if(key in saved||key in d.fields||key in d.relations)this[key]=saved[key];Object.assign(this,projection(saved,d));
    for(const [key,value]of Object.entries(populated))if(String(value._id)===String(saved[key]))this[key]=value;
    return this;
   },session).catch(error=>{throw errorOf(error);});
  }
  static find(filter={}){return new Query(d,filter);}
  static findById(id){return new Query(d,{_id:id},'one');}
  static findOne(filter={}){return new Query(d,filter,'one');}
  static countDocuments(filter={}){return new Query(d,filter,'count');}
  static exists(filter={}){return new Query(d,filter,'exists');}
  static async create(input,options={}){
   const many=Array.isArray(input),values=many?input:[input];
   const docs=await inTransaction(async session=>{const out=[];for(const value of values){const doc=new Record(value);await doc.save({session,preserveTimestamps:options.preserveTimestamps});out.push(doc);}return out;},options.session);
   return many?docs:docs[0];
  }
  static insertMany(rows,options={}){return this.create(rows,options);}
  static updateOne(filter,changes,options={}){return update(filter,changes,options,false);}
  static updateMany(filter,changes,options={}){return update(filter,changes,options,true);}
  static deleteMany(filter,options={}){return remove(filter,options,false);}
  static deleteOne(filter,options={}){return remove(filter,options,true);}
  static findOneAndUpdate(filter,changes,options={}){
   return new Query(d,filter,'one',async state=>inTransaction(async tx=>{
    let row=await Record.findOne(filter).session(tx),before=row?.toObject();
    if(!row&&!options.upsert)return null;
    if(!row)row=new Record(Object.fromEntries(Object.entries(filter).filter(([k,v])=>!k.startsWith('$')&&(v===null||typeof v!=='object'))));
    apply(row,changes);await row.save({session:tx});return options.new===false&&before?Record.hydrate(before,state.selection):Record.hydrate(row[full],state.selection);
   },state.tx||options.session));
  }
  static aggregate(pipeline){return new Query(d,{},'aggregate',state=>aggregate(d,pipeline,state.tx));}
  static async init(){return this;}
 }
 function apply(row,changes){
  for(const [key,value]of Object.entries(changes.$set||{}))row[key]=value;
  for(const key of Object.keys(changes.$unset||{}))row[key]=undefined;
  for(const [key,value]of Object.entries(changes.$inc||{}))row[key]=(row[key]||0)+value;
  for(const [key,value]of Object.entries(changes.$max||{}))row[key]=Math.max(row[key]||0,value);
  if(!Object.keys(changes).some(k=>k.startsWith('$')))row.set(changes);
 }
 function update(filter,changes,options,many){return new Query(d,filter,'update',state=>inTransaction(async tx=>{
  let find=Record.find(filter).session(tx).select(Object.keys(d.fields).join(' '));if(!many)find=find.limit(1);const rows=await find;
  for(const row of rows){apply(row,changes);await row.save({session:tx});}
  return {matchedCount:rows.length,modifiedCount:rows.length};
 },state.tx||options.session));}
 function remove(filter,options,one){return new Query(d,filter,'delete',async state=>{
  const p=new Parameters(),where=condition(d,filter,p);const clause=one?`"_id" IN (SELECT t."_id" FROM ${q(d.table)} t WHERE ${where} LIMIT 1)`:where;
  const result=await query(`DELETE FROM ${q(d.table)} t WHERE ${clause}`,p.values,state.tx||options.session);return {deletedCount:result.rowCount};
 });}
 Record.modelName=name;Record.schema=d.Validator.schema;registry[name]=Record;return Record;
}
