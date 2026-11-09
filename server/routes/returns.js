import { Router } from 'express';
import { Order, Rental, Return, ReturnItem, OrderItem, Equipment, InventoryTransaction } from '../models/index.js';
import { PERIOD_MS,httpErr } from '../utils/availability.js';
import { getSettings } from './settings.js';
import { mutate,audit,money,units } from '../utils/operations.js';
import { requirePermission,assertPermission } from '../utils/permissions.js';
import { paidTotal,remainingLines,recordPayment,syncInvoice } from '../utils/finance.js';
import {returnUnitRows,receiveUnits,assertUnitTotals} from '../utils/equipmentUnits.js';
import {nicHeld,releaseNic} from '../utils/securityDeposit.js';
import { sendReturnUpdate } from '../utils/bookingEmail.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
async function lateInfo(rental,lines,session=null){
 const settings=await getSettings(session);const late=Date.now()-+rental.dueDate-(settings.graceMinutes||0)*60000;
 const total=late>0?Math.ceil(late/PERIOD_MS):0,extra=Math.max(0,total-(rental.latePeriodsCharged||0));
 return {extraPeriods:extra,totalLatePeriods:total,lateFee:Math.round(extra*lines.reduce((s,i)=>s+i.remaining*i.periodRate,0)*settings.lateFeePercent)/100};
}
r.get('/',wrap(async(req,res)=>res.json(await Return.find().sort({returnedAt:-1}).limit(200).populate({path:'rental',populate:[{path:'customer',select:'name'},{path:'order',select:'orderNo status securityMethod nicHeldAt nicReturnedAt'}]}).lean())));
r.get('/preview/:rental',wrap(async(req,res)=>{
 const rental=await Rental.findById(req.params.rental);if(!rental||rental.status==='returned')throw httpErr(404,'Rental not found');
 const order=await Order.findById(rental.order),lines=await remainingLines(order._id);
 res.json({...await lateInfo(rental,lines),balance:Math.max(0,order.totalAmount-await paidTotal(order._id)),items:lines,checklist:rental.pickupChecklist||[],securityMethod:order.securityMethod,nicHeld:nicHeld(order)});
}));
r.post('/',requirePermission('returns.write'),wrap(async(req,res)=>{
 let orderId;
 const payments=[];
 const result=await mutate(req,'return:'+req.body.rental,async session=>{
 payments.length=0;
 const rental=await Rental.findById(req.body.rental).session(session);if(!rental)throw httpErr(404,'Rental not found');if(rental.status==='returned')throw httpErr(409,'Already fully returned');
 const order=await Order.findById(rental.order).session(session),lines=await remainingLines(order._id,session);
 orderId=order._id;
 if(!Array.isArray(req.body.items))throw httpErr(400,'Enter returned quantities');
 const unique=new Set();for(const i of req.body.items){if(unique.has(String(i.equipment)))throw httpErr(400,'Duplicate return item');unique.add(String(i.equipment));if(!lines.some(l=>String(l.equipment._id)===String(i.equipment)))throw httpErr(400,'Equipment is not part of this rental');}
 const rows=lines.map(line=>{
 const row=req.body.items.find(i=>String(i.equipment)===String(line.equipment._id))||{};
 const unitRows=returnUnitRows(line,line.equipment.trackUnits&&!Object.keys(row).length?{units:[]}:row),values=unitRows||row;
 const ok=units(values.quantityReturned||0,true),dmg=units(values.quantityDamaged||0,true),lost=units(values.quantityLost||0,true);
 if(ok+dmg+lost>line.remaining)throw httpErr(400,'Return quantity exceeds the outstanding quantity');return {line,ok,dmg,lost,n:ok+dmg+lost,unitRows:unitRows?.units||[]};
 });
 if(!rows.some(r=>r.n>0))throw httpErr(400,'Return at least one item');
 const complete=rows.every(r=>r.n===r.line.remaining);
 const required=(rental.pickupChecklist||[]).map(i=>i.label),confirmed=new Set((req.body.checklist||[]).filter(i=>i.checked).map(i=>i.label));
 if(complete&&required.some(label=>!confirmed.has(label)))throw httpErr(400,'Confirm all return checklist items');
 const late=await lateInfo(rental,lines,session),waived=money(req.body.waivedFee||0,'Waived fee',true);
 if(waived>late.lateFee)throw httpErr(400,'Waiver exceeds the late fee');if(waived){assertPermission(req.user,'fees.waive');if(!req.body.waiverReason?.trim())throw httpErr(400,'Enter a fee waiver reason');}
 const lateFee=late.lateFee-waived,damageFee=money(req.body.damageFee||0,'Damage fee',true),balanceBefore=Math.max(0,order.totalAmount-await paidTotal(order._id,session));
 const [ret]=await Return.create([{rental:rental._id,returnedAt:new Date(),lateFee,damageFee,partial:!complete,waivedFee:waived,waiverReason:req.body.waiverReason,notes:req.body.notes,checklist:req.body.checklist||[]}],{session});
 for(const {line,ok,dmg,lost,n,unitRows} of rows){if(!n)continue;
  const equipment=await Equipment.findById(line.equipment._id).session(session);if(!equipment)throw httpErr(409,'Equipment is missing');await assertUnitTotals(equipment,session);
  await receiveUnits(line,unitRows,rental,session);
  await ReturnItem.create([{return:ret._id,equipment:line.equipment._id,quantityReturned:ok,quantityDamaged:dmg,quantityLost:lost,units:unitRows}],{session});
  await OrderItem.updateOne({_id:line._id},{$inc:{returnedQuantity:n},...(line.equipment.trackUnits?{$set:{unitAssignments:line.unitAssignments}}:{})},{session});
  if(!equipment||equipment.totalQuantity-lost<equipment.damagedQty+dmg)throw httpErr(409,'Stock figures are inconsistent; check inventory before receiving this return');
  equipment.damagedQty+=dmg;equipment.totalQuantity-=lost;equipment.revision++;await equipment.save({session});
  for(const [type,qty,note] of [['returned',ok,''],['damaged',dmg,`${dmg} damaged`],['lost',lost,`${lost} lost`]])if(qty)await InventoryTransaction.create([{equipment:equipment._id,type,quantity:type==='returned'?qty:0,note,reference:String(ret._id)}],{session});
 }
 rental.latePeriodsCharged=late.totalLatePeriods;if(complete)rental.status='returned';await rental.save({session});
 order.totalAmount=money(order.totalAmount+lateFee+damageFee,'Total',true);if(complete)order.status='completed';await order.save({session});
 if(req.body.returnNic===true){if(!complete)throw httpErr(409,'Return all equipment before releasing the NIC');await releaseNic(order,req.user,session);await order.save({session});}
 const paid=req.body.paid||{};
 for(const [flag,amount,type,reference] of [['balance',balanceBefore,'balance','Rental balance'],['late',lateFee,'fee','Late fee'],['damage',damageFee,'fee','Damage fee']])if(paid[flag]&&amount)payments.push(await recordPayment(order,{amount,type,method:req.body.method,reference},req.user,session));
 await syncInvoice(order,session);await audit(session,req.user,complete?'rental.returned':'rental.partial_return',order._id,null,{return:ret._id,lateFee,damageFee,waived,items:rows.map(r=>({equipment:r.line.equipment._id,returned:r.ok,damaged:r.dmg,lost:r.lost}))});
 return {...ret.toObject(),emailNote:complete?'Return saved. Invoice and balance updated.':'Partial return saved. Remaining equipment is still out.'};
 });
 res.status(201).json({...result,notificationEmail:result._replayed?'already_processed':await sendReturnUpdate(orderId,result,payments)});
}));
export default r;
