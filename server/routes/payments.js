import { Router } from 'express';
import { Order,Payment,DepositTransaction } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { mutate,audit } from '../utils/operations.js';
import { can } from '../utils/permissions.js';
import { recordPayment,paidTotal,depositHeld,recordSecurityDeposit } from '../utils/finance.js';
import { sendDepositUpdate,sendPaymentUpdate } from '../utils/bookingEmail.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const financeView=(req,res,next)=>can(req.user,'finance.view')||can(req.user,'payments.refund')?next():next(httpErr(403,'Financial access is not enabled for this account'));
const view=(req,res,next)=>can(req.user,'payments.record')?next():financeView(req,res,next);
r.get('/balances',financeView,wrap(async(req,res)=>{
 const orders=await Order.find({deletedAt:null}).sort({createdAt:-1}).populate('customer','name phone').lean(),out=[];
 for(const o of orders){const paid=await paidTotal(o._id),held=await depositHeld(o._id);if(o.status==='cancelled'&&paid<=0&&held<=0)continue;out.push({...o,paid,balance:o.status==='cancelled'?0:Math.round((o.totalAmount-paid)*100)/100,refundDue:o.status==='cancelled'&&o.cancellation?.action!=='keep'?paid:0,securityHeld:held});}
 res.json(out);
}));
r.get('/',financeView,wrap(async(req,res)=>res.json(await Payment.find().sort({paidAt:-1}).limit(300).populate({path:'order',select:'orderNo customer',populate:{path:'customer',select:'name'}}).lean())));
r.post('/',wrap(async(req,res)=>{
 const result=await mutate(req,'payment:'+req.body.order,async session=>{
 const order=await Order.findById(req.body.order).session(session);if(!order)throw httpErr(404,'Order not found');
 const result=await recordPayment(order,req.body,req.user,session);await audit(session,req.user,'payment.'+result.type,order._id,null,result);return result;
 });
 res.status(201).json({...result,notificationEmail:result._replayed?'already_processed':await sendPaymentUpdate(result)});
}));
r.get('/deposits/:order',view,wrap(async(req,res)=>res.json({held:await depositHeld(req.params.order),history:await DepositTransaction.find({order:req.params.order}).sort({createdAt:-1}).lean()})));
r.post('/deposits',wrap(async(req,res)=>{
 const result=await mutate(req,'security-deposit:'+req.body.order,async session=>{
 const order=await Order.findById(req.body.order).session(session);if(!order)throw httpErr(404,'Order not found');
 return recordSecurityDeposit(order,req.body,req.user,session);
 });
 res.status(201).json({...result,notificationEmail:result._replayed?'already_processed':await sendDepositUpdate(result)});
}));
export default r;
