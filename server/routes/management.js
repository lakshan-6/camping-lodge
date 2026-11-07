import { Router } from 'express';
import { Expense,AuditEvent,Order,Customer,Equipment,Payment } from '../models/index.js';
import { requirePermission } from '../utils/permissions.js';
import { mutate,audit,money,methodOf } from '../utils/operations.js';
import { dayRange } from '../utils/businessTime.js';
import { httpErr } from '../utils/availability.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
r.get('/audit',wrap(async(req,res)=>{if(req.user.role!=='owner')throw httpErr(403,'Owner only');res.json(await AuditEvent.find().sort({createdAt:-1}).limit(300).lean());}));
r.get('/expenses',requirePermission('expenses.manage'),wrap(async(req,res)=>res.json(await Expense.find().sort({spentAt:-1}).limit(500).lean())));
r.post('/expenses',requirePermission('expenses.manage'),wrap(async(req,res)=>res.status(201).json(await mutate(req,'expense.create',async session=>{
 const spentAt=new Date(req.body.spentAt);if(!Number.isFinite(+spentAt)||!req.body.description?.trim())throw httpErr(400,'Enter a date and description');
 const [expense]=await Expense.create([{amount:money(req.body.amount),description:req.body.description.trim(),category:req.body.category||'Other',spentAt,method:methodOf(req.body.method),actor:req.user._id}],{session});await audit(session,req.user,'expense.created',expense._id,null,expense);return expense;
}))));
r.post('/expenses/:id/reverse',requirePermission('expenses.manage'),wrap(async(req,res)=>res.json(await mutate(req,'expense.reverse:'+req.params.id,async session=>{
 const expense=await Expense.findById(req.params.id).session(session);if(!expense)throw httpErr(404,'Expense not found');if(!req.body.reason?.trim())throw httpErr(400,'Enter a correction reason');await Expense.deleteOne({_id:expense._id},{session});await audit(session,req.user,'expense.removed',expense._id,expense,{reason:req.body.reason});return {ok:true};
}))));
const cell=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
r.get('/export/:kind',requirePermission('reports.view'),wrap(async(req,res)=>{
 const kind=req.params.kind,range=req.query.from?dayRange(req.query.from,req.query.to||req.query.from):null;let rows,fields;
 if(kind==='orders'){rows=await Order.find(range?{startDate:range}:{}).populate('customer','name').limit(10000).lean();fields=['orderNo','customerName','status','startDate','endDate','totalAmount'];rows=rows.map(o=>({...o,customerName:o.customer?.name}));}
 else if(kind==='payments'){rows=await Payment.find(range?{paidAt:range}:{}).populate('order','orderNo').limit(10000).lean();fields=['orderNo','paidAt','type','method','amount','reference'];rows=rows.map(p=>({...p,orderNo:p.order?.orderNo}));}
 else if(kind==='inventory'){rows=await Equipment.find().limit(10000).lean();fields=['name','category','sku','totalQuantity','damagedQty','periodRate','deposit','active'];}
 else if(kind==='customers'){rows=await Customer.find().limit(10000).lean();fields=['name','phone','nic','email','address'];}
 else if(kind==='expenses'){rows=await Expense.find(range?{spentAt:range}:{}).limit(10000).lean();fields=['spentAt','category','description','method','amount'];}
 else throw httpErr(404,'Unknown export');
 const csv='\ufeff'+[fields.map(cell).join(','),...rows.map(row=>fields.map(key=>cell(row[key] instanceof Date?row[key].toISOString():row[key])).join(','))].join('\r\n');
 res.type('text/csv').set('Content-Disposition',`attachment; filename="camping-lodge-${kind}.csv"`).send(csv);
}));
export default r;
