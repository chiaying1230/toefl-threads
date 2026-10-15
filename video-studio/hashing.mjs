// Evidence hashes for 2B. Two different things, never mixed:
//   bytesHash(file / buffer)  – SHA-256 of the exact bytes (+ length), for artifacts on disk
//   jsonHash(value)           – SHA-256 of a fixed canonical serialization (sorted keys), for decisions / manifests
// Both carry their algorithm / format version so evidence written today can be re-checked later.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const HASH_FORMAT = { bytes: 'sha256-bytes-v1', json: 'sha256-canonical-json-v1' };
const sha = data => createHash('sha256').update(data).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Non-finite number in canonical JSON');
  return JSON.stringify(value ?? null);
}
export const jsonHash = value => `sha256:${sha(canonical(value))}`;
export const bufferHash = buffer => `sha256:${sha(buffer)}`;
export function fileEvidence(file) {
  const data = fs.readFileSync(file);
  return { bytesHash: bufferHash(data), size: data.length };
}
export const fileHash = file => fileEvidence(file).bytesHash;

// Relative paths inside manifests: forward slashes, no traversal, no Windows aliases. Rejected, never normalized away.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
export function assertSafeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 400) throw Error(`Unsafe path: ${relative}`);
  if (relative.includes('\\') || relative.startsWith('/') || /^[a-z]:/i.test(relative) || relative.includes('\0')) throw Error(`Unsafe path: ${relative}`);
  for (const part of relative.split('/')) {
    if (!part || part === '.' || part === '..' || part.includes(':') || /[<>"|?*]/.test(part) || /[. ]$/.test(part) || RESERVED.test(part)) throw Error(`Unsafe path segment in ${relative}`);
  }
  return relative;
}
export const caseKey = relative => relative.normalize('NFC').toLowerCase();

/** Refuses symlinks, junctions and any component that resolves outside `base`. */
export function assertInside(base, file) {
  const realBase = fs.realpathSync(base);
  const relative = path.relative(realBase, path.resolve(file));
  if (!relative) return path.resolve(file);
  if (path.isAbsolute(relative)) throw Error(`Path escapes ${base}: ${file}`);
  let current = realBase;
  for (const part of relative.split(path.sep)) {
    if (!part || part === '..') throw Error(`Path escapes ${base}: ${file}`);
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || fs.realpathSync(current) !== current) throw Error(`Refusing reparse point / alias: ${current}`);
  }
  return path.resolve(file);
}

/** Exclusive create (never overwrites), creating only directories inside `base`. */
export function writeExclusive(base, file, data) {
  assertInside(base, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertInside(base, path.dirname(file));
  const fd = fs.openSync(file, 'wx');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  return fileEvidence(file);
}
export const writeJsonExclusive = (base, file, value) => writeExclusive(base, file, JSON.stringify(value, null, 2) + '\n');
