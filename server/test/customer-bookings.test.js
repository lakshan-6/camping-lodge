import test from 'node:test';
import assert from 'node:assert/strict';
import {customerContact} from '../utils/customerContact.js';
import {dayRange,monthRange} from '../utils/businessTime.js';
import {money,units} from '../utils/operations.js';
import {can} from '../utils/permissions.js';
import {encryptSnapshot,decryptSnapshot} from '../utils/backups.js';
import crypto from 'node:crypto';
import {businessDate,businessInput,businessISO} from '../../client/src/businessTime.js';
const phone='0771234567';
test('contact identifiers keep leading zeroes and valid NIC suffixes',()=>{
 for(const nic of ['123456789V','123456789X','200012345678','123456789v',''])assert.deepEqual(customerContact({phone,nic}),{phone,nic:nic.toUpperCase()});
 for(const invalid of ['hello','077abc4567','+94771234567','077 1234567','1','1'.repeat(16),771234567,{}])assert.throws(()=>customerContact({phone:invalid}),{status:400});
 for(const nic of ['abc','123456789','123456789A','V123456789','1234567890V',200012345678,{}])assert.throws(()=>customerContact({phone,nic}),{status:400});
});
test('units, prices and business timezone boundaries are validated',()=>{
 for(const n of [1.5,-1,Infinity,NaN,'abc'])assert.throws(()=>units(n));
 for(const n of [-1,Infinity,NaN,'abc',1.001])assert.throws(()=>money(n));
 assert.equal(units('2'),2);assert.equal(money('1.25'),1.25);
 const range=dayRange('2026-11-07');assert.equal(range.$gte.toISOString(),'2026-11-06T18:30:00.000Z');assert.equal(range.$lt.toISOString(),'2026-11-07T18:30:00.000Z');
 assert.equal(monthRange('2026-12').$lt.toISOString(),'2026-12-31T18:30:00.000Z');
 assert.throws(()=>dayRange('2026-02-30'));assert.throws(()=>dayRange('2026-11-08','2026-11-07'));
 assert.equal(businessDate('2026-11-06T18:31:00Z'),'2026-11-07');
 assert.equal(businessInput('2026-11-06T18:31:00Z'),'2026-11-07T00:01');
 assert.equal(businessISO('2026-11-07T00:01'),'2026-11-06T18:31:00.000Z');
});
test('staff defaults and explicit permission overrides do not grant finance/refund access',()=>{
 assert.equal(can({role:'staff'},'returns.write'),true);assert.equal(can({role:'staff'},'payments.refund'),false);
 assert.equal(can({role:'staff',permissions:[]},'returns.write'),false);assert.equal(can({role:'staff',permissions:['payments.record']},'payments.record'),true);assert.equal(can({role:'owner'},'payments.refund'),true);
});
test('backup encryption authenticates contents and does not expose plaintext',()=>{
 process.env.BACKUP_ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');const data={version:1,collections:{customers:[{name:'Private customer'}]}};
 const encrypted=encryptSnapshot(data),envelope={format:'camping-lodge-encrypted-v1',iv:encrypted.iv.toString('base64'),tag:encrypted.tag.toString('base64'),data:encrypted.payload.toString('base64')};
 assert.deepEqual(decryptSnapshot(envelope),data);assert.equal(encrypted.payload.includes(Buffer.from('Private customer')),false);
 envelope.data=Buffer.from('altered').toString('base64');assert.throws(()=>decryptSnapshot(envelope),{status:400});
 assert.throws(()=>encryptSnapshot({large:'a'.repeat(32*1024*1024)}),{status:413});
});
