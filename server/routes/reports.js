import { Router } from 'express';
import { Order,OrderItem,Payment,Equipment,Expense,DepositTransaction,Rental,Invoice } from '../models/index.js';
import { dayRange } from '../utils/businessTime.js';
import { requirePermission } from '../utils/permissions.js';
const r=Router();
r.get('/',requirePermission('reports.view'),async(req,res,next)=>{try{
 const range=dayRange(req.query.from,req.query.to);
 const pay=await Payment.aggregate([{$match:{paidAt:range}},{$group:{_id:'$method',t:{$sum:{$cond:[{$eq:['$type','refund']},{$multiply:['$amount',-1]},'$amount']}}}}]);
 const orders=await Order.find({status:{$ne:'cancelled'},createdAt:range}).select('_id').lean();
 const rentals=await Rental.find({pickedUpAt:range}).select('order').lean();
 const invoiceTotals=await Invoice.find({status:{$in:['issued','paid']},issuedAt:range}).select('total').lean();
 const byItem=async ids=>OrderItem.aggregate([{$match:{order:{$in:ids}}},{$group:{_id:'$equipment',units:{$sum:'$quantity'}}}]);
 const [booked,handedOut]=await Promise.all([byItem(orders.map(o=>o._id)),byItem(rentals.map(rental=>rental.order))]);
 const rows=new Map(booked.map(item=>[String(item._id),{_id:item._id,bookedUnits:item.units,handedOutUnits:0}]));
 for(const item of handedOut){
  const row=rows.get(String(item._id))||{_id:item._id,bookedUnits:0};
  rows.set(String(item._id),{...row,handedOutUnits:item.units});
 }
 const top=[...rows.values()].sort((a,b)=>b.handedOutUnits-a.handedOutUnits||b.bookedUnits-a.bookedUnits);
 const names=Object.fromEntries((await Equipment.find({_id:{$in:top.map(t=>t._id)}}).select('name')).map(e=>[String(e._id),e.name]));
 const expenses=await Expense.find({spentAt:range}).lean(),revenue=pay.reduce((s,p)=>s+p.t,0),expenseTotal=expenses.reduce((s,e)=>s+e.amount,0);
 const deposits=await DepositTransaction.aggregate([{$group:{_id:null,held:{$sum:{$cond:[{$eq:['$type','collect']},'$amount',{$multiply:['$amount',-1]}]}}}}]);
 res.json({revenue,expenses:expenseTotal,netCashAfterExpenses:revenue-expenseTotal,securityDepositsHeld:deposits[0]?.held||0,byMethod:pay.map(p=>({method:p._id,total:p.t})),orders:orders.length,billed:invoiceTotals.reduce((s,i)=>s+i.total,0),top:top.map(t=>({...t,name:names[String(t._id)]||'Archived item'}))});
 }catch(e){next(e);}});
export default r;
