'use strict';
const assert = require('node:assert/strict');
const { reorderAccounts } = require('../src/account-order');

const accounts = [
  { id: 'a', workspaceId: 'one', name: 'First', url: 'https://example.com/a', settings: { muted: true } },
  { id: 'x', workspaceId: 'two', name: 'Other workspace' },
  { id: 'b', workspaceId: 'one', name: 'Second' },
  { id: 'y', workspaceId: 'two', name: 'Other account' },
  { id: 'c', workspaceId: 'one', name: 'Third' }
];
const before = structuredClone(accounts);
const reordered = reorderAccounts(accounts, 'one', ['c', 'a', 'b']);
assert.deepEqual(reordered.map(account => account.id), ['c', 'x', 'a', 'y', 'b'], 'only the requested workspace slots may change');
assert.deepEqual(accounts, before, 'ordering never mutates the input');
for (const account of accounts) assert.equal(reordered.find(item => item.id === account.id), account, 'account records and nested settings retain their identity');
assert.notEqual(reordered, accounts);
assert.deepEqual(reorderAccounts(accounts, 'two', ['y', 'x']).map(account => account.id), ['a', 'y', 'b', 'x', 'c']);
assert.deepEqual(reorderAccounts([], 'empty', []), []);
assert.deepEqual(reorderAccounts(accounts, 'empty', []), accounts, 'an empty workspace accepts an empty order');

for (const ids of [null, {}, 'abc', ['a', 'b'], ['a', 'b', 'c', 'x'], ['a', 'a', 'c'], ['a', 'b', 'x'], ['a', 'b', 'missing'], ['a', 'b', 3], ['a', 'b', '']]) {
  assert.throws(() => reorderAccounts(accounts, 'one', ids), /order|ids|permutation/i, 'reject incomplete, duplicate, foreign and malformed orders');
  assert.deepEqual(accounts, before, 'invalid orders never partially mutate state');
}
for (const workspaceId of [undefined, null, '', 1]) assert.throws(() => reorderAccounts(accounts, workspaceId, []), /workspace/i);
assert.throws(() => reorderAccounts(null, 'one', []), /accounts/i);
assert.throws(() => reorderAccounts([{ id: 'a', workspaceId: 'one' }, { id: 'a', workspaceId: 'one' }], 'one', ['a', 'a']), /order|ids|permutation/i);
console.log('PASS: exact account-order validation, workspace isolation, immutable array and preserved account identity');
