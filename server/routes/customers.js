import { Router } from 'express';
import { Customer,Order,OrderItem,Payment,Return,Rental,Invoice,Mutation } from '../models/index.js';
import { httpErr } from '../utils/availability.js';
import { customerContact } from '../utils/customerContact.js';
import { mutate,audit } from '../utils/operations.js';
import { requirePermission,can } from '../utils/permissions.js';
const r=Router(),wrap=fn=>(req,res,next)=>fn(req,res).catch(next);
const esc=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export const phoneKey=phone=>phone.startsWith('94')&&phone.length===11?'0'+phone.slice(2):phone;
const aliases=phone=>{const key=phoneKey(phone);return /^0\d{9}$/.test(key)?[key,'94'+key.slice(1)]:[key];};
const pick=b=>({name:b.name,phone:b.phone,nic:b.nic,address:b.address,notes:b.notes,email:b.email});
async function deletionPreview(id,session=null){
 const customer=await Customer.findById(id).session(session).lean();if(!customer)throw httpErr(404,'Customer not found');
 // Include cancelled and hidden orders, and any independent rental/invoice references.
 const orders=await Order.countDocuments({customer:id}).session(session),rentals=await Rental.countDocuments({customer:id}).session(session),invoices=await Invoice.countDocuments({customer:id}).session(session);
 return {customer:{_id:customer._id,name:customer.name},orders,rentals,invoices,canDelete:orders+rentals+invoices===0};
}
async function matchesContact(body,exclude,session=null){
 const clauses=[];if(body.phone)clauses.push({phone:{$in:aliases(body.phone)}},{phoneKey:phoneKey(body.phone)});
 if(body.nic)clauses.push({nic:new RegExp('^'+esc(body.nic)+'$','i')});
 if(!clauses.length)return [];
 return Customer.find({...(exclude?{_id:{$ne:exclude}}:{}),$or:clauses}).session(session).lean();
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
 res.status(201).json(await mutate(req,'customer.create',async session=>{
 const contact=customerContact(req.body),matches=await matchesContact(contact,null,session);
 if(matches.some(c=>contact.nic&&c.nic?.toUpperCase()===contact.nic))throw httpErr(409,'This NIC belongs to an existing customer. Choose that customer.');
 if(req.body.preBooking&&matches.length===1)return matches[0];
 if(matches.length&&(!req.body.confirmDifferentPerson||!contact.nic))throw httpErr(409,'An existing customer uses this phone. Choose the existing record, or confirm a different person with a different NIC.');
 const [customer]=await Customer.create([{...pick(req.body),...contact,phoneKey:phoneKey(contact.phone),name:typeof req.body.name==='string'&&req.body.name.trim()?req.body.name.trim():(req.body.preBooking?'WhatsApp '+contact.phone:''),detailsPending:!!req.body.preBooking}],{session});
 await audit(session,req.user,'customer.created',customer._id,null,{name:customer.name,phone:customer.phone});return customer;
 }));
}));
r.put('/:id',requirePermission('customers.write'),wrap(async(req,res)=>{
 res.json(await mutate(req,'customer.edit:'+req.params.id,async session=>{
 const customer=await Customer.findById(req.params.id).session(session);if(!customer)throw httpErr(404,'Customer not found');
 const contact=customerContact(req.body),matches=await matchesContact(contact,customer._id,session);
 if(contact.nic!==(customer.nic||'')&&await Order.exists({customer:customer._id,nicHeldAt:{$ne:null},nicReturnedAt:null}).session(session))throw httpErr(409,'Return this customer’s held NIC before changing their NIC number');
 if(matches.some(c=>contact.nic&&c.nic?.toUpperCase()===contact.nic))throw httpErr(409,'A customer with this NIC already exists');
 const before=customer.toObject();customer.set({...pick(req.body),...contact,phoneKey:phoneKey(contact.phone)});
 if(customer.detailsPending&&customer.nic&&customer.name&&!/^WhatsApp /.test(customer.name))customer.detailsPending=false;
 await customer.save({session});await audit(session,req.user,'customer.edited',customer._id,before,customer);return customer;
 }));
}));
export default r;
