import { Router } from 'express';
import { Order, OrderItem, Customer, Rental, Equipment, EquipmentUnit,InventoryTransaction, Invoice } from '../models/index.js';
import { httpErr, availability, PERIOD_MS } from '../utils/availability.js';
import { mutate, audit, units, money, PAYMENT_METHODS } from '../utils/operations.js';
import { requirePermission, can } from '../utils/permissions.js';
import { paidTotal, rentalBalanceDue, recordPayment, syncInvoice, remainingLines,depositHeld,recordSecurityDeposit } from '../utils/finance.js';
import { emailInvoice } from '../utils/invoiceMail.js';
import { mailReady } from '../utils/mail.js';
import { sendPickupUpdate } from '../utils/bookingEmail.js';
import {getSettings} from './settings.js';
import {chooseSecurity,receiveNic,nicHeld} from '../utils/securityDeposit.js';
import {allocateUnits,assertUnitTotals} from '../utils/equipmentUnits.js';
import {lateFeeInfo} from '../utils/lateFees.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const handoverChecklist=items=>items.flatMap(item=>(item.equipment.checklist||[]).map((part,index)=>({
 key:`${item._id}:${index}`,label:`${item.equipment.name}: ${part}`,checked:false,
})));
r.get('/',wrap(async(req,res)=>{
 const f=req.query.status?{status:req.query.status}:{};const rows=await Rental.find(f).sort({dueDate:1}).populate('customer','name phone').populate('order','orderNo startDate endDate securityMethod nicHeldAt nicReturnedAt').lean();
 const result=[];for(const row of rows)result.push({...row,overdue:row.status==='out'&&new Date(row.dueDate)<new Date(),items:await remainingLines(row.order._id)});res.json(result);
}));
r.get('/pickup-preview/:order',requirePermission('rentals.write'),wrap(async(req,res)=>{
 const order=await Order.findById(req.params.order).lean();if(!order||order.deletedAt||order.status!=='reserved')throw httpErr(409,'Choose an uncollected booking');
 const lines=await remainingLines(order._id);
 const items=[];for(const line of lines)items.push({...line,availableUnits:line.equipment.trackUnits?await EquipmentUnit.find({equipment:line.equipment._id,state:'good'}).select('code state').sort({code:1}).lean():[]});
 const held=nicHeld(order);
 const [securityHeld,paid]=await Promise.all([depositHeld(order._id),paidTotal(order._id)]);
 const method=held?'nic':securityHeld>0?'money':order.securityMethod??null;
 res.json({securityMethod:method,nicHeld:held,securityHeld,depositAmount:order.depositAmount,balance:rentalBalanceDue(order.totalAmount,paid),items,checklist:handoverChecklist(items)});
}));
r.get('/active/:order',requirePermission('rentals.write'),wrap(async(req,res)=>{
 const rental=await Rental.findOne({order:req.params.order,status:{$in:['out','overdue']}}).populate('order','orderNo').lean();
 if(!rental)throw httpErr(404,'Active rental not found');
 res.json({...rental,items:await remainingLines(rental.order._id)});
}));
r.post('/start',requirePermission('rentals.write'),wrap(async(req,res)=>{
 let payment, deposit;
 const result=await mutate(req,'rental.start:'+req.body.order,async session=>{
  payment=undefined; deposit=undefined;
  const order=await Order.findById(req.body.order).session(session);if(!order||order.deletedAt)throw httpErr(404,'Order not found');
  if(order.status!=='reserved'||await Rental.exists({order:order._id}).session(session))throw httpErr(409,'This booking has already been collected or cancelled');
  const customer=await Customer.findById(order.customer).session(session);if(!customer||customer.detailsPending)throw httpErr(409,'Complete customer name and NIC before handover');
  const items=await OrderItem.find({order:order._id}).populate('equipment').session(session);
  await Equipment.updateMany({_id:{$in:items.map(i=>i.equipment._id)}},{$inc:{revision:1}},{session});
  const now=new Date(),dueDate=new Date(+now+(order.periods||1)*PERIOD_MS);
  const avail=new Map((await availability(now,dueDate,order._id,session)).map(i=>[String(i._id),i]));
  for(const i of items)if(!avail.has(String(i.equipment._id))||i.quantity>avail.get(String(i.equipment._id)).available)throw httpErr(409,'Actual pickup time conflicts with another booking. Change the booking or choose different items.');
  for(const i of items)await assertUnitTotals(i.equipment,session);
  const offered=handoverChecklist(items), submitted=req.body.checklist??[];
  if(!Array.isArray(submitted))throw httpErr(400,'Choose accessories from the handover checklist');
  const confirmed=new Set();
  for(const entry of submitted.filter(i=>i?.checked===true)){
   const item=offered.find(i=>i.label===entry.label&&(!entry.key||i.key===entry.key));
   if(!item)throw httpErr(409,'The handover checklist has changed. Reopen it to choose the accessories again.');
   confirmed.add(item.key);
  }
  const pickupChecklist=offered.filter(i=>confirmed.has(i.key)).map(i=>({...i,checked:true}));
  const securityPending=!order.securityMethod;
  await chooseSecurity(order,req.body.securityMethod??order.securityMethod,session);
  if(order.securityMethod==='nic'){
   if(req.body.nicReceived===true)await receiveNic(order,req.user,session);
   if(!nicHeld(order))throw httpErr(400,'Confirm that the customer NIC was physically received');
  }else{
   if(req.body.securityDeposit?.received===true){
    const amount=Number(req.body.securityDeposit.amount),held=await depositHeld(order._id,session);
    if(!Number.isFinite(amount)||amount<=0)throw httpErr(400,'Enter the money deposit actually received');
    const totalReceived=held+amount;
    order.depositAmount=money(securityPending?totalReceived:Math.max(order.depositAmount||0,totalReceived),'Required deposit',true);
    deposit=await recordSecurityDeposit(order,{type:'collect',amount,method:req.body.securityDeposit.method},req.user,session);
   }
   if(await depositHeld(order._id,session)<=0)throw httpErr(409,'Record the money security deposit before handover, or choose NIC security');
  }
  const received=req.body.rentalPayment;
  if(received!==undefined){
   if(typeof received?.amount!=='number')throw httpErr(400,'Enter the rental payment received at pickup');
   const amount=money(received.amount,'Pickup payment',true);
   if(amount>0){
    if(!PAYMENT_METHODS.includes(received.method))throw httpErr(400,'Choose how the pickup payment was received');
    const balance=rentalBalanceDue(order.totalAmount,await paidTotal(order._id,session));
    if(amount>balance)throw httpErr(409,'The pickup payment exceeds the current balance. Reopen the handover to see the latest balance.');
    payment=await recordPayment(order,{amount,type:'balance',method:received.method,reference:'Pickup payment'},req.user,session);
   }
  }else if(req.body.payBalance){
   const amount=rentalBalanceDue(order.totalAmount,await paidTotal(order._id,session));
   if(amount)payment=await recordPayment(order,{amount,type:'balance',method:req.body.method},req.user,session);
  }
  const [rental]=await Rental.create([{order:order._id,customer:order.customer,pickedUpAt:now,dueDate,pickupChecklist}],{session});
  await allocateUnits(items,req.body.unitSelections,rental,session);
  order.startDate=now;order.endDate=dueDate;order.status='active';order.sendVia=['email','whatsapp','both','none'].includes(req.body.sendVia)?req.body.sendVia:'none';await order.save({session});
  await InventoryTransaction.insertMany(items.map(i=>({equipment:i.equipment._id,type:'rented_out',quantity:-i.quantity,reference:String(order._id)})),{session});
  const invoice=await syncInvoice(order,session,true);await audit(session,req.user,'rental.started',order._id,null,{rental:rental._id,dueDate,checklist:rental.pickupChecklist});
  return {...rental.toObject(),invoiceId:invoice._id,via:order.sendVia};
 });
 result.notificationEmail=result._replayed?'already_processed':await sendPickupUpdate(result,payment,deposit);
 if(!result._replayed){
  if(result.notificationEmail==='not_configured'&&['email','both'].includes(result.via)&&mailReady()){
   try{await emailInvoice(result.invoiceId);result.emailNote='Invoice emailed.';}catch{result.emailNote='Invoice email failed; use PDF or WhatsApp.';}
  }
  if(['whatsapp','both'].includes(result.via))result.whatsappInvoice=result.invoiceId;
 }
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
 const {lateFee}=lateFeeInfo(rental,lines,settings,now);
 const extra=money(rate*periods+lateFee,'Extension charge',true),oldDue=rental.dueDate;
 rental.dueDate=newDue;rental.latePeriodsCharged=0;rental.lateFeePercentCharged=0;await rental.save({session});order.endDate=newDue;order.periods+=periods;order.extensionFees=(order.extensionFees||0)+extra;order.totalAmount+=extra;await order.save({session});
 await syncInvoice(order,session);await audit(session,req.user,'rental.extended',order._id,{dueDate:oldDue},{dueDate:newDue,fee:extra});return {ok:true,dueDate:newDue,extra};
 }));
}));
export default r;
