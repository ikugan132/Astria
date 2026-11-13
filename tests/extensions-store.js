'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const moduleFile = path.join(__dirname, '../src/extensions-store.js');
const { ExtensionsStore } = fs.existsSync(moduleFile) ? require(moduleFile) : {};
assert.equal(typeof ExtensionsStore, 'function', 'the portable extension store must exist');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'astria-extensions-'));
const directory = path.join(root, 'Save', 'Extensions');
const key = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDivkWz/7GryO5K/m73TEld4HClg1auaCnciltbEsf00FG5yIdek6Sm4kfpNRCyalSbL+b9MAxm/yJ80kQS2pr0QfVihgbFPx4hFDBYJc/92VdflXiwxYcLzFiFAs/OKLzKhAtP3xe9MHIzl6Wgns/BKlq23+98v2/rZoQKl0+5QIDAQAB';
let sequence = 0;
const fixture = (changes = {}) => {
  const folder = path.join(root, `source-${sequence++}`);
  fs.mkdirSync(path.join(folder, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(folder, 'ui', 'popup.html'), '<!doctype html><title>Extension</title>');
  fs.writeFileSync(path.join(folder, 'worker.js'), 'globalThis.started = true;');
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test extension', version: '1.2.3',
    permissions: ['storage'], host_permissions: ['https://example.com/*'], background: { service_worker: 'worker.js' },
    action: { default_popup: 'ui/popup.html' }, ...changes }));
  return folder;
};
const readManifest = folder => JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const accountFolder = (directory, accountId) => path.join(directory, `account-${crypto.createHash('sha256').update(accountId).digest('hex')}`);
const store = new ExtensionsStore({ directory });
try {
  assert.deepEqual(store.list('account-a'), []);
  const source = fixture();
  fs.mkdirSync(path.join(source, '.git'));
  fs.writeFileSync(path.join(source, '.git', 'secret'), 'not extension content');
  const original = fs.readFileSync(path.join(source, 'manifest.json'), 'utf8');
  const installed = store.install('account-a', source);
  assert.match(installed.id, /^[0-9a-f-]{36}$/);
  assert.match(installed.extensionId, /^[a-p]{32}$/);
  assert.equal(installed.name, 'Test extension');
  assert.equal(installed.version, '1.2.3');
  assert.equal(installed.enabled, true);
  assert.deepEqual(installed.manifest.permissions, ['storage']);
  assert.equal(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'), original, 'install must not edit the selected source');
  const installedFolder = store.folder('account-a', installed.id);
  assert.equal(fs.readFileSync(path.join(installedFolder, 'worker.js'), 'utf8'), 'globalThis.started = true;');
  assert.equal(fs.existsSync(path.join(installedFolder, '.git')), false);
  const installedManifest = readManifest(installedFolder);
  assert.equal(crypto.createPublicKey({ key: Buffer.from(installedManifest.key, 'base64'), format: 'der', type: 'spki' }).asymmetricKeyType, 'rsa');
  assert.equal(JSON.stringify(store.list('account-a')).includes(source), false, 'public metadata must not expose source paths');
  assert.equal(store.setEnabled('account-a', installed.id, false).enabled, false);
  assert.equal(new ExtensionsStore({ directory }).list('account-a')[0].enabled, false);
  assert.throws(() => store.setEnabled('account-a', installed.id, 'true'), /enabled|boolean/i);
  assert.throws(() => store.folder('account-a', crypto.randomUUID()), /unknown|found/i);

  const fixedSource = fixture({ key });
  const fixed = store.install('account-a', fixedSource);
  assert.equal(fixed.extensionId, 'jbhokdphejmhifhkempbnecdegdlagje');
  assert.equal(readManifest(store.folder('account-a', fixed.id)).key, key);
  assert.throws(() => store.install('account-a', fixedSource), /already|duplicate/i);
  const other = store.install('account-b', fixedSource);
  assert.equal(other.extensionId, fixed.extensionId, 'the same extension is independent in each account');
  assert.equal(store.list('account-a').length, 2);

  const moved = path.join(root, 'moved-extensions');
  fs.renameSync(directory, moved);
  const portable = new ExtensionsStore({ directory: moved });
  const movedFolder = portable.folder('account-a', installed.id);
  assert.equal(readManifest(movedFolder).key, installedManifest.key, 'moving the portable folder must preserve the identity key');
  assert.equal(portable.list('account-a')[0].extensionId, installed.extensionId);
  portable.remove('account-a', fixed.id);
  assert.equal(portable.list('account-a').length, 1);
  assert.equal(portable.list('account-b').length, 1);
  assert.equal(fs.existsSync(fixedSource), true);
  assert.equal(fs.existsSync(path.join(accountFolder(moved, 'account-a'), fixed.id)), false);

  const upperCase = portable.install('A', fixedSource);
  assert.deepEqual(portable.list('a'), [], 'case-distinct account IDs must not share metadata on Windows');
  const lowerCase = portable.install('a', fixedSource);
  portable.setEnabled('A', upperCase.id, false);
  assert.equal(portable.list('A')[0].enabled, false);
  assert.equal(portable.list('a')[0].enabled, true, 'enable changes must preserve the case-distinct account');
  assert.notEqual(portable.folder('A', upperCase.id), portable.folder('a', lowerCase.id));
  assert.equal(portable.remove('A', upperCase.id), true);
  assert.deepEqual(portable.list('A'), []);
  assert.equal(portable.list('a')[0].id, lowerCase.id, 'removal must preserve the case-distinct account');
  assert.equal(readManifest(portable.folder('a', lowerCase.id)).key, key);

  const changedCopy = portable.install('changed-copy', source);
  const changedFolder = portable.folder('changed-copy', changedCopy.id);
  const changedManifest = readManifest(changedFolder);
  fs.writeFileSync(path.join(changedFolder, 'manifest.json'), JSON.stringify({ ...changedManifest, key }));
  assert.throws(() => portable.folder('changed-copy', changedCopy.id), /identity.*reinstall|reinstall.*identity/i, 'changed copied keys must not load under an unexpected native extension ID');
  assert.equal(portable.list('changed-copy')[0].extensionId, changedCopy.extensionId, 'identity rejection must preserve metadata');
  assert.equal(portable.remove('changed-copy', changedCopy.id), true, 'identity-damaged copies must remain removable');

  const missingCopy = portable.install('missing-copy', fixedSource);
  const missingFolder = portable.folder('missing-copy', missingCopy.id);
  assert.equal(path.dirname(missingFolder), fs.realpathSync.native(accountFolder(moved, 'missing-copy')));
  fs.rmSync(missingFolder, { recursive: true });
  assert.equal(portable.remove('missing-copy', missingCopy.id), true, 'missing copies must remain removable');
  assert.deepEqual(portable.list('missing-copy'), []);
  const damagedCopy = portable.install('damaged-copy', fixedSource);
  const damagedFolder = portable.folder('damaged-copy', damagedCopy.id);
  fs.unlinkSync(path.join(damagedFolder, 'manifest.json'));
  const damagedFile = fs.openSync(path.join(damagedFolder, 'large.bin'), 'w');
  fs.ftruncateSync(damagedFile, 100 * 1024 * 1024 + 1);
  fs.closeSync(damagedFile);
  assert.equal(portable.remove('damaged-copy', damagedCopy.id), true, 'removal must not require a valid loading tree');
  assert.deepEqual(portable.list('damaged-copy'), []);
  assert.equal(fs.existsSync(damagedFolder), false);
  const transactional = portable.install('transactional', fixedSource);
  const transactionalFolder = portable.folder('transactional', transactional.id);
  const writeMetadata = portable._write;
  portable._write = () => { throw new Error('Injected metadata write failure.'); };
  try { assert.throws(() => portable.remove('transactional', transactional.id), /metadata write failure/i); }
  finally { portable._write = writeMetadata; }
  assert.equal(portable.list('transactional')[0].id, transactional.id, 'failed metadata writes must retain the record');
  assert.equal(portable.folder('transactional', transactional.id), transactionalFolder, 'failed removals must restore the copied folder');
  assert.equal(portable.remove('transactional', transactional.id), true);

  for (const account of ['', '../outside', '..', 'a/b', 'a\\b', 'a.b', 'x'.repeat(81), null]) {
    assert.throws(() => portable.list(account), /account/i);
    assert.throws(() => portable.install(account, source), /account/i);
  }
  for (const id of ['../outside', '', null, 'not-a-uuid']) assert.throws(() => portable.folder('account-a', id), /id|extension/i);

  for (const changes of [{ manifest_version: 1 }, { manifest_version: '3' }, { name: '' }, { name: 5 }, { version: 'banana' },
    { version: '1.2.3.4.5' }, { version: '65536' }, { key: 'invalid key' },
    { permissions: {} }, { permissions: [3] }, { permissions: [''] }, { host_permissions: '*' },
    { host_permissions: [null] }, { permissions: Array(1001).fill('storage') },
    { content_scripts: [{ matches: {}, js: ['worker.js'] }] },
    { content_scripts: [{ matches: [null], js: ['worker.js'] }] },
    { background: { service_worker: '../outside.js' } }, { action: { default_popup: '/outside.html' } },
    { side_panel: { default_path: 'C:\\outside.html' } }, { options_ui: { page: 'https://example.com' } },
    { options_page: 'ui/../../outside.html' }, { content_scripts: [{ js: ['missing.js'] }] },
    { content_scripts: [{ css: ['..\\outside.css'] }] }, { background: { scripts: ['//server/file.js'] } },
    { background: { page: 'ui/%2e%2e/%2e%2e/outside.html' } }]) {
    assert.throws(() => portable.install('invalid-manifests', fixture(changes)), /manifest|key|path|version|name|file/i);
    assert.deepEqual(portable.list('invalid-manifests'), [], 'failed installs must not add metadata');
  }
  const invalidJson = fixture();
  fs.writeFileSync(path.join(invalidJson, 'manifest.json'), '{');
  assert.throws(() => portable.install('invalid-json', invalidJson), /manifest|json/i);
  const hugeManifest = fixture();
  fs.writeFileSync(path.join(hugeManifest, 'manifest.json'), ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => portable.install('huge-manifest', hugeManifest), /manifest|large|size/i);
  const oversized = fixture();
  const largeFile = fs.openSync(path.join(oversized, 'large.bin'), 'w');
  fs.ftruncateSync(largeFile, 100 * 1024 * 1024 + 1);
  fs.closeSync(largeFile);
  assert.throws(() => portable.install('oversized', oversized), /large|size|100/i);
  const crowded = fixture();
  for (let i = 0; i < 9998; i++) fs.writeFileSync(path.join(crowded, `${i}.txt`), '');
  assert.throws(() => portable.install('crowded', crowded), /file.*limit|many files|10000/i);
  assert.deepEqual(portable.list('crowded'), []);
  assert.deepEqual(fs.readdirSync(accountFolder(moved, 'crowded')), [], 'rejected trees must leave no partial installation');
  const largeMetadataSource = fixture({ description: 'x'.repeat(1024 * 1024 - 1024) });
  let persisted = 0;
  assert.throws(() => {
    for (let i = 0; i < 17; i++) {
      portable.install('metadata-limit', largeMetadataSource);
      persisted++;
    }
  }, /metadata.*(?:size|limit|large)|(?:size|limit|large).*metadata/i, 'metadata limits must reject the new install before making existing records unreadable');
  assert.equal(portable.list('metadata-limit').length, persisted);
  assert.equal(fs.readdirSync(accountFolder(moved, 'metadata-limit')).length, persisted + 1, 'metadata failure must clean its copied folder and staging files');

  const malformedAccount = accountFolder(moved, 'malformed');
  fs.mkdirSync(malformedAccount);
  const malformed = path.join(malformedAccount, 'extensions.json');
  fs.writeFileSync(malformed, '{broken metadata');
  for (const operation of [() => portable.list('malformed'), () => portable.install('malformed', source)]) {
    assert.throws(operation, /metadata/i);
    assert.equal(fs.readFileSync(malformed, 'utf8'), '{broken metadata');
  }
  fs.writeFileSync(malformed, JSON.stringify([{ id: '../escape', enabled: true }]));
  assert.throws(() => portable.list('malformed'), /metadata/i);
  const malformedPermissions = JSON.stringify([{ ...other, manifest: { ...other.manifest, permissions: {} } }]);
  fs.writeFileSync(malformed, malformedPermissions);
  assert.throws(() => portable.list('malformed'), /metadata.*permissions/i);
  assert.throws(() => portable.install('malformed', source), /metadata.*permissions/i);
  assert.equal(fs.readFileSync(malformed, 'utf8'), malformedPermissions, 'malformed permissions metadata must remain preserved');

  const external = path.join(root, 'external');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'keep.txt'), 'untouched');
  const linkedSource = fixture();
  try {
    fs.symlinkSync(external, path.join(linkedSource, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    throw new Error('Security test requires permission to create directory links.', { cause: error });
  }
  assert.throws(() => portable.install('linked-source', linkedSource), /link|redirect|symbolic/i);
  assert.throws(() => portable.install('linked-root', path.join(linkedSource, 'redirect')), /link|redirect|symbolic/i);
  const linkedAccount = accountFolder(moved, 'linked-account');
  fs.symlinkSync(external, linkedAccount, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => portable.install('linked-account', source), /link|redirect|symbolic/i);
  assert.throws(() => new ExtensionsStore({ directory: linkedAccount }), /link|redirect|symbolic/i);
  const nested = path.join(movedFolder, 'redirect');
  fs.symlinkSync(external, nested, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => portable.folder('account-a', installed.id), /link|redirect|symbolic/i, 'loading must not follow redirects added inside installed copies');
  fs.unlinkSync(nested);
  const nestedCopy = portable.install('nested-copy', fixedSource);
  const nestedFolder = portable.folder('nested-copy', nestedCopy.id);
  fs.symlinkSync(external, path.join(nestedFolder, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(portable.remove('nested-copy', nestedCopy.id), true);
  assert.deepEqual(portable.list('nested-copy'), []);
  assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'untouched');
  fs.rmSync(movedFolder, { recursive: true });
  fs.symlinkSync(external, movedFolder, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => portable.folder('account-a', installed.id), /link|redirect|symbolic/i);
  assert.equal(portable.remove('account-a', installed.id), true, 'removing a root junction must remove only its link');
  assert.deepEqual(portable.list('account-a'), []);
  assert.equal(fs.existsSync(movedFolder), false);
  assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'untouched');
  assert.equal(portable.list('account-b')[0].id, other.id);
  assert.equal(fs.existsSync(fixedSource), true);
  {
  // Update: the copy takes the source folder's current files and keeps its ID, identity and enabled state.
  const fresh = new ExtensionsStore({ directory: path.join(root, 'Updates') });
  const live = fixture(), before = fresh.install('account-a', live);
  // Compared as real paths: a temp folder can be spelled with a short 8.3 name.
  assert.equal(fresh.list('account-a')[0].source, fs.realpathSync.native(live), 'the source folder is remembered');
  fresh.setEnabled('account-a', before.id, false);
  fs.writeFileSync(path.join(live, 'manifest.json'), JSON.stringify({ ...readManifest(live), version: '2.0.0' }));
  fs.writeFileSync(path.join(live, 'added.js'), 'new file'); fs.unlinkSync(path.join(live, 'worker.js'));
  fs.writeFileSync(path.join(live, 'worker.js'), 'globalThis.started = 2;');
  const after = fresh.update('account-a', before.id), copy = fresh.folder('account-a', before.id);
  assert.deepEqual([after.id, after.extensionId, after.version, after.enabled], [before.id, before.extensionId, '2.0.0', false]);
  assert.equal(readManifest(copy).key, before.manifest.key, 'a manifest without a key keeps the installed identity');
  assert.equal(fs.readFileSync(path.join(copy, 'worker.js'), 'utf8'), 'globalThis.started = 2;');
  assert.equal(fs.existsSync(path.join(copy, 'added.js')), true);
  assert.deepEqual(fs.readdirSync(accountFolder(path.join(root, 'Updates'), 'account-a')).sort(), [before.id, 'extensions.json'].sort(), 'no staging or previous copy is left');
  // Another folder can become the source; a different extension is refused and the copy survives.
  const relocated = fixture({ version: '2.1.0' });
  assert.equal(fresh.update('account-a', before.id, relocated).version, '2.1.0'); assert.equal(fresh.list('account-a')[0].source, fs.realpathSync.native(relocated));
  assert.throws(() => fresh.update('account-a', before.id, fixture({ key })), /different extension/);
  fs.writeFileSync(path.join(relocated, 'manifest.json'), '{broken');
  assert.throws(() => fresh.update('account-a', before.id), /Invalid extension manifest/);
  assert.equal(fresh.list('account-a')[0].version, '2.1.0'); assert.equal(readManifest(fresh.folder('account-a', before.id)).version, '2.1.0');
  // A keyed extension is recognised from its folder; a key-less one cannot be.
  const keyed = fixture({ key }), installed = fresh.install('account-a', keyed);
  assert.equal(fresh.match('account-a', keyed).id, installed.id); assert.equal(fresh.match('account-a', live), null);
  }
  console.log('PASS: portable extension copies, stable Chromium identities, account isolation, metadata preservation and filesystem validation');
} finally {
  // Every recursive cleanup target is the unique temporary tree created above.
  assert.equal(path.dirname(root), os.tmpdir());
  fs.rmSync(root, { recursive: true, force: true });
}
