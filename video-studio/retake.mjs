// Human take decisions. Immutable coordinator snapshots are the trust root; candidate refs are verified before use.
// A historical take is explicit evidence reuse, NOT a cache entry for the new language request contract.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError } from './store.mjs';
import { now } from './coordinator.mjs';
import { jsonHash } from './hashing.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { validatePair } from './voice-envelope.mjs';
import { validateProduction } from './production-validation.mjs';
import { freeVoicePlan } from './free-voice-plan.mjs';
import { issueChallenge, verifyGeneratedVoice, revokeRun } from './paid-voice.mjs';

export function retakeEvidence(service, run) {
  const row = service.coordinator.get('SELECT * FROM retakes WHERE take_id = ?', run.inputs.retake.takeId);
  if (!row || row.new_run_id !== run.run_id || row.draft_id !== run.draft_id || row.snapshot_hash !== run.inputs.retake.snapshotHash) throw new StudioError('Retake trusted binding mismatch', 409);
  const snapshot = JSON.parse(row.snapshot);
  if (jsonHash(snapshot) !== row.snapshot_hash) throw new StudioError('Retake decision snapshot changed', 409);
  const base = service.coordinator.run2B(row.base_run_id), candidate = service.candidate(base);
  // Even after a restart/code revision, original evidence stays immutable. Never accept new hashes for changed bytes.
  candidate.verifyEngine();
  for (const ref of snapshot.evidence) candidate.verifyDeep(ref);
  const pairs = new Map(snapshot.reuse.map(p => [p.hash, p]));
  const sources = [{ name: 'explicit-sealed-take-reuse', audio: h => pairs.has(h) ? candidate.verify(pairs.get(h).audio) : path.join(candidate.dir, 'absent', `${h}.mp3`), alignment: h => pairs.has(h) ? candidate.verify(pairs.get(h).alignment) : path.join(candidate.dir, 'absent', `${h}.json`) }];
  if (run.inputs.activeTake) {
    const selected = service.candidate(run).readJson(run.inputs.activeTake);
    if (!row.selection || jsonHash(selected) !== row.selection || selected.takeId !== row.take_id) throw new StudioError('Active take selection changed', 409);
  } else if (row.selection) throw new StudioError('Active take reference missing', 409);
  return { row, snapshot, sources };
}

export async function retakePreview(service, draftId, { baseRunId, segmentId, revision, reject, reason }) {
  service.assertOpen();
  if (reject !== true || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new StudioError('必須明確人工拒絕舊 take 並說明原因', 409);
  const ctx = service.context(), draft = ctx.store.get(draftId), record = ctx.catalog.records.get(draft.contentId);
  if (draft.revision !== revision || !record || record.sourceHash !== draft.sourceHash) throw new StudioError('Retake source / revision stale', 409);
  const base = service.coordinator.run2B(baseRunId);
  if (!base || base.draft_id !== draftId || base.source_hash !== draft.sourceHash || base.decision_hash !== jsonHash(draft.decisions)) throw new StudioError('Retake base decisions / source mismatch', 409);
  if (service.jobs.size || service.coordinator.get("SELECT 1 FROM executions WHERE status IN ('running','issued','interrupted')")) throw new StudioError('執行中／已有未完成付費授權；不建立 retake', 409);
  const prior = service.coordinator.get("SELECT * FROM retakes WHERE draft_id = ? AND base_run_id = ? AND segment_id = ? AND status NOT IN ('selected','old_selected','stale')", draftId, baseRunId, segmentId);
  if (prior) {
    if (!prior.new_run_id) throw new StudioError('Retake preview 尚未完成；需人工檢查，不自動另建 take', 409);
    const run = service.assertFresh(prior.new_run_id), result = service.view(draftId);
    return run.state === 'awaiting_confirmation' ? { ...result, challenge: issueChallenge(service.coordinator, run.run_id, run.inputs.envelopes.at(-1).bytesHash) } : result;
  }
  const old = service.candidate(base); old.verifyEngine();
  const out = service.chain(base);
  if (!out.verify || !out.review || !out.voice) throw new StudioError('Retake 需要完整 verified human-review bundle', 409);
  const evidence = [...Object.values(base.inputs.inputRefs), ...base.inputs.envelopes, ...Object.values(out).flatMap(s => s.result.outputs)];
  for (const ref of evidence) old.verifyDeep(ref);
  const oldNarration = old.readJson(base.inputs.inputRefs.narration), oldCfg = service.voiceConfig(base);
  const oldPrepared = prepareNarration(oldNarration, oldCfg, { requireApiKey: false, env: {} });
  const oldBundle = old.readJson(out.voice.result.outputs.find(x => x.role === 'voiceBundle'));
  const target = oldPrepared.segments.find(s => s.id === segmentId && !s.silent);
  const rejectedPair = oldBundle.pairs.find(p => p.hash === target?.hash);
  if (!target || !rejectedPair) throw new StudioError('請選擇真正 spoken TTS unit；parts / silent 不能各自重送', 409);
  // Recompile decisions under current language contract; text and source are unchanged.
  const fresh = ctx.workflow.run(draftId, { revision });
  if (fresh.status !== 'voice_planned') throw new StudioError('Retake compile / validation / free plan FAIL', 409);
  const narration = ctx.workflow.read(fresh, 'narration'), episode = ctx.workflow.read(fresh, 'episode'), report = ctx.workflow.read(fresh, 'compileReport');
  const cfg = JSON.parse(fs.readFileSync(path.join(service.repoRoot, 'scripts/video/voices.json'), 'utf8'));
  const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} });
  if (oldPrepared.segments.length !== prepared.segments.length) throw new StudioError('Retake segment structure changed', 409);
  const takeId = randomUUID(), reuse = [];
  for (const s of prepared.segments) {
    const was = oldPrepared.segments.find(x => x.id === s.id), raw = narration.segments.find(x => x.id === s.id);
    if (!was || s.silent !== was.silent || jsonHash(s.parts ?? null) !== jsonHash(was.parts ?? null) || (!s.silent && (s.speak !== was.speak || s.kind !== was.kind || s.previousText !== was.previousText || s.nextText !== was.nextText || s.voice.voiceId !== was.voice.voiceId || s.voice.model !== was.voice.model || jsonHash(s.voice.settings) !== jsonHash(was.voice.settings) || s.lang !== was.lang))) throw new StudioError(`Retake ${s.id} contract 改變；不能固定重用`, 409);
    if (s.silent) continue;
    if (s.id === segmentId) { raw.ttsTake = { kind: 'retake', id: takeId }; continue; }
    const pair = oldBundle.pairs.find(p => p.hash === was.hash);
    if (!pair) throw new StudioError(`Missing reusable take ${s.id}`, 409);
    validatePair(was, oldPrepared.outputFormat, old.verify(pair.audio), fs.readFileSync(old.verify(pair.alignment), 'utf8'));
    raw.ttsTake = { kind: 'sealed-reuse', id: randomUUID(), hash: was.hash, languageCode: was.voice.languageCode ?? null, originalTakeId: was.voice.takeId ?? null };
    reuse.push({ segmentId: s.id, text: was.speak, language: was.lang, originalLanguageCode: was.voice.languageCode ?? null, ...pair });
  }
  const validation = validateProduction({ narration, episode }, cfg, report);
  if (validation.verdict !== 'PASS') throw new StudioError('Retake narration validation FAIL', 409);
  const plan = freeVoicePlan(narration, cfg, { has: h => reuse.some(p => p.hash === h) });
  if (plan.counts.miss !== 1 || plan.charsToGenerate !== target.chars) throw new StudioError('Retake budget / fixed reuse mismatch', 409);
  const snapshot = { version: 1, takeId, draftId, revision, sourceHash: draft.sourceHash, decisionHash: base.decision_hash, baseRunId, segmentId,
    rejected: { ...rejectedPair, segmentId, text: target.speak, status: 'human_rejected', reason: reason.trim() }, reuse, evidence, createdAt: now() };
  const snapshotHash = jsonHash(snapshot);
  service.coordinator.tx(() => {
    service.coordinator.run('INSERT INTO retakes VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)', takeId, draftId, baseRunId, segmentId, 'preparing', JSON.stringify(snapshot), snapshotHash, now());
    // Rejection invalidates every previous approval / downstream run BEFORE a new paid preview exists.
    for (const run of service.coordinator.runsForDraft(draftId)) {
      const reasons = [{ code: 'HUMAN_TAKE_REJECTED', message: `${segmentId} 原 take 被人工拒絕；原 bundle 與全部 downstream / verify / review 失效。` }];
      revokeRun(service.coordinator, run.run_id, reasons);
      service.coordinator.run("UPDATE reviews SET status = 'stale' WHERE run_id = ? AND status IN ('open','accepted')", run.run_id);
      service.coordinator.run("UPDATE runs SET state = 'stale', reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?", JSON.stringify(reasons), now(), run.run_id);
    }
    service.coordinator.run("UPDATE reviews SET status = 'changes_requested', decided_at = ?, receipt = ? WHERE run_id = ?", now(), JSON.stringify({ decision: 'changes_requested', segmentId, oldHash: target.hash, reason: reason.trim(), takeId }), baseRunId);
  });
  return service.preview(draftId, { revision, _retake: { takeId, segmentId, snapshotHash, rejected: snapshot.rejected, reuse, artifacts: { narration, episode, compileReport: report, validation, voicePlan: plan } } });
}

export async function selectRetake(service, draftId, { runId, takeId }) {
  service.assertOpen();
  const run = service.assertFresh(runId);
  if (run.draft_id !== draftId || run.inputs.retake?.takeId !== takeId) throw new StudioError('Take selection mismatch', 409);
  if (run.inputs.activeTake && service.chain(run).voice) return service.view(draftId); // same selection is idempotent, no generation
  if (run.state !== 'awaiting_take_selection' || service.jobs.has(runId)) throw new StudioError('新 take 尚未完整封存／仍在執行', 409);
  const { snapshot } = retakeEvidence(service, run), candidate = service.candidate(run);
  const prepared = prepareNarration(candidate.readJson(run.inputs.inputRefs.narration), service.voiceConfig(run), { requireApiKey: false, env: {} });
  const targetHash = prepared.segments.find(s => s.id === snapshot.segmentId).hash;
  const generated = verifyGeneratedVoice(service.coordinator, candidate.dir, runId, targetHash);
  if (!generated?.has(targetHash)) throw new StudioError('Retake 沒有 succeeded ledger evidence', 409);
  const active = { takeId, segmentId: snapshot.segmentId, segmentHash: targetHash, sourceHash: run.source_hash, envelopeHash: run.inputs.envelopes.at(-1).bytesHash,
    evidence: generated.get(targetHash), selectedAt: now(), actorId: 'local-owner' };
  if (!run.inputs.activeTake) {
    const ref = candidate.writeInput(`active-take-${takeId}.json`, active);
    service.coordinator.tx(() => {
      service.coordinator.run("UPDATE retakes SET status = 'selected', selection = ? WHERE take_id = ? AND selection IS NULL", jsonHash(active), takeId);
      service.coordinator.updateRun(runId, run.epoch, { inputs: { ...run.inputs, activeTake: ref }, state: 'ready' });
    });
  }
  const executionId = service.coordinator.get("SELECT execution_id FROM executions WHERE run_id = ? AND status = 'completed' ORDER BY sequence DESC", runId)?.execution_id;
  await service.runStep(service.assertFresh(runId), 'voice', async ({ attemptId }) => service.voiceResult(service.assertFresh(runId), attemptId, executionId));
  if (service.autoChain) service.startChain(runId);
  return service.view(draftId);
}

export function restoreOldTake(service, draftId, { runId, takeId }) {
  service.assertOpen();
  const run = service.coordinator.run2B(runId);
  if (!run || run.draft_id !== draftId || run.inputs.retake?.takeId !== takeId) throw new StudioError('語音版本與目前影片不符，請重新整理。', 409);
  if (!['awaiting_take_selection', 'awaiting_review', 'blocked', 'failed'].includes(run.state) || service.jobs.has(runId) || (['blocked', 'failed'].includes(run.state) && !run.inputs.activeTake)) throw new StudioError('目前不能切回原本語音，請重新整理。', 409);
  const { row } = retakeEvidence(service, run);
  const base = service.coordinator.run2B(row.base_run_id);
  const currentDraft = service.context().workflow.reconcile(draftId), current = service.binding(currentDraft);
  const sameArtifacts = currentDraft.status === 'voice_planned' && Object.keys(base?.inputs.bindings.artifacts || {}).every(k => base.inputs.bindings.artifacts[k] === current.artifacts[k]);
  const stale = base && base.draft_id === draftId ? service.staleness(base).filter(x => x.code !== 'COMPILE_ARTIFACTS_CHANGED' || !sameArtifacts) : [{ code: 'BASE_MISSING' }];
  if (stale.length) throw new StudioError(`原本影片的內容或證據已改變，不能直接恢復。請重新做免費預覽。(${stale.map(x => x.code).join('、')})`, 409);
  const out = service.chain(base);
  if (!out.voice || !out.verify || !out.review) throw new StudioError('原本影片已無法完整驗證，不能直接恢復。', 409);
  const session = service.candidate(base).readJson(out.review.result.outputs.find(x => x.role === 'session'));
  if (!session?.bundleHash) throw new StudioError('原本影片缺少人工檢查資料。', 409);
  service.coordinator.tx(() => {
    const reasons = [{ code: 'OLD_TAKE_CHOSEN', message: '使用者改選原本語音；新語音仍封存，但不再用於影片。' }];
    revokeRun(service.coordinator, runId, reasons);
    service.coordinator.run("UPDATE reviews SET status = 'stale' WHERE run_id = ? AND status = 'open'", runId);
    service.coordinator.run("UPDATE runs SET state = 'superseded', reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?", JSON.stringify(reasons), now(), runId);
    service.coordinator.run("UPDATE retakes SET status = 'old_selected' WHERE take_id = ?", takeId);
    service.coordinator.run('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)', randomUUID(), base.run_id, session.bundleHash, 'open', now());
    service.coordinator.updateRun(base.run_id, base.epoch, { inputs: { ...base.inputs, restoredOldTake: { fromRunId: runId, takeId, selectedAt: now() } }, state: 'awaiting_review', reason: null });
  });
  return service.view(draftId);
}
