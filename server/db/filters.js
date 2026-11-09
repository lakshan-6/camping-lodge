import {quote as q} from './definitions.js';
export class Parameters{
 constructor(){this.values=[];}
 add(value){this.values.push(value?._bsontype==='ObjectId'?String(value):value);return '$'+this.values.length;}
}
export function field(d,key,alias='t'){
 const parts=key.split('.'),base=parts.shift();
 if(!d.fields[base])throw new Error('Unknown database field: '+key);
 const column=q(alias)+'.'+q(base);
 if(!parts.length)return column;
 if(d.fields[base].type!=='jsonb'||parts.some(p=>!/^[a-zA-Z0-9_]+$/.test(p)))throw new Error('Invalid nested database field');
 return `${column} #>> '{${parts.join(',')}}'`;
}
export function condition(d,filter={},p=new Parameters(),alias='t'){
 const clauses=[];
 for(const [key,value]of Object.entries(filter||{})){
  if(key==='$or'||key==='$and'){if(!Array.isArray(value))throw new Error('Invalid query conditions');clauses.push(value.length?'('+value.map(f=>condition(d,f,p,alias)).join(key==='$or'?' OR ':' AND ')+')':key==='$or'?'FALSE':'TRUE');continue;}
  const base=key.split('.')[0],relation=d.relations?.[base];
  if(relation){
   const nested=key.includes('.')?{[key.slice(base.length+1)]:value}:value?.$elemMatch;
   if(nested){const child={fields:Object.fromEntries(relation.fields.map(f=>[f,{type:'text'}])),relations:{}};clauses.push(`EXISTS (SELECT 1 FROM ${q(relation.table)} r WHERE r.${q(relation.parent)}=${q(alias)}."_id" AND ${condition(child,nested,p,'r')})`);}
   else clauses.push(`EXISTS (SELECT 1 FROM ${q(relation.table)} r WHERE r.${q(relation.parent)}=${q(alias)}."_id" AND r."unit"=${p.add(value)})`);
   continue;
  }
  const column=field(d,key,alias),array=d.fields[base]?.path?.instance==='Array';
  const compare=(op,v)=>{
   if(v===null||v===undefined)return column+(op==='$ne'?' IS NOT NULL':' IS NULL');
   if(v instanceof RegExp)return column+(v.ignoreCase?' ~* ':' ~ ')+p.add(v.source);
   if(op==='$in'||op==='$nin'){
    if(!Array.isArray(v))throw new Error('Invalid query list');
    if(!v.length)return op==='$in'?'FALSE':'TRUE';
    return column+(op==='$in'?' IN (':' NOT IN (')+v.map(x=>p.add(x)).join(',')+')';
   }
   if(op==='$regex')return column+' ~ '+p.add(v instanceof RegExp?v.source:String(v));
   if(op==='$exists')return column+(v?' IS NOT NULL':' IS NULL');
   if(array&&op==='$eq')return `${column} @> ${p.add(JSON.stringify([v]))}::jsonb`;
   const operators={$eq:'=',$ne:'IS DISTINCT FROM',$gt:'>',$gte:'>=',$lt:'<',$lte:'<='};
   if(!operators[op])throw new Error('Unsupported query operator: '+op);
   return column+' '+operators[op]+' '+p.add(v);
  };
  if(value&&typeof value==='object'&&!(value instanceof Date)&&!(value instanceof RegExp)&&!value._bsontype&&!Buffer.isBuffer(value)){
   for(const [op,v]of Object.entries(value))clauses.push(compare(op,v));
  }else clauses.push(compare('$eq',value));
 }
 return clauses.length?'('+clauses.join(' AND ')+')':'TRUE';
}
