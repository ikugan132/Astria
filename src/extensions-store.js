'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACCOUNT_ID = /^[A-Za-z0-9-]{1,80}$/;
const COPY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST = 1024 * 1024;
const MAX_METADATA = 16 * MAX_MANIFEST;
const VCS = new Set(['.git', '.svn', '.hg']);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (root, target) => { const relative = path.relative(root, target); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

// Check every ancestor: a junction in Save or an account must never redirect writes or deletion.
function checked(target, directory = false, create = false) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      fs.mkdirSync(current);
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink()) throw new Error('Extension path contains a symbolic link.');
    const real = fs.realpathSync.native(current);
    if (!samePath(real, current)) {
      // Windows can spell the same directory entry with a short 8.3 name.
      if (process.platform !== 'win32' || !/~[1-9]\d*(?:\.|$)/.test(parts[i]) ||
          !samePath(path.dirname(real), path.dirname(current))) throw new Error('Extension path contains a redirected folder.');
      const alias = fs.lstatSync(current, { bigint: true }), entry = fs.lstatSync(real, { bigint: true });
      if (alias.isSymbolicLink() || entry.isSymbolicLink() || alias.dev !== entry.dev || alias.ino !== entry.ino) throw new Error('Extension path contains a redirected folder.');
      current = real;
    }
    if ((i < parts.length - 1 || directory) && !stat.isDirectory()) throw new Error('Extension path must be a real directory.');
    if (i === parts.length - 1 && !directory && !stat.isFile()) throw new Error('Extension path must be a regular file.');
  }
  return current;
}

function readFile(file, limit) {
  checked(file);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    checked(file);
    const entry = fs.lstatSync(file);
    if (!stat.isFile() || !entry.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino || stat.size > limit) throw new Error('Extension file changed or exceeds the maximum size.');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const size = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (!size) throw new Error('Extension file changed while reading.');
      offset += size;
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, null)) throw new Error('Extension file changed while reading.');
    return buffer.toString('utf8');
  } finally { fs.closeSync(descriptor); }
}

function publicKey(manifest) {
  const value = manifest.key;
  if (typeof value !== 'string' || value.length > 32768) throw new Error('Manifest key must be a base64 RSA public key.');
  const compact = value.replace(/\s/g, '');
  if (!compact || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) throw new Error('Manifest key must be base64.');
  const der = Buffer.from(compact, 'base64');
  try {
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'rsa' || !key.export({ format: 'der', type: 'spki' }).equals(der)) throw new Error('Invalid RSA public key.');
  } catch (error) { throw new Error('Manifest key is not a valid RSA public key.', { cause: error }); }
  return der;
}

function extensionId(manifest) {
  return crypto.createHash('sha256').update(publicKey(manifest)).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
}

function validateManifest(manifest, folder) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || ![2, 3].includes(manifest.manifest_version)) throw new Error('Manifest must use manifest_version 2 or 3.');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 256) throw new Error('Manifest name is invalid.');
  if (typeof manifest.version !== 'string' || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(manifest.version)
    || manifest.version.split('.').some(value => Number(value) > 65535) || !manifest.version.split('.').some(Number)) throw new Error('Manifest version is invalid.');
  const strings = (values, name) => {
    if (!Array.isArray(values) || values.length > 1000 || values.some(value => typeof value !== 'string' || !value || value.length > 8192)) throw new Error(`Manifest ${name} must be an array of strings (maximum 1000).`);
  };
  for (const name of ['permissions', 'host_permissions']) {
    if (manifest[name] !== undefined) strings(manifest[name], name);
  }
  const entry = value => {
    if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Manifest entry path is invalid.');
    let decoded;
    try { decoded = decodeURIComponent(value); } catch { throw new Error('Manifest entry path has invalid encoding.'); }
    if (/[\\:%?#\0]/.test(decoded) || decoded.startsWith('/') || decoded.split('/').some(part => part === '..' || !part)) throw new Error('Manifest entry path must stay inside the extension folder.');
    if (folder) {
      const target = path.resolve(folder, decoded);
      if (!inside(folder, target)) throw new Error('Manifest entry path escapes the extension folder.');
      try { checked(target); } catch (error) { throw new Error(`Manifest entry file is unavailable: ${value}`, { cause: error }); }
    }
  };
  const object = (value, name) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Manifest ${name} is invalid.`); };
  const entries = values => { if (!Array.isArray(values)) throw new Error('Manifest entry file list is invalid.'); values.forEach(entry); };
  for (const name of ['background', 'action', 'browser_action', 'side_panel', 'options_ui']) {
    if (manifest[name] !== undefined) object(manifest[name], name);
  }
  for (const [name, field] of [['background', 'service_worker'], ['background', 'page'], ['action', 'default_popup'],
    ['browser_action', 'default_popup'], ['side_panel', 'default_path'], ['options_ui', 'page']]) {
    if (manifest[name]?.[field] !== undefined) entry(manifest[name][field]);
  }
  if (manifest.background?.scripts !== undefined) entries(manifest.background.scripts);
  if (manifest.options_page !== undefined) entry(manifest.options_page);
  if (manifest.content_scripts !== undefined) {
    if (!Array.isArray(manifest.content_scripts)) throw new Error('Manifest content_scripts is invalid.');
    for (const script of manifest.content_scripts) {
      object(script, 'content_scripts');
      strings(script.matches, 'content_scripts.matches');
      if (!script.matches.length) throw new Error('Manifest content_scripts.matches must not be empty.');
      if (script.exclude_matches !== undefined) strings(script.exclude_matches, 'content_scripts.exclude_matches');
      if (script.js !== undefined) entries(script.js);
      if (script.css !== undefined) entries(script.css);
    }
  }
  if (manifest.key !== undefined) publicKey(manifest);
  return manifest;
}

function scan(folder, skipVcs = true) {
  checked(folder, true);
  const directories = [folder];
  const files = [];
  let bytes = 0;
  let count = 0;
  while (directories.length) {
    const current = directories.pop();
    checked(current, true);
    for (const name of fs.readdirSync(current)) {
      if (skipVcs && VCS.has(name.toLowerCase())) continue;
      if (/[\\/:\0]/.test(name) || name === '.' || name === '..') throw new Error('Extension filename is invalid.');
      const source = path.join(current, name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || !samePath(fs.realpathSync.native(source), source)) throw new Error('Extension contains a symbolic link or redirected path.');
      if (++count > 20000) throw new Error('Extension contains too many files or folders.');
      if (stat.isDirectory()) directories.push(source);
      else {
        if (!stat.isFile()) throw new Error('Extension contains a non-regular file.');
        bytes += stat.size;
        if (bytes > MAX_BYTES) throw new Error('Extension exceeds the 100 MiB maximum size.');
        files.push({ source, stat, relative: path.relative(folder, source) });
        if (files.length > 10000) throw new Error('Extension exceeds the 10000 file limit.');
      }
    }
  }
  return files;
}

function copyFile(file, destination) {
  checked(file.source);
  const input = fs.openSync(file.source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let output;
  try {
    const stat = fs.fstatSync(input);
    if (!stat.isFile() || stat.dev !== file.stat.dev || stat.ino !== file.stat.ino || stat.size !== file.stat.size) throw new Error('Extension source file changed during installation.');
    output = fs.openSync(destination, 'wx');
    const buffer = Buffer.alloc(Math.min(stat.size || 1, 65536));
    let total = 0;
    while (total < stat.size) {
      const size = fs.readSync(input, buffer, 0, Math.min(buffer.length, stat.size - total), null);
      if (!size) throw new Error('Extension source file changed during installation.');
      let written = 0;
      while (written < size) written += fs.writeSync(output, buffer, written, size - written);
      total += size;
    }
    if (fs.readSync(input, buffer, 0, 1, null)) throw new Error('Extension source file changed during installation.');
  } finally {
    fs.closeSync(input);
    if (output !== undefined) fs.closeSync(output);
  }
}

// All methods are synchronous. Only portable records and copied extension files are persisted.
class ExtensionsStore {
  constructor({ directory } = {}) {
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('Extension store directory is required.');
    this.directory = checked(path.resolve(directory), true, true);
  }

  _account(accountId) {
    if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new Error('Invalid extension account ID.');
    checked(this.directory, true);
    const folder = `account-${crypto.createHash('sha256').update(accountId).digest('hex')}`;
    return checked(path.join(this.directory, folder), true, true);
  }

  list(accountId) {
    const file = path.join(this._account(accountId), 'extensions.json');
    try {
      const records = JSON.parse(readFile(file, MAX_METADATA));
      if (!Array.isArray(records)) throw new Error('Expected an array.');
      const ids = new Set();
      const extensionIds = new Set();
      for (const record of records) {
        if (!record || !COPY_ID.test(record.id) || ids.has(record.id) || typeof record.enabled !== 'boolean') throw new Error('Invalid record.');
        validateManifest(record.manifest);
        if (record.name !== record.manifest.name || record.version !== record.manifest.version || record.extensionId !== extensionId(record.manifest) || extensionIds.has(record.extensionId)) throw new Error('Invalid extension identity.');
        ids.add(record.id);
        extensionIds.add(record.extensionId);
      }
      return records.map(({ id, extensionId, name, version, enabled, manifest }) => ({ id, extensionId, name, version, enabled, manifest }));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error(`Extension metadata could not be read: ${error.message}`, { cause: error });
    }
  }

  _write(accountId, records) {
    const serialized = `${JSON.stringify(records, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_METADATA) throw new Error('Extension metadata exceeds the 16 MiB size limit.');
    const account = this._account(accountId);
    const file = path.join(account, 'extensions.json');
    if (fs.existsSync(file)) checked(file);
    const temporary = path.join(account, `.metadata-${crypto.randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'wx');
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      checked(account, true);
      fs.renameSync(temporary, file);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  install(accountId, sourceFolder) {
    const records = this.list(accountId);
    if (typeof sourceFolder !== 'string' || !sourceFolder.trim()) throw new Error('Extension source folder is required.');
    const source = checked(path.resolve(sourceFolder), true);
    if (inside(source, this.directory) || inside(this.directory, source)) throw new Error('Extension source and store folders must not overlap.');
    let manifest;
    try { manifest = validateManifest(JSON.parse(readFile(path.join(source, 'manifest.json'), MAX_MANIFEST)), source); }
    catch (error) { throw new Error(`Invalid extension manifest: ${error.message}`, { cause: error }); }
    const files = scan(source);
    if (manifest.key === undefined) {
      const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      manifest.key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    }
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    if (Buffer.byteLength(manifestContent) > MAX_MANIFEST) throw new Error('Copied extension manifest exceeds the 1 MiB size limit.');
    const copiedBytes = files.reduce((total, file) => total + (file.relative === 'manifest.json' ? Buffer.byteLength(manifestContent) : file.stat.size), 0);
    if (copiedBytes > MAX_BYTES) throw new Error('Copied extension exceeds the 100 MiB maximum size.');
    const record = { id: crypto.randomUUID(), extensionId: extensionId(manifest), name: manifest.name, version: manifest.version, enabled: true, manifest };
    if (records.some(value => value.extensionId === record.extensionId)) throw new Error('This extension is already installed in this account.');
    const account = this._account(accountId);
    const staging = path.join(account, `.install-${record.id}`);
    const destination = path.join(account, record.id);
    let owned = staging;
    fs.mkdirSync(staging);
    try {
      for (const file of files) {
        const target = path.join(staging, file.relative);
        checked(path.dirname(target), true, true);
        copyFile(file, target);
      }
      fs.writeFileSync(path.join(staging, 'manifest.json'), manifestContent, 'utf8');
      checked(account, true);
      fs.renameSync(staging, destination);
      owned = destination;
      this._write(accountId, [...records, record]);
      return record;
    } catch (error) {
      if (!inside(account, owned)) throw new Error('Extension cleanup path escapes its account.', { cause: error });
      checked(owned, true);
      fs.rmSync(owned, { recursive: true });
      throw error;
    }
  }

  _record(accountId, id) {
    if (typeof id !== 'string' || !COPY_ID.test(id)) throw new Error('Invalid extension ID.');
    const records = this.list(accountId);
    const record = records.find(value => value.id === id);
    if (!record) throw new Error('Unknown installed extension.');
    return { records, record };
  }

  folder(accountId, id) {
    const { record } = this._record(accountId, id);
    const folder = checked(path.join(this._account(accountId), id), true);
    scan(folder, false);
    try {
      const manifest = validateManifest(JSON.parse(readFile(path.join(folder, 'manifest.json'), MAX_MANIFEST)), folder);
      if (extensionId(manifest) !== record.extensionId) throw new Error('Extension identity changed.');
    } catch (error) {
      throw new Error('Installed extension manifest is invalid or its identity changed. Remove and reinstall this extension.', { cause: error });
    }
    return folder;
  }

  setEnabled(accountId, id, enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Extension enabled must be a boolean.');
    const { records, record } = this._record(accountId, id);
    record.enabled = enabled;
    this._write(accountId, records);
    return record;
  }

  remove(accountId, id) {
    const { records } = this._record(accountId, id);
    const account = this._account(accountId);
    const folder = path.join(account, id);
    const trash = path.join(account, `.remove-${id}-${crypto.randomUUID()}`);
    let renamed = false;
    try { fs.renameSync(folder, trash); renamed = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { this._write(accountId, records.filter(record => record.id !== id)); }
    catch (error) { if (renamed) fs.renameSync(trash, folder); throw error; }
    if (renamed) {
      if (!inside(account, trash)) throw new Error('Extension removal path escapes its account.');
      const stat = fs.lstatSync(trash);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fs.unlinkSync(trash);
      else {
        checked(trash, true);
        // Node removes child links themselves, including Windows junctions, without visiting their targets.
        fs.rmSync(trash, { recursive: true });
      }
    }
    return true;
  }
}

module.exports = { ExtensionsStore };
