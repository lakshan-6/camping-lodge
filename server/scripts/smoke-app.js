import express from 'express';
import {testDatabase} from '../test/helpers/database.js';
import {User,Customer,Equipment,EquipmentUnit,Counter,Order,OrderItem,Settings} from '../models/index.js';
import {hashPassword,requireAuth} from '../utils/auth.js';
import {initializeDocumentNumbers} from '../utils/documentNumbers.js';
import {serveClient} from '../utils/production.js';
import auth from '../routes/auth.js';import customers from '../routes/customers.js';import equipment from '../routes/equipment.js';import orders from '../routes/orders.js';import rentals from '../routes/rentals.js';import returns from '../routes/returns.js';import payments from '../routes/payments.js';import invoices from '../routes/invoices.js';import stats from '../routes/stats.js';import reports from '../routes/reports.js';import users from '../routes/users.js';import settings from '../routes/settings.js';import manage from '../routes/management.js';import backups from '../routes/backups.js';
import reconciliation from '../routes/reconciliation.js';import security from '../routes/security.js';
if(!process.env.TEST_MONGOD_PATH)throw new Error('TEST_MONGOD_PATH is required; this script only uses a temporary test database');
process.env.AUTH_SECRET='smoke-auth-key-for-disposable-test-only-123456789';process.env.BACKUP_ENCRYPTION_KEY='smoke-backup-key-for-disposable-test-only-123456';
const cleanup=await testDatabase();
await User.create({name:'Smoke Owner',username:'smoke_owner',passwordHash:await hashPassword('SmokeTestOnly123!'),role:'owner'});
const customer=await Customer.create({name:'Smoke Customer',phone:'0771234567',nic:'123456789V'});
const item=await Equipment.create({name:'Smoke Tent',category:'Tents',totalQuantity:5,damagedQty:1,periodRate:1000,deposit:500,checklist:['Poles','Bag'],trackUnits:true,unitPrefix:'ST'});
await EquipmentUnit.insertMany(Array.from({length:5},(_,i)=>({equipment:item._id,code:'ST-'+String(i+1).padStart(3,'0'),state:i===0?'damaged':'good'})));await Counter.create({_id:'unit:ST',value:5});
const order=await Order.create({orderNo:'CL-0001',customer:customer._id,status:'reserved',startDate:new Date(),endDate:new Date(Date.now()+36*3600000),periods:1,totalAmount:2000,depositAmount:1000,securityMethod:'nic'});
await OrderItem.create({order:order._id,equipment:item._id,quantity:2,periodRate:1000,periods:1,lineTotal:2000});await Settings.create({});await initializeDocumentNumbers();
const app=express();app.use(express.json({limit:'16mb'}));app.use('/api/auth',auth);app.use('/api',requireAuth);
for(const [path,router]of Object.entries({customers,equipment,orders,rentals,returns,payments,invoices,stats,reports,users,settings,manage,backups,reconciliation,security}))app.use('/api/'+path,router);
app.use('/api',(req,res)=>res.status(404).json({error:'Not found'}));serveClient(app);app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
const server=app.listen(5099,'127.0.0.1',()=>console.log('Disposable UI test app: http://127.0.0.1:5099'));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await new Promise(r=>server.close(r));await cleanup();process.exit(0);}
process.stdin.on('data',stop);process.once('SIGINT',stop);process.once('SIGTERM',stop);
// Noninteractive runners cannot send input later; do not leave temporary servers behind.
process.stdin.once('end',stop);process.stdin.resume();
