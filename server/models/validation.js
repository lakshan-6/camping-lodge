// Validation/casting only. Runtime persistence is implemented in db/repository.js using PostgreSQL.
import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (m, extra = {}) => ({ type: Schema.Types.ObjectId, ref: m, ...extra });
const opts = { timestamps: true };

export const Counter = model('Counter', new Schema({ _id: String, value: { type: Number, default: 0 } }));

export const Equipment = model('Equipment', new Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, unique: true, sparse: true },
  totalQuantity: { type: Number, required: true, min: 0, default: 0 },
  periodRate: { type: Number, required: true, min: 0 },  // LKR per 36-hour period
  deposit: { type: Number, min: 0, default: 0 },          // LKR
  damagedQty: { type: Number, min: 0, default: 0 },       // units damaged / in repair
  checklist: [String],
  revision: { type: Number, default: 0 },
  trackUnits: { type: Boolean, default: false }, unitPrefix: String,
  condition: { type: String, enum: ['good', 'fair', 'needs_repair'], default: 'good' },
  notes: String,
  active: { type: Boolean, default: true },
}, opts));

export const EquipmentUnit = model('EquipmentUnit',new Schema({
  equipment: ref('Equipment',{required:true,index:true}),
  code: {type:String,required:true,unique:true,uppercase:true,trim:true,match:/^[A-Z0-9]{2,12}-[0-9]{3,}$/},
  state: {type:String,enum:['good','out','damaged','repair','lost','retired'],default:'good',required:true},
  rental: ref('Rental'), notes:String,
},opts));

export const Customer = model('Customer', new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  nic: String, address: String, notes: String,
  phoneKey: { type: String, index: true },
  email: { type: String, trim: true, lowercase: true },
  detailsPending: { type: Boolean, default: false },  // WhatsApp pre-booking: full details still to collect
  securityRevision: { type: Number, default: 0 },
}, opts));

export const Order = model('Order', new Schema({
  orderNo: { type: String, unique: true },
  customer: ref('Customer', { required: true }),
  pickupDate: String,
  plannedReturnDate: String,
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['reserved', 'active', 'completed', 'cancelled'], default: 'reserved' },
  totalAmount: { type: Number, default: 0 },
  depositAmount: { type: Number, default: 0 },
  securityMethod: { type: String, enum: ['nic', 'money'] },
  nicHeldAt: Date, nicHeldBy: ref('User'), nicReturnedAt: Date, nicReturnedBy: ref('User'),
  periods: Number,
  sendVia: { type: String, enum: ['email', 'whatsapp', 'both', 'none'], default: 'email' },  // how the customer gets their invoices
  deletedAt: Date,
  deletedBy: ref('User'),
  cancellation: { action: String, reason: String, refundPending: Number },
  extensionFees: { type: Number, default: 0 },
  notes: String,
}, opts));

export const OrderItem = model('OrderItem', new Schema({
  order: ref('Order', { required: true, index: true }),
  equipment: ref('Equipment', { required: true, index: true }),
  quantity: { type: Number, required: true, min: 1 },
  periodRate: { type: Number, required: true },
  periods: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true },
  returnedQuantity: { type: Number, default: 0 },
  unitAssignments: [{unit:ref('EquipmentUnit',{required:true}),code:String,outcome:{type:String,enum:['out','good','damaged','lost'],default:'out'},returnedAt:Date}],
}, opts));

export const Rental = model('Rental', new Schema({
  order: ref('Order', { required: true }),
  customer: ref('Customer', { required: true }),
  pickedUpAt: Date, dueDate: { type: Date, required: true },
  pickupChecklist: [{ key: String, label: String, checked: Boolean }],
  latePeriodsCharged: { type: Number, default: 0 },
  lateFeePercentCharged: { type: Number, min: 0, max: 100 },
  status: { type: String, enum: ['out', 'returned', 'overdue'], default: 'out' },
}, opts));

export const Return = model('Return', new Schema({
  rental: ref('Rental', { required: true }),
  returnedAt: { type: Date, default: Date.now },
  lateFee: { type: Number, default: 0 },
  damageFee: { type: Number, default: 0 },
  partial: Boolean,
  waivedFee: Number,
  waiverReason: String,
  checklist: [{ key: String, label: String, checked: Boolean, missing: Boolean, fee: Number }],
  notes: String,
}, opts));

export const ReturnItem = model('ReturnItem', new Schema({
  return: ref('Return', { required: true }),
  equipment: ref('Equipment', { required: true }),
  quantityReturned: { type: Number, default: 0 },
  quantityDamaged: { type: Number, default: 0 },
  quantityLost: { type: Number, default: 0 },
  units: [{unit:ref('EquipmentUnit',{required:true}),code:String,condition:{type:String,enum:['good','damaged','lost'],required:true}}],
  notes: String,
}, opts));

export const Payment = model('Payment', new Schema({
  order: ref('Order', { required: true }),
  invoice: ref('Invoice'),
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['cash', 'bank_transfer', 'card', 'other'], default: 'cash' },
  type: { type: String, enum: ['deposit', 'rental', 'balance', 'refund', 'fee'], default: 'rental' },
  paidAt: { type: Date, default: Date.now },
  reference: String,
}, opts));

export const Invoice = model('Invoice', new Schema({
  invoiceNo: { type: String, unique: true },
  order: ref('Order', { required: true }),
  customer: ref('Customer', { required: true }),
  subtotal: Number, fees: { type: Number, default: 0 }, total: Number,
  status: { type: String, enum: ['draft', 'issued', 'paid', 'void'], default: 'draft' },
  issuedAt: Date,
}, opts));

export const InventoryTransaction = model('InventoryTransaction', new Schema({
  equipment: ref('Equipment', { required: true, index: true }),
  type: { type: String, enum: ['initial_stock', 'adjustment', 'rented_out', 'returned', 'damaged', 'lost', 'repaired'], required: true },
  quantity: { type: Number, required: true },  // signed change in stock
  reference: String,                           // e.g. order or return id
  note: String,
}, opts));

export const User = model('User', new Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  permissions: { type: [String], default: undefined },
  sessionVersion: { type: Number, default: 0 },
  role: { type: String, enum: ['owner', 'admin', 'staff'], default: 'staff' },
  lastSeenAt: Date,
  active: { type: Boolean, default: true },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  mfaPendingSecret: { type: String, select: false },
  mfaPendingUntil: { type: Date, select: false },
  mfaLastStep: { type: Number, default: -1, select: false },
  mfaRecoveryHashes: { type: [String], select: false, default: [] },
  accountRecoveryHashes: { type: [String], select: false, default: [] },
}, opts));

export const Settings = model('Settings', new Schema({
  businessName: { type: String, default: 'Camping Lodge' },
  phone: { type: String, default: '071 552 4499' },
  address: { type: String, default: '' },
  lateFeePercent: { type: Number, default: 100, min: 0 },  // Retained for older settings and backups.
  graceMinutes: { type: Number, default: 0, min: 0, max: 1440 },
  lateFeeIntervalHours: { type: Number, min: 0.01 },
  lateFeeStepPercent: { type: Number, min: 0, max: 100 },
  lateFeeFullRateAfterHours: { type: Number, min: 0.01 },
}, opts));

export const DepositTransaction = model('DepositTransaction', new Schema({
  order: ref('Order', { required: true, index: true }), type: { type: String, enum: ['collect', 'refund', 'apply'], required: true },
  amount: { type: Number, min: 0, required: true }, method: String, reason: String, actor: ref('User'),
}, opts));
export const AuditEvent = model('AuditEvent', new Schema({
  actor: ref('User'), actorName: String, action: String, target: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed,
}, opts));
export const Mutation = model('Mutation', new Schema({
  _id: String, fingerprint: String, result: Schema.Types.Mixed,
}, opts));
export const Repair = model('Repair', new Schema({
  equipment: ref('Equipment', { required: true }), quantity: { type: Number, required: true, min: 1 },
  units: [ref('EquipmentUnit')],
  status: { type: String, enum: ['open', 'completed'], default: 'open' }, notes: String, cost: Number, completedAt: Date,
}, opts));
export const Expense = model('Expense', new Schema({
  amount: { type: Number, min: 0, required: true }, category: String, description: String,
  spentAt: { type: Date, required: true }, method: String, actor: ref('User'), repair: ref('Repair'),
}, opts));
export const Backup = model('Backup', new Schema({
  day: { type: String, unique: true }, payload: Buffer, iv: Buffer, tag: Buffer, size: Number,
  externalKey: String, externalVerifiedAt: Date, externalError: String,
}, opts));

const cashCloseSchema = new Schema({
  day: { type: String, required: true }, revision: { type: Number, required: true },
  openingCash: Number, cashRemoved: Number, countedCash: Number, expectedCash: Number, difference: Number,
  summary: Schema.Types.Mixed, ledgerHash: String, reason: String, actor: ref('User'), actorName: String,
}, opts);
cashCloseSchema.index({day:1,revision:1},{unique:true});
export const CashClose = model('CashClose', cashCloseSchema);
export const StockCount = model('StockCount', new Schema({
  equipment: ref('Equipment',{required:true}), equipmentName: String, countedGood: Number, countedDamaged: Number,
  outQuantity: Number, before: Schema.Types.Mixed, after: Schema.Types.Mixed, reason: String, actor: ref('User'), actorName: String,
}, opts));
