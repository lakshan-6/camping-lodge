import { Router } from 'express';
import crypto from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { Order, OrderItem, Customer, Payment, Invoice } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { nextDocumentNumber } from '../utils/documentNumbers.js';
import { previewOrderDeletion, permanentlyDeleteOrder } from '../utils/orderDeletion.js';
import { mutate, audit, money, methodOf } from '../utils/operations.js';
import { requirePermission, assertPermission, can } from '../utils/permissions.js';
import { priceItems, paidTotal, recordPayment, syncInvoice, depositHeld } from '../utils/finance.js';
import {dayRange} from '../utils/businessTime.js';
import {securityMethod,chooseSecurity,receiveNic,releaseNic,nicHeld} from '../utils/securityDeposit.js';
import {bookingContact,resolveBookingCustomer} from '../utils/customers.js';
import {sendBookingConfirmation,sendPaymentUpdate} from '../utils/bookingEmail.js';
const r=Router(), wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const ownerOnly=(req,res,next)=>req.user?.role==='owner'?next():next(httpErr(403,'Only the owner can delete past orders'));
const limit=rateLimit({windowMs:15*60*1000,limit:5,keyGenerator:req=>String(req.user._id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many deletion attempts. Try again in 15 minutes.'}});
r.get('/',wrap(async(req,res)=>{
  const hidden=req.query.deleted==='true';if(hidden&&req.user.role!=='owner')throw httpErr(403,'Owner only');
  const filter=hidden?{deletedAt:{$ne:null},status:'completed'}:{deletedAt:null};
  const status=req.query.status;if(status){if(!['reserved','active','completed','cancelled'].includes(status))throw httpErr(400,'Choose a valid status');if(hidden&&status!=='completed')throw httpErr(400,'Hidden past orders are completed orders');filter.status=status;}
  if(req.query.from||req.query.to)filter.startDate=dayRange(req.query.from||req.query.to,req.query.to||req.query.from);
  const term=String(req.query.q||'').trim();if(term.length>80)throw httpErr(400,'Search must be 80 characters or fewer');
  if(term){const regex=new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');const customers=await Customer.find({$or:[{name:regex},{phone:regex},{nic:regex}]}).select('_id').lean();filter.$or=[{orderNo:regex},{customer:{$in:customers.map(c=>c._id)}}];}
  const paged=req.query.paged==='true',page=Number(req.query.page||1),pageSize=Number(req.query.pageSize||25);
  if(paged&&(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100))throw httpErr(400,'Choose a valid page');
  let query=Order.find(filter).sort({createdAt:-1,_id:-1});if(paged)query=query.skip((page-1)*pageSize).limit(pageSize);
  const orders=await query.populate('customer','name phone nic address email detailsPending').lean();
  const items=await OrderItem.find({order:{$in:orders.map(o=>o._id)}}).populate('equipment','name checklist').lean();
  const rows=orders.map(o=>({...o,items:items.filter(i=>String(i.order)===String(o._id))}));
  res.json(paged?{rows,total:await Order.countDocuments(filter),page,pageSize}:rows);
}));
r.post('/',requirePermission('orders.write'),wrap(async(req,res)=>{
  const result=await mutate(req,'order.create',async session=>{
    const requestedMethod=req.body.securityMethod??(req.body.depositAmount!==undefined?'money':null);
    const method=requestedMethod===null?null:securityMethod(requestedMethod);
    let depositAmount;
    if(req.body.depositAmount!==undefined){
      if(method!=='money'||typeof req.body.depositAmount!=='number')throw httpErr(400,'Enter a money security deposit amount');
      depositAmount=money(req.body.depositAmount,'Security deposit');
    }
    let customer;
    if(req.body.customerDetails!==undefined){
      if(req.body.customer||!req.body.customerDetails||typeof req.body.customerDetails!=='object'||Array.isArray(req.body.customerDetails))throw httpErr(400,'Choose an existing customer or enter new customer details');
      customer=await resolveBookingCustomer(req.body.customerDetails,req.user,session);
    }else{
      customer=await Customer.findById(req.body.customer).session(session);
      if(!customer)throw httpErr(400,'Choose an existing customer');
      bookingContact(customer);
    }
    const p=await priceItems(req.body,session);
    const [order]=await Order.create([{orderNo:await nextDocumentNumber('order',session),customer:customer._id,startDate:p.start,endDate:p.end,periods:p.periods,totalAmount:p.total,depositAmount:depositAmount??p.deposit,securityMethod:method,notes:req.body.notes}],{session});
    await OrderItem.insertMany(p.lines.map(i=>({...i,order:order._id})),{session});
    if(Number(req.body.advance?.amount)>0)await recordPayment(order,{...req.body.advance,type:'deposit'},req.user,session);
    await audit(session,req.user,'order.created',order._id,null,order);return order;
  });
  const bookingEmail = result._replayed ? 'already_processed' : await sendBookingConfirmation(result._id);
  res.status(201).json({...result, bookingEmail});
}));
r.put('/:id',requirePermission('orders.write'),wrap(async(req,res)=>{
  res.json(await mutate(req,'order.edit:'+req.params.id,async session=>{
    const order=await Order.findById(req.params.id).session(session);
    if(!order||order.deletedAt)throw httpErr(404,'Order not found');
    if(order.status!=='reserved')throw httpErr(409,'Only uncollected bookings can be edited');
    const before=order.toObject();const p=await priceItems({startDate:req.body.startDate||order.startDate,endDate:req.body.endDate||order.endDate,items:req.body.items},session,order._id);
    await OrderItem.deleteMany({order:order._id},{session});await OrderItem.insertMany(p.lines.map(i=>({...i,order:order._id})),{session});
    const depositAmount=order.securityMethod==='money'?order.depositAmount??p.deposit:p.deposit;
    order.set({startDate:p.start,endDate:p.end,periods:p.periods,totalAmount:p.total,depositAmount});await order.save({session});
    await syncInvoice(order,session);await audit(session,req.user,'order.edited',order._id,before,order);return order;
  }));
}));
r.patch('/:id/cancel',requirePermission('orders.write'),wrap(async(req,res)=>{
  let refund;
  const result=await mutate(req,'order.cancel:'+req.params.id,async session=>{
    refund=undefined;
    const order=await Order.findById(req.params.id).session(session);
    if(!order||order.deletedAt)throw httpErr(404,'Order not found');if(order.status!=='reserved')throw httpErr(409,'Only reserved bookings can be cancelled');
    if(nicHeld(order))throw httpErr(409,'Record returning the held NIC before cancelling this booking');
    const before=order.toObject(),paid=await paidTotal(order._id,session),held=await depositHeld(order._id,session);
    if(held>0)throw httpErr(409,'Refund or apply the held security deposit before cancelling');
    const action=req.body.action||'pending';if(!['refund','keep','pending'].includes(action))throw httpErr(400,'Choose a cancellation payment action');
    if(paid>0&&action==='refund')refund=await recordPayment(order,{type:'refund',amount:paid,method:req.body.method,reason:req.body.reason||'Booking cancelled'},req.user,session);
    if(paid>0&&action==='keep')assertPermission(req.user,'payments.refund');
    order.status='cancelled';order.cancellation={action,reason:req.body.reason||'',refundPending:action==='pending'?paid:0};await order.save({session});
    await Invoice.updateMany({order:order._id,status:{$ne:'void'}},{$set:{status:'void'}},{session});
    await audit(session,req.user,'order.cancelled',order._id,before,order);return order;
  });
  res.json({...result,...(!result._replayed&&refund?{notificationEmail:await sendPaymentUpdate(refund)}:{})});
}));
r.post('/:id/security',wrap(async(req,res)=>{
 const action=req.body.action;if(!['set','receive','return'].includes(action))throw httpErr(400,'Choose a security action');
 assertPermission(req.user,action==='set'?'orders.write':action==='return'?'returns.write':'rentals.write');
 res.json(await mutate(req,'order.security:'+req.params.id,async session=>{
  const order=await Order.findById(req.params.id).session(session);if(!order||order.deletedAt)throw httpErr(404,'Order not found');
  if(order.status==='reserved'&&!order.securityMethod&&action!=='return')throw httpErr(409,'Choose and confirm security during pickup');
  if(action==='set'){
   if(order.status!=='reserved')throw httpErr(409,'Choose the security method before handover');
   const before=order.securityMethod;await chooseSecurity(order,req.body.method,session);await audit(session,req.user,'security.method_changed',order._id,{method:before},{method:order.securityMethod});
  }else{
   if(req.body.confirmed!==true)throw httpErr(400,'Confirm the NIC was physically received or returned');
   if(action==='receive'){await chooseSecurity(order,'nic',session);await receiveNic(order,req.user,session);}else await releaseNic(order,req.user,session);
  }
  await order.save({session});return {ok:true,securityMethod:order.securityMethod,nicHeld:nicHeld(order),nicHeldAt:order.nicHeldAt,nicReturnedAt:order.nicReturnedAt};
 }));
}));
r.get('/:id/detail',wrap(async(req,res)=>{
  const order=await Order.findById(req.params.id).populate('customer').lean();if(!order)throw httpErr(404,'Order not found');
  const items=await OrderItem.find({order:order._id}).populate('equipment','name').lean();
  const showPayments=['finance.view','payments.record','payments.refund'].some(p=>can(req.user,p));
  res.json({...order,items,paid:await paidTotal(order._id),securityHeld:await depositHeld(order._id),payments:showPayments?await Payment.find({order:order._id}).sort({paidAt:-1}).lean():[],invoices:await Invoice.find({order:order._id}).lean()});
}));
r.get('/:id/past-delete-preview',ownerOnly,wrap(async(req,res)=>res.json(await previewOrderDeletion(req.params.id))));
r.delete('/:id/past',ownerOnly,limit,wrap(async(req,res)=>{
  const expected=process.env.PAST_ORDER_DELETE_KEY,supplied=req.body?.accessKey;
  if(!expected||expected.length<12||expected.length>128)throw httpErr(503,'Set PAST_ORDER_DELETE_KEY to 12 to 128 characters in the server environment.');
  const digest=v=>crypto.createHash('sha256').update(v).digest();
  if(typeof supplied!=='string'||supplied.length>128||!crypto.timingSafeEqual(digest(supplied.trim()),digest(expected)))throw httpErr(403,'Incorrect delete access key');
  res.json({ok:true,deleted:await permanentlyDeleteOrder(req.params.id,req.body.confirmation,req.user)});
}));
r.delete('/:id',requirePermission('orders.write'),wrap(async(req,res)=>{
  res.json(await mutate(req,'order.hide:'+req.params.id,async session=>{
    const order=await Order.findById(req.params.id).session(session);if(!order||order.deletedAt)throw httpErr(404,'Booking not found');
    if(nicHeld(order))throw httpErr(409,'Return the held NIC before hiding this booking');
    if(!['reserved','cancelled'].includes(order.status))throw httpErr(409,'Only uncollected bookings can be removed');
    if(await paidTotal(order._id,session)>0||await depositHeld(order._id,session)>0)throw httpErr(409,'Resolve the advance/refund and security deposit before removing this booking');
    order.status='cancelled';order.deletedAt=new Date();order.deletedBy=req.user._id;await order.save({session});
    await audit(session,req.user,'order.hidden',order._id,null,{orderNo:order.orderNo});return {ok:true};
  }));
}));
export default r;
