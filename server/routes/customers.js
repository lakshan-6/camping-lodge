import { Router } from 'express';
import { Customer,Order,OrderItem,Payment,Return,Rental,Invoice,Mutation } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { customerContact } from '../utils/customerContact.js';
import { mutate,audit } from '../utils/operations.js';
import { requirePermission,can } from '../utils/permissions.js';
import { createCustomer, customerFields, matchesContact, phoneKey } from '../utils/customers.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
async function deletionPreview(id,session=null){
 const customer=await Customer.findById(id).session(session).lean();if(!customer)throw httpErr(404,'Customer not found');
 // Include cancelled and hidden orders, and any independent rental/invoice references.
 const orders=await Order.countDocuments({customer:id}).session(session),rentals=await Rental.countDocuments({customer:id}).session(session),invoices=await Invoice.countDocuments({customer:id}).session(session);
 return {customer:{_id:customer._id,name:customer.name},orders,rentals,invoices,canDelete:orders+rentals+invoices===0};
}
r.get('/matches',wrap(async(req,res)=>{res.json(await matchesContact({phone:String(req.query.phone||''),nic:String(req.query.nic||'').toUpperCase()},req.query.exclude));}));
r.get('/',wrap(async(req,res)=>{const q=String(req.query.q||''),filter=q?{$or:[{name:new RegExp(esc(q),'i')},{phone:new RegExp(esc(q),'i')},{nic:new RegExp(esc(q),'i')}]}:{};res.json(await Customer.find(filter).sort({name:1}));}));
r.get('/:id/delete-preview',requirePermission('customers.delete'),wrap(async(req,res)=>res.json(await deletionPreview(req.params.id))));
r.delete('/:id',requirePermission('customers.delete'),wrap(async(req,res)=>{
 res.json(await mutate(req,'customer.delete:'+req.params.id,async session=>{
  const preview=await deletionPreview(req.params.id,session);
  if(!preview.canDelete)throw httpErr(409,'This customer has order, rental or invoice history and cannot be deleted. Remove test orders and their related records first.');
  await Customer.deleteOne({_id:req.params.id},{session});
  // Remove cached customer data so a retried old create/edit cannot return a deleted record.
  await Mutation.deleteMany({_id:/:customer\.(create|edit):/,'result._id':{$in:[preview.customer._id,String(preview.customer._id)]}},{session});
  await audit(session,req.user,'customer.deleted',req.params.id,{name:preview.customer.name},null);
  return {deleted:true,customerId:req.params.id};
 }));
}));
r.get('/:id/history',wrap(async(req,res)=>{
 const customer=await Customer.findById(req.params.id).lean();if(!customer)throw httpErr(404,'Customer not found');
 const orders=await Order.find({customer:customer._id,deletedAt:null}).sort({createdAt:-1}).lean(),ids=orders.map(o=>o._id);
 const items=await OrderItem.find({order:{$in:ids}}).populate('equipment','name').lean(),payments=await Payment.find({order:{$in:ids}}).sort({paidAt:-1}).lean();
 const rentals=await Rental.find({customer:customer._id}).lean(),returns=await Return.find({rental:{$in:rentals.map(x=>x._id)}}).lean();
 const rows=orders.map(o=>{const paid=payments.filter(p=>String(p.order)===String(o._id)).reduce((s,p)=>s+(p.type==='refund'?-p.amount:p.amount),0);return {...o,paid,balance:o.status==='cancelled'?0:Math.max(0,o.totalAmount-paid),items:items.filter(i=>String(i.order)===String(o._id))};});
 res.json({customer,orders:rows,returns,payments:can(req.user,'finance.view')?payments:[],outstanding:rows.reduce((s,o)=>s+o.balance,0)});
}));
r.post('/',requirePermission('customers.write'),wrap(async(req,res)=>{
 res.status(201).json(await mutate(req,'customer.create',session=>createCustomer(req.body,req.user,session)));
}));
r.put('/:id',requirePermission('customers.write'),wrap(async(req,res)=>{
 res.json(await mutate(req,'customer.edit:'+req.params.id,async session=>{
 const customer=await Customer.findById(req.params.id).session(session);if(!customer)throw httpErr(404,'Customer not found');
 const contact=customerContact(req.body),matches=await matchesContact(contact,customer._id,session);
 if(contact.nic!==(customer.nic||'')&&await Order.exists({customer:customer._id,nicHeldAt:{$ne:null},nicReturnedAt:null}).session(session))throw httpErr(409,'Return this customer’s held NIC before changing their NIC number');
 if(matches.some(c=>contact.nic&&c.nic?.toUpperCase()===contact.nic))throw httpErr(409,'A customer with this NIC already exists');
 const before=customer.toObject();customer.set({...customerFields(req.body),...contact,phoneKey:phoneKey(contact.phone)});
 if(customer.detailsPending&&customer.nic&&customer.name&&!/^WhatsApp /.test(customer.name))customer.detailsPending=false;
 await customer.save({session});await audit(session,req.user,'customer.edited',customer._id,before,customer);return customer;
 }));
}));
export default r;
