import { constants, lstatSync, realpathSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { resolve, relative, dirname, basename, sep, isAbsolute } from 'node:path';
import { InputError, requireInput as need } from './errors.mjs';

const LIMIT = 512 * 1024;
export function reader(root) {
  let base;
  try {
    base = resolve(root);
    need(lstatSync(base).isDirectory() && !lstatSync(base).isSymbolicLink(), 'UNSAFE_ROOT', 'Root must be a real directory.');
    base = realpathSync(base);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('INVALID_ROOT', 'Cannot access the selected root.');
  }
  function selected(file) {
    need(typeof file === 'string' && file.length > 0 && file.length < 2048 && !isAbsolute(file) && !/[\\\x00-\x1f]/.test(file), 'UNSAFE_PATH', 'Input paths must be relative to the selected root.');
    need(!file.split('/').includes('..'), 'UNSAFE_PATH', 'Parent traversal is unsupported.');
    const full = resolve(base, file);
    need(full !== base && !relative(base, full).startsWith(`..${sep}`), 'UNSAFE_PATH', 'Input must remain within the selected root.');
    let current = base;
    const parts = relative(base, full).split(sep);
    for (let i = 0; i < parts.length; i++) {
      current = resolve(current, parts[i]);
      const stat = lstatSync(current);
      need(!stat.isSymbolicLink(), 'UNSAFE_PATH', 'Symlinks in input paths are unsupported.');
      need(i === parts.length - 1 ? stat.isFile() : stat.isDirectory(), 'UNSAFE_PATH', 'Input must be a regular file under real directories.');
    }
    return full;
  }
  function read(file) {
    let fd;
    try {
      const full = selected(file);
      fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = fstatSync(fd);
      need(before.isFile() && before.size <= LIMIT, 'INPUT_LIMIT', 'Input is not a bounded regular file.');
      const buffer = Buffer.alloc(LIMIT + 1); let length = 0;
      while (length < buffer.length) {
        const n = readSync(fd, buffer, length, buffer.length - length, null);
        if (!n) break; length += n;
      }
      const after = fstatSync(fd);
      const now = lstatSync(selected(file));
      need(before.dev === now.dev && before.ino === now.ino && before.size === after.size && before.mtimeMs === after.mtimeMs, 'INPUT_CHANGED', 'Input changed during the audit.');
      need(length <= LIMIT, 'INPUT_LIMIT', 'Input exceeds 512 KiB.');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
      catch { throw new InputError('INVALID_ENCODING', 'Only UTF-8 text inputs are supported.'); }
    } catch (error) {
      if (error instanceof InputError) throw error;
      throw new InputError('INPUT_UNREADABLE', 'A selected input is missing or unreadable.');
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  function checkStatic(config) {
    need(basename(config) === 'app.json', 'UNSUPPORTED_CONFIG', 'Select a static app.json file.');
    read(config); // Validate containment before probing sibling names.
    for (const name of ['app.config.json', ...['js', 'ts', 'mjs', 'cjs', 'mts', 'cts'].map(ext => `app.config.${ext}`)]) {
      try {
        lstatSync(resolve(base, dirname(config), name));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new InputError('INPUT_UNREADABLE', 'Cannot establish static configuration authority.');
      }
      throw new InputError('UNSUPPORTED_CONFIG', 'A competing or executable app config exists; it was not loaded.');
    }
  }
  return { read, checkStatic };
}
