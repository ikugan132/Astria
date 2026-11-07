'use strict';

function reorderAccounts(accounts, workspaceId, ids) {
  if (!Array.isArray(accounts)) throw new TypeError('Invalid accounts.');
  if (typeof workspaceId !== 'string' || !workspaceId) throw new TypeError('Invalid workspace.');
  const members = accounts.filter(account => account.workspaceId === workspaceId);
  const byId = new Map(members.map(account => [account.id, account]));
  if (!Array.isArray(ids) || ids.length !== members.length || byId.size !== members.length ||
      new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id || !byId.has(id))) {
    throw new TypeError('Account order must be an exact permutation of the workspace ids.');
  }
  let index = 0;
  return accounts.map(account => account.workspaceId === workspaceId ? byId.get(ids[index++]) : account);
}

module.exports = { reorderAccounts };
