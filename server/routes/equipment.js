import { Router } from 'express';
import { Equipment,InventoryTransaction,Repair,Expense,Order,OrderItem } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { mutate,audit,money,units,methodOf } from '../utils/operations.js';
import { requirePermission, assertPermission } from '../utils/permissions.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function parse(body){const totalQuantity=units(body.totalQuantity,true),damagedQty=units(body.damagedQty||0,true);if(damagedQty>totalQuantity)throw httpErr(400,'Damaged quantity cannot exceed total stock');
 if(typeof body.name!=='string'||!body.name.trim()||typeof body.category!=='string'||!body.category.trim())throw httpErr(400,'Name and category are required');
 return {name:body.name.trim(),category:body.category.trim(),sku:body.sku||undefined,totalQuantity,damagedQty,periodRate:money(body.periodRate,'Rate',true),deposit:money(body.deposit||0,'Deposit',true),condition:body.condition||'good',notes:body.notes||'',checklist:Array.isArray(body.checklist)?body.checklist.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()).slice(0,30):[]};}
r.get('/',wrap(async(req,res)=>{const f={active:req.query.archived!=='true'};if(req.query.category)f.category=String(req.query.category);if(req.query.q)f.$or=[{name:new RegExp(esc(req.query.q),'i')},{sku:new RegExp(esc(req.query.q),'i')}];res.json(await Equipment.find(f).sort({category:1,name:1}));}));
r.post('/',requirePermission('inventory.manage'),wrap(async(req,res)=>res.status(201).json(await mutate(req,'equipment.create',async session=>{
 const [item]=await Equipment.create([parse(req.body)],{session});if(item.totalQuantity)await InventoryTransaction.create([{equipment:item._id,type:'initial_stock',quantity:item.totalQuantity}],{session});await audit(session,req.user,'equipment.created',item._id,null,item);return item;
}))));
r.put('/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.edit:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');const data=parse(req.body),before=item.toObject();
 const bookings=await Order.find({status:{$in:['reserved','active']}}).select('_id startDate endDate status').session(session);
 const lines=await OrderItem.find({equipment:item._id,order:{$in:bookings.map(o=>o._id)}}).session(session);
 const events=[];for(const line of lines){const order=bookings.find(o=>String(o._id)===String(line.order)),q=line.quantity-(line.returnedQuantity||0);events.push([order.status==='active'?0:+order.startDate,q],[order.status==='active'?Infinity:+order.endDate,-q]);}
 events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let current=0,max=0;for(const [,n]of events){current+=n;max=Math.max(max,current);}
 if(data.totalQuantity-data.damagedQty<max)throw httpErr(409,'Stock reduction would leave existing bookings without enough equipment');
 const open=await Repair.find({equipment:item._id,status:'open'}).session(session);if(data.damagedQty<open.reduce((s,x)=>s+x.quantity,0))throw httpErr(409,'Complete open repair jobs before reducing damaged stock');
 item.set(data);item.revision++;await item.save({session});if(item.totalQuantity!==before.totalQuantity)await InventoryTransaction.create([{equipment:item._id,type:'adjustment',quantity:item.totalQuantity-before.totalQuantity,note:'Inventory edit'}],{session});await audit(session,req.user,'equipment.edited',item._id,before,item);return item;
}))));
r.delete('/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.archive:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');const orders=await Order.find({status:{$in:['reserved','active']}}).select('_id').session(session);
 if(await OrderItem.exists({equipment:item._id,order:{$in:orders.map(o=>o._id)}}).session(session))throw httpErr(409,'This item is part of an outstanding booking or rental');item.active=false;await item.save({session});await audit(session,req.user,'equipment.archived',item._id,null,{name:item.name});return item;
}))));
r.post('/:id/restore',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.restore:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');item.active=true;await item.save({session});await audit(session,req.user,'equipment.restored',item._id,null,{name:item.name});return item;
}))));
r.get('/repairs/list',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await Repair.find().sort({createdAt:-1}).populate('equipment','name').lean())));
r.post('/repairs',requirePermission('inventory.manage'),wrap(async(req,res)=>res.status(201).json(await mutate(req,'repair.create',async session=>{
 const item=await Equipment.findById(req.body.equipment).session(session);if(!item)throw httpErr(404,'Item not found');const quantity=units(req.body.quantity),open=await Repair.find({equipment:item._id,status:'open'}).session(session);
 if(quantity>item.damagedQty-open.reduce((s,x)=>s+x.quantity,0))throw httpErr(409,'Quantity exceeds damaged units not already in a repair job');
 const [repair]=await Repair.create([{equipment:item._id,quantity,notes:req.body.notes}],{session});await audit(session,req.user,'repair.opened',repair._id,null,repair);return repair;
}))));
r.post('/repairs/:id/complete',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'repair.complete:'+req.params.id,async session=>{
 const repair=await Repair.findById(req.params.id).session(session);if(!repair||repair.status!=='open')throw httpErr(409,'Repair is already completed or missing');const item=await Equipment.findById(repair.equipment).session(session);
 if(!item||item.damagedQty<repair.quantity)throw httpErr(409,'Damaged stock is inconsistent');item.damagedQty-=repair.quantity;item.revision++;if(!item.damagedQty)item.condition='good';await item.save({session});repair.status='completed';repair.completedAt=new Date();repair.cost=money(req.body.cost||0,'Repair cost',true);await repair.save({session});
 await InventoryTransaction.create([{equipment:item._id,type:'repaired',quantity:repair.quantity,reference:String(repair._id)}],{session});if(repair.cost){assertPermission(req.user,'expenses.manage');await Expense.create([{amount:repair.cost,category:'Repairs',description:'Repair: '+item.name,spentAt:new Date(),method:methodOf(req.body.method||'other'),repair:repair._id,actor:req.user._id}],{session});}await audit(session,req.user,'repair.completed',repair._id,null,repair);return repair;
}))));
export default r;
