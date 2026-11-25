import { Router } from 'express';
import { Customer,Order,OrderItem,Rental,Payment } from '../models/index.js';
import { availability } from '../utils/availability.js';
import { dayRange,localDate,monthRange } from '../utils/businessTime.js';
import { can } from '../utils/permissions.js';
import { paidTotal } from '../utils/finance.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
async function income(range){
 const [row]=await Payment.aggregate([...(range?[{$match:{paidAt:range}}]:[]),{$group:{
  _id:null,total:{$sum:{$cond:[{$eq:['$type','refund']},{$multiply:['$amount',-1]},'$amount']}},
  sales:{$sum:{$cond:[{$eq:['$type','refund']},{$multiply:[{$ifNull:['$saleAmount',0]},-1]},{$ifNull:['$saleAmount',0]}]}},
 }}]);
 const revenue=Math.round((row?.total||0)*100)/100,salesNet=Math.round((row?.sales||0)*100)/100;
 return {revenue,salesNet,rentalNet:Math.round((revenue-salesNet)*100)/100};
}
r.get('/today',wrap(async(req,res)=>{
 const range=dayRange(localDate(new Date())),orders=await Order.find({deletedAt:null,status:'reserved',startDate:range}).populate('customer','name phone').lean();
 const missed=await Order.find({deletedAt:null,status:'reserved',startDate:{$lt:range.$gte}}).sort({startDate:-1}).limit(100).populate('customer','name phone').lean();
 const pending=await Order.find({deletedAt:null,status:'settlement_pending'}).sort({updatedAt:-1}).limit(100).populate('customer','name phone').lean();
 const listedOrderIds=[...orders,...missed,...pending].map(order=>order._id);
 const itemTypes=await OrderItem.find({order:{$in:listedOrderIds}}).select('order itemType').lean();
 const rentalOrderIds=new Set(itemTypes.filter(item=>item.itemType!=='sale').map(item=>String(item.order)));
 const withItemType=rows=>rows.map(order=>({...order,hasRentalItems:rentalOrderIds.has(String(order._id))}));
 const out=await Rental.find({status:'out'}).populate('customer','name phone').populate('order','orderNo').lean();
 const due=out.filter(r=>new Date(r.dueDate)>=range.$gte&&new Date(r.dueDate)<range.$lt),overdue=out.filter(r=>new Date(r.dueDate)<new Date());
 const unpaid=[];if(can(req.user,'finance.view'))for(const o of await Order.find({status:{$ne:'cancelled'},deletedAt:null}).populate('customer','name phone').lean()){const balance=o.totalAmount-await paidTotal(o._id);if(balance>0)unpaid.push({...o,balance});}
 res.json({date:localDate(new Date()),pickups:withItemType(orders),missed:withItemType(missed),pending:withItemType(pending),returns:due,overdue,unpaid});
}));
r.get('/',wrap(async(req,res)=>{
 const now=new Date(),avail=await availability(now,new Date(+now+1)),financial=can(req.user,'finance.view');
 const customers=await Customer.countDocuments(),activeOrders=await Order.countDocuments({status:{$in:['reserved','active']}}),rentalsOut=await Rental.countDocuments({status:'out'}),overdue=await Rental.countDocuments({status:'out',dueDate:{$lt:now}});
 let outstanding=0;if(financial)for(const o of await Order.find({status:{$ne:'cancelled'}}).lean())outstanding+=Math.max(0,o.totalAmount-await paidTotal(o._id));
 const [all,month]=financial?await Promise.all([income(),income(monthRange(localDate(now).slice(0,7)))]):[];
 res.json({customers,activeOrders,rentalsOut,overdue,outstanding:financial?outstanding:null,revenue:all?.revenue??null,monthRevenue:month?.revenue??null,
 salesNet:all?.salesNet??null,rentalNet:all?.rentalNet??null,monthSalesNet:month?.salesNet??null,monthRentalNet:month?.rentalNet??null,
 recent:await Order.find({deletedAt:null}).sort({createdAt:-1}).limit(5).populate('customer','name').lean(),equipmentItems:avail.length,totalUnits:avail.reduce((s,i)=>s+i.totalQuantity,0),availableUnits:avail.reduce((s,i)=>s+i.available,0),low:avail.filter(i=>i.totalQuantity>0&&i.available<=Math.ceil(i.totalQuantity*.25)).map(i=>({_id:i._id,name:i.name,available:i.available,total:i.totalQuantity}))});
}));
r.get('/summary',wrap(async(req,res)=>{
 if(!can(req.user,'finance.view'))return res.json({revenue:null,salesNet:null,rentalNet:null,customers:await Customer.countDocuments(),since:null});
 let range;if(req.query.period==='month')range=monthRange(req.query.value);else if(req.query.period==='year'){const y=String(req.query.value);if(!/^\d{4}$/.test(y))throw Object.assign(new Error('Choose a year'),{status:400});range={$gte:new Date(y+'-01-01T00:00:00+05:30'),$lt:new Date((+y+1)+'-01-01T00:00:00+05:30')};}
 res.json({...await income(range),customers:await Customer.countDocuments(range?{createdAt:range}:{}),since:(await Order.findOne().sort({createdAt:1}).lean())?.createdAt||null});
}));
export default r;
