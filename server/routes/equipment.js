import { Router } from 'express';
import { Equipment,EquipmentUnit,InventoryTransaction,Repair,Expense,Order,OrderItem } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { mutate,audit,money,units,methodOf } from '../utils/operations.js';
import { requirePermission, assertPermission } from '../utils/permissions.js';
import {configureUnits,assertUnitTotals,physicalStates,damagedStates} from '../utils/equipmentUnits.js';
import {stockSnapshot,checkStock} from '../utils/stock.js';
import {nextDocumentNumber} from '../utils/documentNumbers.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function parse(body,before){
 if(typeof body.name!=='string'||!body.name.trim()||typeof body.category!=='string'||!body.category.trim())throw httpErr(400,'Name and category are required');
 const totalQuantity=units(body.totalQuantity,true);
 let damagedQty=units(body.damagedQty??before?.damagedQty??0,true);
 if(body.unitConditions!==undefined){
  const added=totalQuantity-(before?.trackUnits?before.totalQuantity:0);
  if(added<0)throw httpErr(409,'Mark individual units lost or retired to reduce tracked stock');
  if((body.trackUnits??before?.trackUnits)!==true||!Array.isArray(body.unitConditions)||body.unitConditions.length!==added||body.unitConditions.some(state=>!['good','damaged'].includes(state)))
   throw httpErr(400,'Choose Ready or Damaged for each new unit');
  damagedQty=(before?.trackUnits?before.damagedQty:0)+body.unitConditions.filter(state=>state==='damaged').length;
 }
 if(damagedQty>totalQuantity)throw httpErr(400,'Damaged quantity cannot exceed total stock');
 return {name:body.name.trim(),category:body.category.trim(),sku:body.sku||before?.sku,totalQuantity,damagedQty,periodRate:money(body.periodRate,'Rate',true),deposit:money(body.deposit??before?.deposit??0,'Deposit',true),condition:body.condition||before?.condition||'good',notes:body.notes||'',checklist:Array.isArray(body.checklist)?body.checklist.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()).slice(0,30):[]};
}
async function allocateSku(data,session){
 if(data.sku)return;
 do {data.sku=await nextDocumentNumber('equipment',session);}
 while(await Equipment.exists({sku:data.sku}).session(session));
}
r.get('/categories',wrap(async(req,res)=>{
 const rows=await Equipment.find().select('category').lean();
 res.json([...new Set(rows.map(row=>row.category))].sort((a,b)=>a.localeCompare(b)));
}));
r.get('/',wrap(async(req,res)=>{const f={active:req.query.archived!=='true'};if(req.query.category)f.category=String(req.query.category);if(req.query.q)f.$or=[{name:new RegExp(esc(req.query.q),'i')},{sku:new RegExp(esc(req.query.q),'i')}];res.json(await Equipment.find(f).sort({category:1,name:1}));}));
r.post('/',requirePermission('inventory.manage'),wrap(async(req,res)=>res.status(201).json(await mutate(req,'equipment.create',async session=>{
 const data=parse(req.body);await allocateSku(data,session);
 const [item]=await Equipment.create([data],{session});await configureUnits(item,req.body,null,session);await item.save({session});if(item.totalQuantity)await InventoryTransaction.create([{equipment:item._id,type:'initial_stock',quantity:item.totalQuantity}],{session});await audit(session,req.user,'equipment.created',item._id,null,item);return item;
}))));
r.put('/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.edit:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');const before=item.toObject(),data=parse(req.body,before);
 const bookings=await Order.find({status:{$in:['reserved','active']}}).select('_id startDate endDate status').session(session);
 const lines=await OrderItem.find({equipment:item._id,order:{$in:bookings.map(o=>o._id)}}).session(session);
 const events=[];for(const line of lines){const order=bookings.find(o=>String(o._id)===String(line.order)),q=line.quantity-(line.returnedQuantity||0);events.push([order.status==='active'?0:+order.startDate,q],[order.status==='active'?Infinity:+order.endDate,-q]);}
 events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let current=0,max=0;for(const [,n]of events){current+=n;max=Math.max(max,current);}
 if(data.totalQuantity-data.damagedQty<max)throw httpErr(409,'Stock reduction would leave existing bookings without enough equipment');
 const open=await Repair.find({equipment:item._id,status:'open'}).session(session);if(data.damagedQty<open.reduce((s,x)=>s+x.quantity,0))throw httpErr(409,'Complete open repair jobs before reducing damaged stock');
 await assertUnitTotals(item,session);await allocateSku(data,session);item.set(data);await configureUnits(item,req.body,before,session);item.revision++;await item.save({session});if(item.totalQuantity!==before.totalQuantity)await InventoryTransaction.create([{equipment:item._id,type:'adjustment',quantity:item.totalQuantity-before.totalQuantity,note:'Inventory edit'}],{session});await audit(session,req.user,'equipment.edited',item._id,before,item);return item;
}))));
r.delete('/:id',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.archive:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');const orders=await Order.find({status:{$in:['reserved','active']}}).select('_id').session(session);
 if(await OrderItem.exists({equipment:item._id,order:{$in:orders.map(o=>o._id)}}).session(session))throw httpErr(409,'This item is part of an outstanding booking or rental');item.active=false;await item.save({session});await audit(session,req.user,'equipment.archived',item._id,null,{name:item.name});return item;
}))));
r.post('/:id/restore',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'equipment.restore:'+req.params.id,async session=>{
 const item=await Equipment.findById(req.params.id).session(session);if(!item)throw httpErr(404,'Item not found');item.active=true;await item.save({session});await audit(session,req.user,'equipment.restored',item._id,null,{name:item.name});return item;
}))));
r.get('/:id/units',wrap(async(req,res)=>{
 const item=await Equipment.findById(req.params.id).lean();if(!item)throw httpErr(404,'Equipment not found');
 res.json({equipment:item,units:await EquipmentUnit.find({equipment:item._id}).sort({code:1}).populate({path:'rental',populate:[{path:'order',select:'orderNo'},{path:'customer',select:'name'}]}).lean()});
}));
r.get('/:id/units/:unit/history',requirePermission('inventory.manage'),wrap(async(req,res)=>{
 const unit=await EquipmentUnit.findOne({_id:req.params.unit,equipment:req.params.id}).lean();if(!unit)throw httpErr(404,'Unit not found');
 const lines=await OrderItem.find({'unitAssignments.unit':unit._id}).sort({updatedAt:-1}).limit(100).populate({path:'order',populate:{path:'customer',select:'name'}}).lean();
 const repairs=await Repair.find({units:unit._id}).sort({createdAt:-1}).limit(100).lean();
 res.json({unit,history:lines.map(l=>({orderNo:l.order?.orderNo,customer:l.order?.customer?.name,pickedUpAt:l.order?.startDate,assignment:l.unitAssignments.find(a=>String(a.unit)===String(unit._id))})),repairs});
}));
r.patch('/:id/units/:unit',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'unit.condition:'+req.params.unit,async session=>{
 const snapshot=await stockSnapshot(req.params.id,session),item=snapshot.item;await assertUnitTotals(item,session);
 const unit=await EquipmentUnit.findOne({_id:req.params.unit,equipment:item._id}).session(session);if(!unit)throw httpErr(404,'Unit not found');
 if(['out','repair'].includes(unit.state))throw httpErr(409,'Receive this unit through Returns or finish its repair job first');
 const state=req.body.state;if(!['good','damaged','lost','retired'].includes(state)||state===unit.state)throw httpErr(400,'Choose a different unit condition');
 if(typeof req.body.reason!=='string'||!req.body.reason.trim())throw httpErr(400,'Enter a reason for this unit change');
 const beforeTotal=item.totalQuantity,total=item.totalQuantity+Number(physicalStates.includes(state))-Number(physicalStates.includes(unit.state));
 const damaged=item.damagedQty+Number(damagedStates.includes(state))-Number(damagedStates.includes(unit.state));checkStock(snapshot,total,damaged);
 const before=unit.toObject();unit.state=state;unit.notes=req.body.reason.trim();await unit.save({session});item.totalQuantity=total;item.damagedQty=damaged;item.revision++;await item.save({session});
 await InventoryTransaction.create([{equipment:item._id,type:'adjustment',quantity:total-beforeTotal,note:unit.code+': '+req.body.reason,reference:String(unit._id)}],{session});
 await audit(session,req.user,'unit.condition_changed',unit._id,before,unit);return unit;
}))));
r.get('/repairs/list',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await Repair.find().sort({createdAt:-1}).populate('equipment','name').populate('units','code').lean())));
r.post('/repairs',requirePermission('inventory.manage'),wrap(async(req,res)=>res.status(201).json(await mutate(req,'repair.create',async session=>{
 const item=await Equipment.findById(req.body.equipment).session(session);if(!item)throw httpErr(404,'Item not found');await assertUnitTotals(item,session);const quantity=units(req.body.quantity),open=await Repair.find({equipment:item._id,status:'open'}).session(session);
 if(quantity>item.damagedQty-open.reduce((s,x)=>s+x.quantity,0))throw httpErr(409,'Quantity exceeds damaged units not already in a repair job');
 let selected=[];if(item.trackUnits){const ids=req.body.units;if(!Array.isArray(ids)||ids.length!==quantity||new Set(ids.map(String)).size!==ids.length||ids.some(id=>!/^[a-f0-9]{24}$/i.test(String(id))))throw httpErr(400,'Select the exact damaged unit codes');selected=await EquipmentUnit.find({_id:{$in:ids},equipment:item._id,state:'damaged'}).session(session);if(selected.length!==quantity)throw httpErr(409,'Choose damaged units that are not already in repair');}
 const [repair]=await Repair.create([{equipment:item._id,quantity,units:selected.map(u=>u._id),notes:req.body.notes}],{session});if(selected.length)await EquipmentUnit.updateMany({_id:{$in:selected.map(u=>u._id)}},{$set:{state:'repair'}},{session});item.revision++;await item.save({session});await audit(session,req.user,'repair.opened',repair._id,null,repair);return repair;
}))));
r.post('/repairs/:id/complete',requirePermission('inventory.manage'),wrap(async(req,res)=>res.json(await mutate(req,'repair.complete:'+req.params.id,async session=>{
 const repair=await Repair.findById(req.params.id).session(session);if(!repair||repair.status!=='open')throw httpErr(409,'Repair is already completed or missing');const item=await Equipment.findById(repair.equipment).session(session);
 if(!item||item.damagedQty<repair.quantity)throw httpErr(409,'Damaged stock is inconsistent');await assertUnitTotals(item,session);
 if(item.trackUnits){if(repair.units.length!==repair.quantity)throw httpErr(409,'Repair unit codes are missing');const changed=await EquipmentUnit.updateMany({_id:{$in:repair.units},equipment:item._id,state:'repair'},{$set:{state:'good'}},{session});if(changed.modifiedCount!==repair.quantity)throw httpErr(409,'Repair unit conditions changed. Refresh before completing.');}
 item.damagedQty-=repair.quantity;item.revision++;if(!item.damagedQty)item.condition='good';await item.save({session});repair.status='completed';repair.completedAt=new Date();repair.cost=money(req.body.cost||0,'Repair cost',true);await repair.save({session});
 await InventoryTransaction.create([{equipment:item._id,type:'repaired',quantity:repair.quantity,reference:String(repair._id)}],{session});if(repair.cost){assertPermission(req.user,'expenses.manage');await Expense.create([{amount:repair.cost,category:'Repairs',description:'Repair: '+item.name,spentAt:new Date(),method:methodOf(req.body.method||'other'),repair:repair._id,actor:req.user._id}],{session});}await audit(session,req.user,'repair.completed',repair._id,null,repair);return repair;
}))));
export default r;
