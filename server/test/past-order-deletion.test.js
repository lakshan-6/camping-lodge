import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { User, Order, OrderItem, Payment, Invoice, Rental, Return, ReturnItem, Equipment, InventoryTransaction } from '../models/index.js';
import { requireAuth, sign } from '../utils/auth.js';
import orders from '../routes/orders.js';

process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
const correctKey = crypto.randomBytes(32).toString('hex');
process.env.PAST_ORDER_DELETE_KEY = correctKey;

test('past-order deletion requires owner authentication and its separate access key', async t => {
  const accounts = new Map();
  let sequence = 1;
  const actor = (role = 'owner') => {
    const user = { _id: String(sequence++).padStart(24, '0'), role, active: true,
      passwordHash: 'test-password-fingerprint', sessionVersion: 0, lastSeenAt: new Date() };
    accounts.set(user._id, user);
    return sign(user);
  };
  t.mock.method(User, 'findById', async id => accounts.get(id));
  let order;
  let writes = 0;
  const resetOrder = (status = 'completed') => { writes = 0; order = { _id: '112345678901234567890123', orderNo: 'CL-0001', status, totalAmount: 5000 }; };
  resetOrder();
  t.mock.method(Order, 'findById', async () => order);
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    writes++;
    assert.equal(filter.status, 'completed');
    assert.equal(filter.deletedAt, null);
    assert.equal(filter._id, '112345678901234567890123');
    assert.deepEqual(Object.keys(update), ['$set']);
    assert.deepEqual(Object.keys(update.$set).sort(), ['deletedAt', 'deletedBy']);
    if (!order || order.deletedAt || order.status !== 'completed') return null;
    Object.assign(order, update.$set);
    return order;
  });
  // Hiding a past order must not mutate any accounting or stock record.
  for (const model of [OrderItem, Payment, Invoice, Rental, Return, ReturnItem, Equipment, InventoryTransaction]) {
    for (const method of ['deleteMany', 'deleteOne', 'updateMany', 'updateOne', 'findByIdAndUpdate'])
      t.mock.method(model, method, () => assert.fail('Related records must be retained unchanged'));
  }
  const app = express();
  app.use(express.json());
  app.use('/orders', requireAuth, orders);
  app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const remove = (token, accessKey = correctKey, path = '/orders/112345678901234567890123/past') => fetch(base + path, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ accessKey })
  });
  await t.test('unauthenticated, staff and admin callers cannot delete even with the correct key', async () => {
    resetOrder();
    assert.equal((await remove()).status, 401);
    for (const role of ['staff', 'admin']) assert.equal((await remove(actor(role))).status, 403);
    assert.equal(writes, 0);
    assert.equal(order.deletedAt, undefined);
  });
  await t.test('missing, invalid, malformed and excessive keys fail before any write', async () => {
    resetOrder();
    const token = actor();
    for (const key of [undefined, 'wrong-key', { $ne: null }, 'x'.repeat(257)])
      assert.equal((await remove(token, key === undefined ? null : key)).status, 403);
    assert.equal(writes, 0);
  });
  await t.test('no configured key or a weak configured key fails closed', async () => {
    resetOrder();
    const token = actor();
    delete process.env.PAST_ORDER_DELETE_KEY;
    assert.equal((await remove(token)).status, 503);
    process.env.PAST_ORDER_DELETE_KEY = 'short';
    assert.equal((await remove(token)).status, 503);
    process.env.PAST_ORDER_DELETE_KEY = correctKey;
    assert.equal(writes, 0);
  });
  await t.test('owner and key hide a completed order and record who/when without changing totals or status', async () => {
    resetOrder();
    const before = { ...order };
    const token = actor();
    assert.equal((await remove(token)).status, 200);
    for (const [key, value] of Object.entries(before)) assert.equal(order[key], value);
    assert.ok(order.deletedAt instanceof Date);
    assert.equal(order.deletedBy, JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).id);
    assert.equal((await remove(token)).status, 404);
  });
  await t.test('active/reserved/cancelled orders cannot bypass their normal workflows', async () => {
    const token = actor();
    for (const status of ['active', 'reserved', 'cancelled']) {
      resetOrder(status);
      assert.equal((await remove(token)).status, 409);
      assert.equal(order.deletedAt, undefined);
      assert.equal(order.status, status);
    }
    order = null;
    assert.equal((await remove(token)).status, 404);
  });
  await t.test('normal booking delete cannot bypass the key for a completed order', async () => {
    // Completed status cannot match the normal route's reserved/cancelled filter.
    resetOrder();
    Order.findOneAndUpdate.mock.mockImplementation(async filter => {
      assert.deepEqual(filter.status.$in, ['reserved', 'cancelled']);
      return null;
    });
    assert.equal((await remove(actor(), correctKey, '/orders/112345678901234567890123')).status, 409);
    assert.equal(order.deletedAt, undefined);
  });
  await t.test('key guessing is limited to five attempts and cannot be reset by new sessions', async () => {
    const token = actor();
    for (let i = 0; i < 5; i++) assert.equal((await remove(token, 'wrong')).status, 403);
    assert.equal((await remove(token, correctKey)).status, 429);
    const userId = JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).id;
    const newSession = sign(accounts.get(userId));
    assert.equal((await remove(newSession, correctKey)).status, 429);
  });
});
