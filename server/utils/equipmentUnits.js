import {Counter,EquipmentUnit,OrderItem,Rental,Repair} from '../models/index.js';
import {httpErr} from './availability.js';
import {units} from './operations.js';
export const physicalStates=['good','out','damaged','repair'];
export const damagedStates=['damaged','repair'];
export function unitPrefix(value){const prefix=typeof value==='string'?value.trim().toUpperCase():'';if(!/^[A-Z0-9]{2,12}$/.test(prefix))throw httpErr(400,'Use 2–12 letters/numbers for the unit code prefix, for example SB');return prefix;}
export async function addUnits(item,count,damaged,session,conditions){
 if(!count)return [];
 if(count>2000)throw httpErr(400,'Add at most 2,000 individually tracked units at a time');
 const counter=await Counter.findOneAndUpdate({_id:'unit:'+item.unitPrefix},{$inc:{value:count}},{new:true,upsert:true,session});
 return EquipmentUnit.insertMany(Array.from({length:count},(_,i)=>({equipment:item._id,code:item.unitPrefix+'-'+String(counter.value-count+i+1).padStart(3,'0'),state:conditions?.[i]??(i<damaged?'damaged':'good')})),{session});
}
export async function configureUnits(item,body,before,session){
 const enabled=body.trackUnits===undefined?!!before?.trackUnits:body.trackUnits;
 if(typeof enabled!=='boolean')throw httpErr(400,'Choose whether units are individually tracked');
 if(before?.trackUnits&&!enabled)throw httpErr(409,'Unit tracking cannot be disabled after labels have been assigned');
 if(!enabled){item.trackUnits=false;return;}
 const skuPrefix=item.sku?.replaceAll('-','');
 const automaticPrefix=/^(?:EQ|[A-Z0-9]{3}-[A-Z0-9]{3})-\d+$/.test(item.sku)&&skuPrefix.length<=12
  ?skuPrefix:'EQ'+String(item._id).slice(-10);
 const prefix=unitPrefix(body.unitPrefix??before?.unitPrefix??automaticPrefix);
 if(before?.trackUnits&&prefix!==before.unitPrefix)throw httpErr(409,'Existing unit codes cannot be renamed. Keep the original prefix.');
 if(!before?.trackUnits){
  const rentals=await Rental.find({status:{$in:['out','overdue']}}).select('order').session(session);
  if(await OrderItem.exists({equipment:item._id,order:{$in:rentals.map(r=>r.order)}}).session(session)||await Repair.exists({equipment:item._id,status:'open'}).session(session))throw httpErr(409,'Finish outstanding rentals and open repair jobs before enabling unit tracking');
 }
 item.trackUnits=true;item.unitPrefix=prefix;
 if(before?.trackUnits){
  if(item.totalQuantity<before.totalQuantity)throw httpErr(409,'Select the exact unit code to mark a unit lost or retired instead of reducing the total');
  const newlyDamaged=body.unitConditions?.filter(condition=>condition==='damaged').length??0;
  if(item.damagedQty!==before.damagedQty+newlyDamaged)throw httpErr(409,'Change the condition of the exact unit code instead of editing damaged quantity');
  await addUnits(item,item.totalQuantity-before.totalQuantity,0,session,body.unitConditions);
 }else await addUnits(item,item.totalQuantity,item.damagedQty,session,body.unitConditions);
}
export async function assertUnitTotals(item,session){
 if(!item.trackUnits)return;
 const rows=await EquipmentUnit.find({equipment:item._id}).session(session).lean();
 if(rows.filter(u=>physicalStates.includes(u.state)).length!==item.totalQuantity||rows.filter(u=>damagedStates.includes(u.state)).length!==item.damagedQty)throw httpErr(409,'Unit labels and stock totals disagree. Refresh inventory before continuing.');
}
export async function allocateUnits(items,selections,rental,session){
 if(selections!==undefined&&!Array.isArray(selections))throw httpErr(400,'Choose valid unit codes');
 const choices=selections||[],seen=new Set();
 for(const choice of choices){if(!choice||typeof choice!=='object'||seen.has(String(choice.equipment))||!items.some(i=>String(i.equipment._id)===String(choice.equipment)&&i.equipment.trackUnits))throw httpErr(400,'Invalid or duplicate equipment unit selection');seen.add(String(choice.equipment));}
 for(const line of items){
  if(!line.equipment.trackUnits)continue;
  const ids=choices.find(c=>String(c.equipment)===String(line.equipment._id))?.units;
  if(!Array.isArray(ids)||ids.length!==line.quantity||new Set(ids.map(String)).size!==ids.length)throw httpErr(400,'Select exactly '+line.quantity+' unit codes for '+line.equipment.name);
  if(ids.some(id=>!String(id).match(/^[a-f0-9]{24}$/i)))throw httpErr(400,'Choose valid unit codes');
  const selected=await EquipmentUnit.find({_id:{$in:ids},equipment:line.equipment._id,state:'good'}).session(session);
  if(selected.length!==ids.length)throw httpErr(409,'A selected unit is damaged, already out, or belongs to another item. Refresh and choose again.');
  const changed=await EquipmentUnit.updateMany({_id:{$in:ids},state:'good'},{$set:{state:'out',rental:rental._id}},{session});
  if(changed.modifiedCount!==ids.length)throw httpErr(409,'Selected units changed. Refresh before handover.');
  line.unitAssignments=selected.map(u=>({unit:u._id,code:u.code,outcome:'out'}));await line.save({session});
 }
}
export function returnUnitRows(line,row){
 if(!line.equipment.trackUnits){if(row.units?.length)throw httpErr(400,'This equipment is not individually tracked');return null;}
 const remaining=(line.unitAssignments||[]).filter(u=>u.outcome==='out');
 if(!Array.isArray(row.units))throw httpErr(400,'Choose the condition of each returned unit code');
 const seen=new Set(),result=[];
 for(const entry of row.units){
  if(!entry||typeof entry!=='object')throw httpErr(400,'Choose valid returned unit codes');
  const assignment=remaining.find(u=>String(u.unit)===String(entry.unit));
  if(!assignment||seen.has(String(entry.unit))||!['good','damaged','lost'].includes(entry.condition))throw httpErr(400,'Invalid, duplicated or already returned unit code');
  seen.add(String(entry.unit));result.push({unit:assignment.unit,code:assignment.code,condition:entry.condition});
 }
 const counts={quantityReturned:result.filter(u=>u.condition==='good').length,quantityDamaged:result.filter(u=>u.condition==='damaged').length,quantityLost:result.filter(u=>u.condition==='lost').length};
 for(const [key,value]of Object.entries(counts))if(row[key]!==undefined&&units(row[key],true)!==value)throw httpErr(400,'Unit conditions must match the returned quantities');
 return {units:result,...counts};
}
export async function receiveUnits(line,entries,rental,session){
 for(const entry of entries){
  const changed=await EquipmentUnit.updateOne({_id:entry.unit,equipment:line.equipment._id,state:'out',rental:rental._id},{$set:{state:entry.condition},$unset:{rental:1}},{session});
  if(changed.modifiedCount!==1)throw httpErr(409,'A unit is no longer outstanding on this rental. Refresh the return.');
  const assignment=line.unitAssignments.find(u=>String(u.unit)===String(entry.unit));assignment.outcome=entry.condition;assignment.returnedAt=new Date();
 }
}
