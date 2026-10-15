// READ-ONLY production diagnosis. No Studio service, coordinator writes, provider/key access or artifact repair.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Candidate } from './candidate.mjs';
import { validatePair } from './voice-envelope.mjs';
import { bufferHash } from './hashing.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { assembleNarration } from '../scripts/video/voice/assemble.mjs';
import { decodeAudio, voicedBounds, rms, fade, writeWav, SAMPLE_RATE as SR } from '../scripts/video/voice/audio.mjs';
globalThis.fetch = () => { throw Error('Network forbidden: diagnosis'); };
const fsRead = fs.readFileSync;
fs.readFileSync = function(file, ...args) { assert.notEqual(path.basename(String(file)), '.env'); return fsRead.call(this, file, ...args); };
const production = path.resolve('video-studio/state/drafts/production'), draftId = '20ee16ed-e72f-4b06-9b4c-0387fc82b0f8';
const db = new DatabaseSync(path.join(production, 'coordinator.db'), { readOnly: true });
try {
  const run = db.prepare('SELECT * FROM runs WHERE draft_id=? AND run_id IN (SELECT run_id FROM executions) ORDER BY created_at DESC').get(draftId);
  assert.ok(run); const inputs = JSON.parse(run.inputs);
  const candidate = new Candidate(production, run.candidate_id, inputs.bindings.engine);
  candidate.verifyEngine();
  for (const ref of Object.values(inputs.inputRefs)) candidate.verifyDeep(ref);
  for (const ref of inputs.envelopes) candidate.verifyDeep(ref);
  const steps = db.prepare('SELECT * FROM steps WHERE run_id=? ORDER BY started_at').all(run.run_id);
  const succeeded = steps.filter(s => s.status === 'succeeded').map(s => ({ ...s, result: JSON.parse(s.result) }));
  for (const s of succeeded) for (const ref of s.result.outputs) candidate.verifyDeep(ref);
  const output = (step, role) => succeeded.findLast(s => s.step === step).result.outputs.find(r => r.role === role);
  const bundle = candidate.readJson(output('voice', 'voiceBundle'));
  const narration = candidate.readJson(inputs.inputRefs.narration), cfg = JSON.parse(candidate.engineFile('scripts/video/voices.json'));
  const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} });
  const paid = db.prepare('SELECT a.* FROM attempts a JOIN executions e ON e.execution_id=a.execution_id WHERE e.run_id=?').all(run.run_id);
  assert.equal(paid.length, 11); assert.ok(paid.every(a => a.status === 'succeeded' && a.network_attempted === 1 && a.http_status === 200));
  assert.equal(bundle.pairs.length, 11);
  const decoded = new Map(), evidence = [];
  for (const pair of bundle.pairs) {
    const entry = paid.find(a => a.segment_hash === pair.hash), seg = prepared.segments.find(s => s.hash === pair.hash);
    const audio = candidate.verify(pair.audio), alignment = candidate.verify(pair.alignment);
    assert.equal(bufferHash(fs.readFileSync(audio)), entry.audio_hash); assert.equal(bufferHash(fs.readFileSync(alignment)), entry.alignment_hash);
    const valid = validatePair(seg, prepared.outputFormat, audio, fs.readFileSync(alignment, 'utf8'));
    decoded.set(pair.hash, decodeAudio(audio)); evidence.push({ id: seg.id, hash: pair.hash, status: entry.status, httpStatus: entry.http_status, hashesMatchLedger: true, ...valid });
  }
  const plan = candidate.readJson(output('assemble', 'plan')), wav = decodeAudio(candidate.verify(output('assemble', 'wav'))), w = Math.round(SR * .01);
  const voicedIn = (from, to) => {
    let first = null, last = null;
    for (let i = Math.round(from * SR); i < Math.min(wav.length, Math.round(to * SR)); i += w) if (rms(wav, i, i + w) > .004) { first ??= i / SR; last = (i + w) / SR; }
    return { first, last };
  };
  const rows = [];
  for (const [i, l] of plan.lines.entries()) {
    if (l.silent) continue;
    const next = plan.lines[i + 1], voiced = voicedIn(l.start - .03, next ? Math.min(l.end + .06, next.start - .01) : l.end + .06);
    const onsetMinusStart = +(voiced.first - l.start).toFixed(3), endMinusVoicedEnd = +(l.end - voiced.last).toFixed(3);
    rows.push({ id: l.id, text: l.text, planStart: l.start, planEnd: l.end, voicedStart: voiced.first, voicedEnd: voiced.last,
      onsetSlackMs: +((voiced.first - l.start) * 1000).toFixed(3), endSlackMs: +((l.end - voiced.last) * 1000).toFixed(3),
      pass: !(onsetMinusStart < -.01 || onsetMinusStart > .06 || endMinusVoicedEnd < -.01 || endMinusVoicedEnd > .06) });
  }
  const reports = steps.filter(s => s.step === 'verify' && s.status === 'failed').map(s => {
    const file = path.join(candidate.dir, 'attempts/verify', s.attempt_id, 'docs-out/verification.json');
    const checks = JSON.parse(fs.readFileSync(file)).checks;
    const failed = checks.filter(c => !c.ok); assert.equal(failed.length, 1);
    assert.deepEqual(failed[0].detail.outside.map(r => r.id), ['story002']);
    return { attemptId: s.attempt_id, checks: checks.length, passed: checks.length - failed.length, outside: failed[0].detail.outside };
  });
  const cache = { has: h => bundle.pairs.some(p => p.hash === h), audioPath: h => candidate.verify(bundle.pairs.find(p => p.hash === h).audio),
    readAlignment: h => candidate.readJson(bundle.pairs.find(p => p.hash === h).alignment) };
  // Unmodified shared assembler, against the exact successful paid evidence. In-memory only, plus one disposable WAV.
  const assembled = assembleNarration(prepared, cache, { decode: file => decoded.get(bundle.pairs.find(p => candidate.abs(p.audio.path) === file).hash) });
  assert.deepEqual(assembled.plan, plan);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-verify-diagnosis-'));
  try {
    const file = path.join(temp, 'narration.wav'); writeWav(file, assembled.samples);
    assert.equal(bufferHash(fs.readFileSync(file)), output('assemble', 'wav').bytesHash);
  } finally {
    assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  }
  const seg = prepared.segments.find(s => s.id === 'story002'), raw = decoded.get(seg.hash), b = voicedBounds(raw);
  const from = Math.max(0, b.first - Math.round(.035 * SR)), to = Math.min(raw.length, b.last + Math.round(.05 * SR));
  const trimmed = raw.subarray(from, to), faded = fade(trimmed, Math.round(.006 * SR), Math.round(.006 * SR));
  const bounds = x => { const v = voicedBounds(x); return { duration: x.length / SR, first: v.first / SR, last: v.last / SR }; };
  const tail = [];
  for (let i = Math.round(1.25 * SR); i < raw.length; i += w) tail.push({ from: i / SR, to: Math.min(raw.length, i + w) / SR, rms: rms(raw, i, i + w) });
  const align = cache.readAlignment(seg.hash).alignment;
  const result = { schemaVersion: 1, draftId, revision: run.revision, runId: run.run_id, candidateId: run.candidate_id, runState: run.state,
    paidRequests: paid.reduce((n, a) => n + a.network_attempted, 0), successfulPaidRequests: evidence.length, additionalProviderRequests: 0,
    voiceEvidence: evidence, artifactIntegrity: 'engine/input closure, nested voice bundle, ledger audio/alignment hashes, all successful step outputs verified',
    lines: rows, failingLines: rows.filter(r => !r.pass), failedVerifyAttempts: reports,
    unmodifiedReassemble: { planIdentical: true, wavBytesIdentical: true, conclusion: 'Repeating current free pipeline reproduces the failure.' },
    story002: { original: bounds(raw), trim: { from: from / SR, to: to / SR }, beforeFade: bounds(trimmed), afterFade: bounds(faded),
      characterAlignmentEnd: align.character_end_times_seconds.at(-1), finalCharacter: align.characters.at(-1), tailRmsBlocks: tail },
    completedSteps: succeeded.map(s => ({ step: s.step, outputs: s.result.outputs.map(r => ({ role: r.role, path: r.path, hash: r.bytesHash })), report: s.step === 'mix' ? s.result.report : undefined })),
    rootCause: 'Shared trimClip measures voicedBounds BEFORE the 6ms fade; a terminal 10ms RMS-active transient at 1.59–1.60s retains the entire tail. Fade removes that transient but duration/timing is not recalculated. Final waveform voiced end is 315ms before plan end.',
    needsSharedPipelineChange: true, modifiedProductionArtifacts: false, toleranceChanged: false, approvalAllowed: false,
    recommendation: 'Re-measure final processed waveform and enforce existing HEAD_PAD/TAIL_PAD with shifted/clamped original alignment; no threshold/tolerance changes. Requires authorized shared revision + frozen regressions and integrity-safe reuse of ledger-sealed voice.' };
  const out = 'video-studio/state/qa/p6-verify-diagnosis.json'; fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ report: out, paidRequests: result.paidRequests, successfulPaidRequests: evidence.length, evidenceIntegrity: 'PASS', failingLines: result.failingLines,
    original: result.story002.original, beforeFade: result.story002.beforeFade, afterFade: result.story002.afterFade, planAndWavReassembleIdentical: true, needsSharedPipelineChange: true, additionalRequests: 0 }, null, 2));
} finally { db.close(); fs.readFileSync = fsRead; }
