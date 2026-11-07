import crypto from 'node:crypto';
import {httpErr} from './availability.js';
export const securityFields='+mfaSecret +mfaPendingSecret +mfaPendingUntil +mfaLastStep +mfaRecoveryHashes +accountRecoveryHashes';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function decode(secret){let bits=0,value=0;const out=[];for(const c of secret){const n=alphabet.indexOf(c);if(n<0)throw new Error('Invalid authenticator secret');value=(value<<5)|n;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function totp(secret,time=Date.now(),digits=6){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(time/30000)));const digest=crypto.createHmac('sha1',decode(secret)).update(counter).digest(),offset=digest.at(-1)&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%10**digits).padStart(digits,'0');}
export function matchingStep(secret,code,last=-1,now=Date.now()){
  if(typeof code!=='string'||!/^\d{6}$/.test(code))return null;
  const current=Math.floor(now/30000);
  for(const step of [current,current-1,current+1])if(step>last&&step>=0&&crypto.timingSafeEqual(Buffer.from(totp(secret,step*30000)),Buffer.from(code)))return step;
  return null;
}
function key(){const raw=process.env.BACKUP_ENCRYPTION_KEY;if(!raw||raw.length<32)throw httpErr(503,'Account security needs the backup encryption key configured on the server');return crypto.createHash('sha256').update('camping-lodge-mfa-v1\0'+raw).digest();}
export function sealSecret(secret){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64url')).join('.');}
export function openSecret(value){try{const [iv,tag,data]=value.split('.').map(s=>Buffer.from(s,'base64url'));const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}catch(e){if(e.status)throw e;throw httpErr(503,'Authenticator key could not be opened. Restore the original backup encryption key.');}}
export const codeHash=code=>crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[-\s]/g,'')).digest('hex');
export function newCodes(count=8){const codes=Array.from({length:count},()=>crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));return {codes,hashes:codes.map(codeHash)};}
export function consumeCode(user,field,code){if(typeof code!=='string'||code.length>100)return false;const hash=codeHash(code),rows=user[field]||[],index=rows.findIndex(h=>h.length===hash.length&&crypto.timingSafeEqual(Buffer.from(h),Buffer.from(hash)));if(index<0)return false;user[field]=rows.filter((_,i)=>i!==index);return true;}
export function verifyFactor(user,code){
  if(!user.mfaEnabled)return;
  const step=matchingStep(openSecret(user.mfaSecret),code,user.mfaLastStep??-1);
  if(step!==null){user.mfaLastStep=step;return;}
  if(consumeCode(user,'mfaRecoveryHashes',code))return;
  throw httpErr(401,'Incorrect or already used authenticator/recovery code. Wait for the next code if needed.');
}
