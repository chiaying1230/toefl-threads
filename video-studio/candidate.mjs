// Isolated production candidate workspace.
//
// candidates/<candidateId>/
//   engine/      byte-identical copy of the allowlisted pipeline closure (scripts/video/...), sealed read-only
//   inputs/      sealed snapshots: decisions, compiled narration / episode, validation, voice plan, envelope ...
//   sealed/<step>/<attemptId>/...   outputs of a successful step, read-only, hashed in the step result
//   attempts/<step>/<attemptId>/root/   a fresh materialized repo root for one tool run (engine + predecessor outputs)
//
// The copied scripts keep their relative imports, so voice/config.mjs resolves REPO_ROOT to the attempt root: every
// default path of the existing tools (voice-cache, narration/alignment, docs/<id>-auto, outputs) lands inside the attempt.
// Nothing here writes the real repository. .env, .git, frozen episode assets and unrelated files are never copied.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertInside, assertSafeRelative, bufferHash, fileEvidence, jsonHash, writeExclusive, writeJsonExclusive, HASH_FORMAT } from './hashing.mjs';
import { StudioError } from './state-contract.mjs';

export const ENGINE_CLOSURE = Object.freeze([
  'scripts/video/post-reference.html',
  ...['PostTemplate.js', 'Components.js', 'ReadingCue.js', 'Phrase.js', 'Header.js', 'post.css', 'outro.css'].map(f => `scripts/video/reference/${f}`),
  'scripts/video/components/Mascot.js',
  ...['align', 'assemble', 'audio', 'cache', 'config', 'elevenlabs', 'episode-refs', 'generate', 'segments', 'split'].map(f => `scripts/video/voice/${f}.mjs`),
  ...['render-lib', 'render-episode', 'audio-mix', 'verify-episode', 'assemble', 'fit-camera'].map(f => `scripts/video/${f}.mjs`),
  'scripts/video/voices.json', 'scripts/video/series.json',
  'scripts/video/assets/social-soft-groove.wav', 'scripts/video/assets/answer-correct.wav',
]);

/** Hashes of the closure as it is in `root` now. Missing files make the manifest invalid (fail closed). */
export function engineManifest(root) {
  const files = ENGINE_CLOSURE.map(relative => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw new StudioError(`Pipeline file missing or aliased: ${relative}`, 409);
    return { path: relative, ...fileEvidence(file) };
  });
  return { version: 1, hashFormat: HASH_FORMAT.bytes, files, hash: jsonHash(files) };
}
export const engineDrift = (root, manifest) => {
  try { const now = engineManifest(root); return now.hash === manifest.hash ? null : now.files.filter((f, i) => f.bytesHash !== manifest.files[i]?.bytesHash).map(f => f.path); }
  catch (e) { return [e.message]; }
};

const readOnly = file => { try { fs.chmodSync(file, 0o444); } catch { /* best effort; hashes are the real guard */ } };
const copyVerified = (from, to, expected, base) => {
  const data = fs.readFileSync(from);
  if (bufferHash(data) !== expected) throw new StudioError(`Hash mismatch while materializing ${path.basename(from)}`, 409);
  writeExclusive(base, to, data);
};

/** The trusted expected closure (file list + root hash) must come from OUTSIDE the snapshot (the coordinator's run row). */
export function assertTrustedEngine(expected) {
  if (!expected || !Array.isArray(expected.files) || typeof expected.hash !== 'string') throw new StudioError('沒有可信的 pipeline closure 紀錄（舊 run 或紀錄缺失）；fail closed', 409);
  if (jsonHash(expected.files) !== expected.hash) throw new StudioError('可信 closure 紀錄本身不一致（root hash ≠ files）', 409);
  if (JSON.stringify(expected.files.map(f => f.path)) !== JSON.stringify(ENGINE_CLOSURE)) throw new StudioError('可信 closure 紀錄的檔案集合不是 allowlist', 409);
  return expected;
}
const listFiles = (dir, base = dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isSymbolicLink()) return [`${path.relative(base, p).split(path.sep).join('/')} (reparse point)`];
  return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
}) : [];

export class Candidate {
  /** `expectedEngine` = the trusted closure record from the run row; the snapshot's own manifest file is never the authority. */
  constructor(productionDir, candidateId, expectedEngine = null) {
    if (!/^[a-f0-9-]{36}$/.test(candidateId)) throw new StudioError('Invalid candidate id');
    this.productionDir = productionDir; this.id = candidateId; this.expectedEngine = expectedEngine;
    this.dir = path.join(productionDir, 'candidates', candidateId);
  }
  static create(productionDir, repoRoot) {
    const c = new Candidate(productionDir, randomUUID());
    fs.mkdirSync(path.join(productionDir, 'candidates'), { recursive: true });
    fs.mkdirSync(c.dir);
    const manifest = engineManifest(repoRoot);
    // copy bytes as they are (no LF / CRLF normalization), verify each copy against the manifest
    for (const f of manifest.files) { copyVerified(path.join(repoRoot, f.path), path.join(c.dir, 'engine', f.path), f.bytesHash, c.dir); readOnly(path.join(c.dir, 'engine', f.path)); }
    const manifestRef = c.writeInput('engine-manifest.json', manifest);
    c.expectedEngine = { files: manifest.files, hash: manifest.hash };
    c.verifyEngine();
    return { candidate: c, engine: manifest, manifestRef };
  }
  rel(file) { return path.relative(this.dir, file).split(path.sep).join('/'); }
  abs(relative) { assertSafeRelative(relative); return assertInside(this.dir, path.join(this.dir, ...relative.split('/'))); }
  writeInput(name, value) {
    const file = path.join(this.dir, 'inputs', name);
    const evidence = Buffer.isBuffer(value) ? writeExclusive(this.dir, file, value) : writeJsonExclusive(this.dir, file, value);
    readOnly(file);
    return { path: this.rel(file), ...evidence };
  }
  readInput(ref) { return this.readJson(ref); }
  verify(ref) {
    const file = this.abs(ref.path);
    if (!fs.existsSync(file)) throw new StudioError(`Sealed artifact missing: ${ref.path}`, 409);
    const now = fileEvidence(file);
    if (now.bytesHash !== ref.bytesHash || now.size !== ref.size) throw new StudioError(`Sealed artifact changed: ${ref.path}`, 409);
    return file;
  }
  readJson(ref) { return JSON.parse(fs.readFileSync(this.verify(ref), 'utf8')); }
  /**
   * Transitive integrity: verify the artifact and, when it is JSON, every candidate artifact ref it contains ({ path, bytesHash, size }),
   * recursively (a voice bundle → its MP3 / alignment pairs; a review bundle → every included artifact). Returns a digest over the
   * whole verified graph, so any nested change changes the identity of everything that includes it.
   */
  verifyDeep(ref, seen = new Map()) {
    if (seen.has(ref.path)) { if (seen.get(ref.path) !== ref.bytesHash) throw new StudioError(`Artifact graph 自相矛盾：${ref.path}`, 409); return ref.bytesHash; }
    const file = this.verify(ref);
    seen.set(ref.path, ref.bytesHash);
    const children = [];
    if (file.endsWith('.json')) {
      const walk = v => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (!v || typeof v !== 'object') return;
        // only candidate-owned artifacts are refs; repo-relative paths (e.g. the engine file list) are checked by verifyEngine
        if (typeof v.path === 'string' && typeof v.bytesHash === 'string' && typeof v.size === 'number' && /^(?:inputs|voice|sealed|attempts)[/]/.test(v.path)) children.push([v.path, this.verifyDeep(v, seen)]);
        for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x);
      };
      walk(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    return children.length ? jsonHash({ self: ref.bytesHash, children }) : ref.bytesHash;
  }
  /** The trusted closure, never read from the snapshot. */
  engine() { return assertTrustedEngine(this.expectedEngine); }
  /** Recompute every copied byte and the exact file set against the trusted record (an edited copy + edited manifest still fails). */
  verifyEngine() {
    const expected = this.engine(), actual = listFiles(path.join(this.dir, 'engine')).sort(), want = expected.files.map(f => f.path).sort();
    if (JSON.stringify(actual) !== JSON.stringify(want)) throw new StudioError(`Pipeline 副本的檔案集合被改變：${actual.filter(f => !want.includes(f)).concat(want.filter(f => !actual.includes(f))).join(', ')}`, 409);
    for (const f of expected.files) {
      const now = fileEvidence(path.join(this.dir, 'engine', ...f.path.split('/')));
      if (now.bytesHash !== f.bytesHash || now.size !== f.size) throw new StudioError(`Pipeline 副本被修改：${f.path}`, 409);
    }
    return expected;
  }
  /** One verified engine file (e.g. voices.json) read from the snapshot. */
  engineFile(relative) {
    const f = this.engine().files.find(x => x.path === relative);
    if (!f) throw new StudioError(`Not in the pipeline closure: ${relative}`);
    const data = fs.readFileSync(path.join(this.dir, 'engine', ...relative.split('/')));
    if (bufferHash(data) !== f.bytesHash) throw new StudioError(`Pipeline 副本被修改：${relative}`, 409);
    return data;
  }

  /** A fresh repo-shaped root for one tool run: the sealed engine plus the given sealed artifacts at their pipeline paths. */
  attemptRoot(step, attemptId, placements = []) {
    const root = path.join(this.dir, 'attempts', step, attemptId, 'root');
    fs.mkdirSync(root, { recursive: true });
    this.verifyEngine(); // exact set + every byte, against the trusted record, before anything can execute
    for (const f of this.engine().files) copyVerified(path.join(this.dir, 'engine', f.path), path.join(root, f.path), f.bytesHash, this.dir);
    for (const p of placements) { assertSafeRelative(p.as); copyVerified(this.verify(p.ref), path.join(root, ...p.as.split('/')), p.ref.bytesHash, this.dir); }
    return root;
  }
  /** Copy step outputs into sealed/<step>/<attemptId>/ (exclusive, read-only) and return their evidence. */
  seal(step, attemptId, files) {
    return files.map(({ role, from, as }) => {
      assertSafeRelative(as);
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) throw new StudioError(`Step output missing: ${role}`, 409);
      const to = path.join(this.dir, 'sealed', step, attemptId, ...as.split('/'));
      const evidence = writeExclusive(this.dir, to, fs.readFileSync(from));
      readOnly(to);
      return { role, path: this.rel(to), as, ...evidence };
    });
  }
  sealJson(step, attemptId, role, as, value) {
    const to = path.join(this.dir, 'sealed', step, attemptId, ...assertSafeRelative(as).split('/'));
    const evidence = writeJsonExclusive(this.dir, to, value); readOnly(to);
    return { role, path: this.rel(to), as, ...evidence };
  }
}

/** Studio-owned content-addressed voice store: validated MP3 + alignment pairs, never overwritten. */
export class VoiceStore {
  constructor(productionDir) { this.dir = path.join(productionDir, 'voice-store'); fs.mkdirSync(this.dir, { recursive: true }); }
  paths(hash) { if (!/^[a-f0-9]{32}$/.test(hash)) throw new StudioError('Invalid segment hash'); return { audio: path.join(this.dir, `${hash}.mp3`), alignment: path.join(this.dir, `${hash}.json`) }; }
  has(hash) { const p = this.paths(hash); return fs.existsSync(p.audio) && fs.existsSync(p.alignment); }
  /** Publish a validated pair. Same bytes again = no-op; different bytes for the same hash = collision (stop). */
  publish(hash, audio, alignmentBytes) {
    const p = this.paths(hash);
    for (const [file, data] of [[p.audio, audio], [p.alignment, alignmentBytes]]) {
      if (fs.existsSync(file)) { if (bufferHash(fs.readFileSync(file)) !== bufferHash(data)) throw new StudioError(`Voice store collision for ${hash}: different bytes already sealed`, 409); continue; }
      writeExclusive(this.dir, file, data); readOnly(file);
    }
  }
}
