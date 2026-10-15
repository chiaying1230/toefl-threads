// Canonical promotion of an APPROVED Studio bundle (separate authorization; never part of the automatic chain).
//
// Windows / NTFS cannot install files into several directories atomically. This is therefore NOT presented as atomic:
//   PREPARED  fresh approval + frozen denylist + destination inventory + bundle hash, journaled in the coordinator DB
//   STAGED    every file copied into a private staging dir on the same volume and hash-checked
//   INSTALLING  each file installed with a no-replace hard link (never an overwrite), intent journaled before each one
//   READY_TO_PUBLISH  every canonical file re-hashed, nothing missing
//   COMMITTED the commit marker docs/<id>-auto/studio-publication.json is linked in last: it is the linearization point.
// Cooperating readers (Studio) treat a bundle as canonical only through the marker; raw CLIs / IDEs can still see the
// physical partial files during the window, which is why the publication gate blocks Studio production while a journal is open.
// Recovery never overwrites and only removes files this transaction provably created (same file id + hash, not frozen).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LifetimeLock, now } from './coordinator.mjs';
import { assertSafeRelative, caseKey, fileEvidence, jsonHash } from './hashing.mjs';
import { StudioError } from './state-contract.mjs';

const OPEN_STATES = ['PREPARED', 'STAGED', 'INSTALLING', 'READY_TO_PUBLISH'];
const ALLOWED = [/^scripts\/video\/episodes\/[a-z0-9-]+-auto\.json$/, /^scripts\/video\/narration\/[a-z0-9-]+(\.manifest)?\.json$/, /^scripts\/video\/narration\/alignment\/[a-f0-9]{32}\.json$/, /^docs\/[a-z0-9-]+-auto\/[a-z0-9._-]+$/, /^outputs\/[a-z0-9._-]+\.mp4$/];

/** Every path any FROZEN.json protects (all hash groups and revisions), plus the frozen docs folders. Malformed = fail closed. */
export function frozenInventory(root) {
  const files = new Set(), folders = new Set(), sources = [];
  const docs = path.join(root, 'docs');
  if (!fs.existsSync(docs)) return { files, folders, sources };
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new StudioError(`Reparse point in docs: ${p}`, 409);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (e.isFile() && e.name === 'FROZEN.json') {
        let frozen;
        try { frozen = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw new StudioError(`FROZEN.json 無法解析：${p}；promotion fail closed`, 409); }
        if (!frozen.hashes || typeof frozen.hashes !== 'object') throw new StudioError(`FROZEN.json 缺少 hashes：${p}`, 409);
        const rel = path.relative(root, p).split(path.sep).join('/');
        sources.push(rel); files.add(caseKey(rel)); folders.add(caseKey(path.posix.dirname(rel) + '/'));
        const groups = [frozen.hashes, ...(frozen.revisions || []).map(r => ({ templateAndPipeline: r.templateAndPipeline || {} }))];
        for (const g of groups) for (const set of Object.values(g)) for (const f of Object.keys(set || {})) files.add(caseKey(f));
      }
    }
  };
  walk(docs, 0);
  return { files, folders, sources };
}
export function deniedReason(relative, inventory) {
  try { assertSafeRelative(relative); } catch (e) { return e.message; }
  const key = caseKey(relative);
  if (inventory.files.has(key)) return 'frozen reference 檔案';
  if ([...inventory.folders].some(f => key.startsWith(f))) return 'frozen reference 資料夾';
  if (!ALLOWED.some(r => r.test(relative))) return 'shared code / 不在 promotion allowlist 的路徑（永久拒絕）';
  return null;
}
const realParentInside = (root, relative) => {
  let current = fs.realpathSync(root);
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return true;
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || fs.realpathSync(current) !== current || !st.isDirectory()) return false;
  }
  return true;
};

export function publicationGateOpen(coordinator) {
  const open = coordinator.get(`SELECT tx_id, state FROM publications WHERE state IN (${OPEN_STATES.map(() => '?').join(',')}, 'BROKEN')`, ...OPEN_STATES);
  return open ? { open: false, reason: `publication ${open.tx_id} 狀態 ${open.state}；需先完成 / 恢復` } : { open: true };
}

/** Preview: every target path, its hash, create / reuse / blocked, and the risks. Read-only. */
export function promotionPreview({ root, manifest }) {
  const inventory = frozenInventory(root), problems = [], targets = [], seen = new Map();
  for (const a of manifest.artifacts) {
    const dest = a.canonical, key = caseKey(dest);
    if (seen.has(key)) problems.push({ code: 'DESTINATION_ALIAS', message: `${dest} 與 ${seen.get(key)} 是同一路徑（大小寫 / alias）` });
    seen.set(key, dest);
    const denied = deniedReason(dest, inventory);
    if (denied) { targets.push({ ...a, action: 'blocked', reason: denied }); problems.push({ code: 'DESTINATION_DENIED', message: `${dest}: ${denied}` }); continue; }
    if (!realParentInside(root, dest)) { targets.push({ ...a, action: 'blocked', reason: 'parent 是 junction / symlink' }); problems.push({ code: 'REPARSE_POINT', message: dest }); continue; }
    const abs = path.join(root, ...dest.split('/'));
    if (fs.existsSync(abs)) {
      const same = fileEvidence(abs).bytesHash === a.bytesHash;
      if (same && /^scripts\/video\/narration\/alignment\//.test(dest)) targets.push({ ...a, action: 'reuse', reason: '相同 hash 的 alignment 已存在（不寫入，只引用）' });
      else { targets.push({ ...a, action: 'blocked', reason: same ? '目的地已存在（不覆寫）' : '目的地已存在且內容不同' }); problems.push({ code: 'DESTINATION_EXISTS', message: dest }); }
      continue;
    }
    targets.push({ ...a, action: 'create' });
  }
  const marker = `docs/${manifest.contentId}-auto/studio-publication.json`;
  if (fs.existsSync(path.join(root, ...marker.split('/')))) problems.push({ code: 'MARKER_EXISTS', message: marker });
  return { ok: !problems.length, targets, marker, problems, frozenSources: inventory.sources, risks: ['跨多個資料夾的安裝不是原子操作；commit marker 之前的檔案不算 canonical。', 'Promotion 期間 Studio 的製作會被 publication gate 阻擋；請勿同時執行原始 CLI。', '不會建立 FROZEN.json、不 freeze、不 stage / commit / push / tag。'] };
}

/**
 * Run the transaction. `source(target)` returns the sealed absolute file for a target; `fresh()` re-checks approval / revision
 * and throws when stale. `faults` lets tests stop at any gap ({ at: 'staged' | 'install:<n>' | 'ready' | 'committed-before-db' }).
 */
export function promote({ coordinator, root, stagingRoot, lockDir, manifest, approval, source, fresh, faults = {} }) {
  const lock = LifetimeLock.acquire(path.join(lockDir, 'publication.lock'), 'Canonical publication');
  try {
    const gate = publicationGateOpen(coordinator); if (!gate.open) throw new StudioError(gate.reason, 409);
    fresh();
    const preview = promotionPreview({ root, manifest });
    if (!preview.ok) throw Object.assign(new StudioError(`Promotion BLOCK：${preview.problems.map(p => p.message).join('；')}`, 409), { problems: preview.problems });
    const txId = randomUUID(), bundleHash = jsonHash(manifest), staging = path.join(stagingRoot, txId);
    const journal = { txId, bundleHash, approvalHash: approval.receiptHash, contentId: manifest.contentId, marker: preview.marker, staging, targets: preview.targets.map(t => ({ canonical: t.canonical, bytesHash: t.bytesHash, size: t.size, action: t.action, intent: false, installed: false, fileId: null })), createdDirs: [] };
    const save = state => coordinator.run('UPDATE publications SET state = ?, journal = ?, updated_at = ? WHERE tx_id = ?', state, JSON.stringify(journal), now(), txId);
    coordinator.run('INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?, ?)', txId, manifest.candidateId, bundleHash, 'PREPARED', now(), now(), JSON.stringify(journal));
    // STAGED
    fs.mkdirSync(staging, { recursive: true });
    for (const [k, t] of journal.targets.entries()) {
      if (t.action !== 'create') continue;
      const to = path.join(staging, `${k}`), data = fs.readFileSync(source(preview.targets[k]));
      if (fileEvidence(source(preview.targets[k])).bytesHash !== t.bytesHash) throw new StudioError(`Sealed artifact changed: ${t.canonical}`, 409);
      const fd = fs.openSync(to, 'wx'); fs.writeSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd);
    }
    const markerBody = { version: 1, kind: 'studio-publication', txId, bundleHash, approvalHash: approval.receiptHash, contentId: manifest.contentId, committedAt: null, files: journal.targets.map(t => ({ path: t.canonical, bytesHash: t.bytesHash, size: t.size, action: t.action })), note: '只有這份 marker 存在且所有 hash 相符時，這組檔案才是 Studio canonical publication。不是 FROZEN、不是 freeze。' };
    save('STAGED');
    if (faults.at === 'staged') throw Object.assign(new Error('fault injected after STAGED'), { fault: true });
    // INSTALLING
    save('INSTALLING');
    let n = 0;
    for (const [k, t] of journal.targets.entries()) {
      if (t.action !== 'create') continue;
      fresh();
      const inv = frozenInventory(root);
      if (deniedReason(t.canonical, inv) || !realParentInside(root, t.canonical)) throw new StudioError(`安裝前重新檢查拒絕：${t.canonical}`, 409);
      const dest = path.join(root, ...t.canonical.split('/'));
      let dir = path.dirname(dest); const missing = [];
      while (!fs.existsSync(dir)) { missing.unshift(dir); dir = path.dirname(dir); }
      for (const d of missing) { fs.mkdirSync(d); journal.createdDirs.push(path.relative(root, d).split(path.sep).join('/')); }
      t.intent = true; save('INSTALLING');
      if (faults.at === `install:${n}`) throw Object.assign(new Error(`fault injected before install ${n}`), { fault: true });
      fs.linkSync(path.join(staging, `${k}`), dest); // no-replace: fails with EEXIST, never overwrites
      if (fileEvidence(dest).bytesHash !== t.bytesHash) throw new StudioError(`安裝後 hash 不符：${t.canonical}`, 409);
      t.installed = true; t.fileId = String(fs.statSync(dest, { bigint: true }).ino); save('INSTALLING');
      n++;
    }
    // READY_TO_PUBLISH
    for (const t of journal.targets) { const abs = path.join(root, ...t.canonical.split('/')); if (!fs.existsSync(abs) || fileEvidence(abs).bytesHash !== t.bytesHash) throw new StudioError(`READY 檢查失敗：${t.canonical}`, 409); }
    fresh();
    save('READY_TO_PUBLISH');
    if (faults.at === 'ready') throw Object.assign(new Error('fault injected at READY_TO_PUBLISH'), { fault: true });
    // COMMITTED: the marker is linked last (no-replace); it is the linearization point
    markerBody.committedAt = now();
    const markerStage = path.join(staging, 'marker.json');
    fs.writeFileSync(markerStage, JSON.stringify(markerBody, null, 2) + '\n', { flag: 'wx' });
    fs.linkSync(markerStage, path.join(root, ...preview.marker.split('/')));
    if (faults.at === 'committed-before-db') throw Object.assign(new Error('fault injected after marker, before DB'), { fault: true });
    save('COMMITTED');
    fs.rmSync(staging, { recursive: true, force: true });
    return { txId, state: 'COMMITTED', marker: preview.marker, installed: journal.targets.filter(t => t.installed).map(t => t.canonical), reused: journal.targets.filter(t => t.action === 'reuse').map(t => t.canonical) };
  } catch (e) {
    // an ordinary failure rolls back at once; an injected crash (tests) leaves the journal for startup recovery, like a real crash
    lock.release();
    if (!e.fault) recoverPublications({ coordinator, root, lockDir });
    throw e;
  } finally { lock.release(); }
}

/** Startup / before any production: finish or undo every open journal. Never overwrites; unclear ownership = BROKEN (manual). */
export function recoverPublications({ coordinator, root, lockDir }) {
  const open = coordinator.all(`SELECT * FROM publications WHERE state IN (${OPEN_STATES.map(() => '?').join(',')})`, ...OPEN_STATES);
  if (!open.length) return [];
  const lock = LifetimeLock.acquire(path.join(lockDir, 'publication.lock'), 'Canonical publication recovery');
  const results = [];
  try {
    for (const row of open) {
      const j = JSON.parse(row.journal), markerAbs = path.join(root, ...j.marker.split('/'));
      const set = (state, extra = {}) => { coordinator.run('UPDATE publications SET state = ?, journal = ?, updated_at = ? WHERE tx_id = ?', state, JSON.stringify({ ...j, ...extra }), now(), row.tx_id); results.push({ txId: row.tx_id, state, ...extra }); };
      if (fs.existsSync(markerAbs)) {
        let marker = null; try { marker = JSON.parse(fs.readFileSync(markerAbs, 'utf8')); } catch { /* broken */ }
        const intact = marker?.txId === row.tx_id && marker.files.every(f => { const a = path.join(root, ...f.path.split('/')); return fs.existsSync(a) && fileEvidence(a).bytesHash === f.bytesHash; });
        if (intact) { set('COMMITTED', { recovered: 'roll-forward: marker 與所有檔案一致' }); fs.rmSync(j.staging, { recursive: true, force: true }); }
        else set('BROKEN', { recovered: 'marker 存在但檔案缺少 / 被修改；需要人工處理，不自動覆寫或刪除' });
        continue;
      }
      // no marker: roll back only what this transaction provably created
      const inventory = frozenInventory(root), blocked = [];
      for (const [k, t] of j.targets.entries()) {
        if (t.action !== 'create' || !t.intent) continue;
        const dest = path.join(root, ...t.canonical.split('/'));
        if (!fs.existsSync(dest)) continue;
        const staged = path.join(j.staging, `${k}`);
        const ino = String(fs.statSync(dest, { bigint: true }).ino);
        const ours = fileEvidence(dest).bytesHash === t.bytesHash && (t.fileId ? t.fileId === ino : fs.existsSync(staged) && String(fs.statSync(staged, { bigint: true }).ino) === ino);
        if (!ours || deniedReason(t.canonical, inventory)) { blocked.push(t.canonical); continue; }
        fs.unlinkSync(dest);
      }
      for (const d of [...j.createdDirs].reverse()) { const abs = path.join(root, ...d.split('/')); try { if (fs.existsSync(abs) && !fs.readdirSync(abs).length) fs.rmdirSync(abs); } catch { /* keep */ } }
      if (blocked.length) set('BROKEN', { recovered: `所有權不明，未刪除：${blocked.join(', ')}` });
      else { set('ROLLED_BACK', { recovered: 'rollback：只移除本 transaction 建立的檔案' }); fs.rmSync(j.staging, { recursive: true, force: true }); }
    }
  } finally { lock.release(); }
  return results;
}
