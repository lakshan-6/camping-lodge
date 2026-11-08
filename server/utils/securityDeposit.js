import {Order,Customer} from '../models/index.js';
import {httpErr} from './availability.js';
import {depositHeld} from './finance.js';
import {audit} from './operations.js';
export const nicHeld=order=>!!order.nicHeldAt&&!order.nicReturnedAt;
export function securityMethod(value){if(!['nic','money'].includes(value))throw httpErr(400,'Choose NIC or money as security');return value;}
export async function chooseSecurity(order,value,session){
 const method=securityMethod(value);
 if(method!=='nic'&&nicHeld(order))throw httpErr(409,'Return the held NIC before changing to a money deposit');
 if(method==='nic'&&await depositHeld(order._id,session)>0)throw httpErr(409,'Refund or apply the held money deposit before choosing NIC security');
 order.securityMethod=method;
}
export async function receiveNic(order,user,session){
 if(order.securityMethod!=='nic')throw httpErr(409,'Choose NIC as security first');
 if(nicHeld(order))return;
 if(!['reserved','active'].includes(order.status)||order.deletedAt)throw httpErr(409,'Only an open booking or rental can receive NIC security');
 const customer=await Customer.findById(order.customer).session(session);if(!customer?.nic)throw httpErr(409,'Add the customer NIC number before recording their NIC as held');
 // Serialize competing NIC receipts even when more than one server process is used.
 await Customer.updateOne({_id:customer._id},{$inc:{securityRevision:1}},{session});
 const other=await Order.findOne({_id:{$ne:order._id},customer:order.customer,nicHeldAt:{$ne:null},nicReturnedAt:null}).session(session);
 if(other)throw httpErr(409,'This customer NIC is already held for '+other.orderNo+'. Use money security for this order.');
 order.nicHeldAt=new Date();order.nicHeldBy=user._id;order.nicReturnedAt=undefined;order.nicReturnedBy=undefined;
 await audit(session,user,'security.nic_received',order._id,null,{orderNo:order.orderNo});
}
export async function releaseNic(order,user,session){
 if(!nicHeld(order))throw httpErr(409,'There is no held NIC to return');
 if(order.status==='active')throw httpErr(409,'Receive all outstanding equipment before returning the NIC');
 order.nicReturnedAt=new Date();order.nicReturnedBy=user._id;
 await audit(session,user,'security.nic_returned',order._id,null,{orderNo:order.orderNo});
}
