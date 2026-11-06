import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { Customer, Equipment, Order, OrderItem, Rental, Return, ReturnItem, Invoice, Payment, InventoryTransaction } from '../models/index.js';
import { permanentlyDeleteOrder, previewOrderDeletion, withOrderLock } from '../utils/orderDeletion.js';
import { initializeDocumentNumbers, nextDocumentNumber } from '../utils/documentNumbers.js';

const binary = process.env.TEST_MONGOD_PATH;
test('real MongoDB replica-set deletion, rollback and document numbering', { skip: !binary, timeout: 60000 }, async t => {
  const temp = await mkdtemp(join(tmpdir(), 'camping-lodge-db-test-'));
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const child = spawn(binary, ['--dbpath', temp, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'codexTest', '--logpath', join(temp, 'mongod.log')], { windowsHide: true, stdio: 'ignore' });
  let spawnError; child.on('error', e => { spawnError = e; });
  const uri = `mongodb://127.0.0.1:${port}/deletion_test?directConnection=true`;
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 500 });
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (spawnError) throw spawnError;
      try { await client.connect(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'temporary mongod must start');
    await client.db('admin').command({ replSetInitiate: { _id: 'codexTest', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
    for (let n = 0; n < 100; n++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await mongoose.connect(uri);
    await Promise.all(Object.values(mongoose.models).map(model => model.init()));
    const customer = await Customer.create({ name: 'Test', phone: '0771234567' });
    const equipment = await Equipment.create({ name: 'Tent', category: 'Tents', periodRate: 2000, totalQuantity: 10, damagedQty: 1 });
    const create = async (orderNo, invoiceNo, amount) => {
      const order = await Order.create({ orderNo, customer: customer._id, startDate: new Date(0), endDate: new Date(3600000), status: 'completed', totalAmount: amount });
      await OrderItem.create({ order: order._id, equipment: equipment._id, quantity: 1, periodRate: amount, periods: 1, lineTotal: amount });
      const rental = await Rental.create({ order: order._id, customer: customer._id, dueDate: new Date(3600000), status: 'returned' });
      const returned = await Return.create({ rental: rental._id });
      await ReturnItem.create({ return: returned._id, equipment: equipment._id, quantityReturned: 1 });
      const invoice = await Invoice.create({ order: order._id, customer: customer._id, invoiceNo, subtotal: amount, total: amount, status: 'paid' });
      await Payment.create({ order: order._id, invoice: invoice._id, amount });
      await InventoryTransaction.create({ equipment: equipment._id, type: 'rented_out', quantity: -1, reference: String(order._id) });
      await InventoryTransaction.create({ equipment: equipment._id, type: 'returned', quantity: 1, reference: String(returned._id) });
      return order;
    };
    const other = await create('CL-0007', 'INV-0010', 9000);
    const target = await create('CL-0008', 'INV-0011', 5000);
    await initializeDocumentNumbers();
    const models = [Order, OrderItem, Rental, Return, ReturnItem, Invoice, Payment, InventoryTransaction];
    const snapshot = async () => Promise.all(models.map(m => m.find().sort({ _id: 1 }).lean()));
    const before = await snapshot();
    const preview = await previewOrderDeletion(target._id);
    assert.equal(preview.netPayments, 5000); assert.equal(preview.counts.stockTransactions, 2);
    await t.test('real database rolls back all removals on failure', async () => {
      const mock = t.mock.method(Invoice, 'deleteMany', async () => { throw new Error('Injected failure'); });
      await assert.rejects(permanentlyDeleteOrder(target._id, target.orderNo), /Injected failure/);
      mock.mock.restore();
      assert.deepEqual(await snapshot(), before);
    });
    await t.test('permanent cascade affects only the chosen order and updates financial aggregates', async () => {
      await permanentlyDeleteOrder(target._id, target.orderNo);
      assert.equal(await Order.findById(target._id), null);
      assert.ok(await Order.findById(other._id));
      for (const model of models.slice(0, 7)) assert.equal(await model.countDocuments(), 1, model.modelName);
      assert.equal(await InventoryTransaction.countDocuments(), 2);
      assert.equal((await Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]))[0].total, 9000);
      const current = await Equipment.findById(equipment._id);
      assert.equal(current.totalQuantity, 10); assert.equal(current.damagedQty, 1);
      assert.ok(await Customer.findById(customer._id));
    });
    await t.test('deleted newest order/invoice numbers are not reused, including after restart initialization', async () => {
      assert.equal(await nextDocumentNumber('order'), 'CL-0009');
      assert.equal(await nextDocumentNumber('invoice'), 'INV-0012');
      await initializeDocumentNumbers();
      assert.equal(await nextDocumentNumber('order'), 'CL-0010');
      assert.equal(await nextDocumentNumber('invoice'), 'INV-0013');
    });
    await t.test('same-order writes wait for deletion while independent orders can progress', async () => {
      const events = []; let release;
      const gate = new Promise(resolve => { release = resolve; });
      const first = withOrderLock('test-order', async () => { events.push('delete'); await gate; events.push('deleted'); });
      await Promise.resolve(); await Promise.resolve();
      const second = withOrderLock('test-order', async () => { events.push('payment'); });
      await withOrderLock('another-order', async () => { events.push('other'); });
      assert.deepEqual(events, ['delete', 'other']); release(); await Promise.all([first, second]);
      assert.deepEqual(events, ['delete', 'other', 'deleted', 'payment']);
    });
  } finally {
    await mongoose.disconnect(); await client.close();
    child.kill(); if (child.exitCode === null) await once(child, 'exit');
    const absolute = resolve(temp);
    if (dirname(absolute) !== resolve(tmpdir()) || !basename(absolute).startsWith('camping-lodge-db-test-')) throw new Error('Unexpected test data path');
    await rm(absolute, { recursive: true, force: true });
  }
});
