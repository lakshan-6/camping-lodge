import crypto from 'node:crypto';
import {httpErr} from './availability.js';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest();
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function externalConfig(){
  const keys=['BACKUP_S3_ENDPOINT','BACKUP_S3_BUCKET','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY'];
  if(!keys.every(k=>process.env[k]))throw httpErr(503,'External backup storage is not configured. Follow EXTERNAL_BACKUPS.md.');
  let endpoint;try{endpoint=new URL(process.env.BACKUP_S3_ENDPOINT);}catch{throw httpErr(503,'Invalid external backup endpoint');}
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw httpErr(503,'External backup endpoint must be an HTTPS origin');
  const bucket=process.env.BACKUP_S3_BUCKET,region=process.env.BACKUP_S3_REGION||'auto',prefix=process.env.BACKUP_S3_PREFIX||'camping-lodge';
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||!/^[-a-z0-9]{1,32}$/.test(region)||!/^[-a-zA-Z0-9/_]{1,100}$/.test(prefix))throw httpErr(503,'Invalid external backup bucket, region or prefix');
  return {endpoint:endpoint.origin,bucket,region,prefix,accessKey:process.env.BACKUP_S3_ACCESS_KEY_ID,secretKey:process.env.BACKUP_S3_SECRET_ACCESS_KEY};
}
export function externalStatus(){try{const c=externalConfig();return {configured:true,bucket:c.bucket,prefix:c.prefix};}catch{return {configured:false};}}
// AWS Signature Version 4, S3 path-style requests; credentials never enter URLs.
export function signS3({method,key,body='',config,now=new Date()}){
  const timestamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''),day=timestamp.slice(0,8),scope=`${day}/${config.region}/s3/aws4_request`;
  const url=new URL(config.endpoint+'/'+[config.bucket,...key.split('/')].map(encode).join('/'));
  const hash=sha(body),headers={'host':url.host,'x-amz-content-sha256':hash,'x-amz-date':timestamp};
  const names=Object.keys(headers).sort(),signedHeaders=names.join(';');
  const canonical=[method,url.pathname,'',names.map(n=>`${n}:${headers[n]}\n`).join(''),signedHeaders,hash].join('\n');
  const signingKey=hmac(hmac(hmac(hmac('AWS4'+config.secretKey,day),config.region),'s3'),'aws4_request');
  const signature=hmac(signingKey,['AWS4-HMAC-SHA256',timestamp,scope,sha(canonical)].join('\n')).toString('hex');
  headers.authorization=`AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  delete headers.host;return {url:url.toString(),headers};
}
async function boundedText(response){
  const max=12*1024*1024;if(Number(response.headers.get('content-length')||0)>max)throw httpErr(413,'External backup is too large');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw httpErr(413,'External backup is too large');}parts.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(parts).toString('utf8');
}
export async function externalRequest(method,key,body='',send=fetch){
  const signed=signS3({method,key,body,config:externalConfig()});let response;
  try{response=await send(signed.url,{method,headers:{...signed.headers,...(method==='PUT'?{'content-type':'application/json'}:{})},...(method==='PUT'?{body}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw httpErr(502,'External storage could not be reached. Check its private settings and try again.');}
  if(!response.ok){await response.body?.cancel();throw httpErr(502,`External storage rejected the ${method} request (HTTP ${response.status}).`);}
  if(method==='GET')return boundedText(response);await response.body?.cancel();return null;
}
export async function uploadAndReadBack(envelope,key,send=fetch){
  const text=JSON.stringify(envelope);await externalRequest('PUT',key,text,send);const copy=await externalRequest('GET',key,'',send);
  if(sha(copy)!==sha(text))throw httpErr(502,'External backup read-back did not match the uploaded file');return JSON.parse(copy);
}
