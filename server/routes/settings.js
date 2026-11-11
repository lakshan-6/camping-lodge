import { Router } from 'express';
import { Settings } from '../models/index.js';
import { requireAdmin } from '../utils/auth.js';
import { mutate,audit,money,units } from '../utils/operations.js';
import { httpErr } from '../utils/availability.js';
import { lateFeePolicy } from '../utils/lateFees.js';
import { mailReady } from '../utils/mail.js';
import { bookingEmailConfigured } from '../utils/bookingEmail.js';
const emailSettings=()=>({emailConfigured:mailReady(),bookingEmailConfigured:bookingEmailConfigured()});
export const getSettings=async(session=null)=>(await Settings.findOne().session(session))||(await Settings.create([{}],{session}))[0];
const settingsResponse = settings => ({...settings.toObject(),...lateFeePolicy(settings),...emailSettings()});

function feeSetting(value, fallback, label, allowZero = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    throw httpErr(400, `Enter a valid ${label.toLowerCase()}`);
  }
  return money(value,label,allowZero);
}

const r=Router();
r.get('/',async(req,res,next)=>{try{res.json(settingsResponse(await getSettings()));}catch(e){next(e);}});
r.put('/',requireAdmin,async(req,res,next)=>{
  try {
    res.json(await mutate(req,'settings.edit',async session=>{
      const settings=await getSettings(session),before=settings.toObject(),current=lateFeePolicy(settings);
      const { businessName=settings.businessName, phone=settings.phone, address=settings.address, graceMinutes=settings.graceMinutes } = req.body;
      const lateFeeIntervalHours=feeSetting(req.body.lateFeeIntervalHours,current.lateFeeIntervalHours,'Late fee interval');
      const lateFeeStepPercent=feeSetting(req.body.lateFeeStepPercent,current.lateFeeStepPercent,'Late fee percentage',true);
      const lateFeeFullRateAfterHours=feeSetting(req.body.lateFeeFullRateAfterHours,current.lateFeeFullRateAfterHours,'Full-rate threshold');
      if(lateFeeStepPercent>100)throw httpErr(400,'Late fee percentage cannot exceed 100%');
      settings.set({businessName,phone,address,graceMinutes:units(graceMinutes||0,true),
        lateFeeIntervalHours,lateFeeStepPercent,lateFeeFullRateAfterHours});
      await settings.save({session});
      await audit(session,req.user,'settings.edited',settings._id,before,settings);
      return settingsResponse(settings);
    }));
  } catch (e) { next(e); }
});
export default r;
