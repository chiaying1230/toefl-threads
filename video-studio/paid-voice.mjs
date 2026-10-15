// Paid voice boundary: one-time confirmation receipts, a durable per-request ledger and the ONLY function that may send a
// text-to-speech request. Defaults: zero automatic paid retries; an unknown provider outcome stops the execution.
//
// The existing generator (generateNarration) and client (synthesizeWithTimestamps / buildRequest) do the work. Studio only
// injects: a guarded `synthesize` (receipt / freshness / exact body / budget checks, durable intent before the request,
// raw response saved before it is parsed), a recording `fetchImpl`, and a cache that publishes only validated pairs.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { prepareNarration, segmentHash } from '../scripts/video/voice/segments.mjs';
import { planNarration, generateNarration } from '../scripts/video/voice/generate.mjs';
import { buildRequest, synthesizeWithTimestamps } from '../scripts/video/voice/elevenlabs.mjs';
import { bufferHash, jsonHash, writeExclusive, fileEvidence } from './hashing.mjs';
import { validatePair, CHALLENGE_TTL_MS, RETRY_POLICY } from './voice-envelope.mjs';
import { now } from './coordinator.mjs';
import { StudioError } from './state-contract.mjs';

/** Thrown by the guard; deliberately not an ElevenLabsError / AlignmentError and without code NO_ALIGNMENT, so withRetry never retries it. */
export class DispatchStopped extends Error {
  constructor(code, message, detail = {}) { super(message); this.name = 'DispatchStopped'; this.code = code; this.detail = detail; }
}
const challengeHash = token => bufferHash(Buffer.from(`studio-challenge:${token}`));

/**
 * Trusted evidence of the voice a run has already generated: every attempt the ledger recorded as succeeded (any execution of the
 * run) with the audio / alignment byte hashes written in the same step that sealed the pair. Candidate files are checked against
 * these, never the other way round: a changed / missing pair is never re-hashed into the ledger, never a hit, never a paid miss.
 */
export function generatedVoiceLedger(coordinator, runId) {
  return new Map(coordinator.all("SELECT a.segment_hash, a.audio_hash, a.alignment_hash FROM attempts a JOIN executions e ON a.execution_id = e.execution_id WHERE e.run_id = ? AND a.status = 'succeeded'", runId).map(a => [a.segment_hash, { audioHash: a.audio_hash, alignmentHash: a.alignment_hash }]));
}
const sealedProblems = (candidateDir, hash, trusted) => [['audio', 'mp3', trusted.audioHash], ['alignment', 'json', trusted.alignmentHash]].flatMap(([kind, ext, expected]) => {
  const file = path.join(candidateDir, 'voice', 'sealed', `${hash}.${ext}`);
  if (!expected) return [`${hash.slice(0, 12)} ${kind}: ledger 沒有 hash`];
  if (!fs.existsSync(file)) return [`${hash.slice(0, 12)} ${kind}: missing`];
  return fileEvidence(file).bytesHash === expected ? [] : [`${hash.slice(0, 12)} ${kind}: hash ≠ ledger`];
});
/** Every generated pair of the run (also a partial execution without a voice bundle) must equal its ledger hashes. Throws otherwise. */
export function verifyGeneratedVoice(coordinator, candidateDir, runId, only = null) {
  const ledger = generatedVoiceLedger(coordinator, runId);
  const problems = [...ledger].filter(([hash]) => !only || hash === only).flatMap(([hash, trusted]) => sealedProblems(candidateDir, hash, trusted));
  if (problems.length) throw new DispatchStopped('VOICE_EVIDENCE_CHANGED', `已生成的語音與 ledger 紀錄不符（${problems.join('; ')}）；不送出任何請求、不當作 cache hit、不改成付費 miss。`, { problems });
  return ledger;
}

/**
 * Credential persistence boundary. Every provider-controlled byte — body, header NAMES and values, request id, and everything the
 * client derives its error text from — passes ONE gate, gateResponse(), at the single ingress point (recordingFetch) before it is
 * written anywhere or handed to the parser. Ledger rows, execution / run errors, the generator manifest, sealed alignment and the UI
 * view are derived only from that gated view; safeMessage() re-checks what is persisted as text (defence in depth).
 *
 * The gate decides what to KEEP, not what to remove:
 *   - a non-success response keeps metadata only: status, size, the provider error code (detail.status, code-shaped) and exact
 *     allowlisted headers with shape-checked values. Provider free text (messages, echoes, unknown fields / headers) is never kept.
 *   - a success response (2xx JSON with audio_base64) must stay byte-identical for replay, so it is kept only when the detector
 *     finds it clean; otherwise only status / size are kept and the segment stops (fail closed, never re-sent).
 *   - every kept value is itself checked by the detector.
 *
 * Detector, credentialTrace(): bounded breadth-first decoding over a closed set of reversible text encodings — escapes (JSON
 * \uXXXX / \xXX / backslash, %XX, HTML numeric entities), base64 / base64url at every alignment, hex at every alignment, and
 * separator stripping — composed up to DECODE_DEPTH layers, with duplicate views suppressed and a work budget; a text-like layer
 * still left at the bound means the search was cut short → 'undecidable' (fail closed), never "clean". Decoded bytes keep
 * only printable runs (NULs removed, so UTF-16 text is seen too). Each view is compared to every credential (any letter case, and
 * separator-stripped) and to the generic key shape. Verdicts: 'clean' | 'contiguous' (found whole inside one decoded view) |
 * 'segmented' (ONLY found across separators: boundaries unknown) | 'undecidable' (budget exceeded). Only 'clean' is ever kept as is;
 * the verdict only decides whether a non-success response keeps its metadata (contiguous) or nothing at all (segmented / undecidable).
 */
export const MIN_SCRUBBABLE_SECRET = 16; // real ElevenLabs keys are far longer (sk_ + 48 hex)
export const KEY_SHAPE = /\b(?:sk_|xi-)[A-Za-z0-9_-]{16,}/g; // same shape the client's own redact() removes from errors
const KEY_SHAPE_ANY = new RegExp(KEY_SHAPE.source);
export const DECODE_DEPTH = 4;               // layers of reversible encoding peeled (each escape layer runs to its fixed point)
const MIN_ENCODED = 16;                       // shortest base64 / hex run worth decoding (base64 of a 16-char key is 24 chars)
const B64_RUN = new RegExp(`[A-Za-z0-9+/_-]{${MIN_ENCODED},}`, 'g'), HEX_RUN = new RegExp(`[0-9a-fA-F]{${MIN_ENCODED},}`, 'g');
const MAX_VIEWS = 4096, MAX_INSPECT = 32 << 20; // a response larger than 32 MiB is not inspected → undecidable
const RANK = { clean: 0, contiguous: 1, segmented: 2, undecidable: 3 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);
const char = cp => (cp <= 0x10ffff ? String.fromCodePoint(cp) : '');
const compact = t => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const stripSeparators = t => t.replace(/[\s"',[\]{}:;]+/g, '');
const unescapeOnce = s => s
  .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => char(parseInt(h, 16)))
  .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => char(parseInt(h, 16)))
  .replace(/%([0-9a-fA-F]{2})/g, (_, h) => char(parseInt(h, 16)))
  .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (_, h) => char(parseInt(h, 16)))
  .replace(/&#([0-9]{1,7});/g, (_, d) => char(Number(d)))
  .replace(/\\([\\/"])/g, '$1');
const printable = bytes => Buffer.from(bytes.filter(b => b !== 0)).toString('latin1').match(/[\x20-\x7e]{8,}/g)?.join('\n') ?? '';
/** A shared work budget: one per response (or message), so many small values cannot add up to unbounded work. */
export const inspectionBudget = size => ({ left: Math.min(64 * size + (1 << 20), 1 << 30) });
const spend = (budget, n) => (budget.left -= n) >= 0;

const matchView = (view, secrets, viaSeparators) => {
  const lower = view.toLowerCase();
  if (!viaSeparators && (secrets.some(s => lower.includes(s.lower)) || KEY_SHAPE_ANY.test(view))) return 'contiguous';
  // found only once separators are removed / ignored: the credential is spread over several values, its boundaries are unknown
  if (secrets.some(s => (viaSeparators && lower.includes(s.lower)) || (s.dense.length >= MIN_SCRUBBABLE_SECRET && compact(view).includes(s.dense)))) return 'segmented';
  return 'clean';
};
/** Children of one view: escapes to a fixed point, base64 / hex decoded at every alignment, separators removed. */
function children(view, budget) {
  const out = [];
  let u = view;
  for (let next = unescapeOnce(u); next !== u; next = unescapeOnce(u)) { if (!spend(budget, u.length)) return null; u = next; }
  out.push([u, false]);
  if (/^\s*[[{"]/.test(view)) { // JSON semantics (\\ before \u…), as the parser sees it: every string key / value, one per line
    const leaves = [], walk = v => { if (typeof v === 'string') leaves.push(v); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) leaves.push(k); walk(x); } };
    try { walk(JSON.parse(view)); out.push([leaves.join('\n'), false]); } catch { /* not JSON */ }
  }
  const decoded = [];
  for (const run of view.match(B64_RUN) || []) {
    for (let k = 0; k < 4; k++) { if (!spend(budget, run.length)) return null; decoded.push(printable(Buffer.from(run.slice(k), 'base64'))); }
  }
  for (const run of view.match(HEX_RUN) || []) {
    for (let k = 0; k < 2; k++) { if (!spend(budget, run.length)) return null; decoded.push(printable(Buffer.from(run.slice(k), 'hex'))); }
  }
  out.push([decoded.filter(Boolean).join('\n'), false]);
  out.push([stripSeparators(view), true]); // segmented encodings (chunked / wrapped base64, char arrays)
  return out;
}
/**
 * At the depth bound: does the view still hold another TEXT-like encoding layer (a base64 / hex run that decodes to mostly
 * printable text, or a run of escape sequences)? Then the search was cut short, not finished → undecidable (fail closed).
 * Random bytes (audio) do not decode to mostly printable text, so ordinary responses end clean.
 */
const ESCAPE_SEQ = /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|%[0-9a-fA-F]{2}|&#[xX]?[0-9a-fA-F]{1,7};/g;
const textLike = buf => { const b = buf.filter(x => x !== 0); return b.length >= 12 && b.filter(x => x >= 0x20 && x <= 0x7e).length >= 0.9 * b.length; };
function hasTextLayer(view, budget) {
  if ((view.match(ESCAPE_SEQ) || []).length >= MIN_ENCODED / 2) return true;
  for (const [re, offsets, encoding] of [[B64_RUN, 4, 'base64'], [HEX_RUN, 2, 'hex']]) for (const run of view.match(re) || []) {
    for (let k = 0; k < offsets; k++) { if (!spend(budget, run.length) || textLike(Buffer.from(run.slice(k), encoding))) return true; }
  }
  return false;
}
const prepared = secrets => secrets.filter(s => typeof s === 'string' && s.length).map(s => ({ lower: s.toLowerCase(), dense: compact(s) }));
/** Bounded, terminating, fail-closed search for any trace of the credentials in `text`. */
export function credentialTrace(text, secrets, budget = inspectionBudget(String(text ?? '').length)) {
  const s = String(text ?? ''), keys = prepared(secrets);
  if (s.length > MAX_INSPECT) return 'undecidable';
  let verdict = 'clean', level = [[s, false]];
  const seen = new Set();
  for (let depth = 0; depth <= DECODE_DEPTH && level.length; depth++) {
    const next = [];
    for (const [view, viaSeparators] of level) {
      if (!view || seen.has(view)) continue;
      seen.add(view);
      if (seen.size > MAX_VIEWS || !spend(budget, view.length)) return 'undecidable';
      const found = matchView(view, keys, viaSeparators);
      if (found === 'contiguous') return found; // whole inside one decoded value; a segmented sighting may be the same occurrence
      if (found === 'segmented') verdict = found;
      if (depth === DECODE_DEPTH) { if (hasTextLayer(view, budget) || hasTextLayer(stripSeparators(view), budget)) return 'undecidable'; continue; }
      const c = children(view, budget);
      if (!c) return 'undecidable';
      next.push(...c.map(([v, sep]) => [v, sep || viaSeparators]));
    }
    level = next;
  }
  return verdict;
}

// exact header names that may be kept, each with the only value shape accepted; any other header (name or value) is never kept
const KEPT_HEADERS = {
  'request-id': /^[A-Za-z0-9._:-]{1,128}$/, 'x-request-id': /^[A-Za-z0-9._:-]{1,128}$/, 'history-item-id': /^[A-Za-z0-9._:-]{1,128}$/,
  'character-cost': /^\d{1,9}$/, 'content-type': /^[\w.+-]{1,40}\/[\w.+-]{1,60}(?:; ?charset=[\w-]{1,20})?$/,
};
const PROVIDER_CODE = /^[a-z][a-z0-9_]{0,63}$/;
/**
 * The one gate for a provider response. Returns { record, body, headers, failed }: `record` is the only thing persisted, and
 * `body` / `headers` are exactly what the client parser is given (so replay sees the same bytes). failed → nothing provider-written
 * is kept (status / size only) and the caller stops the segment without resending.
 */
export function gateResponse({ attemptId, status, headers: rawHeaders, raw, secrets }) {
  const budget = inspectionBudget(raw.length + rawHeaders.reduce((n, [k, v]) => n + k.length + v.length, 0));
  const bodyVerdict = credentialTrace(raw, secrets, budget);
  const headerVerdicts = rawHeaders.map(([k, v]) => [k.toLowerCase(), v, credentialTrace(`${k}: ${v}`, secrets, budget)]);
  let json = null;
  try { json = JSON.parse(raw); } catch { /* not JSON: metadata only */ }
  const success = status >= 200 && status < 300 && json && typeof json === 'object' && typeof json.audio_base64 === 'string' && json.audio_base64.length > 0;
  const overall = [bodyVerdict, ...headerVerdicts.map(h => h[2])].reduce(worst, 'clean');
  const failClosed = reason => ({ failed: true, record: { attemptId, status, headers: {}, raw: null, rawBytes: Buffer.byteLength(raw), sanitization: { version: 2, failed: 'SECRET_SANITIZATION_FAILED', reason } } });
  if (RANK[overall] >= RANK.segmented) return failClosed(overall);
  if (success && bodyVerdict !== 'clean') return failClosed('success-body');
  const headers = {};
  for (const [k, v, verdict] of headerVerdicts) if (verdict === 'clean' && KEPT_HEADERS[k]?.test(v)) headers[k] = v; // the verdict covers the header name and value
  const redactions = [bodyVerdict, ...headerVerdicts.map(h => h[2])].filter(v => v !== 'clean').length; // provider values withheld for a credential trace
  let body = raw;
  if (!success) {
    const code = json?.detail?.status;
    body = JSON.stringify({ detail: typeof code === 'string' && PROVIDER_CODE.test(code) && credentialTrace(code, secrets, budget) === 'clean' ? { status: code } : {} });
  }
  if (budget.left < 0) return failClosed('undecidable');
  return { failed: false, body, headers, record: { attemptId, status, headers, raw: body, rawBytes: Buffer.byteLength(raw), sanitization: { version: 2, mode: success ? 'verbatim' : 'metadata-only', redactions } } };
}
/** For messages persisted in the ledger / execution / run rows: kept only when the detector finds them clean, else a fixed placeholder. */
export const safeMessage = (text, secrets, max = 300) => {
  const t = String(text ?? '').slice(0, max);
  return credentialTrace(t, secrets) === 'clean' ? t : '[omitted: 訊息可能含 credential，無法安全保存]';
};
/** Error codes persisted next to messages: our own constants only (a code-shaped string), never free text. */
const codeOf = e => { const c = e?.code || e?.name; return typeof c === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(c) ? c : 'ERROR'; };
/** Transport failures may carry provider / proxy text: the client only ever sees a fixed message (timeouts keep their name). */
const transportError = e => {
  const err = new Error('provider transport failed (details not kept)');
  err.name = ['TimeoutError', 'AbortError'].includes(e?.name) ? e.name : 'TransportError';
  const code = e?.cause?.code;
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) err.cause = { code };
  return err;
};

/**
 * A receipt is valid only when its content still hashes to the hash recorded at confirmation, its identity / envelope / run /
 * revision / dependency bindings match, its status allows the use, and it has not expired. Throws DispatchStopped otherwise.
 * Called at confirmation replay, claim, before EVERY paid dispatch (inside the reserve transaction) and on restart.
 */
export function verifyReceipt(coordinator, row, { statuses = ['issued', 'claimed'], at = Date.now() } = {}) {
  const stop = (code, message) => { throw new DispatchStopped(code, message, { receiptId: row?.receipt_id }); };
  if (!row) stop('RECEIPT_MISSING', 'Receipt 不存在');
  let content;
  try { content = JSON.parse(row.receipt); } catch { stop('RECEIPT_TAMPERED', 'Receipt 內容無法解析'); }
  const { receiptHash, ...rest } = content;
  if (jsonHash(rest) !== receiptHash || receiptHash !== row.receipt_hash) stop('RECEIPT_TAMPERED', 'Receipt 內容與確認時的 checksum 不同；不送出請求');
  if (content.receiptId !== row.receipt_id || content.executionId !== row.execution_id || content.runId !== row.run_id || content.confirmationEnvelopeHash !== row.envelope_hash || content.confirmationChallengeHash !== row.challenge_hash) stop('RECEIPT_IDENTITY_MISMATCH', 'Receipt 與 execution / envelope / challenge 的綁定不一致');
  const run = coordinator.run2B(row.run_id), refs = run?.inputs?.inputRefs || {}, b = run?.inputs?.bindings || {};
  if (!run || content.candidateId !== run.candidate_id || content.draftId !== run.draft_id || content.revision !== run.revision || content.sourceHash !== run.source_hash || content.decisionHash !== run.decision_hash) stop('RECEIPT_BINDING_MISMATCH', 'Receipt 綁定的 revision / source / decisions 與 run 不同');
  if (content.narrationBytesHash !== refs.narration?.bytesHash || content.compiledEpisodeBytesHash !== refs.episode?.bytesHash || content.validationHash !== refs.validation?.bytesHash || content.voicePlanHash !== refs.voicePlan?.bytesHash || content.engineManifestHash !== b.engineManifestHash) stop('RECEIPT_BINDING_MISMATCH', 'Receipt 綁定的 artifacts / engine 與 run 不同');
  if (!(run.inputs.envelopes || []).some(e => e.bytesHash === row.envelope_hash)) stop('RECEIPT_BINDING_MISMATCH', 'Receipt 的 envelope 不屬於這個 run');
  if (!statuses.includes(row.status)) stop('RECEIPT_NOT_ACTIVE', `Receipt 狀態 ${row.status}，不能使用`);
  if (!(Date.parse(content.expiresAt) > at) || !(Date.parse(row.expires_at) > at) || content.expiresAt !== row.expires_at) stop('RECEIPT_EXPIRED', 'Receipt 已過期；剩餘請求需要重新免費預覽與確認');
  return content;
}

export function issueChallenge(coordinator, runId, envelopeHash, { recoveryOf = null } = {}) {
  const token = randomBytes(24).toString('hex'), created = Date.now();
  coordinator.run('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, NULL, ?)', challengeHash(token), runId, envelopeHash, new Date(created).toISOString(), new Date(created + CHALLENGE_TTL_MS).toISOString(), recoveryOf);
  return { challenge: token, expiresAt: new Date(created + CHALLENGE_TTL_MS).toISOString() };
}

/**
 * Consume a challenge exactly once and create the receipt + execution. The same idempotency key with the same body returns the
 * same execution (double click / HTTP retry); a different body with that key is 409; a run never gets a second live execution.
 */
export function confirmReceipt(coordinator, { run, envelope, envelopeRef, challenge, idempotencyKey, acknowledgements = {}, expectedBudget }) {
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)) throw new StudioError('Idempotency key missing / invalid');
  const requestHash = jsonHash({ runId: run.run_id, envelopeHash: envelopeRef.bytesHash, challenge: typeof challenge === 'string' ? challengeHash(challenge) : null, budget: expectedBudget, acknowledgements });
  return coordinator.tx(() => {
    const prior = coordinator.get('SELECT * FROM receipts WHERE idempotency_key = ?', idempotencyKey);
    if (prior) { if (prior.request_hash !== requestHash) throw new StudioError('同一個 idempotency key 已用於不同的確認內容', 409); verifyReceipt(coordinator, prior, { statuses: ['issued', 'claimed', 'completed'] }); return { receipt: coordinator.json(prior, 'receipt'), execution: coordinator.execution(prior.execution_id), replayed: true }; }
    const live = coordinator.get("SELECT * FROM executions WHERE run_id = ? AND status IN ('issued','running')", run.run_id);
    if (live) { const r = coordinator.get('SELECT * FROM receipts WHERE receipt_id = ?', live.receipt_id); if (r.envelope_hash !== envelopeRef.bytesHash) throw new StudioError('這個 run 已有進行中的付費 execution', 409); verifyReceipt(coordinator, r, { statuses: ['issued', 'claimed'] }); return { receipt: coordinator.json(r, 'receipt'), execution: coordinator.execution(live.execution_id), replayed: true }; }
    if (typeof challenge !== 'string') throw new StudioError('Confirmation challenge missing', 409);
    const c = coordinator.get('SELECT * FROM challenges WHERE challenge_hash = ?', challengeHash(challenge));
    if (!c || c.run_id !== run.run_id || c.envelope_hash !== envelopeRef.bytesHash) throw new StudioError('確認碼不屬於這份 envelope；請重新產生免費預覽', 409);
    if (c.consumed_at) {
      const used = coordinator.get('SELECT * FROM receipts WHERE challenge_hash = ?', c.challenge_hash);
      if (used) { verifyReceipt(coordinator, used, { statuses: ['issued', 'claimed', 'completed'] }); return { receipt: coordinator.json(used, 'receipt'), execution: coordinator.execution(used.execution_id), replayed: true }; }
      throw new StudioError('確認碼已使用', 409);
    }
    if (Date.parse(c.expires_at) <= Date.now()) throw new StudioError('確認碼已過期；請重新產生免費預覽', 409);
    if (jsonHash(expectedBudget) !== jsonHash(envelope.budget)) throw new StudioError('預算與 envelope 顯示的不同；請重新預覽確認', 409);
    if (c.recovery_of && acknowledgements.possibleDoubleCharge !== true) throw new StudioError('恢復付費前必須確認「先前請求可能已扣額，重送可能再次扣額」', 409);
    if (acknowledgements.noAutomaticRetry !== true || acknowledgements.estimateIsNotBilling !== true) throw new StudioError('請確認「不自動付費重試」與「字元估算不是扣額保證」', 409);
    const sequence = (coordinator.get('SELECT MAX(sequence) m FROM executions WHERE run_id = ?', run.run_id)?.m ?? 0) + 1;
    const receiptId = randomUUID(), executionId = randomUUID(), created = new Date(Date.now()); // one clock source for issue and expiry checks
    const content = {
      version: 1, receiptId, runId: run.run_id, executionId, candidateId: run.candidate_id, draftId: run.draft_id, revision: run.revision,
      sourceHash: run.source_hash, decisionHash: run.decision_hash, narrationBytesHash: envelope.narrationBytesHash, compiledEpisodeBytesHash: envelope.compiledEpisodeBytesHash,
      validationHash: envelope.validationHash, voicePlanHash: envelope.voicePlanHash, confirmationEnvelopeHash: envelopeRef.bytesHash, engineManifestHash: envelope.engineManifestHash,
      voiceConfigHash: envelope.voiceConfigHash, requests: envelope.requests.map(r => ({ segmentHash: r.segmentHash, requestBodyHash: r.requestBodyHash, url: r.url, voiceId: r.voiceId, model: r.model, settings: r.settings, languageCode: r.languageCode ?? null, takeId: r.takeId ?? null, outputFormat: r.outputFormat, chars: r.chars })),
      pinnedCacheManifestHash: envelope.pinnedCacheManifestHash, confirmedMissHashes: envelope.confirmedMissHashes, estimatedUniqueTextChars: envelope.estimatedUniqueTextChars,
      budget: envelope.budget, retryPolicy: RETRY_POLICY, recoveryOf: c.recovery_of, acknowledgements,
      confirmedAt: created.toISOString(), expiresAt: new Date(created.getTime() + CHALLENGE_TTL_MS).toISOString(), actorId: 'local-owner', confirmationChallengeHash: c.challenge_hash,
    };
    content.receiptHash = jsonHash(content);
    coordinator.run('UPDATE challenges SET consumed_at = ? WHERE challenge_hash = ? AND consumed_at IS NULL', now(), c.challenge_hash);
    coordinator.run('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', receiptId, run.run_id, executionId, c.challenge_hash, idempotencyKey, requestHash, content.receiptHash, envelopeRef.bytesHash, 'issued', now(), content.expiresAt, JSON.stringify(content));
    coordinator.run('INSERT INTO executions VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)', executionId, run.run_id, receiptId, sequence, 'issued', now(), now());
    return { receipt: coordinator.receipt(receiptId), execution: coordinator.execution(executionId), replayed: false };
  });
}

/** A receipt that fails verification ends its execution deterministically: expired → 'expired', anything else → 'blocked'. */
export function markReceiptFailure(coordinator, execution, e) {
  const expired = e.code === 'RECEIPT_EXPIRED';
  coordinator.tx(() => {
    coordinator.run("UPDATE executions SET status = ?, updated_at = ?, error = ? WHERE execution_id = ? AND status IN ('issued','interrupted','failed','running')", expired ? 'expired' : 'blocked', now(), JSON.stringify({ code: e.code, message: e.message }), execution.execution_id);
    coordinator.run("UPDATE receipts SET status = ? WHERE receipt_id = ? AND status IN ('issued','claimed')", expired ? 'expired' : 'revoked', execution.receipt_id);
  });
}

/** Revoke every receipt / execution of a run that has not finished (dependency drift, decision edit, superseded run). */
export function revokeRun(coordinator, runId, reason) {
  coordinator.run("UPDATE receipts SET status = 'revoked' WHERE run_id = ? AND status IN ('issued','claimed')", runId);
  coordinator.run("UPDATE executions SET status = 'superseded', error = ?, updated_at = ? WHERE run_id = ? AND status IN ('issued','running')", JSON.stringify(reason), now(), runId);
}

/** Startup recovery: an intent without a durable response is an unknown provider outcome; it is never resent. */
export function recoverLedger(coordinator, candidateDir) {
  for (const a of coordinator.all("SELECT * FROM attempts WHERE status IN ('dispatch_intent','response_received')")) {
    const ref = a.response_ref && JSON.parse(a.response_ref);
    const durable = Boolean(ref?.path) && fs.existsSync(path.join(candidateDir(a.execution_id), ref.path)) && fileEvidence(path.join(candidateDir(a.execution_id), ref.path)).bytesHash === ref.bytesHash;
    const status = a.status === 'dispatch_intent' ? 'unknown' : durable ? 'failed' : 'unknown';
    coordinator.run('UPDATE attempts SET status = ?, finished_at = ?, error = ? WHERE execution_id = ? AND segment_hash = ? AND attempt_no = ?', status, now(), JSON.stringify({ code: 'RECOVERED_AFTER_RESTART', message: status === 'unknown' ? 'Studio 在請求進行中停止，沒有可驗證的 response；可能已扣額，不會自動重送。' : '已有 response 但尚未封存；不重送。' }), a.execution_id, a.segment_hash, a.attempt_no);
  }
  coordinator.run("UPDATE executions SET status = 'interrupted', updated_at = ? WHERE status = 'running'", now());
}

/**
 * Run (or resume) one execution. `freshness()` is called before every dispatch and must throw when anything bound changed.
 * `fetchImpl` is the transport (mocked in tests); `apiKey()` returns the key only here, after the claim.
 */
export async function executeVoice({ coordinator, candidate, voiceStore, executionId, freshness, fetchImpl, apiKey, voiceConfig, narration, envelope, log = () => {} }) {
  let execution = coordinator.execution(executionId);
  const receipt = coordinator.receipt(execution.receipt_id);
  const receiptRow = () => coordinator.get('SELECT * FROM receipts WHERE receipt_id = ?', execution.receipt_id);
  let content;
  try { content = verifyReceipt(coordinator, receiptRow()); }
  catch (e) { markReceiptFailure(coordinator, execution, e); throw e; }
  // claim: issued → running (once); interrupted → running is a resume of the same authorization, never new rights
  const fencing = coordinator.tx(() => {
    const e = coordinator.execution(executionId);
    if (!['issued', 'interrupted', 'failed'].includes(e.status)) throw new StudioError(`Execution 狀態 ${e.status} 不能執行`, 409);
    // expiry applies to starting AND resuming paid attempts; already generated audio is kept either way
    const unknown = coordinator.get("SELECT COUNT(*) n FROM attempts WHERE execution_id = ? AND status = 'unknown'", executionId).n;
    if (unknown) throw new StudioError('有未知結果的付費請求；不會自動重送，需要人工恢復確認', 409);
    coordinator.run("UPDATE executions SET status = 'running', fencing = fencing + 1, updated_at = ? WHERE execution_id = ?", now(), executionId);
    coordinator.run("UPDATE receipts SET status = 'claimed' WHERE receipt_id = ? AND status IN ('issued','claimed')", receipt.receipt_id);
    return coordinator.execution(executionId).fencing;
  });
  freshness();
  // resume of a partial execution: the pairs already generated must still equal the ledger before anything else (blocked / revoked otherwise)
  try { verifyGeneratedVoice(coordinator, candidate.dir, execution.run_id); }
  catch (e) { markReceiptFailure(coordinator, execution, e); throw e; }
  const prepared = prepareNarration(narration, voiceConfig, { requireApiKey: false, env: {} });
  const requests = new Map(content.requests.map(r => [r.segmentHash, r]));
  const voiceDir = path.join(candidate.dir, 'voice');
  const sealed = hash => ({ audio: path.join(voiceDir, 'sealed', `${hash}.mp3`), alignment: path.join(voiceDir, 'sealed', `${hash}.json`) });
  // pinned hits are exactly the receipt's envelope snapshot; a changed / missing pinned file stops the run (never becomes a paid miss)
  if (envelope.pinnedCacheManifestHash !== content.pinnedCacheManifestHash) throw new StudioError('Envelope 與 receipt 綁定的 pinned cache 不同', 409);
  const pinnedMap = new Map(envelope.pinned.map(p => [p.hash, p]));
  const pinnedPair = hash => {
    const p = pinnedMap.get(hash); if (!p) return null;
    const pair = { audio: path.join(candidate.dir, p.audio.path), alignment: path.join(candidate.dir, p.alignment.path) };
    if (!fs.existsSync(pair.audio) || !fs.existsSync(pair.alignment) || fileEvidence(pair.audio).bytesHash !== p.audio.bytesHash || fileEvidence(pair.alignment).bytesHash !== p.alignment.bytesHash) throw new DispatchStopped('PINNED_CACHE_CHANGED', `已確認的 cache hit ${hash} 被修改或消失；不會改成付費 miss`);
    return pair;
  };
  // a generated pair is ready only when the ledger recorded it as succeeded AND its bytes still equal those ledger hashes
  const ready = hash => (generatedVoiceLedger(coordinator, execution.run_id).has(hash) && verifyGeneratedVoice(coordinator, candidate.dir, execution.run_id, hash) && sealed(hash)) || pinnedPair(hash);
  const secrets = []; // credentials used by this execution; everything persisted below is scrubbed of them
  const attemptOf = hash => coordinator.json(coordinator.get('SELECT * FROM attempts WHERE execution_id = ? AND segment_hash = ? ORDER BY attempt_no DESC', executionId, hash), 'response_ref', 'error');
  const checkFence = () => { const e = coordinator.execution(executionId); if (e.status !== 'running' || e.fencing !== fencing) throw new DispatchStopped('EXECUTION_FENCED', 'Execution 已被取代或停止；不再送出請求。'); };

  // the cache the existing generator sees: has() only for sealed / pinned pairs; write() validates and publishes exclusively
  const cache = {
    has: hash => Boolean(ready(hash)),
    audioPath: hash => (ready(hash) || sealed(hash)).audio,
    readAlignment: hash => JSON.parse(fs.readFileSync((ready(hash) || sealed(hash)).alignment, 'utf8')),
    write(hash, { audio, alignment, meta }) {
      checkFence();
      const request = requests.get(hash), attempt = attemptOf(hash), segment = prepared.segments.find(s => s.hash === hash);
      if (!request || !segment || attempt?.status !== 'response_received') throw new DispatchStopped('UNAUTHORIZED_WRITE', `沒有對應的已收到回應，拒絕寫入 ${hash}`);
      if (meta.text !== segment.speak || meta.voiceId !== request.voiceId || meta.model !== request.model) throw new DispatchStopped('META_MISMATCH', '產生結果與確認的請求不同');
      const alignmentBytes = Buffer.from(JSON.stringify({ hash, ...meta, alignment }, null, 2) + '\n');
      const staging = path.join(voiceDir, 'staging', attempt.response_ref.attemptId);
      writeExclusive(candidate.dir, path.join(staging, `${hash}.mp3`), audio);
      writeExclusive(candidate.dir, path.join(staging, `${hash}.json`), alignmentBytes);
      const evidence = validatePair(segment, prepared.outputFormat, path.join(staging, `${hash}.mp3`), alignmentBytes.toString('utf8'));
      const target = sealed(hash);
      for (const [file, data] of [[target.audio, audio], [target.alignment, alignmentBytes]]) {
        if (fs.existsSync(file)) { if (bufferHash(fs.readFileSync(file)) !== bufferHash(data)) throw new DispatchStopped('HASH_COLLISION', `${hash} 已有不同的封存內容`); }
        else writeExclusive(candidate.dir, file, data);
      }
      voiceStore.publish(hash, audio, alignmentBytes);
      coordinator.run("UPDATE attempts SET status = 'succeeded', finished_at = ?, audio_hash = ?, alignment_hash = ? WHERE execution_id = ? AND segment_hash = ? AND attempt_no = ?", now(), bufferHash(audio), bufferHash(alignmentBytes), executionId, hash, attempt.attempt_no);
      log(`sealed ${hash} (${evidence.decodedSeconds}s)`);
    },
  };

  // the only path to the network
  const synthesize = async ({ voice, text, previousText, nextText, outputFormat, apiBase }) => {
    const hash = segmentHash({ voice, speak: text, previousText, nextText, outputFormat });
    const request = requests.get(hash);
    if (!request) throw new DispatchStopped('UNKNOWN_SEGMENT', '要送出的 segment 不在這張 receipt 裡');
    const { url, body } = buildRequest({ voice, text, previousText, nextText, outputFormat, apiBase });
    const bodyHash = bufferHash(Buffer.from(JSON.stringify(body)));
    if (url !== request.url || bodyHash !== request.requestBodyHash || text.length !== request.chars) throw new DispatchStopped('REQUEST_CHANGED', '重建的請求與確認時不同（文字 / model / settings / prosody）');
    const prior = attemptOf(hash);
    if (prior) {
      // never a second paid request: an already received response can only be replayed through the same client parser
      if (['response_received', 'succeeded'].includes(prior.status) && prior.response_ref) return replay(prior.response_ref, { voice, text, previousText, nextText, outputFormat, apiBase });
      throw new DispatchStopped('NO_PAID_RETRY', `這個 segment 已嘗試過（${prior.status}）；預設不自動付費重試`, { hash, status: prior.status });
    }
    freshness(); checkFence();
    // the receipt-bound pinned snapshot must still be exactly what was confirmed before ANY further request
    for (const p of envelope.pinned) pinnedPair(p.hash);
    // so must every pair this run already generated (also before a voice bundle exists): changed / missing → no further request
    verifyGeneratedVoice(coordinator, candidate.dir, execution.run_id);
    const key = apiKey(); // credentials only after claim + freshness; a missing key fails before any intent is recorded
    // a credential too short to be removed from provider payloads without colliding with ordinary bytes cannot be kept off disk: refuse
    if (typeof key !== 'string' || key.length < MIN_SCRUBBABLE_SECRET) throw new DispatchStopped('API_KEY_UNSAFE', `API key 格式不足以安全遮蔽（少於 ${MIN_SCRUBBABLE_SECRET} 字元）；沒有送出任何請求。`);
    secrets.push(key);
    const attemptId = randomUUID();
    coordinator.tx(() => {
      checkFence();
      verifyReceipt(coordinator, receiptRow(), { statuses: ['claimed'] }); // checksum / status / expiry at the reserve boundary
      const used = coordinator.get('SELECT COALESCE(SUM(reserved_chars),0) chars, COUNT(*) n FROM attempts WHERE execution_id = ?', executionId);
      if (used.chars + text.length > content.budget.maxSubmittedChars || used.n + 1 > content.budget.maxRequests || text.length > content.budget.maxCharsPerRequest) throw new DispatchStopped('BUDGET_EXCEEDED', `超過確認的預算（已保留 ${used.chars} / ${content.budget.maxSubmittedChars} characters，${used.n} / ${content.budget.maxRequests} requests）`);
      coordinator.run('INSERT INTO attempts (execution_id, segment_hash, attempt_no, status, reserved_chars, body_hash, intent_at, network_attempted, response_ref) VALUES (?, ?, 1, ?, ?, ?, ?, 1, ?)', executionId, hash, 'dispatch_intent', text.length, bodyHash, now(), JSON.stringify({ attemptId }));
    });
    // durable intent is committed; only now may the request leave
    let responseRef = null, unsafeResponse = null;
    const recordingFetch = async (target, init) => {
      if (target !== request.url) throw new DispatchStopped('URL_CHANGED', 'URL 與確認不同');
      let res, raw;
      try { res = await fetchImpl(target, init); raw = await res.text(); } catch (e) { throw transportError(e); }
      // provider-controlled bytes pass the gate BEFORE they touch disk or the parser; the parser then sees exactly what was saved,
      // so a replay is identical. If that cannot be guaranteed, only status / size are persisted and the segment stops (fail closed).
      const gate = gateResponse({ attemptId, status: res.status, headers: [...res.headers], raw, secrets });
      const file = path.join(candidate.dir, 'voice', 'responses', `${attemptId}.json`);
      const evidence = writeExclusive(candidate.dir, file, JSON.stringify(gate.record));
      responseRef = { attemptId, path: candidate.rel(file), ...evidence };
      coordinator.run("UPDATE attempts SET status = 'response_received', http_status = ?, provider_request_id = ?, response_ref = ? WHERE execution_id = ? AND segment_hash = ? AND attempt_no = 1", res.status, gate.failed ? null : gate.headers['request-id'] || gate.headers['x-request-id'] || null, JSON.stringify(responseRef), executionId, hash);
      // the client wraps transport errors, so the stop is also carried out of band to keep its own code
      if (gate.failed) throw (unsafeResponse = new DispatchStopped('SECRET_SANITIZATION_FAILED', 'Provider response 可能含 credential 且無法安全移除；沒有保存內容，這個 segment 停止（不重送）。', { hash, httpStatus: res.status }));
      return new Response(gate.body, { status: res.status, headers: gate.headers });
    };
    try {
      return await synthesizeWithTimestamps({ voice, text, previousText, nextText, outputFormat, apiBase, apiKey: key, fetchImpl: recordingFetch, timeoutMs: 120000 });
    } catch (e) {
      if (e instanceof DispatchStopped) throw e;
      if (unsafeResponse) {
        coordinator.run('UPDATE attempts SET status = ?, finished_at = ?, error = ? WHERE execution_id = ? AND segment_hash = ? AND attempt_no = 1', 'failed', now(), JSON.stringify({ code: unsafeResponse.code, message: unsafeResponse.message, billing: 'provider 已回應；是否扣額未知' }), executionId, hash);
        throw unsafeResponse;
      }
      const status = responseRef ? 'failed' : 'unknown';
      coordinator.run('UPDATE attempts SET status = ?, finished_at = ?, error = ? WHERE execution_id = ? AND segment_hash = ? AND attempt_no = 1', status, now(), JSON.stringify({ code: codeOf(e), message: safeMessage(e.message, secrets), billing: status === 'unknown' ? '未知：請求可能已送達並扣額' : 'provider 已回應；是否扣額未知' }), executionId, hash);
      throw new DispatchStopped(status === 'unknown' ? 'UNKNOWN_PROVIDER_OUTCOME' : 'PROVIDER_FAILED', `付費請求失敗（${codeOf(e)}）；預設不重送`, { hash, cause: codeOf(e) });
    }
  };
  const replay = async (ref, params) => {
    const file = path.join(candidate.dir, ref.path);
    if (fileEvidence(file).bytesHash !== ref.bytesHash) throw new DispatchStopped('RESPONSE_TAMPERED', '已保存的 response 被修改');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.raw !== 'string') throw new DispatchStopped('RESPONSE_NOT_REPLAYABLE', '這個 response 因 credential 安全原因沒有保存內容；不重送');
    return synthesizeWithTimestamps({ ...params, apiKey: 'replay-no-network', fetchImpl: async () => new Response(saved.raw, { status: saved.status }) });
  };

  // residual projection of the ORIGINAL authorization: only confirmed, never-attempted misses; exhausted ones are skipped
  const plan = planNarration(prepared, cache);
  for (const s of plan.segments) {
    if (s.status !== 'miss') continue;
    if (!requests.has(s.hash)) throw new StudioError(`Residual miss ${s.id} 不屬於確認的 requests；需要新的免費預覽與確認`, 409);
    const a = attemptOf(s.hash);
    if (a && a.status !== 'response_received') s.status = 'not_authorized_again';
  }
  const manifestPath = path.join(candidate.dir, 'voice', 'manifests', `${randomUUID()}.manifest.json`);
  let failure = null;
  try {
    await generateNarration(plan, { cache, synthesize, manifestPath, sleep: async () => {}, log, maxChars: content.budget.maxSubmittedChars });
  } catch (e) { failure = e; }
  // a response that was received but never sealed (alignment / parse failure) is failed, not retried
  coordinator.run("UPDATE attempts SET status = 'failed', finished_at = ?, error = COALESCE(error, ?) WHERE execution_id = ? AND status = 'response_received'", now(), JSON.stringify({ code: failure ? codeOf(failure) : 'NOT_SEALED', message: safeMessage(failure?.message || 'response 未通過驗證', secrets) }), executionId);
  // the generated evidence is re-checked at the end too; an integrity failure outranks any other failure of this execution
  try { verifyGeneratedVoice(coordinator, candidate.dir, execution.run_id); } catch (e) { failure = e; }
  const missing = content.confirmedMissHashes.filter(h => { try { return !ready(h); } catch { return true; } });
  const unknown = coordinator.get("SELECT COUNT(*) n FROM attempts WHERE execution_id = ? AND status = 'unknown'", executionId).n;
  const receiptProblem = /^RECEIPT_|^PINNED_CACHE_CHANGED$|^REQUEST_CHANGED$|^URL_CHANGED$|^STALE_DEPENDENCY$|^VOICE_EVIDENCE_CHANGED$/.test(failure?.code || '');
  const status = !missing.length && !failure ? 'completed' : unknown ? 'blocked' : failure?.code === 'RECEIPT_EXPIRED' ? 'expired' : receiptProblem ? 'blocked' : 'failed';
  coordinator.tx(() => {
    const e = coordinator.execution(executionId);
    if (e.status !== 'running' || e.fencing !== fencing) return; // superseded meanwhile: results stay quarantined in the candidate
    coordinator.run('UPDATE executions SET status = ?, updated_at = ?, error = ? WHERE execution_id = ?', status, now(), failure ? JSON.stringify({ code: codeOf(failure), message: safeMessage(failure.message, secrets, 400), missing }) : null, executionId);
    if (status === 'completed') coordinator.run("UPDATE receipts SET status = 'completed' WHERE receipt_id = ?", receipt.receipt_id);
    if (status === 'expired') coordinator.run("UPDATE receipts SET status = 'expired' WHERE receipt_id = ?", receipt.receipt_id);
    if (status === 'blocked' && receiptProblem) coordinator.run("UPDATE receipts SET status = 'revoked' WHERE receipt_id = ? AND status IN ('issued','claimed')", receipt.receipt_id);
  });
  return { status: coordinator.execution(executionId).status, missing, unknown, failure: failure && { code: codeOf(failure), message: safeMessage(failure.message, secrets, 400) } };
}

/** Ledger summary for the UI: initial hits, generated, unknown, failed, budget used. */
export function ledgerSummary(coordinator, runId) {
  return coordinator.all('SELECT * FROM executions WHERE run_id = ? ORDER BY sequence', runId).map(e => {
    const attempts = coordinator.attempts(e.execution_id), receipt = coordinator.receipt(e.receipt_id);
    return { executionId: e.execution_id, sequence: e.sequence, status: e.status, error: e.error && JSON.parse(e.error), receiptStatus: receipt.status, recoveryOf: receipt.receipt.recoveryOf, budget: receipt.receipt.budget, reservedChars: attempts.reduce((n, a) => n + a.reserved_chars, 0), networkAttempts: attempts.filter(a => a.network_attempted).length,
      attempts: attempts.map(a => ({ segmentHash: a.segment_hash, status: a.status, reservedChars: a.reserved_chars, httpStatus: a.http_status, providerRequestId: a.provider_request_id, providerBilledCharacters: null, intentAt: a.intent_at, finishedAt: a.finished_at, error: a.error, audioHash: a.audio_hash, alignmentHash: a.alignment_hash })) };
  });
}
