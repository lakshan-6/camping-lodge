import crypto from 'node:crypto';
import {Equipment,Order,OrderItem,Repair} from '../models/index.js';
import {httpErr} from './availability.js';

export async function stockSnapshot(id,session=null){
  const item=await Equipment.findById(id).session(session);
  if(!item)throw httpErr(404,'Equipment not found');
  const orders=await Order.find({status:{$in:['active','reserved']}}).select('_id status startDate endDate').session(session).lean();
  const lines=await OrderItem.find({equipment:id,order:{$in:orders.map(o=>o._id)}}).session(session).lean();
  const repairs=await Repair.find({equipment:id,status:'open'}).session(session).lean();
  let out=0,current=0,peak=0;const events=[];
  for(const line of lines){const order=orders.find(o=>String(o._id)===String(line.order)),quantity=line.quantity-(line.returnedQuantity||0);
    if(order.status==='active')out+=quantity;
    events.push([order.status==='active'?0:+order.startDate,quantity],[order.status==='active'?Infinity:+order.endDate,-quantity]);
  }
  events.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);for(const [,q]of events){current+=q;peak=Math.max(peak,current);}
  const repairQuantity=repairs.reduce((s,r)=>s+r.quantity,0);
  const signature=crypto.createHash('sha256').update(JSON.stringify({revision:item.revision||0,total:item.totalQuantity,damaged:item.damagedQty,out,peak,repairQuantity})).digest('hex');
  return {item,out,peak,repairQuantity,signature,expectedGood:item.totalQuantity-item.damagedQty-out};
}
export function checkStock(snapshot,total,damaged){
  if(damaged>total||damaged<snapshot.repairQuantity)throw httpErr(409,'Damaged stock must include units in open repair jobs');
  if(total-damaged<snapshot.peak)throw httpErr(409,'This stock count would leave existing bookings or rentals without enough equipment. Resolve those bookings first.');
}
