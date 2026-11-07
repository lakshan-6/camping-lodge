import { Router } from 'express';
import { Order,Payment,DepositTransaction } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { mutate,audit,money,methodOf } from '../utils/operations.js';
import { requirePermission,can,assertPermission } from '../utils/permissions.js';
import { recordPayment,paidTotal,depositHeld,syncInvoice } from '../utils/finance.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const view=(req,res,next)=>can(req.user,'finance.view')||can(req.user,'payments.record')||can(req.user,'payments.refund')?next():next(httpErr(403,'Financial access is not enabled for this account'));
r.get('/balances',wrap(async(req,res)=>{
 const orders=await Order.find({deletedAt:null}).sort({createdAt:-1}).populate('customer','name phone').lean(),out=[];
 for(const o of orders){const paid=await paidTotal(o._id),held=await depositHeld(o._id);if(o.status==='cancelled'&&paid<=0&&held<=0)continue;out.push({...o,paid,balance:o.status==='cancelled'?0:Math.round((o.totalAmount-paid)*100)/100,refundDue:o.status==='cancelled'&&o.cancellation?.action!=='keep'?paid:0,securityHeld:held});}
 res.json(out);
}));
r.get('/',view,wrap(async(req,res)=>res.json(await Payment.find().sort({paidAt:-1}).limit(300).populate({path:'order',select:'orderNo customer',populate:{path:'customer',select:'name'}}).lean())));
r.post('/',wrap(async(req,res)=>{
 res.status(201).json(await mutate(req,'payment:'+req.body.order,async session=>{
 const order=await Order.findById(req.body.order).session(session);if(!order)throw httpErr(404,'Order not found');
 const result=await recordPayment(order,req.body,req.user,session);await audit(session,req.user,'payment.'+result.type,order._id,null,result);return result;
 }));
}));
r.get('/deposits/:order',view,wrap(async(req,res)=>res.json({held:await depositHeld(req.params.order),history:await DepositTransaction.find({order:req.params.order}).sort({createdAt:-1}).lean()})));
r.post('/deposits',wrap(async(req,res)=>{
 res.status(201).json(await mutate(req,'security-deposit:'+req.body.order,async session=>{
 const order=await Order.findById(req.body.order).session(session);if(!order)throw httpErr(404,'Order not found');
 const type=req.body.type;if(!['collect','refund','apply'].includes(type))throw httpErr(400,'Choose a deposit action');
 assertPermission(req.user,type==='collect'?'payments.record':'payments.refund');
 const amount=money(req.body.amount),held=await depositHeld(order._id,session);
 if(type==='collect'&&(order.status==='cancelled'||amount>Math.max(0,order.depositAmount-held)))throw httpErr(409,'Deposit collection exceeds the required deposit or this booking is cancelled');
 if(type!=='collect'&&amount>held)throw httpErr(409,'Amount exceeds the held security deposit');
 if(type!=='collect'&&!req.body.reason?.trim())throw httpErr(400,'Enter a reason');
 if(type==='apply')await recordPayment(order,{amount,type:'balance',method:'other',reference:'Applied security deposit',reason:req.body.reason}, {...req.user,role:req.user.role,permissions:[...(req.user.permissions||[]),'payments.record']},session);
 const [row]=await DepositTransaction.create([{order:order._id,type,amount,method:methodOf(req.body.method),reason:req.body.reason,actor:req.user._id}],{session});
 await audit(session,req.user,'security_deposit.'+type,order._id,{held},{amount,held:held+(type==='collect'?amount:-amount)});return row;
 }));
}));
export default r;
