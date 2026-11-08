import { Router } from 'express';
import { Order, OrderItem, Customer, Rental, Equipment, EquipmentUnit,InventoryTransaction, Invoice } from '../models/index.js';
import { httpErr, availability, PERIOD_MS } from '../utils/availability.js';
import { mutate, audit, units,money } from '../utils/operations.js';
import { requirePermission, can } from '../utils/permissions.js';
import { paidTotal, recordPayment, syncInvoice, remainingLines,depositHeld,recordSecurityDeposit } from '../utils/finance.js';
import { emailInvoice } from '../utils/invoiceMail.js';
import { mailReady } from '../utils/mail.js';
import {getSettings} from './settings.js';
import {chooseSecurity,receiveNic,nicHeld} from '../utils/securityDeposit.js';
import {allocateUnits,assertUnitTotals} from '../utils/equipmentUnits.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
r.get('/',wrap(async(req,res)=>{
 const f=req.query.status?{status:req.query.status}:{};const rows=await Rental.find(f).sort({dueDate:1}).populate('customer','name phone').populate('order','orderNo startDate endDate securityMethod nicHeldAt nicReturnedAt').lean();
 const result=[];for(const row of rows)result.push({...row,overdue:row.status==='out'&&new Date(row.dueDate)<new Date(),items:await remainingLines(row.order._id)});res.json(result);
}));
r.get('/pickup-preview/:order',requirePermission('rentals.write'),wrap(async(req,res)=>{
 const order=await Order.findById(req.params.order).lean();if(!order||order.deletedAt||order.status!=='reserved')throw httpErr(409,'Choose an uncollected booking');
 const lines=await remainingLines(order._id);
 const items=[];for(const line of lines)items.push({...line,availableUnits:line.equipment.trackUnits?await EquipmentUnit.find({equipment:line.equipment._id,state:'good'}).select('code state').sort({code:1}).lean():[]});
 res.json({securityMethod:order.securityMethod||'money',nicHeld:nicHeld(order),securityHeld:await depositHeld(order._id),depositAmount:order.depositAmount,items});
}));
r.post('/start',requirePermission('rentals.write'),wrap(async(req,res)=>{
 const result=await mutate(req,'rental.start:'+req.body.order,async session=>{
  const order=await Order.findById(req.body.order).session(session);if(!order||order.deletedAt)throw httpErr(404,'Order not found');
  if(order.status!=='reserved'||await Rental.exists({order:order._id}).session(session))throw httpErr(409,'This booking has already been collected or cancelled');
  const customer=await Customer.findById(order.customer).session(session);if(!customer||customer.detailsPending)throw httpErr(409,'Complete customer name and NIC before handover');
  const items=await OrderItem.find({order:order._id}).populate('equipment').session(session);
  await Equipment.updateMany({_id:{$in:items.map(i=>i.equipment._id)}},{$inc:{revision:1}},{session});
  const now=new Date(),dueDate=new Date(+now+(order.periods||1)*PERIOD_MS);
  const avail=new Map((await availability(now,dueDate,order._id,session)).map(i=>[String(i._id),i]));
  for(const i of items)if(!avail.has(String(i.equipment._id))||i.quantity>avail.get(String(i.equipment._id)).available)throw httpErr(409,'Actual pickup time conflicts with another booking. Change the booking or choose different items.');
  for(const i of items)await assertUnitTotals(i.equipment,session);
  const required=items.flatMap(i=>(i.equipment.checklist||[]).map(part=>`${i.equipment.name}: ${part}`));
  const confirmed=new Set((req.body.checklist||[]).filter(i=>i.checked).map(i=>i.label));
  if(required.some(label=>!confirmed.has(label)))throw httpErr(400,'Confirm all equipment handover checklist items');
  await chooseSecurity(order,req.body.securityMethod??order.securityMethod??'money',session);
  if(order.securityMethod==='nic'){
   if(req.body.nicReceived===true)await receiveNic(order,req.user,session);
   if(!nicHeld(order))throw httpErr(400,'Confirm that the customer NIC was physically received');
  }else{
   if(req.body.securityDeposit?.received===true){
    const amount=Number(req.body.securityDeposit.amount),held=await depositHeld(order._id,session);
    if(!Number.isFinite(amount)||amount<=0)throw httpErr(400,'Enter the money deposit actually received');
    order.depositAmount=money(Math.max(order.depositAmount||0,held+amount),'Required deposit',true);
    await recordSecurityDeposit(order,{type:'collect',amount,method:req.body.securityDeposit.method},req.user,session);
   }
   if(await depositHeld(order._id,session)<=0)throw httpErr(409,'Record the money security deposit before handover, or choose NIC security');
  }
  if(req.body.payBalance){const amount=Math.max(0,order.totalAmount-await paidTotal(order._id,session));if(amount)await recordPayment(order,{amount,type:'balance',method:req.body.method},req.user,session);}
  const [rental]=await Rental.create([{order:order._id,customer:order.customer,pickedUpAt:now,dueDate,pickupChecklist:required.map(label=>({label,checked:true}))}],{session});
  await allocateUnits(items,req.body.unitSelections,rental,session);
  order.startDate=now;order.endDate=dueDate;order.status='active';order.sendVia=['email','whatsapp','both','none'].includes(req.body.sendVia)?req.body.sendVia:'none';await order.save({session});
  await InventoryTransaction.insertMany(items.map(i=>({equipment:i.equipment._id,type:'rented_out',quantity:-i.quantity,reference:String(order._id)})),{session});
  const invoice=await syncInvoice(order,session,true);await audit(session,req.user,'rental.started',order._id,null,{rental:rental._id,dueDate,checklist:rental.pickupChecklist});
  return {...rental.toObject(),invoiceId:invoice._id,via:order.sendVia};
 });
 if(!result._replayed){if(['email','both'].includes(result.via)&&mailReady()){try{await emailInvoice(result.invoiceId);result.emailNote='Invoice emailed.';}catch{result.emailNote='Rental saved. Email delivery failed; use PDF or WhatsApp.';}}
 if(['whatsapp','both'].includes(result.via))result.whatsappInvoice=result.invoiceId;}
 res.status(201).json(result);
}));
r.post('/:id/extend',requirePermission('rentals.write'),wrap(async(req,res)=>{
 res.json(await mutate(req,'rental.extend:'+req.params.id,async session=>{
 const rental=await Rental.findById(req.params.id).session(session);if(!rental||rental.status!=='out')throw httpErr(409,'Only outstanding rentals can be extended');
 const order=await Order.findById(rental.order).session(session),periods=units(req.body.periods),lines=await remainingLines(order._id,session);
 if(periods>30)throw httpErr(400,'Extend by at most 30 periods at a time');
 const now=Date.now(),newDue=new Date(Math.max(+rental.dueDate,now)+periods*PERIOD_MS);
 await Equipment.updateMany({_id:{$in:lines.map(i=>i.equipment._id)}},{$inc:{revision:1}},{session});
 const avail=new Map((await availability(rental.dueDate,newDue,order._id,session)).map(i=>[String(i._id),i]));
 for(const i of lines)if(i.remaining>(avail.get(String(i.equipment._id))?.available||0))throw httpErr(409,'Extension overlaps another booking');
 const settings=await getSettings(session),rate=lines.reduce((s,i)=>s+i.remaining*i.periodRate,0);
 const latePeriods=Math.max(0,Math.ceil(Math.max(0,now-+rental.dueDate-(settings.graceMinutes||0)*60000)/PERIOD_MS)-(rental.latePeriodsCharged||0));
 const lateCharge=Math.round(rate*latePeriods*settings.lateFeePercent)/100;
 const extra=rate*periods+lateCharge,oldDue=rental.dueDate;
 rental.dueDate=newDue;rental.latePeriodsCharged=0;await rental.save({session});order.endDate=newDue;order.periods+=periods;order.extensionFees=(order.extensionFees||0)+extra;order.totalAmount+=extra;await order.save({session});
 await syncInvoice(order,session);await audit(session,req.user,'rental.extended',order._id,{dueDate:oldDue},{dueDate:newDue,fee:extra});return {ok:true,dueDate:newDue,extra};
 }));
}));
export default r;
