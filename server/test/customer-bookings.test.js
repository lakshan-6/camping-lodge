import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { Customer, Order, OrderItem, Payment, Invoice } from '../models/index.js';
import { customerContact } from '../utils/customerContact.js';
import customers from '../routes/customers.js';
import orders from '../routes/orders.js';

const phone = '0771234567';
test('contact validation preserves leading zeroes and accepts old/new NIC formats', () => {
  for (const nic of ['123456789V', '123456789X', '200012345678', '123456789v', ''])
    assert.deepEqual(customerContact({ phone, nic }), { phone, nic: nic.toUpperCase() });
  assert.equal(customerContact({ phone: '94771234567' }).phone, '94771234567');
  for (const invalid of ['hello', '077abc4567', '+94771234567', '077 1234567', '1', '1'.repeat(16), 771234567, { $ne: null }])
    assert.throws(() => customerContact({ phone: invalid }), { status: 400 });
  for (const nic of ['abc', '123456789', '123456789A', 'V123456789', '1234567890V', '2000hello678', 200012345678, {}])
    assert.throws(() => customerContact({ phone, nic }), { status: 400 });
});

test('customer and booking API regression checks with isolated model doubles', async t => {
  const record = { _id: '012345678901234567890123', name: 'Test Customer', phone, nic: '',
    set(data) { Object.assign(this, data); }, async save() { return this; } };
  let duplicate = null;
  t.mock.method(Customer, 'findOne', async () => duplicate);
  t.mock.method(Customer, 'findById', async () => record);
  t.mock.method(Customer, 'create', async data => data);
  let booking = { _id: '112345678901234567890123', orderNo: 'CL-0001', status: 'reserved' };
  const original = { ...booking };
  t.mock.method(Order, 'findOneAndUpdate', async (filter, update) => {
    if (!booking || booking.deletedAt || !filter.status.$in.includes(booking.status)) return null;
    Object.assign(booking, update.$set);
    return booking;
  });
  t.mock.method(Order, 'findById', async () => booking);
  t.mock.method(Order, 'find', filter => {
    assert.deepEqual(filter, { deletedAt: null });
    return { sort() { return this; }, populate() { return this; }, lean: async () => booking?.deletedAt ? [] : [booking] };
  });
  t.mock.method(OrderItem, 'find', () => ({ populate() { return this; }, lean: async () => [] }));
  // Deleting a booking must never destroy its accounting/line-item records.
  for (const model of [OrderItem, Payment, Invoice])
    t.mock.method(model, 'deleteMany', () => assert.fail('Related records must be preserved'));
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { _id: '212345678901234567890123' }; next(); });
  app.use('/customers', customers);
  app.use('/orders', orders);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method, body) => fetch(base + path, { method,
    headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  await t.test('all create modes and edits reject invalid phone/NIC input', async () => {
    for (const method of ['POST', 'PUT']) for (const preBooking of [false, true]) {
      const path = '/customers' + (method === 'PUT' ? '/' + record._id : '');
      assert.equal((await request(path, method, { name: 'Test', phone: 'words', preBooking })).status, 400);
      assert.equal((await request(path, method, { name: 'Test', phone, nic: '123text', preBooking })).status, 400);
    }
  });
  await t.test('lowercase NIC suffix is saved uppercase and duplicate NIC edits are blocked', async () => {
    const created = await request('/customers', 'POST', { name: 'Test', phone, nic: '123456789v' });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).nic, '123456789V');
    const updated = await request('/customers/' + record._id, 'PUT', { name: 'Test', phone, nic: '200012345678' });
    assert.equal(updated.status, 200);
    duplicate = { _id: 'another-customer' };
    assert.equal((await request('/customers/' + record._id, 'PUT', { name: 'Test', phone, nic: '123456789X' })).status, 409);
    duplicate = null;
  });
  await t.test('reserved and cancelled bookings can be removed; stock is released and records preserved', async () => {
    for (const status of ['reserved', 'cancelled']) {
      booking = { ...original, status };
      assert.equal((await request('/orders/' + booking._id, 'DELETE')).status, 200);
      assert.equal(booking.status, 'cancelled');
      assert.ok(booking.deletedAt instanceof Date);
      assert.equal(booking.deletedBy, '212345678901234567890123');
      const list = await request('/orders', 'GET');
      assert.deepEqual(await list.json(), []);
      assert.equal((await request('/orders/' + booking._id, 'DELETE')).status, 404);
    }
  });
  await t.test('active and completed rentals cannot be deleted', async () => {
    for (const status of ['active', 'completed']) {
      booking = { ...original, status };
      assert.equal((await request('/orders/' + booking._id, 'DELETE')).status, 409);
      assert.equal(booking.deletedAt, undefined);
    }
    booking = null;
    assert.equal((await request('/orders/missing', 'DELETE')).status, 404);
  });
});
