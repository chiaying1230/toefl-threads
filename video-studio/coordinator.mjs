// Durable 2B coordinator: one local SQLite database (transactions, FULL durability) plus OS lifetime locks.
//
// A lifetime lock is a SQLite file held in an open EXCLUSIVE transaction. The operating system releases it when the
// holding process ends (crash included); it is never released by a timer, a PID or a modification time.
// The database records runs / steps / receipts / paid attempts / reviews / publication journals. Draft JSON stays the
// authority for human decisions; the database only stores decision hashes and immutable snapshot references.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { StudioError } from './state-contract.mjs';

export const now = () => new Date().toISOString();

export class LifetimeLock {
  static acquire(file, label) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file, { timeout: 0 });
    try {
      db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS holder(pid INTEGER, label TEXT, at TEXT)');
      db.exec('BEGIN EXCLUSIVE');
      db.prepare('DELETE FROM holder').run();
      db.prepare('INSERT INTO holder VALUES (?, ?, ?)').run(process.pid, label, now());
    } catch (e) {
      try { db.close(); } catch { /* already closed */ }
      throw new StudioError(`${label} 已被另一個仍在執行的 process 持有；不接管（${e.message}）`, 409);
    }
    const lock = new LifetimeLock(); lock.db = db; lock.file = file; lock.label = label; return lock;
  }
  release() { if (!this.db) return; try { this.db.exec('ROLLBACK'); } catch { /* nothing open */ } this.db.close(); this.db = null; }
}

/** Run `fn` while holding a lifetime lock; refuses (does not wait) when another process holds it. */
export async function withLock(file, label, fn) {
  const lock = LifetimeLock.acquire(file, label);
  try { return await fn(); } finally { lock.release(); }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS runs(run_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, revision INTEGER NOT NULL, decision_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL, wf_run_id TEXT NOT NULL, candidate_id TEXT NOT NULL UNIQUE, created_at TEXT, updated_at TEXT,
  milestone TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, epoch INTEGER NOT NULL DEFAULT 0, inputs TEXT NOT NULL, capability_profile TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_draft ON runs(draft_id);
CREATE TABLE IF NOT EXISTS steps(attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT,
  finished_at TEXT, input_hash TEXT, result TEXT, fencing INTEGER, child_pids TEXT);
CREATE TABLE IF NOT EXISTS challenges(challenge_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL, envelope_hash TEXT NOT NULL, created_at TEXT,
  expires_at TEXT NOT NULL, consumed_at TEXT, recovery_of TEXT);
CREATE TABLE IF NOT EXISTS receipts(receipt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, execution_id TEXT NOT NULL UNIQUE,
  challenge_hash TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL,
  envelope_hash TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT, expires_at TEXT NOT NULL, receipt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS executions(execution_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, receipt_id TEXT NOT NULL UNIQUE, sequence INTEGER NOT NULL,
  status TEXT NOT NULL, fencing INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, error TEXT, UNIQUE(run_id, sequence));
CREATE TABLE IF NOT EXISTS attempts(execution_id TEXT NOT NULL, segment_hash TEXT NOT NULL, attempt_no INTEGER NOT NULL, status TEXT NOT NULL,
  reserved_chars INTEGER NOT NULL, body_hash TEXT NOT NULL, intent_at TEXT, finished_at TEXT, http_status INTEGER, provider_request_id TEXT,
  response_ref TEXT, audio_hash TEXT, alignment_hash TEXT, error TEXT, network_attempted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(execution_id, segment_hash, attempt_no));
CREATE TABLE IF NOT EXISTS mutations(mutation_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, from_revision INTEGER NOT NULL, from_decision_hash TEXT,
  status TEXT NOT NULL, created_at TEXT, finished_at TEXT);
CREATE TABLE IF NOT EXISTS reviews(review_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, bundle_hash TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT, decided_at TEXT, idempotency_key TEXT UNIQUE, receipt TEXT);
CREATE TABLE IF NOT EXISTS publications(tx_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, bundle_hash TEXT NOT NULL, state TEXT NOT NULL,
  created_at TEXT, updated_at TEXT, journal TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS retakes(take_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, base_run_id TEXT NOT NULL,
  segment_id TEXT NOT NULL, status TEXT NOT NULL, new_run_id TEXT, snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, selection TEXT);
`;

export class Coordinator {
  /** Opens the database and takes the coordinator lifetime lock for this state directory (one executing Studio at a time). */
  constructor(stateRoot, { label = 'Video Studio coordinator' } = {}) {
    this.stateRoot = stateRoot;
    fs.mkdirSync(stateRoot, { recursive: true });
    this.lock = LifetimeLock.acquire(path.join(stateRoot, 'locks', 'coordinator.lock'), label);
    try {
      this.db = new DatabaseSync(path.join(stateRoot, 'coordinator.db'), { timeout: 5000 });
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.db.exec(SCHEMA);
      this.processId = randomUUID();
    } catch (e) { this.lock.release(); throw e; }
  }
  close() { try { this.db?.close(); } finally { this.db = null; this.lock?.release(); } }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
  }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  json(row, ...keys) { if (!row) return row; const out = { ...row }; for (const k of keys) if (typeof out[k] === 'string') out[k] = JSON.parse(out[k]); return out; }

  run2B(runId) { return this.json(this.get('SELECT * FROM runs WHERE run_id = ?', runId), 'inputs', 'reason'); }
  runsForDraft(draftId) { return this.all('SELECT * FROM runs WHERE draft_id = ? ORDER BY created_at', draftId).map(r => this.json(r, 'inputs', 'reason')); }
  /** CAS on the run's epoch: a transition from a stale view (another worker, an old page) changes nothing. */
  updateRun(runId, epoch, fields) {
    const sets = Object.keys(fields).map(k => `${k} = ?`), values = Object.values(fields).map(v => (v && typeof v === 'object') ? JSON.stringify(v) : v);
    const r = this.run(`UPDATE runs SET ${sets.join(', ')}, updated_at = ?, epoch = epoch + 1 WHERE run_id = ? AND epoch = ?`, ...values, now(), runId, epoch);
    if (r.changes !== 1) throw new StudioError('Run 狀態已被其他操作改變（fencing / epoch mismatch）；請重新載入。', 409);
    return this.run2B(runId);
  }
  steps(runId) { return this.all('SELECT * FROM steps WHERE run_id = ? ORDER BY started_at, attempt_id', runId).map(s => this.json(s, 'result', 'child_pids')); }
  execution(id) { return this.json(this.get('SELECT * FROM executions WHERE execution_id = ?', id), 'error'); }
  attempts(executionId) { return this.all('SELECT * FROM attempts WHERE execution_id = ? ORDER BY segment_hash, attempt_no', executionId).map(a => this.json(a, 'response_ref', 'error')); }
  receipt(id) { return this.json(this.get('SELECT * FROM receipts WHERE receipt_id = ?', id), 'receipt'); }
}
