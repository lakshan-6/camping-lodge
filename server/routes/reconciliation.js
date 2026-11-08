import {Router} from 'express';
import crypto from 'node:crypto';
import {CashClose,StockCount,Payment,DepositTransaction,Expense,InventoryTransaction} from '../models/index.js';
import {can,requirePermission} from '../utils/permissions.js';
import {mutate,audit,money,units} from '../utils/operations.js';
import {dayRange,localDate} from '../utils/businessTime.js';
import {httpErr} from '../utils/availability.js';
import {stockSnapshot,checkStock} from '../utils/stock.js';
import {assertUnitTotals} from '../utils/equipmentUnits.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const cashView=(req,res,next)=>can(req.user,'finance.view')||can(req.user,'finance.close')?next():next(httpErr(403,'Cash reconciliation access is not enabled'));
const round=n=>Math.round(n*100)/100;
export async function cashSummary(day,session=null){
  const range=dayRange(day);
  const payments=await Payment.find({method:'cash',paidAt:range}).sort({_id:1}).session(session).lean();
  const deposits=await DepositTransaction.find({method:'cash',createdAt:range,type:{$in:['collect','refund']}}).sort({_id:1}).session(session).lean();
  const expenses=await Expense.find({method:'cash',spentAt:range}).sort({_id:1}).session(session).lean();
  const rentalReceipts=round(payments.filter(p=>p.type!=='refund').reduce((s,p)=>s+p.amount,0));
  const rentalRefunds=round(payments.filter(p=>p.type==='refund').reduce((s,p)=>s+p.amount,0));
  const securityCollected=round(deposits.filter(p=>p.type==='collect').reduce((s,p)=>s+p.amount,0));
  const securityRefunds=round(deposits.filter(p=>p.type==='refund').reduce((s,p)=>s+p.amount,0));
  const cashExpenses=round(expenses.reduce((s,p)=>s+p.amount,0));
  const ledgerHash=crypto.createHash('sha256').update(JSON.stringify({payments:payments.map(p=>[p._id,p.type,p.amount,p.paidAt]),deposits:deposits.map(p=>[p._id,p.type,p.amount,p.createdAt]),expenses:expenses.map(p=>[p._id,p.amount,p.spentAt])})).digest('hex');
  return {day,rentalReceipts,rentalRefunds,securityCollected,securityRefunds,cashExpenses,netMovement:round(rentalReceipts-rentalRefunds+securityCollected-securityRefunds-cashExpenses),ledgerHash};
}
r.get('/cash',cashView,wrap(async(req,res)=>{
  const day=req.query.day||localDate(new Date()),summary=await cashSummary(day);
  const history=await CashClose.find({day}).sort({revision:-1}).lean();
  const previous=await CashClose.findOne({day:{$lt:day}}).sort({day:-1,revision:-1}).lean();
  res.json({...summary,history,suggestedOpening:previous?.countedCash||0,ledgerChanged:!!history[0]&&history[0].ledgerHash!==summary.ledgerHash});
}));
r.post('/cash',requirePermission('finance.close'),wrap(async(req,res)=>{
  res.status(201).json(await mutate(req,'cash.close:'+req.body.day,async session=>{
    const day=req.body.day;dayRange(day);if(day>localDate(new Date()))throw httpErr(400,'Cannot close a future business day');
    const summary=await cashSummary(day,session);
    if(req.body.ledgerHash!==summary.ledgerHash)throw httpErr(409,'Cash entries changed. Refresh and check the new totals before closing.');
    const previous=await CashClose.findOne({day}).sort({revision:-1}).session(session);
    if(previous&&req.user.role!=='owner')throw httpErr(403,'Only the owner can correct a closed day');
    const openingCash=money(req.body.openingCash,'Opening cash',true),cashRemoved=money(req.body.cashRemoved||0,'Cash removed',true),countedCash=money(req.body.countedCash,'Counted cash',true);
    const expectedCash=round(openingCash+summary.netMovement-cashRemoved),difference=round(countedCash-expectedCash);
    if(expectedCash<0)throw httpErr(400,'Cash removed exceeds the expected available cash');
    const reason=typeof req.body.reason==='string'?req.body.reason.trim():'';
    if((previous||difference!==0)&&!reason)throw httpErr(400,'Enter a reason for the difference or correction');
    const [row]=await CashClose.create([{day,revision:(previous?.revision||0)+1,openingCash,cashRemoved,countedCash,expectedCash,difference,summary,ledgerHash:summary.ledgerHash,reason,actor:req.user._id,actorName:req.user.name}],{session});
    await audit(session,req.user,previous?'cash.close_corrected':'cash.closed',row._id,previous,row);return row;
  }));
}));
r.get('/stock/history',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await StockCount.find().sort({createdAt:-1}).limit(100).lean())));
r.get('/stock/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>{
  const s=await stockSnapshot(req.params.id);res.json({equipment:s.item,expectedGood:s.expectedGood,outQuantity:s.out,repairQuantity:s.repairQuantity,signature:s.signature});
}));
r.post('/stock/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>{
  res.status(201).json(await mutate(req,'stock.count:'+req.params.id,async session=>{
    const snapshot=await stockSnapshot(req.params.id,session),item=snapshot.item;
    await assertUnitTotals(item,session);
    if(req.body.signature!==snapshot.signature)throw httpErr(409,'Stock or bookings changed. Refresh the count before saving.');
    const countedGood=units(req.body.countedGood,true),countedDamaged=units(req.body.countedDamaged,true);
    if(item.trackUnits&&(countedGood!==snapshot.expectedGood||countedDamaged!==item.damagedQty))throw httpErr(409,'For labelled equipment, update the condition of the exact unit codes in Inventory first. Then record a matching physical count.');
    const total=units(countedGood+countedDamaged+snapshot.out,true);checkStock(snapshot,total,countedDamaged);
    const reason=typeof req.body.reason==='string'?req.body.reason.trim():'';
    if((total!==item.totalQuantity||countedDamaged!==item.damagedQty)&&!reason)throw httpErr(400,'Explain the stock difference before applying it');
    const before={totalQuantity:item.totalQuantity,damagedQty:item.damagedQty,goodInStore:snapshot.expectedGood};
    const after={totalQuantity:total,damagedQty:countedDamaged,goodInStore:countedGood};
    item.totalQuantity=total;item.damagedQty=countedDamaged;item.revision++;await item.save({session});
    const [count]=await StockCount.create([{equipment:item._id,equipmentName:item.name,countedGood,countedDamaged,outQuantity:snapshot.out,before,after,reason,actor:req.user._id,actorName:req.user.name}],{session});
    if(total!==before.totalQuantity||countedDamaged!==before.damagedQty)await InventoryTransaction.create([{equipment:item._id,type:'adjustment',quantity:total-before.totalQuantity,reference:String(count._id),note:'Physical count: '+reason}],{session});
    await audit(session,req.user,'stock.counted',item._id,before,{...after,count:count._id,reason});return count;
  }));
}));
export default r;
