import crypto from 'node:crypto';
import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {User} from '../models/index.js';
import {checkPassword,hashPassword,sign} from '../utils/auth.js';
import {httpErr} from '../utils/availability.js';
import {exclusive,transaction,audit} from '../utils/operations.js';
import {base32,sealSecret,openSecret,matchingStep,newCodes,verifyFactor,securityFields} from '../utils/mfa.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
r.use((req,res,next)=>{res.set('Cache-Control','no-store');req.user.role==='owner'?next():next(httpErr(403,'Owner only'));});
r.use(rateLimit({windowMs:15*60*1000,limit:15,keyGenerator:req=>String(req.user._id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many security attempts. Try again in 15 minutes.'},skip:req=>req.method==='GET'}));
r.get('/',wrap(async(req,res)=>{const u=await User.findById(req.user._id).select(securityFields);res.json({mfaEnabled:u.mfaEnabled,authenticatorRecoveryCodes:u.mfaRecoveryHashes.length,accountRecoveryCodes:u.accountRecoveryHashes.length,encryptionConfigured:(process.env.BACKUP_ENCRYPTION_KEY||'').length>=32});}));
const secure=(action,fn)=>wrap(async(req,res)=>{
  const result=await exclusive(()=>transaction(async session=>{
    const u=await User.findById(req.user._id).select(securityFields).session(session);
    if(!u?.active||u.role!=='owner'||u.passwordHash!==req.user.passwordHash||u.sessionVersion!==req.user.sessionVersion)throw httpErr(401,'Please log in again');
    if(!await checkPassword(req.body.currentPassword,u.passwordHash))throw httpErr(403,'Incorrect current password');
    try{verifyFactor(u,req.body.code);}catch(e){if(e.status===401)e.status=403;throw e;}
    const result=await fn(u,session,req.body);await u.save({session});
    await audit(session,u,action,u._id,null,{enabled:u.mfaEnabled});
    return {...result,token:sign(u)};
  }));res.json(result);
});
r.post('/mfa/start',secure('security.enrollment_started',async u=>{
  if(u.mfaEnabled)throw httpErr(409,'Authenticator is already enabled');
  const secret=base32(crypto.randomBytes(20));u.mfaPendingSecret=sealSecret(secret);u.mfaPendingUntil=new Date(Date.now()+10*60000);
  return {secret,username:u.username,expiresAt:u.mfaPendingUntil};
}));
r.post('/mfa/enable',secure('security.authenticator_enabled',async(u,session,body)=>{
  if(u.mfaEnabled||!u.mfaPendingSecret||+u.mfaPendingUntil<Date.now())throw httpErr(409,'Start authenticator setup again');
  const step=matchingStep(openSecret(u.mfaPendingSecret),body.enrollmentCode);
  if(step===null)throw httpErr(400,'Enter the current six-digit code from your authenticator');
  const recovery=newCodes();u.mfaSecret=u.mfaPendingSecret;u.mfaPendingSecret=undefined;u.mfaPendingUntil=undefined;u.mfaEnabled=true;u.mfaLastStep=step;u.mfaRecoveryHashes=recovery.hashes;u.sessionVersion++;
  return {codes:recovery.codes,kind:'authenticator',mfaEnabled:true};
}));
r.post('/mfa/disable',secure('security.authenticator_disabled',async u=>{
  u.mfaEnabled=false;u.mfaSecret=undefined;u.mfaPendingSecret=undefined;u.mfaPendingUntil=undefined;u.mfaRecoveryHashes=[];u.mfaLastStep=-1;u.sessionVersion++;return {ok:true};
}));
r.post('/mfa/recovery-codes',secure('security.authenticator_codes_regenerated',async u=>{
  if(!u.mfaEnabled)throw httpErr(409,'Enable the authenticator first');const recovery=newCodes();u.mfaRecoveryHashes=recovery.hashes;u.sessionVersion++;return {codes:recovery.codes,kind:'authenticator'};
}));
r.post('/account-recovery-codes',secure('security.account_codes_regenerated',async u=>{
  const recovery=newCodes();u.accountRecoveryHashes=recovery.hashes;u.sessionVersion++;return {codes:recovery.codes,kind:'account'};
}));
r.post('/password',secure('security.password_changed',async(u,session,body)=>{
  u.passwordHash=await hashPassword(body.newPassword);u.sessionVersion++;return {ok:true};
}));
export default r;
