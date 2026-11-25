import { Router } from 'express';
import { Order,OrderItem,Equipment,Rental,Invoice } from '../models/index.js';
import { dayRange } from '../utils/businessTime.js';
import { requirePermission } from '../utils/permissions.js';
import { moneySummary } from '../utils/moneySummary.js';
const r=Router();
r.get('/',requirePermission('reports.view'),async(req,res,next)=>{try{
 const range=dayRange(req.query.from,req.query.to);
 const money=await moneySummary({from:req.query.from,to:req.query.to??req.query.from});
 const orders=await Order.find({status:{$ne:'cancelled'},createdAt:range}).select('_id').lean();
 const rentals=await Rental.find({pickedUpAt:range}).select('order').lean();
 const fulfilled=await Order.find({status:{$ne:'cancelled'},fulfilledAt:range}).select('_id').lean();
 const invoiceTotals=await Invoice.find({status:{$in:['issued','paid']},issuedAt:range}).select('total').lean();
 const byItem=async ids=>OrderItem.aggregate([{$match:{order:{$in:ids},itemType:{$ne:'sale'}}},{$group:{_id:'$equipment',units:{$sum:'$quantity'}}}]);
 const [booked,handedOut]=await Promise.all([byItem(orders.map(o=>o._id)),byItem(rentals.map(rental=>rental.order))]);
 const rows=new Map(booked.map(item=>[String(item._id),{_id:item._id,bookedUnits:item.units,handedOutUnits:0}]));
 for(const item of handedOut){
  const row=rows.get(String(item._id))||{_id:item._id,bookedUnits:0};
  rows.set(String(item._id),{...row,handedOutUnits:item.units});
 }
 const top=[...rows.values()].sort((a,b)=>b.handedOutUnits-a.handedOutUnits||b.bookedUnits-a.bookedUnits);
 const sales=await OrderItem.aggregate([{$match:{order:{$in:fulfilled.map(order=>order._id)},itemType:'sale'}},
  {$group:{_id:'$equipment',units:{$sum:'$quantity'},charged:{$sum:'$lineTotal'}}},{$sort:{units:-1}}]);
 const names=Object.fromEntries((await Equipment.find({_id:{$in:[...top,...sales].map(item=>item._id)}}).select('name')).map(e=>[String(e._id),e.name]));
 const named=items=>items.map(item=>({...item,name:names[String(item._id)]||'Archived item'}));
 res.json({revenue:money.netPayments,rentalNet:money.rentalNet,salesNet:money.salesNet,
  rentalReceipts:money.rentalReceipts,salesReceipts:money.salesReceipts,totalReceipts:money.totalReceipts,
  rentalRefunds:money.rentalRefunds,salesRefunds:money.salesRefunds,totalRefunds:money.totalRefunds,
  securityApplied:money.securityApplied,expenses:money.expenses,netCashAfterExpenses:money.receiptsLessExpenses,
  securityDepositsHeld:money.current.securityHeld,
  byMethod:money.byMethod.map(row=>({method:row.method,total:row.netPayments,rentalNet:row.rentalNet,salesNet:row.salesNet})),
  orders:orders.length,billed:invoiceTotals.reduce((sum,invoice)=>sum+invoice.total,0),top:named(top),sales:named(sales)});
 }catch(e){next(e);}});
export default r;
