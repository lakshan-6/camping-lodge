import { Router } from 'express';
import { Order,OrderItem,Payment,Equipment,Expense,DepositTransaction } from '../models/index.js';
import { dayRange } from '../utils/businessTime.js';
import { requirePermission } from '../utils/permissions.js';
const r=Router();
r.get('/',requirePermission('reports.view'),async(req,res,next)=>{try{
 const range=dayRange(req.query.from,req.query.to);
 const pay=await Payment.aggregate([{$match:{paidAt:range}},{$group:{_id:'$method',t:{$sum:{$cond:[{$eq:['$type','refund']},{$multiply:['$amount',-1]},'$amount']}}}}]);
 const orders=await Order.find({status:{$ne:'cancelled'},startDate:range}).select('_id totalAmount').lean();
 const top=await OrderItem.aggregate([{$match:{order:{$in:orders.map(o=>o._id)}}},{$group:{_id:'$equipment',orders:{$sum:1},units:{$sum:'$quantity'},revenue:{$sum:'$lineTotal'}}},{$sort:{units:-1,revenue:-1}}]);
 const names=Object.fromEntries((await Equipment.find({_id:{$in:top.map(t=>t._id)}}).select('name')).map(e=>[String(e._id),e.name]));
 const expenses=await Expense.find({spentAt:range}).lean(),revenue=pay.reduce((s,p)=>s+p.t,0),expenseTotal=expenses.reduce((s,e)=>s+e.amount,0);
 const deposits=await DepositTransaction.aggregate([{$group:{_id:null,held:{$sum:{$cond:[{$eq:['$type','collect']},'$amount',{$multiply:['$amount',-1]}]}}}}]);
 res.json({revenue,expenses:expenseTotal,netCashAfterExpenses:revenue-expenseTotal,securityDepositsHeld:deposits[0]?.held||0,byMethod:pay.map(p=>({method:p._id,total:p.t})),orders:orders.length,billed:orders.reduce((s,o)=>s+o.totalAmount,0),top:top.map(t=>({...t,name:names[String(t._id)]||'Archived item'}))});
 }catch(e){next(e);}});
export default r;
