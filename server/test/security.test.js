import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { User,AuditEvent } from '../models/index.js';
import { hashPassword, checkPassword, requireAuth, requireAdmin, sign, validateAuthConfig } from '../utils/auth.js';
import auth from '../routes/auth.js';
import users from '../routes/users.js';
import {database} from '../db/connection.js';

process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.SETUP_KEY = crypto.randomBytes(32).toString('hex');

test('authentication security regression checks (isolated model doubles)', async t => {
  t.mock.method(AuditEvent,'create',async()=>[]);
  let account;
  let creates = 0;
  t.mock.method(User, 'countDocuments', () => ({session(){return this;},then(resolve,reject){return Promise.resolve(account?1:0).then(resolve,reject);}}));
  t.mock.method(User, 'findOne', async ({ username }) => account?.username === username ? account : null);
  t.mock.method(User, 'findById', async id => String(id) === account?._id ? account : null);
  t.mock.method(User, 'create', async data => {
    const many=Array.isArray(data);if(many)data=data[0];
    creates++;
    account = { ...data, _id: '012345678901234567890123', active: true, sessionVersion: 0, lastSeenAt: new Date(), save: async () => account };
    return many?[account]:account;
  });
  t.mock.method(User, 'updateOne', async (filter, update) => {
    if (update.$inc) account.sessionVersion += update.$inc.sessionVersion;
    if (update.$set) Object.assign(account, update.$set);
    return { modifiedCount: 1 };
  });
  t.mock.method(database,'startSession',async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
  const app = express();
  app.use(express.json());
  app.use('/auth', auth);
  app.use('/users', requireAuth, requireAdmin, users);
  app.use((e, req, res, next) => res.status(e.status || 500).json({ error: e.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, token, method = 'POST') => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const setup = { name: 'Test Owner', username: 'owner', password: 'a-long-test-password', setupKey: process.env.SETUP_KEY };
  await t.test('weak secrets fail closed; new passwords enforce bounds; legacy hashes remain usable', async () => {
    const strong = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'short';
    assert.throws(validateAuthConfig);
    process.env.AUTH_SECRET = strong;
    await assert.rejects(hashPassword('short'));
    await assert.rejects(hashPassword('x'.repeat(129)));
    const salt = 'legacy-salt';
    const legacy = salt + ':' + crypto.scryptSync('old123', salt, 64).toString('hex');
    assert.equal(await checkPassword('old123', legacy), true);
    assert.equal(await checkPassword('wrong', legacy), false);
  });
  await t.test('setup requires private key; parallel attempts create only one owner', async () => {
    assert.equal((await request('/auth/setup', { ...setup, setupKey: 'wrong' })).status, 403);
    const responses = await Promise.all([request('/auth/setup', setup), request('/auth/setup', { ...setup, username: 'other-owner' })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(creates, 1);
    assert.equal((await request('/auth/setup', setup)).status, 403);
    const status = await (await request('/auth/status', undefined, undefined, 'GET')).json();
    assert.deepEqual(status, { hasUsers: true });
  });
  await t.test('login succeeds; tampered, expired, and legacy tokens fail', async () => {
    const login = await request('/auth/login', { username: account.username, password: setup.password });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    assert.equal((await request('/auth/me', undefined, token, 'GET')).status, 200);
    assert.equal((await request('/auth/me', undefined, token + 'x', 'GET')).status, 401);
    for (const claims of [{ id: account._id }, { ...JSON.parse(Buffer.from(token.split('.')[0], 'base64url')), exp: 1 }]) {
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const forged = p + '.' + crypto.createHmac('sha256', process.env.AUTH_SECRET).update(p).digest('base64url');
      assert.equal((await request('/auth/me', undefined, forged, 'GET')).status, 401);
    }
  });
  await t.test('logout revokes sessions; a new login works', async () => {
    const token = sign(account);
    assert.equal((await request('/auth/logout', {}, token)).status, 200);
    assert.equal((await request('/auth/me', undefined, token, 'GET')).status, 401);
    assert.equal((await request('/auth/login', { username: account.username, password: setup.password })).status, 200);
  });
  await t.test('password reset through account API revokes existing tokens', async () => {
    account.role='admin'; // Owner password changes now require Account Security re-authentication.
    const token = sign(account);
    const response = await request('/users/' + account._id, { password: 'new-password-for-testing' }, token, 'PATCH');
    assert.equal(response.status, 200);
    assert.equal((await request('/auth/me', undefined, token, 'GET')).status, 401);
    assert.equal(await checkPassword('new-password-for-testing', account.passwordHash), true);
    account.role='owner';
  });
  await t.test('disable/re-enable does not restore old sessions', async () => {
    const token = sign(account);
    account.active = false;
    account.sessionVersion++;
    assert.equal((await request('/auth/me', undefined, token, 'GET')).status, 401);
    account.active = true;
    assert.equal((await request('/auth/me', undefined, token, 'GET')).status, 401);
  });
  await t.test('repeated login attempts are rate limited', async () => {
    let response;
    for (let i = 0; i < 11; i++) response = await request('/auth/login', { username: account.username, password: 'wrong' });
    assert.equal(response.status, 429);
  });
});
