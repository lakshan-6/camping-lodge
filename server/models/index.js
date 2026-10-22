import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (m, extra = {}) => ({ type: Schema.Types.ObjectId, ref: m, ...extra });
const opts = { timestamps: true };

export const Equipment = model('Equipment', new Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, unique: true, sparse: true },
  totalQuantity: { type: Number, required: true, min: 0, default: 0 },
  periodRate: { type: Number, required: true, min: 0 },  // LKR per 36-hour period
  deposit: { type: Number, min: 0, default: 0 },          // LKR
  damagedQty: { type: Number, min: 0, default: 0 },       // units damaged / in repair
  condition: { type: String, enum: ['good', 'fair', 'needs_repair'], default: 'good' },
  notes: String,
  active: { type: Boolean, default: true },
}, opts));

export const Customer = model('Customer', new Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  nic: String, address: String, notes: String,
}, opts));

export const Order = model('Order', new Schema({
  orderNo: { type: String, unique: true },
  customer: ref('Customer', { required: true }),
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['reserved', 'active', 'completed', 'cancelled'], default: 'reserved' },
  totalAmount: { type: Number, default: 0 },
  depositAmount: { type: Number, default: 0 },
  periods: Number,
  notes: String,
}, opts));

export const OrderItem = model('OrderItem', new Schema({
  order: ref('Order', { required: true, index: true }),
  equipment: ref('Equipment', { required: true, index: true }),
  quantity: { type: Number, required: true, min: 1 },
  periodRate: { type: Number, required: true },
  periods: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true },
}, opts));

export const Rental = model('Rental', new Schema({
  order: ref('Order', { required: true }),
  customer: ref('Customer', { required: true }),
  pickedUpAt: Date, dueDate: { type: Date, required: true },
  status: { type: String, enum: ['out', 'returned', 'overdue'], default: 'out' },
}, opts));

export const Return = model('Return', new Schema({
  rental: ref('Rental', { required: true }),
  returnedAt: { type: Date, default: Date.now },
  lateFee: { type: Number, default: 0 },
  damageFee: { type: Number, default: 0 },
  notes: String,
}, opts));

export const ReturnItem = model('ReturnItem', new Schema({
  return: ref('Return', { required: true }),
  equipment: ref('Equipment', { required: true }),
  quantityReturned: { type: Number, default: 0 },
  quantityDamaged: { type: Number, default: 0 },
  quantityLost: { type: Number, default: 0 },
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
  role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  active: { type: Boolean, default: true },
}, opts));

export const Settings = model('Settings', new Schema({
  businessName: { type: String, default: 'Camping Lodge' },
  phone: { type: String, default: '071 552 4499' },
  address: { type: String, default: '' },
  lateFeePercent: { type: Number, default: 100, min: 0 },  // % of the rental rate charged per extra 36h period
}, opts));
