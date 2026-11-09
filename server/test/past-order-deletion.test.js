import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import {database} from '../db/connection.js';
import { once } from 'node:events';
import { User, Customer, DepositTransaction, Mutation, AuditEvent, Order, OrderItem, Payment, Invoice, Rental, Return, ReturnItem, Equipment, InventoryTransaction } from '../models/index.js';
import { requireAuth, sign } from '../utils/auth.js';
import orders from '../routes/orders.js';

process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
const correctKey = 'TestKey123@@';
process.env.PAST_ORDER_DELETE_KEY = correctKey;
const id = '112345678901234567890123';
const other = '112345678901234567890124';
const fixture = () => ({
  Order: [{ _id: id, orderNo: 'CL-0001', status: 'completed', totalAmount: 5000 }, { _id: other, orderNo: 'CL-0002', status: 'completed', totalAmount: 9000 }],
  DepositTransaction: [], Mutation: [],
  OrderItem: [{ _id: 'line1', order: id }, { _id: 'line2', order: other }],
  Rental: [{ _id: 'rental1', order: id, status: 'returned' }, { _id: 'rental2', order: other, status: 'returned' }],
  Return: [{ _id: 'return1', rental: 'rental1' }, { _id: 'return2', rental: 'rental2' }],
  ReturnItem: [{ _id: 'return-item1', return: 'return1' }, { _id: 'return-item2', return: 'return2' }],
  Invoice: [{ _id: 'invoice1', order: id }, { _id: 'invoice2', order: other }],
  Payment: [{ _id: 'payment1', order: id, amount: 5000, type: 'balance' }, { _id: 'refund1', order: id, amount: 1000, type: 'refund' },
    { _id: 'invoice-payment1', invoice: 'invoice1', amount: 20, type: 'fee' }, { _id: 'payment2', order: other, amount: 9000, type: 'rental' }],
  InventoryTransaction: [{ _id: 'tx1', reference: id }, { _id: 'tx2', reference: 'return1' }, { _id: 'tx3', reference: other }]
});
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(f => matches(doc, f));
  if (value === null) return doc[key] == null;
  if (typeof value === 'object') {
    if ('$in' in value) return value.$in.map(String).includes(String(doc[key]));
    if ('$ne' in value) return doc[key] != value.$ne;
  }
  return String(doc[key]) === String(value);
});

test('permanent past-order removal is owner/key protected and transactional', async t => {
  let db = fixture(), failure, writes = 0, activeSession, ended = 0;
  const accounts = new Map();
  let sequence = 1;
  const actor = (role = 'owner') => {
    const user = { _id: String(sequence++).padStart(24, '0'), role, active: true, passwordHash: 'fixture', sessionVersion: 0, lastSeenAt: new Date() };
    accounts.set(user._id, user); return sign(user);
  };
  t.mock.method(User, 'findById', async key => accounts.get(key));
  t.mock.method(database, 'startSession', async () => {
    const session = {
      async withTransaction(fn) {
        const before = structuredClone(db); activeSession = session;
        try { return await fn(); } catch (e) { db = before; throw e; } finally { activeSession = null; }
      },
      async endSession() { ended++; }
    };
    return session;
  });
  const query = get => ({
    session(value) { assert.ok(value === null || value === activeSession); return this; },
    sort() { return this; }, populate() { return this; },
    async lean() { return get(); },
    then(resolve, reject) { return Promise.resolve(get()).then(resolve, reject); }
  });
  for (const model of [Order, OrderItem, Payment, Invoice, Rental, Return, ReturnItem, InventoryTransaction, DepositTransaction, Mutation]) {
    const name = model.modelName;
    t.mock.method(model, 'find', filter => query(() => db[name].filter(d => matches(d, filter))));
    t.mock.method(model, 'findById', key => query(() => db[name].find(d => d._id === key) || null));
    t.mock.method(model, 'countDocuments', filter => query(() => db[name].filter(d => matches(d, filter)).length));
    t.mock.method(model, 'deleteMany', async (filter, options) => {
      assert.ok(activeSession); assert.equal(options.session, activeSession); writes++;
      if (failure === name) throw new Error('Injected failure');
      const before = db[name].length; db[name] = db[name].filter(d => !matches(d, filter));
      return { deletedCount: before - db[name].length };
    });
  }
  t.mock.method(Order, 'deleteOne', async (filter, options) => {
    assert.equal(options.session, activeSession); writes++;
    const before = db.Order.length; db.Order = db.Order.filter(d => !matches(d, filter));
    return { deletedCount: before - db.Order.length };
  });
  t.mock.method(Order, 'findOneAndUpdate', async filter => {
    assert.deepEqual(filter.status.$in, ['reserved', 'cancelled']); return null;
  });
  for (const model of [Customer, Equipment]) for (const method of ['deleteOne', 'deleteMany', 'updateOne', 'updateMany'])
    t.mock.method(model, method, () => assert.fail('Shared customer and physical stock must stay unchanged'));
  t.mock.method(AuditEvent, 'create', async () => []);
  const app = express(); app.use(express.json()); app.use('/orders', requireAuth, orders);
  app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (token, { accessKey = correctKey, confirmation = 'CL-0001', path = `/orders/${id}/past`, method = 'DELETE' } = {}) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(method !== 'GET' ? { body: JSON.stringify({ accessKey, confirmation }) } : {})
  });
  const reset = () => { db = fixture(); writes = 0; failure = undefined; process.env.PAST_ORDER_DELETE_KEY = correctKey; };
  await t.test('unauthenticated/staff/admin requests cannot delete or preview even with the key', async () => {
    reset(); assert.equal((await request()).status, 401);
    for (const role of ['staff', 'admin']) {
      const token = actor(role);
      assert.equal((await request(token)).status, 403);
      assert.equal((await request(token, { method: 'GET', path: `/orders/${id}/past-delete-preview` })).status, 403);
      assert.equal((await request(token, { method: 'GET', path: '/orders?deleted=true' })).status, 403);
    }
    assert.equal(writes, 0);
  });
  await t.test('missing, invalid, malformed and excessive keys fail before any write', async () => {
    reset(); const token = actor();
    for (const accessKey of [null, 'wrong', {}, 'x'.repeat(129)]) assert.equal((await request(token, { accessKey })).status, 403);
    assert.equal(writes, 0);
  });
  await t.test('missing/invalid configuration fails closed; 12-character symbol keys work', async () => {
    reset(); const token = actor();
    for (const value of [undefined, 'short', 'x'.repeat(129)]) {
      if (value) process.env.PAST_ORDER_DELETE_KEY = value; else delete process.env.PAST_ORDER_DELETE_KEY;
      assert.equal((await request(token)).status, 503);
    }
    assert.equal(writes, 0); process.env.PAST_ORDER_DELETE_KEY = correctKey;
    assert.equal(correctKey.length, 12); assert.equal((await request(token)).status, 200);
  });
  await t.test('preview lists exact related counts and net payments without writing', async () => {
    reset(); const response = await request(actor(), { method: 'GET', path: `/orders/${id}/past-delete-preview` });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { orderNo: 'CL-0001', totalAmount: 5000, netPayments: 4020,
      counts: { orders: 1, orderItems: 1, payments: 3, invoices: 1, rentals: 1, returns: 1, returnItems: 1, stockTransactions: 2, securityDeposits: 0 } });
    assert.equal(writes, 0);
  });
  await t.test('exact order-number confirmation is required', async () => {
    reset(); const response = await request(actor(), { confirmation: 'CL-0002' });
    assert.equal(response.status, 400); assert.equal(writes, 0); assert.deepEqual(db, fixture());
  });
  await t.test('all linked records are removed while the other order is untouched', async () => {
    reset(); const response = await request(actor()); assert.equal(response.status, 200);
    assert.deepEqual(db.Order.map(d => d._id), [other]);
    assert.deepEqual(db.Payment.map(d => d._id), ['payment2']);
    for (const name of ['OrderItem', 'Invoice', 'Rental', 'Return', 'ReturnItem', 'InventoryTransaction']) assert.equal(db[name].length, 1, name);
    assert.equal(writes, 10);
    assert.equal((await request(actor())).status, 404);
  });
  await t.test('failure midway rolls back every removal and closes the session', async () => {
    reset(); failure = 'Invoice'; const beforeEnded = ended;
    assert.equal((await request(actor())).status, 500); assert.deepEqual(db, fixture()); assert.equal(ended, beforeEnded + 1);
  });
  await t.test('active/reserved/cancelled and inconsistent outstanding rentals are rejected', async () => {
    const token = actor();
    for (const status of ['active', 'reserved', 'cancelled']) {
      reset(); db.Order[0].status = status; assert.equal((await request(token)).status, 409); assert.equal(writes, 0);
    }
    reset(); db.Rental[0].status = 'out'; assert.equal((await request(token)).status, 409); assert.equal(writes, 0);
  });
  await t.test('previously hidden completed orders can be selected and permanently deleted', async () => {
    reset(); db.Order[0].deletedAt = new Date().toISOString(); const token = actor();
    const response = await request(token, { method: 'GET', path: '/orders?deleted=true' });
    assert.deepEqual((await response.json()).map(d => d._id), [id]);
    assert.equal((await request(token)).status, 200); assert.equal(db.Order.length, 1);
  });
  await t.test('normal booking deletion cannot bypass owner/key requirements', async () => {
    reset(); assert.equal((await request(actor('staff'), { path: `/orders/${id}` })).status, 409); assert.equal(writes, 0);
  });
  await t.test('five failed attempts rate limit further requests even after a new session', async () => {
    reset(); const token = actor();
    for (let i = 0; i < 5; i++) assert.equal((await request(token, { accessKey: 'wrong' })).status, 403);
    const userId = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).id;
    assert.equal((await request(sign(accounts.get(userId)))).status, 429); assert.equal(writes, 0);
  });
});
