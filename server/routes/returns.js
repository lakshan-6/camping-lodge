import { Router } from 'express';
import { Order, Rental, Return, ReturnItem, OrderItem, Equipment, InventoryTransaction } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { getSettings } from './settings.js';
import { mutate,audit,money,units,PAYMENT_METHODS } from '../utils/operations.js';
import { requirePermission,assertPermission } from '../utils/permissions.js';
import { paidTotal,rentalBalanceDue,remainingLines,recordPayment,syncInvoice } from '../utils/finance.js';
import {returnUnitRows,receiveUnits,assertUnitTotals} from '../utils/equipmentUnits.js';
import {nicHeld,releaseNic} from '../utils/securityDeposit.js';
import { sendReturnUpdate } from '../utils/bookingEmail.js';
import { lateFeeInfo } from '../utils/lateFees.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const checklistId=entry=>entry.key??entry.label;
async function outstandingChecklist(rental,session){
 const handedOut=(rental.pickupChecklist||[]).filter(entry=>entry.checked===true);
 if(!handedOut.length)return [];
 const previousReturns=await Return.find({rental:rental._id}).select('checklist').session(session).lean();
 const resolved=new Set(previousReturns.flatMap(record=>(record.checklist||[])
  .filter(entry=>entry.checked===true||entry.missing===true).map(checklistId)));
 return handedOut.filter(entry=>!resolved.has(checklistId(entry)));
}
function receiveChecklist(outstanding,submitted,complete){
 if(!Array.isArray(submitted))throw httpErr(400,'Choose accessories from the return checklist');
 const checklist=new Map();
 for(const entry of submitted){
  const checked=entry?.checked===true,missing=entry?.missing===true;
  if(!checked&&!missing)continue;
  const item=outstanding.find(i=>i.label===entry.label&&(!entry.key||i.key===entry.key));
  if(!item)throw httpErr(409,'The return checklist has changed. Reopen it to see the remaining accessories.');
  const id=checklistId(item);
  if(checked&&missing||checklist.has(id))throw httpErr(400,'Choose one outcome for each accessory');
  const fee=missing?money(entry.fee??0,'Missing accessory fee',true):0;
  checklist.set(id,{...item,checked,missing,fee});
 }
 if(complete&&outstanding.some(item=>!checklist.has(checklistId(item))))
  throw httpErr(400,'Mark each handed-out accessory as returned or missing before completing the return');
 return [...checklist.values()];
}
r.get('/',wrap(async(req,res)=>res.json(await Return.find().sort({returnedAt:-1}).limit(200).populate({path:'rental',populate:[{path:'customer',select:'name'},{path:'order',select:'orderNo status securityMethod nicHeldAt nicReturnedAt'}]}).lean())));
r.get('/preview/:rental',wrap(async(req,res)=>{
 const rental=await Rental.findById(req.params.rental);if(!rental||rental.status==='returned')throw httpErr(404,'Rental not found');
 const order=await Order.findById(rental.order),lines=await remainingLines(order._id);
 const settings=await getSettings();
 const checklist=await outstandingChecklist(rental);
 const netPaid=await paidTotal(order._id);
 res.json({...lateFeeInfo(rental,lines,settings),balance:rentalBalanceDue(order.totalAmount,netPaid),paymentCredit:rentalBalanceDue(netPaid,order.totalAmount),items:lines,checklist,securityMethod:order.securityMethod,nicHeld:nicHeld(order)});
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
 const checklist=receiveChecklist(await outstandingChecklist(rental,session),req.body.checklist??[],complete);
 const equipmentFee=money(req.body.damageFee??0,'Equipment damage / loss fee',true);
 const damageFee=money((Math.round(equipmentFee*100)+checklist.reduce((cents,entry)=>cents+Math.round(entry.fee*100),0))/100,'Damage / loss fee',true);
 const settings=await getSettings(session),returnedAt=new Date();
 const late=lateFeeInfo(rental,lines,settings,+returnedAt),waived=money(req.body.waivedFee||0,'Waived fee',true);
 if(waived>late.lateFee)throw httpErr(400,'Waiver exceeds the late fee');if(waived){assertPermission(req.user,'fees.waive');if(!req.body.waiverReason?.trim())throw httpErr(400,'Enter a fee waiver reason');}
 const lateFee=money(late.lateFee-waived,'Late fee',true);
 const totalAfter=money(order.totalAmount+lateFee+damageFee,'Total',true);
 const netPaid=await paidTotal(order._id,session);
 const credit=rentalBalanceDue(netPaid,order.totalAmount);
 const amounts=[
  ['balance',rentalBalanceDue(order.totalAmount,netPaid),'balance','Return payment'],
  ['late',rentalBalanceDue(lateFee,credit),'fee','Late fee'],
  ['damage',rentalBalanceDue(damageFee,rentalBalanceDue(credit,lateFee)),'fee','Damage fee'],
 ];
 const paid=req.body.paid||{};
 for(const [flag,amount,,reference] of amounts){
  const quoted=req.body[flag+'PaymentAmount'];
  if(paid[flag]===true&&quoted!==undefined&&money(quoted,reference,true)!==amount)
   throw httpErr(409,'The amount due has changed. Reopen the return to see the latest amounts.');
 }
 if(complete&&amounts.some(([flag,amount])=>amount>0&&paid[flag]!==true))
  throw httpErr(409,'Record the full outstanding balance and any return fees before completing the return.');
 const toRecord=amounts.filter(([flag,amount])=>amount>0&&paid[flag]===true);
 if(toRecord.length){
  assertPermission(req.user,'payments.record');
  if(!PAYMENT_METHODS.includes(req.body.method))throw httpErr(400,'Choose how the return payment was received.');
 }
 const returnNic=req.body.returnNic===true;
 if(returnNic&&!complete)throw httpErr(409,'Return all equipment before releasing the NIC');
 if(complete&&nicHeld(order)&&!returnNic)
  throw httpErr(409,'Confirm the customer’s NIC was physically returned before completing the return.');
 const [ret]=await Return.create([{rental:rental._id,returnedAt,lateFee,damageFee,partial:!complete,waivedFee:waived,waiverReason:req.body.waiverReason,notes:req.body.notes,checklist}],{session});
 for(const {line,ok,dmg,lost,n,unitRows} of rows){if(!n)continue;
  const equipment=await Equipment.findById(line.equipment._id).session(session);if(!equipment)throw httpErr(409,'Equipment is missing');await assertUnitTotals(equipment,session);
  await receiveUnits(line,unitRows,rental,session);
  await ReturnItem.create([{return:ret._id,equipment:line.equipment._id,quantityReturned:ok,quantityDamaged:dmg,quantityLost:lost,units:unitRows}],{session});
  await OrderItem.updateOne({_id:line._id},{$inc:{returnedQuantity:n},...(line.equipment.trackUnits?{$set:{unitAssignments:line.unitAssignments}}:{})},{session});
  if(!equipment||equipment.totalQuantity-lost<equipment.damagedQty+dmg)throw httpErr(409,'Stock figures are inconsistent; check inventory before receiving this return');
  equipment.damagedQty+=dmg;equipment.totalQuantity-=lost;equipment.revision++;await equipment.save({session});
  for(const [type,qty,note] of [['returned',ok,''],['damaged',dmg,`${dmg} damaged`],['lost',lost,`${lost} lost`]])if(qty)await InventoryTransaction.create([{equipment:equipment._id,type,quantity:type==='returned'?qty:0,note,reference:String(ret._id)}],{session});
 }
 rental.lateFeePercentCharged=late.chargedPercent;if(complete)rental.status='returned';await rental.save({session});
 order.totalAmount=totalAfter;
 for(const [,amount,type,reference] of toRecord)payments.push(await recordPayment(order,{amount,type,method:req.body.method,reference},req.user,session));
 if(complete)order.status='completed';
 if(returnNic)await releaseNic(order,req.user,session);
 await order.save({session});
 await syncInvoice(order,session);await audit(session,req.user,complete?'rental.returned':'rental.partial_return',order._id,null,{return:ret._id,lateFee,damageFee,waived,items:rows.map(r=>({equipment:r.line.equipment._id,returned:r.ok,damaged:r.dmg,lost:r.lost}))});
 return {...ret.toObject(),emailNote:complete?'Return saved. Order completed and balance settled.':'Partial return saved. Remaining equipment is still out.'};
 });
 res.status(201).json({...result,notificationEmail:result._replayed?'already_processed':await sendReturnUpdate(orderId,result,payments)});
}));
export default r;
