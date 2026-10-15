// 2B production coordinator: voice_planned → (free preflight + envelope) → paid confirmation → voice → assemble → camera →
// audit → render → mix → verify → human review → approved. Every transition re-checks freshness against the human decisions,
// the source, the 2A artifacts, the Studio code and the pipeline closure; anything stale is superseded (never continued).
// productionReady is derived here (capabilityProfile 2B) and is true only for an approved, current, exact bundle.
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DraftStore, StudioError } from './store.mjs';
import { ProductionWorkflow } from './workflow.mjs';
import { Coordinator, now } from './coordinator.mjs';
import { Candidate, VoiceStore, engineDrift } from './candidate.mjs';
import { buildEnvelope, validatePair } from './voice-envelope.mjs';
import { issueChallenge, confirmReceipt, executeVoice, recoverLedger, revokeRun, ledgerSummary, DispatchStopped, verifyReceipt, markReceiptFailure, verifyGeneratedVoice } from './paid-voice.mjs';
import { assembleStep, cameraStep, auditStep, renderStep, mixStep, verifyStep, seamClips, cardBoundsDryRun, stepInputHash, StepFailure, layout } from './production-steps.mjs';
import { parityReport, linesFromTextForRefs } from './camera-solver.mjs';
import { VISUAL_POLICY } from './production-decisions.mjs';
import { jsonHash, fileEvidence, bufferHash } from './hashing.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { linesFromNarration } from '../scripts/video/voice/episode-refs.mjs';
import { frozenInventory, publicationGateOpen, promotionPreview, promote, recoverPublications } from './promotion.mjs';
import { retakePreview, selectRetake, restoreOldTake, retakeEvidence } from './retake.mjs';

export const CAPABILITY_PROFILE = '2B';
export const STEP_ORDER = ['voice', 'assemble', 'camera', 'audit', 'render', 'mix', 'verify', 'review'];
const MILESTONE = { voice: 'voice_generated', assemble: 'assembled', camera: 'camera_fitted', audit: 'audited', render: 'rendered', mix: 'mixed', verify: 'verified', review: 'awaiting_human_review' };
const TERMINAL = ['stale', 'superseded', 'changes_requested'];
const ARTIFACTS_2A = ['narration', 'episode', 'compileReport', 'validation', 'voicePlan'];
const VISUAL_CHECKLIST = [
  ['hook', 'Hook 保留懸念、只揭露足以停下來的資訊；視覺精簡'],
  ['streaming', '閱讀時下一段適度提前出現，沒有大片留白後突然跳出'],
  ['cards', '詞卡 / 詞組：黃色 handoff、詞義、例句、回到故事都清楚可讀'],
  ['quiz', 'Quiz 題目與選項可讀，答案沒有提前出現'],
  ['outro', 'Outro 文案正確，吉祥物停留到接近結尾'],
];

/** Reads ELEVENLABS_API_KEY from the repo-root .env only when a claimed paid execution asks for it; never placed in process.env. */
export function repoApiKey(repoRoot) {
  return () => {
    const file = path.join(repoRoot, '.env');
    const key = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')).ELEVENLABS_API_KEY : undefined;
    if (!key || /\s/.test(key.trim())) throw new DispatchStopped('API_KEY_MISSING', 'ELEVENLABS_API_KEY 未設定（repo-root .env）；沒有送出任何請求。');
    return key.trim();
  };
}

export class ProductionService {
  constructor({ draftsDir, productionDir, repoRoot, catalogLoader, loadedEngineHash, fetchImpl = globalThis.fetch, apiKey, promotion = { enabled: false }, log = () => {}, autoChain = true, localSteps = {} }) {
    // autoChain: after voice_generated the free local steps start by themselves (tests of the paid boundary turn it off)
    Object.assign(this, { draftsDir, productionDir, repoRoot, catalogLoader, loadedEngineHash, fetchImpl, promotion, log, autoChain });
    // the free local step implementations (tests may replace them to exercise chain gating without a browser; never the paid path)
    this.steps = { assembleStep, cameraStep, auditStep, renderStep, mixStep, verifyStep, ...localSteps };
    this.apiKey = apiKey || repoApiKey(repoRoot);
    this.coordinator = new Coordinator(productionDir);
    try {
      this.voiceStore = new VoiceStore(productionDir);
      this.jobs = new Map();
      this.promotionRoot = promotion.root || repoRoot;
      this.publicationRecovery = recoverPublications({ coordinator: this.coordinator, root: this.promotionRoot, lockDir: path.join(productionDir, 'locks') });
      this.recover();
    } catch (e) { this.coordinator.close(); throw e; } // never keep the lifetime lock after a failed start
  }
  close() { this.closed = true; this.coordinator.close(); }
  idle() { return Promise.allSettled([...this.jobs.values()]); }

  // ---------------- context / bindings ----------------
  context() { const catalog = this.catalogLoader(this.repoRoot), store = new DraftStore(this.draftsDir, catalog); return { catalog, store, workflow: new ProductionWorkflow(store, this.repoRoot, { loadedEngineHash: this.loadedEngineHash }) }; }
  binding(draft) {
    return { draftId: draft.id, revision: draft.revision, decisionHash: jsonHash(draft.decisions), sourceHash: draft.sourceHash, wfRunId: draft.workflow?.runId || null, studioEngineHash: this.loadedEngineHash, artifacts: Object.fromEntries(ARTIFACTS_2A.map(k => [k, draft.artifacts?.[k]?.hash || null])) };
  }
  // the trusted closure record lives in the coordinator's run row (written from the live repo), never in the snapshot
  candidate(run) { return new Candidate(this.productionDir, run.candidate_id, run.inputs?.bindings?.engine || null); }
  voiceConfig(run) { return JSON.parse(this.candidate(run).engineFile('scripts/video/voices.json').toString('utf8')); }
  /** Carry an explicitly selected immutable take through a display-only edit. Never silently fall back to the rejected take. */
  inheritedDisplayTake(draft, workflow) {
    const current = workflow.read(draft, 'narration');
    const withoutDisplay = d => ({ ...d, meaningDisplay: {}, meaningSpeech: d.meaningSpeech || {}, sourceDisplayOnly: d.sourceDisplayOnly || [], storyChinese: d.storyChinese ? { mode: d.storyChinese.mode } : undefined });
    for (const prior of this.coordinator.runsForDraft(draft.id).filter(r => r.inputs.activeTake).reverse()) {
      if (prior.source_hash !== draft.sourceHash) continue;
      const old = this.candidate(prior);
      let previousDecisions, selected, oldNarration;
      try {
        old.verifyEngine();
        previousDecisions = old.readJson(prior.inputs.inputRefs.decisions).decisions;
        selected = old.readJson(prior.inputs.activeTake);
        oldNarration = old.readJson(prior.inputs.inputRefs.narration);
      } catch { continue; }
      if (jsonHash(withoutDisplay(previousDecisions)) !== jsonHash(withoutDisplay(draft.decisions))) continue;
      const oldSegment = oldNarration.segments.find(s => s.id === selected.segmentId && s.ttsTake?.kind === 'retake' && s.ttsTake.id === selected.takeId);
      const newSegment = current.segments.find(s => s.id === selected.segmentId);
      if (!oldSegment || !newSegment || jsonHash({ ...oldSegment, ttsTake: undefined }) !== jsonHash(newSegment)) continue;
      const oldVoice = this.chain(prior).voice;
      if (!oldVoice) continue;
      old.verifyDeep(oldVoice.result.outputs.find(x => x.role === 'voiceBundle'));
      newSegment.ttsTake = structuredClone(oldSegment.ttsTake);
      return { narration: current, segmentId: selected.segmentId, takeId: selected.takeId, fromRunId: prior.run_id };
    }
    return null;
  }

  /** Every reason a run is no longer current. Empty = current. */
  staleness(run, ctx = this.context()) {
    const reasons = [], b = run.inputs.bindings;
    let draft;
    try { draft = ctx.workflow.reconcile(run.draft_id); } catch (e) { return [{ code: 'DRAFT_MISSING', message: e.message }]; }
    const current = this.binding(draft), record = ctx.catalog.records.get(draft.contentId);
    if (draft.revision !== b.revision || current.decisionHash !== b.decisionHash) reasons.push({ code: 'DECISIONS_CHANGED', message: '人工決策已改變（新 revision）；舊 run / receipt / approval 失效。' });
    if (!record || record.sourceHash !== b.sourceHash || draft.sourceHash !== b.sourceHash) reasons.push({ code: 'SOURCE_CHANGED', message: '來源文章已變更。' });
    const sameArtifacts = ARTIFACTS_2A.every(k => current.artifacts[k] === b.artifacts[k]);
    // A restored old take may have an equivalent, later free compile from the retake preview.
    // The coordinator records that explicit choice; all artifact bytes must still match.
    if (draft.status !== 'voice_planned' || !sameArtifacts || (current.wfRunId !== b.wfRunId && !run.inputs.restoredOldTake)) reasons.push({ code: 'COMPILE_ARTIFACTS_CHANGED', message: 'compile / validation / voice plan 已重做或失效。' });
    if (draft.quizReview?.status === 'needs_confirmation') reasons.push({ code: 'QUIZ_RECONFIRMATION_REQUIRED', message: 'Quiz 需要重新確認。' });
    if (ctx.workflow.engineHash() !== b.studioEngineHash) reasons.push({ code: 'STUDIO_ENGINE_CHANGED', message: 'Studio / shared helper 程式已改變；請重啟 Studio。' });
    const candidate = this.candidate(run);
    // P0-1: the copied closure is recomputed byte by byte against the trusted record, then the record against the live repo
    try { candidate.verifyEngine(); if (candidate.engine().hash !== b.engineManifestHash) throw new StudioError('trusted engine record ≠ run binding', 409); }
    catch (e) { reasons.push({ code: 'PIPELINE_COPY_CHANGED', message: `Candidate 的 pipeline 副本 / 可信紀錄不一致：${e.message}` }); }
    if (b.engine) { const drift = engineDrift(this.repoRoot, b.engine); if (drift) reasons.push({ code: 'PIPELINE_ENGINE_CHANGED', message: `pipeline 程式 / 設定 / 音訊資產已改變：${drift.join(', ')}` }); }
    // executable inputs, envelopes (with their pinned pairs) and preflight evidence: transitive, against the run row
    const sealedRefs = [...Object.entries(run.inputs.inputRefs || {}), ...(run.inputs.envelopes || []).map((e, i) => [`envelope-${i + 1}`, e]), ...(run.inputs.preflight ? [['preflight', run.inputs.preflight]] : [])];
    if (run.inputs.retake) {
      try { retakeEvidence(this, run); } catch (e) { reasons.push({ code: 'RETAKE_EVIDENCE_CHANGED', message: e.message }); }
    }
    for (const [name, ref] of sealedRefs) { try { candidate.verifyDeep(ref); } catch (e) { reasons.push({ code: 'SEALED_INPUT_CHANGED', message: `${name}: ${e.message}` }); } }
    // P0-2: paid voice evidence (bundle → every MP3 / alignment) cannot be regenerated locally; a changed pair supersedes the run
    const voice = this.coordinator.steps(run.run_id).filter(x => x.step === 'voice' && x.status === 'succeeded').at(-1);
    if (voice) { try { for (const ref of voice.result.outputs) candidate.verifyDeep(ref); } catch (e) { reasons.push({ code: 'VOICE_EVIDENCE_CHANGED', message: `語音 bundle 或其 MP3 / alignment 已改變：${e.message}` }); } }
    // …and so is every pair a (possibly partial, bundle-less) execution already generated, against the ledger's own byte hashes
    try { verifyGeneratedVoice(this.coordinator, candidate.dir, run.run_id); } catch (e) { reasons.push({ code: 'VOICE_EVIDENCE_CHANGED', message: e.message }); }
    if (this.coordinator.get("SELECT 1 FROM mutations WHERE draft_id = ? AND status = 'pending'", run.draft_id)) reasons.push({ code: 'MUTATION_PENDING', message: '草稿修改尚未完成；付費 / 製作暫停。' });
    return reasons;
  }
  supersede(run, reasons, state = 'stale') {
    this.coordinator.tx(() => {
      revokeRun(this.coordinator, run.run_id, reasons);
      this.coordinator.run("UPDATE reviews SET status = 'stale' WHERE run_id = ? AND status IN ('open','accepted')", run.run_id);
      this.coordinator.run('UPDATE runs SET state = ?, reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?', state, JSON.stringify(reasons), now(), run.run_id);
    });
    return this.coordinator.run2B(run.run_id);
  }
  reconcile(run, ctx) {
    if (TERMINAL.includes(run.state)) return run;
    const reasons = this.staleness(run, ctx);
    return reasons.length ? this.supersede(run, reasons) : run;
  }
  assertFresh(runId) {
    const run = this.reconcile(this.coordinator.run2B(runId));
    if (TERMINAL.includes(run.state)) throw new DispatchStopped('STALE_DEPENDENCY', `Run 已失效：${(run.reason || []).map(r => r.message).join(' ')}`);
    return run;
  }

  // ---------------- step chain ----------------
  stepInputs(name, run, out) {
    const i = run.inputs.inputRefs, o = (step, role) => out[step]?.result.outputs.find(x => x.role === role);
    switch (name) {
      case 'voice': return { narration: i.narration, envelope: run.inputs.envelopes?.at(-1), ...(run.inputs.retake ? { activeTake: run.inputs.activeTake || null } : {}) };
      case 'assemble': return { narration: i.narration, episode: i.episode, voiceBundle: o('voice', 'voiceBundle') };
      case 'camera': return { episode: i.episode, plan: o('assemble', 'plan'), wav: o('assemble', 'wav'), narration: i.narration };
      case 'audit': return { episode: o('camera', 'episode'), plan: o('assemble', 'plan'), wav: o('assemble', 'wav'), narration: i.narration };
      case 'render': return { episode: o('camera', 'episode'), plan: o('assemble', 'plan'), wav: o('assemble', 'wav'), narration: i.narration, auditSpec: o('audit', 'renderSpec') };
      case 'mix': return { episode: o('camera', 'episode'), plan: o('assemble', 'plan'), wav: o('assemble', 'wav'), narrationOnly: o('render', 'narrationOnly') };
      case 'verify': return { episode: o('camera', 'episode'), plan: o('assemble', 'plan'), wav: o('assemble', 'wav'), narration: i.narration, narrationOnly: o('render', 'narrationOnly'), final: o('mix', 'final') };
      // review is bound to the WHOLE current bundle (every artifact + every step's evidence), not to three media hashes
      case 'review': return { bundle: ['voice', 'assemble', 'camera', 'audit', 'render', 'mix', 'verify'].every(k => out[k]) ? jsonHash(this.bundleManifest(run, out)) : null };
    }
  }
  /** The current valid chain: latest succeeded attempt per step whose inputs are exactly the current predecessor outputs. */
  chain(run) { return this.chainState(run).out; }
  /** chain() plus where / why it stops; inputs that cannot be resolved (e.g. a changed sealed input) end the chain, never throw. */
  chainState(run) {
    const steps = this.coordinator.steps(run.run_id), out = {};
    let invalidation = null;
    for (const name of STEP_ORDER) {
      let inputs;
      try { inputs = this.stepInputs(name, run, out); }
      catch (e) { invalidation = { step: name, code: 'STEP_INPUT_UNAVAILABLE', message: e.message }; break; }
      if (Object.values(inputs).some(v => !v)) break;
      const inputHash = stepInputHash(inputs), s = steps.filter(x => x.step === name && x.status === 'succeeded' && x.input_hash === inputHash).at(-1);
      if (!s) break;
      // transitive: every output and every artifact it references (e.g. voice bundle → MP3 / alignment) must match its sealed bytes
      try { s.graph = s.result.outputs.map(ref => [ref.role, this.candidate(run).verifyDeep(ref)]); } catch (e) {
        this.coordinator.run("UPDATE steps SET status = 'invalidated', result = ? WHERE attempt_id = ?", JSON.stringify({ ...s.result, invalidated: e.message }), s.attempt_id);
        invalidation = { step: name, code: 'STEP_OUTPUT_CHANGED', message: e.message };
        break;
      }
      out[name] = s;
    }
    return { out, invalidation };
  }
  milestone(run, out = this.chain(run)) {
    const review = this.coordinator.get("SELECT * FROM reviews WHERE run_id = ? AND status = 'accepted' ORDER BY decided_at DESC", run.run_id);
    if (out.review && review && review.bundle_hash === out.review.result.report.bundleHash) return 'approved';
    for (const name of [...STEP_ORDER].reverse()) if (out[name]) return MILESTONE[name];
    const e = this.coordinator.get("SELECT status FROM executions WHERE run_id = ? ORDER BY sequence DESC", run.run_id);
    if (e?.status === 'running') return 'voice_generating';
    if (e?.status === 'issued') return 'voice_confirmed';
    return 'voice_planned';
  }
  async runStep(run, name, fn) {
    const blocker = this.deterministicRetryBlocker(run);
    if (blocker?.step === name) throw new StepFailure(blocker.code, blocker.message, { blocked: true, detail: blocker });
    const attemptId = randomUUID(), inputs = this.stepInputs(name, run, this.chain(run)), inputHash = stepInputHash(inputs);
    this.coordinator.run('INSERT INTO steps VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)', attemptId, run.run_id, name, 'running', now(), inputHash, run.epoch, '[]');
    const base = { schemaVersion: 1, runId: run.run_id, candidateId: run.candidate_id, revision: run.revision, step: name, attemptId, inputManifestHash: inputHash, engineManifestHash: run.inputs.bindings.engineManifestHash, fencingToken: run.epoch, productionReady: false };
    const pids = [], onSpawn = pid => { pids.push(pid); this.coordinator.run('UPDATE steps SET child_pids = ? WHERE attempt_id = ?', JSON.stringify(pids), attemptId); };
    try {
      const r = await fn({ attemptId, inputs, onSpawn });
      const fresh = this.coordinator.run2B(run.run_id);
      if (TERMINAL.includes(fresh.state) || fresh.epoch !== run.epoch) throw new StepFailure('SUPERSEDED_DURING_STEP', 'Run 在步驟執行中失效；結果隔離，不接到目前 draft。', { blocked: true });
      const result = { ...base, status: 'succeeded', startedAt: this.coordinator.get('SELECT started_at FROM steps WHERE attempt_id = ?', attemptId).started_at, finishedAt: now(), outputs: r.outputs, report: r.report, errors: [], warnings: r.warnings || [], unresolved: [], exitCode: 0 };
      this.candidate(run).sealJson(name, attemptId, 'completion', `completion-${name}.json`, result);
      this.coordinator.run("UPDATE steps SET status = 'succeeded', finished_at = ?, result = ? WHERE attempt_id = ?", result.finishedAt, JSON.stringify(result), attemptId);
      return result;
    } catch (e) {
      const blocked = e instanceof StepFailure ? e.blocked : e instanceof DispatchStopped;
      const result = { ...base, status: blocked ? 'blocked' : 'failed', finishedAt: now(), outputs: [], errors: [{ code: e.code || 'STEP_ERROR', path: name, message: String(e.message).slice(0, 4000), detail: e.detail ?? null }], warnings: e.warnings || [], unresolved: [], exitCode: 1 };
      this.coordinator.run('UPDATE steps SET status = ?, finished_at = ?, result = ? WHERE attempt_id = ?', result.status, result.finishedAt, JSON.stringify(result), attemptId);
      const fresh = this.coordinator.run2B(run.run_id);
      if (!TERMINAL.includes(fresh.state)) this.coordinator.run('UPDATE runs SET state = ?, reason = ?, updated_at = ? WHERE run_id = ?', result.status, JSON.stringify(result.errors), now(), run.run_id);
      throw e;
    }
  }

  // ---------------- preflight / envelope ----------------
  retake(draftId, input) { return retakePreview(this, draftId, input); }
  selectTake(draftId, input) { return selectRetake(this, draftId, input); }
  restoreTake(draftId, input) { return restoreOldTake(this, draftId, input); }
  async rebuildAfterUpdate(draftId, { runId, revision }) {
    this.assertOpen();
    const ctx = this.context(), draft = ctx.store.get(draftId), base = this.coordinator.run2B(runId);
    if (!base || base.draft_id !== draftId || base.revision !== revision || draft.revision !== revision || base.source_hash !== draft.sourceHash || base.decision_hash !== jsonHash(draft.decisions)) throw new StudioError('內容已改變，請回到免費檢查確認最新草稿。', 409);
    if (ctx.workflow.engineHash() !== this.loadedEngineHash) throw new StudioError('排版程式已更新，請先重新啟動 Studio，再按免費重建。', 409);
    const pipelineChanged = base.inputs.bindings.engine && engineDrift(this.repoRoot, base.inputs.bindings.engine);
    if (base.inputs.bindings.studioEngineHash === this.loadedEngineHash && !pipelineChanged) throw new StudioError('目前沒有新的製作修正；相同失敗內容不能重複重建。', 409);
    if (this.jobs.size) throw new StudioError('仍有製作正在執行，請稍候。', 409);
    const voice = this.chain(base).voice;
    if (!voice) throw new StudioError('既有語音無法完整驗證，請回到免費檢查。', 409);
    const old = this.candidate(base); old.verifyDeep(voice.result.outputs.find(x => x.role === 'voiceBundle'));
    const fresh = ctx.workflow.run(draftId, { revision });
    if (fresh.status !== 'voice_planned') throw new StudioError('免費檢查尚未通過，請查看內容檢查結果。', 409);
    // This action never confirms a paid receipt. preview can only reuse verified audio or show misses.
    return this.preview(draftId, { revision });
  }
  async preview(draftId, { revision, recoveryRunId = null, _retake = null } = {}) {
    this.assertOpen();
    const ctx = this.context();
    const draft = ctx.workflow.reconcile(draftId);
    if (draft.revision !== revision) throw new StudioError('草稿已更新，請重新載入。', 409);
    if (recoveryRunId) return this.recoveryPreview(draft, recoveryRunId, ctx);
    const problems = this.preflightProblems(draft, ctx);
    if (problems.length) throw Object.assign(new StudioError(`Production preflight BLOCK：${problems.map(p => p.message).join(' ')}`, 409), { problems });
    const binding = this.binding(draft);
    for (const r of this.coordinator.runsForDraft(draftId).map(x => this.reconcile(x, ctx)).filter(x => !TERMINAL.includes(x.state))) {
      if (r.inputs.retake) {
        if (r.state === 'awaiting_confirmation') return { ...this.view(draftId), challenge: issueChallenge(this.coordinator, r.run_id, r.inputs.envelopes.at(-1).bytesHash) };
        return { ...this.view(draftId), notice: '沿用 immutable retake；不另建全部 segments 的付費 preview。' };
      }
      const started = this.coordinator.get('SELECT 1 FROM executions WHERE run_id = ?', r.run_id) || Object.keys(this.chain(r)).length;
      if (started) return { ...this.view(draftId), notice: '這個 revision 已有付費 / 製作中的 run；沿用，不建立第二份授權。' };
      this.supersede(r, [{ code: 'REPLACED_BY_NEW_PREVIEW', message: '已用新的免費預覽取代（尚未付費）。' }], 'superseded');
    }
    const inheritedTake = _retake ? null : this.inheritedDisplayTake(draft, ctx.workflow);
    const candidateCreated = Candidate.create(this.productionDir, this.repoRoot), { candidate, engine } = candidateCreated;
    const inputRefs = { decisions: candidate.writeInput('decisions.json', { draftId, revision: draft.revision, decisions: draft.decisions, sourceHash: draft.sourceHash, quizReview: draft.quizReview }) };
    for (const k of ARTIFACTS_2A) inputRefs[k] = candidate.writeInput(`${k}.json`, _retake?.artifacts[k] || (k === 'narration' && inheritedTake ? inheritedTake.narration : fs.readFileSync(ctx.workflow.safeFile(draft.artifacts[k].path))));
    const runId = randomUUID();
    const inputs = { bindings: { ...binding, engineManifestHash: engine.hash, engine: { files: engine.files, hash: engine.hash } }, inputRefs: { ...inputRefs, engineManifest: candidateCreated.manifestRef }, envelopes: [], preflight: null };
    if (_retake) inputs.retake = { takeId: _retake.takeId, snapshotHash: _retake.snapshotHash };
    if (inheritedTake) inputs.inheritedTake = { segmentId: inheritedTake.segmentId, takeId: inheritedTake.takeId, fromRunId: inheritedTake.fromRunId };
    this.coordinator.run('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)', runId, draftId, draft.revision, binding.decisionHash, draft.sourceHash, binding.wfRunId, candidate.id, now(), now(), 'voice_planned', 'preflight', JSON.stringify(inputs), CAPABILITY_PROFILE);
    if (_retake) this.coordinator.run('UPDATE retakes SET new_run_id = ?, status = ? WHERE take_id = ?', runId, 'awaiting_confirmation', _retake.takeId);
    let run = this.coordinator.run2B(runId);
    const narration = candidate.readJson(inputRefs.narration), episode = candidate.readJson(inputRefs.episode), cfg = this.voiceConfig(run);
    // time references: every helper must find the same word (text tokens; real alignment is checked again later)
    const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} }), lineMap = linesFromNarration(prepared);
    const parity = parityReport(linesFromTextForRefs(lineMap), episode);
    // card bounds / horizontal overflow, measured on the real renderer with a synthetic (non-production) plan
    const silent = new Map(prepared.segments.filter(s => s.silent).map(s => [s.id, s.duration])), langs = new Map(prepared.segments.map(s => [s.id, s.lang]));
    const ordered = [...lineMap.values()].map(l => ({ ...l, duration: silent.get(l.id), lang: langs.get(l.id) ?? langs.get(prepared.segments.find(s => s.parts?.some(p => p.id === l.id))?.id) }));
    let cards;
    try { cards = await cardBoundsDryRun({ candidate, attemptId: randomUUID(), contentId: draft.contentId, narration, episode, linesInOrder: ordered }); }
    catch (e) { cards = { ok: false, error: e.message, tooTall: [], overflow: [] }; }
    const preflight = { version: 1, policy: VISUAL_POLICY, parity, cards, checkedAt: now(), note: '付費後仍可能因真實 alignment / 幾何無解而停止；屆時不會重送語音。' };
    const preflightRef = candidate.writeInput('preflight.json', preflight);
    const blocked = [...parity.problems, ...(cards.error ? [{ code: 'PREFLIGHT_RENDERER_FAILED', message: cards.error }] : []), ...cards.tooTall.map(c => ({ code: 'CARD_TOO_TALL', path: c.id, message: `詞卡 ${c.id} 高 ${c.innerHeight}px，超過可見高度 ${cards.limit}px；付費前 BLOCK（不刪詞、不縮字）。` })), ...cards.overflow.map(o => ({ code: 'HORIZONTAL_OVERFLOW', message: o }))];
    inputs.preflight = preflightRef;
    if (blocked.length) {
      run = this.coordinator.updateRun(runId, run.epoch, { inputs, state: 'blocked', reason: blocked });
      return this.view(draftId);
    }
    const envelope = this.envelope(run, candidate, narration, cfg, inputRefs, engine);
    if (inheritedTake && envelope.requests.some(r => r.segmentIds.includes(inheritedTake.segmentId))) throw new StudioError('已選語音的封存檔無法驗證；停止免費重建，避免改用被拒絕的舊語音或再次收費。', 409);
    if (_retake) {
      if (envelope.requests.length !== 1 || !envelope.requests[0].segmentIds.includes(_retake.segmentId) || envelope.requests[0].takeId !== _retake.takeId) throw new StudioError('Retake 必須只包含所選 take 的 1 request', 409);
      // Historical refs belong to a DIFFERENT candidate; external trust root retains/verifies them.
      // This candidate's envelope contains only summary hashes plus its own verified pinned refs.
      const { audio, alignment, ...rejected } = _retake.rejected;
      envelope.retake = { takeId: _retake.takeId, rejected: { ...rejected, audioHash: audio.bytesHash, alignmentHash: alignment.bytesHash }, reuse: _retake.reuse.map(({ audio, alignment, ...p }) => ({ ...p, audioHash: audio.bytesHash, alignmentHash: alignment.bytesHash })), note: '原 take 人工拒絕；其他 segments 固定重用原始封存 contract，不宣稱是新 language_code 的 cache。新 take 成功後需明確選為 active。' };
    }
    const envelopeRef = candidate.writeInput('envelope-1.json', envelope);
    inputs.envelopes = [envelopeRef];
    run = this.coordinator.updateRun(runId, run.epoch, { inputs, state: envelope.requests.length ? 'awaiting_confirmation' : 'ready' });
    if (!envelope.requests.length) { await this.freeVoice(run); if (this.autoChain) this.startChain(runId); return this.view(draftId); }
    const challenge = issueChallenge(this.coordinator, runId, envelopeRef.bytesHash);
    return { ...this.view(draftId), challenge };
  }
  envelope(run, candidate, narration, cfg, inputRefs, engine, { localHits = false } = {}) {
    const repoAudio = h => path.join(this.repoRoot, 'voice-cache', `${h}.mp3`), repoAlign = h => path.join(this.repoRoot, 'scripts/video/narration/alignment', `${h}.json`);
    const sources = [
      ...(run.inputs.retake ? retakeEvidence(this, run).sources : []),
      ...(localHits ? [{ name: 'candidate-sealed', audio: h => path.join(candidate.dir, 'voice/sealed', `${h}.mp3`), alignment: h => path.join(candidate.dir, 'voice/sealed', `${h}.json`) }, { name: 'candidate-pinned', audio: h => path.join(candidate.dir, 'voice/pinned', `${h}.mp3`), alignment: h => path.join(candidate.dir, 'voice/pinned', `${h}.json`) }] : []),
      { name: 'studio-voice-store', audio: h => this.voiceStore.paths(h).audio, alignment: h => this.voiceStore.paths(h).alignment },
      { name: 'repo-voice-cache', audio: repoAudio, alignment: repoAlign },
    ];
    return buildEnvelope({ candidate, narration, voiceConfig: cfg, sources, pinDir: localHits ? `voice/pinned-r${Date.now()}` : 'voice/pinned', bindings: {
      runId: run.run_id, candidateId: run.candidate_id, draftId: run.draft_id, revision: run.revision, sourceHash: run.source_hash, decisionHash: run.decision_hash,
      narrationBytesHash: inputRefs.narration.bytesHash, compiledEpisodeBytesHash: inputRefs.episode.bytesHash, validationHash: inputRefs.validation.bytesHash, voicePlanHash: inputRefs.voicePlan.bytesHash, engineManifestHash: engine.hash,
    } });
  }
  preflightProblems(draft, ctx) {
    const p = [], add = (code, message) => p.push({ code, message });
    if (draft.status !== 'voice_planned' || !draft.steps.some(s => s.name === 'voicePlan' && s.status === 'succeeded')) add('VOICE_PLAN_REQUIRED', '先完成 compile → validation → 免費 voice plan（目前狀態不是 voice_planned）。');
    if (draft.quizReview?.status !== 'confirmed') add('QUIZ_NOT_CONFIRMED', 'Quiz 尚未確認。');
    if (!draft.decisions.production) add('PRODUCTION_DECISIONS_REQUIRED', '付費前請先確認 Outro、配樂、逐句翻譯與 visual / timing policy。');
    // Hook copy is governed by the hash-bound compiler/shared validation, including explicit zh:null.
    // Do not duplicate that contract here by requiring Chinese display text before payment.
    let report = null;
    try { report = ctx.workflow.read(draft, 'compileReport'); } catch { add('COMPILE_REPORT_UNAVAILABLE', '無法讀取 compile report。'); }
    for (const u of report?.unresolved || []) if (u.resolvedBy === 'decision' || !u.resolvedBy) add('DECISION_UNRESOLVED', `${u.code}：${u.message}`);
    if (report?.blocked?.length) add('COMPILER_BLOCKED', report.blocked.map(b => b.code).join(', '));
    // canonical collisions: a candidate that could never be promoted is not produced (and never paid for)
    const id = draft.contentId, d = draft.decisions;
    if (fs.existsSync(path.join(this.repoRoot, 'scripts/video/episodes', `${id}-auto.json`)) || fs.existsSync(path.join(this.repoRoot, 'docs', `${id}-auto`))) add('CANONICAL_DESTINATION_EXISTS', `正式 ${id} episode / docs 已存在（含 frozen）；不製作會撞到正式資產的 candidate。`);
    const legacy = { TOEFL: [1, 2] };
    const taken = (legacy[d.series] || []).includes(d.seriesEpisode) || fs.readdirSync(path.join(this.repoRoot, 'scripts/video/episodes')).filter(f => f.endsWith('.json')).some(f => { try { const e = JSON.parse(fs.readFileSync(path.join(this.repoRoot, 'scripts/video/episodes', f), 'utf8')); return e.series === d.series && e.seriesEpisode === d.seriesEpisode; } catch { return false; } });
    if (taken) add('SERIES_EPISODE_COLLISION', `${d.series} #${d.seriesEpisode} 已被正式 episode 使用。`);
    try { frozenInventory(this.repoRoot); } catch (e) { add('FROZEN_INVENTORY_INVALID', e.message); }
    return p;
  }
  assertOpen() { const gate = publicationGateOpen(this.coordinator); if (!gate.open) throw new StudioError(`Publication gate 關閉：${gate.reason}`, 409); }

  /** All hits: voice_generated from validated pinned pairs, no receipt, nothing paid. */
  async freeVoice(run) {
    if (run.inputs.retake && !run.inputs.activeTake) throw new StudioError('Retake 必須人工選擇 active take 才能建立 voice bundle', 409);
    await this.runStep(run, 'voice', async ({ attemptId }) => this.voiceResult(run, attemptId, null));
  }
  voiceResult(run, attemptId, executionId) {
    const candidate = this.candidate(run), envelope = candidate.readJson(run.inputs.envelopes.at(-1));
    const narration = candidate.readJson(run.inputs.inputRefs.narration), cfg = this.voiceConfig(run);
    const prepared = prepareNarration(narration, cfg, { requireApiKey: false, env: {} }), pairs = [];
    const generated = verifyGeneratedVoice(this.coordinator, candidate.dir, run.run_id); // a generated pair counts only as recorded in the ledger
    for (const s of prepared.segments) {
      if (s.silent || pairs.some(p => p.hash === s.hash)) continue;
      const dirs = [...(generated.has(s.hash) ? ['voice/sealed'] : []), ...fs.readdirSync(path.join(candidate.dir, 'voice')).filter(d => d.startsWith('pinned')).map(d => `voice/${d}`)];
      const dir = dirs.find(d => fs.existsSync(path.join(candidate.dir, d, `${s.hash}.mp3`)) && fs.existsSync(path.join(candidate.dir, d, `${s.hash}.json`)));
      if (!dir) throw new StepFailure('VOICE_INCOMPLETE', `${s.id} 沒有已驗證的音訊`, { blocked: true });
      const audio = path.join(candidate.dir, dir, `${s.hash}.mp3`), alignment = path.join(candidate.dir, dir, `${s.hash}.json`);
      validatePair(s, prepared.outputFormat, audio, fs.readFileSync(alignment, 'utf8'));
      pairs.push({ hash: s.hash, segment: s.id, origin: dir === 'voice/sealed' ? 'generated' : envelope.pinned.find(p => p.hash === s.hash)?.origin || 'pinned', audio: { path: candidate.rel(audio), ...fileEvidence(audio) }, alignment: { path: candidate.rel(alignment), ...fileEvidence(alignment) } });
    }
    const bundle = { version: 1, narrationId: prepared.id, executionId, pairs, ledger: executionId ? ledgerSummary(this.coordinator, run.run_id) : [], paid: Boolean(executionId) };
    return { outputs: [candidate.sealJson('voice', attemptId, 'voiceBundle', 'voice-bundle.json', bundle)], report: { pairs: pairs.length, generated: pairs.filter(p => p.origin === 'generated').length, initialHits: pairs.filter(p => p.origin !== 'generated').length, paid: Boolean(executionId) } };
  }

  // ---------------- paid confirmation / execution ----------------
  async confirm(draftId, { runId, challenge, idempotencyKey, budget, acknowledgements }) {
    this.assertOpen();
    let run = this.coordinator.run2B(runId);
    if (!run || run.draft_id !== draftId) throw new StudioError('Unknown run', 404);
    run = this.reconcile(run);
    if (TERMINAL.includes(run.state)) throw new StudioError(`Run 已失效，不能付費：${(run.reason || []).map(r => r.message).join(' ')}`, 409);
    const envelopeRef = run.inputs.envelopes.at(-1), envelope = this.candidate(run).readJson(envelopeRef);
    if (!envelope.requests.length) throw new StudioError('沒有需要付費的 request', 409);
    const { execution, replayed } = confirmReceipt(this.coordinator, { run, envelope, envelopeRef, challenge, idempotencyKey, acknowledgements, expectedBudget: budget });
    if (!replayed) { this.coordinator.run("UPDATE runs SET state = 'running', updated_at = ? WHERE run_id = ?", now(), runId); this.startVoice(runId, execution.execution_id); }
    return { ...this.view(draftId), executionId: execution.execution_id, replayed };
  }
  startVoice(runId, executionId) {
    if (this.jobs.has(runId)) return this.jobs.get(runId);
    const job = (async () => {
      const run = this.coordinator.run2B(runId), candidate = this.candidate(run);
      let result;
      try {
        result = await executeVoice({ coordinator: this.coordinator, candidate, voiceStore: this.voiceStore, executionId, freshness: () => this.assertFresh(runId), fetchImpl: this.fetchImpl, apiKey: this.apiKey, voiceConfig: this.voiceConfig(run), narration: candidate.readJson(run.inputs.inputRefs.narration), envelope: candidate.readJson(run.inputs.envelopes.find(e => e.bytesHash === this.coordinator.receipt(this.coordinator.execution(executionId).receipt_id).envelope_hash)), log: this.log });
      } catch (e) { result = { status: 'failed', failure: { code: e.code || e.name, message: e.message } }; }
      const fresh = this.coordinator.run2B(runId);
      if (TERMINAL.includes(fresh.state)) return;
      if (result.status === 'completed') {
        if (fresh.inputs.retake && !fresh.inputs.activeTake) {
          this.coordinator.run("UPDATE runs SET state = 'awaiting_take_selection', reason = NULL, updated_at = ? WHERE run_id = ?", now(), runId);
          this.coordinator.run("UPDATE retakes SET status = 'generated' WHERE take_id = ?", fresh.inputs.retake.takeId);
          return;
        }
        this.coordinator.run("UPDATE runs SET state = 'running', reason = NULL, updated_at = ? WHERE run_id = ?", now(), runId);
        await this.runStep(this.coordinator.run2B(runId), 'voice', async ({ attemptId }) => this.voiceResult(this.coordinator.run2B(runId), attemptId, executionId));
        if (this.autoChain) return this.chainJob(runId);
        this.coordinator.run("UPDATE runs SET state = 'ready', updated_at = ? WHERE run_id = ? AND state = 'running'", now(), runId);
        return;
      }
      const reason = [{ code: result.unknown ? 'UNKNOWN_PROVIDER_OUTCOME' : result.failure?.code || 'VOICE_FAILED', message: result.unknown ? '有請求結果未知（可能已扣額）；不自動重送。需要人工恢復確認。' : `語音產生停止：${result.failure?.message || '部分 segment 未完成'}`, missing: result.missing }];
      this.coordinator.run('UPDATE runs SET state = ?, reason = ?, updated_at = ? WHERE run_id = ?', result.unknown ? 'blocked' : 'failed', JSON.stringify(reason), now(), runId);
    })().catch(e => this.log(`voice job error: ${e.stack || e}`)).finally(() => this.jobs.delete(runId));
    this.jobs.set(runId, job);
    return job;
  }
  /** Residual misses after a failed / unknown execution need a NEW receipt with the double-charge acknowledgement. */
  recoveryPreview(draft, runId, ctx) {
    let run = this.reconcile(this.coordinator.run2B(runId), ctx);
    if (!run || run.draft_id !== draft.id || TERMINAL.includes(run.state)) throw new StudioError('Run 已失效，請重新預覽', 409);
    const last = this.coordinator.get('SELECT * FROM executions WHERE run_id = ? ORDER BY sequence DESC', runId);
    if (!last || !['failed', 'blocked', 'interrupted', 'expired'].includes(last.status)) throw new StudioError('沒有需要恢復的付費 execution', 409);
    // the double-charge acknowledgement is required only when a previous request may actually have reached the provider
    const reached = this.coordinator.get("SELECT COUNT(*) n FROM attempts a JOIN executions e ON a.execution_id = e.execution_id WHERE e.run_id = ? AND a.network_attempted = 1 AND a.status IN ('unknown','failed')", runId).n > 0;
    if (this.jobs.has(runId)) throw new StudioError('執行中', 409);
    const candidate = this.candidate(run), narration = candidate.readJson(run.inputs.inputRefs.narration);
    const envelope = this.envelope(run, candidate, narration, this.voiceConfig(run), run.inputs.inputRefs, candidate.engine(), { localHits: true });
    if (run.inputs.retake) envelope.retake = candidate.readJson(run.inputs.envelopes.at(-1)).retake;
    envelope.recovery = reached ? { of: last.execution_id, warning: '先前的請求可能已扣額；重送可能再次扣額。' } : { of: last.execution_id, warning: null, note: '先前的授權已過期 / 失效，沒有任何請求送出；這是新的確認。' };
    const ref = candidate.writeInput(`envelope-${run.inputs.envelopes.length + 1}.json`, envelope);
    const inputs = { ...run.inputs, envelopes: [...run.inputs.envelopes, ref] };
    run = this.coordinator.updateRun(runId, run.epoch, { inputs, state: 'awaiting_confirmation', reason: null });
    if (!envelope.requests.length) {
      if (run.inputs.retake && !run.inputs.activeTake) this.coordinator.run("UPDATE runs SET state = 'awaiting_take_selection' WHERE run_id = ?", runId);
      else this.freeVoice(run).then(() => this.startChain(runId)).catch(e => this.log(String(e)));
      return this.view(draft.id);
    }
    return { ...this.view(draft.id), challenge: issueChallenge(this.coordinator, runId, ref.bytesHash, { recoveryOf: reached ? last.execution_id : null }) };
  }
  /** Resume an interrupted execution of the SAME receipt (only never-attempted hashes; unknown outcomes stop). */
  resumeVoice(draftId, runId) {
    const run = this.reconcile(this.coordinator.run2B(runId));
    if (!run || run.draft_id !== draftId || TERMINAL.includes(run.state)) throw new StudioError('Run 已失效', 409);
    if (this.jobs.has(runId)) return this.view(draftId); // a double click returns the job already running, never a second claim
    const e = this.coordinator.get('SELECT * FROM executions WHERE run_id = ? ORDER BY sequence DESC', runId);
    if (!e || !['issued', 'interrupted', 'failed'].includes(e.status)) throw new StudioError('沒有可續跑的 execution（需要新的確認時請用恢復付費）', 409);
    try { verifyReceipt(this.coordinator, this.coordinator.get('SELECT * FROM receipts WHERE receipt_id = ?', e.receipt_id)); }
    catch (err) { markReceiptFailure(this.coordinator, e, err); throw new StudioError(`${err.message}（不送出請求；請用恢復付費建立新的確認）`, 409); }
    if (this.coordinator.get("SELECT COUNT(*) n FROM attempts WHERE execution_id = ? AND status = 'unknown'", e.execution_id).n) throw new StudioError('有未知結果的付費請求；不能沿用舊授權續跑，需要恢復確認', 409);
    this.coordinator.run("UPDATE runs SET state = 'running', updated_at = ? WHERE run_id = ?", now(), runId);
    this.startVoice(runId, e.execution_id);
    return this.view(draftId);
  }

  // ---------------- free local chain ----------------
  deterministicRetryBlocker(run, out = this.chain(run)) {
    if (TERMINAL.includes(run.state)) return null;
    for (const [step, predecessor, codes] of [
      ['camera', 'assemble', ['CAMERA_AUDIT_UNRESOLVED', 'CAMERA_UNSATISFIABLE', 'CAMERA_REVERSAL_REQUIRED']],
      ['audit', 'camera', ['LAYOUT_AUDIT_FAILED', 'EXTENDED_AUDIT_FAILED']],
      ['verify', 'mix', ['VERIFY_FAILED']],
    ]) {
      if (!out[predecessor] || out[step]) continue;
      const inputHash = stepInputHash(this.stepInputs(step, run, out));
      const failed = this.coordinator.steps(run.run_id).filter(s => s.step === step && ['failed','blocked'].includes(s.status) && s.input_hash === inputHash &&
        s.result?.engineManifestHash === run.inputs.bindings.engineManifestHash && s.result?.errors?.some(e => codes.includes(e.code))).at(-1);
      if (failed) return { code: `DETERMINISTIC_${step.toUpperCase()}_BLOCKED`, step, inputHash, failedAttemptId: failed.attempt_id,
        message: `相同影片資料的「${step === 'camera' ? '鏡頭排版' : step === 'audit' ? '畫面檢查' : '影片驗證'}」已確定失敗。重按不會修好。請先修改相關內容或選擇另一個語音版本，再重新建立免費影片。` };
    }
    return null;
  }
  startChain(runId) { if (!this.jobs.has(runId)) { const j = this.chainJob(runId).catch(e => this.log(`chain error: ${e.stack || e}`)).finally(() => this.jobs.delete(runId)); this.jobs.set(runId, j); } return this.jobs.get(runId); }
  resume(draftId, runId) {
    let run = this.coordinator.run2B(runId);
    if (!run || run.draft_id !== draftId) throw new StudioError('Unknown run', 404);
    run = this.reconcile(run);
    if (TERMINAL.includes(run.state)) throw new StudioError('Run 已失效，不能續跑', 409);
    if (!this.chain(run).voice) throw new StudioError('語音尚未完成；本機步驟不能開始', 409);
    if (this.jobs.has(runId)) return this.view(draftId);
    const blocker = this.deterministicRetryBlocker(run);
    if (blocker) throw Object.assign(new StudioError(blocker.message, 409), { problems: [blocker] });
    this.coordinator.run("UPDATE runs SET state = 'running', reason = NULL, updated_at = ? WHERE run_id = ?", now(), runId);
    this.startChain(runId);
    return this.view(draftId);
  }
  async chainJob(runId) {
    for (const name of STEP_ORDER.slice(1)) {
      if (this.closed) return;
      let run;
      try { run = this.assertFresh(runId); } catch { return; }
      const out = this.chain(run);
      if (out[name]) continue;
      const id = this.coordinator.get('SELECT draft_id FROM runs WHERE run_id = ?', runId).draft_id, ctx = this.context(), draft = ctx.store.get(id), contentId = draft.contentId;
      const candidate = this.candidate(run), i = run.inputs.inputRefs, o = (step, role) => out[step].result.outputs.find(x => x.role === role);
      const common = { candidate, contentId, productionDir: this.productionDir };
      try {
        await this.runStep(run, name, async ({ attemptId, onSpawn }) => {
          if (name === 'assemble') return this.steps.assembleStep({ ...common, attemptId, onSpawn, narrationRef: i.narration, episodeRef: i.episode, voiceBundle: candidate.readJson(o('voice', 'voiceBundle')), voiceConfig: this.voiceConfig(run) });
          if (name === 'camera') return this.steps.cameraStep({ ...common, attemptId, onSpawn, episodeRef: i.episode, planRef: o('assemble', 'plan'), wavRef: o('assemble', 'wav'), narrationRef: i.narration });
          if (name === 'audit') return this.steps.auditStep({ ...common, attemptId, onSpawn, episodeRef: o('camera', 'episode'), planRef: o('assemble', 'plan'), wavRef: o('assemble', 'wav'), narrationRef: i.narration });
          if (name === 'render') return this.steps.renderStep({ ...common, attemptId, onSpawn, episodeRef: o('camera', 'episode'), planRef: o('assemble', 'plan'), wavRef: o('assemble', 'wav'), narrationRef: i.narration, auditSpecRef: o('audit', 'renderSpec') });
          if (name === 'mix') return this.steps.mixStep({ ...common, attemptId, onSpawn, episodeRef: o('camera', 'episode'), planRef: o('assemble', 'plan'), wavRef: o('assemble', 'wav'), narrationOnlyRef: o('render', 'narrationOnly') });
          if (name === 'verify') return this.steps.verifyStep({ ...common, attemptId, onSpawn, episodeRef: o('camera', 'episode'), planRef: o('assemble', 'plan'), wavRef: o('assemble', 'wav'), narrationRef: i.narration, narrationOnlyRef: o('render', 'narrationOnly'), finalRef: o('mix', 'final'), mixReport: out.mix.result.report });
          if (name === 'review') return this.openReview(run, out, attemptId);
        });
      } catch { return; }
    }
    const run = this.coordinator.run2B(runId);
    if (!TERMINAL.includes(run.state)) this.coordinator.run("UPDATE runs SET state = 'awaiting_review', reason = NULL, updated_at = ? WHERE run_id = ?", now(), runId);
  }

  // ---------------- human review ----------------
  bundleManifest(run, out) {
    // contentId from the run's own sealed narration (deterministic; no catalog / draft read on every chain evaluation)
    const candidate = this.candidate(run), contentId = candidate.readJson(run.inputs.inputRefs.narration).id, draft = { contentId }, L = layout(contentId);
    const pick = (step, role, dest) => { const r = out[step].result.outputs.find(x => x.role === role); return { role, step, path: r.path, bytesHash: r.bytesHash, size: r.size, canonical: dest }; };
    const bundle = candidate.readJson(out.voice.result.outputs.find(x => x.role === 'voiceBundle'));
    const artifacts = [
      pick('camera', 'episode', L.episode), { role: 'narration', step: 'inputs', ...run.inputs.inputRefs.narration, canonical: L.narration }, pick('assemble', 'manifest', L.manifest),
      pick('assemble', 'plan', L.plan), pick('assemble', 'wav', L.wav), pick('assemble', 'assembly', L.assembly), pick('audit', 'layoutAudit', `${L.docs}/layout-audit.json`),
      pick('audit', 'renderSpec', `${L.docs}/render.json`), pick('verify', 'verification', `${L.docs}/verification.json`), pick('mix', 'final', `outputs/${draft.contentId}-studio-final.mp4`),
      ...(out.mix.result.outputs.some(x => x.role === 'mixVerification') ? [pick('mix', 'mixVerification', `${L.docs}/mix-verification.json`)] : []),
      ...bundle.pairs.map(p => ({ role: `alignment:${p.hash}`, step: 'voice', path: p.alignment.path, bytesHash: p.alignment.bytesHash, size: p.alignment.size, canonical: L.alignment(p.hash) })),
    ];
    return { version: 1, kind: 'studio-production-bundle', candidateId: run.candidate_id, runId: run.run_id, draftId: run.draft_id, revision: run.revision, contentId: draft.contentId, sourceHash: run.source_hash, decisionHash: run.decision_hash, engineManifestHash: run.inputs.bindings.engineManifestHash, studioEngineHash: run.inputs.bindings.studioEngineHash, artifacts, evidence: Object.fromEntries(['voice', 'assemble', 'camera', 'audit', 'render', 'mix', 'verify'].map(s => [s, { attemptId: out[s].attempt_id, inputHash: out[s].input_hash, outputs: out[s].result.outputs.map(o => ({ role: o.role, path: o.path, bytesHash: o.bytesHash, size: o.size })), graph: out[s].graph || null, warnings: (out[s].result.warnings || []).map(w => w.code) }])), localOnly: bundle.pairs.map(p => ({ hash: p.hash, audio: p.audio })) };
  }
  openReview(run, out, attemptId) {
    const candidate = this.candidate(run), manifest = this.bundleManifest(run, out), bundleHash = jsonHash(manifest);
    const plan = candidate.readJson(out.assemble.result.outputs.find(x => x.role === 'plan'));
    const seams = out.assemble.result.report.seams;
    const clips = seamClips({ candidate, attemptId, seams, voiceBundle: candidate.readJson(out.voice.result.outputs.find(x => x.role === 'voiceBundle')), wavRef: out.assemble.result.outputs.find(x => x.role === 'wav'), planLines: plan.lines });
    const compile = candidate.readJson(run.inputs.inputRefs.compileReport);
    const warnings = [
      ...out.assemble.result.warnings, ...out.camera.result.warnings, ...out.audit.result.warnings,
      ...compile.warnings.filter(w => !['DRAFT_ARTIFACT_ONLY'].includes(w.code)),
      ...compile.unresolved.filter(u => u.resolvedBy === 'review'),
    ].map((w, k) => ({ id: `w${k + 1}`, code: w.code, message: w.message, t: w.t ?? null }));
    const session = { version: 1, bundleHash, seams: seams.map((s, k) => ({ ...s, clips: clips[k] })), warnings, visualChecklist: VISUAL_CHECKLIST.map(([id, text]) => ({ id, text })), machine: { verify: out.verify.result.report.checks, mix: out.mix.result.report, audit: out.audit.result.report, camera: out.camera.result.report } };
    const outputs = [candidate.sealJson('review', attemptId, 'bundle', 'bundle.json', manifest), candidate.sealJson('review', attemptId, 'session', 'review-session.json', session), ...clips.flatMap(c => c.clips.map(x => x.ref))];
    this.coordinator.run('INSERT INTO reviews VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)', randomUUID(), run.run_id, bundleHash, 'open', now());
    return { outputs, report: { bundleHash, seams: seams.length, warnings: warnings.length } };
  }
  decideReview(draftId, { runId, bundleHash, decision, acknowledgements = {}, notes = [], comment = '', idempotencyKey }) {
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)) throw new StudioError('Idempotency key missing');
    const prior = this.coordinator.get('SELECT * FROM reviews WHERE idempotency_key = ?', idempotencyKey);
    if (prior) { if (prior.bundle_hash !== bundleHash) throw new StudioError('Idempotency key 已用於其他 bundle', 409); return this.view(draftId); }
    let run = this.coordinator.run2B(runId);
    if (!run || run.draft_id !== draftId) throw new StudioError('Unknown run', 404);
    run = this.reconcile(run);
    if (TERMINAL.includes(run.state)) throw new StudioError('Run 已失效；舊頁面的驗收無效。', 409);
    const out = this.chain(run);
    if (!out.review || this.milestone(run, out) !== 'awaiting_human_review') throw new StudioError('目前沒有可驗收的 verified bundle', 409);
    const session = this.candidate(run).readJson(out.review.result.outputs.find(x => x.role === 'session'));
    if (session.bundleHash !== bundleHash) throw new StudioError('驗收的 bundle 不是目前的 bundle（409）', 409);
    const review = this.coordinator.get("SELECT * FROM reviews WHERE run_id = ? AND bundle_hash = ? AND status = 'open'", runId, bundleHash);
    if (!review) throw new StudioError('Review session 不存在或已結束', 409);
    if (decision === 'accept') {
      const missing = [...session.seams.filter(s => acknowledgements.seams?.[s.id] !== true).map(s => `接縫 ${s.id} 未確認實聽`), ...session.visualChecklist.filter(v => acknowledgements.visual?.[v.id] !== true).map(v => `視覺項目「${v.text}」未確認`), ...session.warnings.filter(w => acknowledgements.warnings?.[w.id] !== true).map(w => `warning ${w.code} 未確認`)];
      if (missing.length) throw new StudioError(`尚不能接受：${missing.join('；')}`, 409);
      const receipt = { version: 1, bundleHash, runId, candidateId: run.candidate_id, revision: run.revision, decisionHash: run.decision_hash, acknowledgements, comment: String(comment).slice(0, 2000), actorId: 'local-owner', decidedAt: now() };
      receipt.receiptHash = jsonHash(receipt);
      this.coordinator.tx(() => {
        this.coordinator.run("UPDATE reviews SET status = 'accepted', decided_at = ?, idempotency_key = ?, receipt = ? WHERE review_id = ? AND status = 'open'", receipt.decidedAt, idempotencyKey, JSON.stringify(receipt), review.review_id);
        this.coordinator.run("UPDATE runs SET state = 'approved', reason = NULL, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?", now(), runId);
      });
    } else if (decision === 'changes') {
      if (!Array.isArray(notes) || !notes.length || notes.some(n => typeof n?.text !== 'string' || !n.text.trim())) throw new StudioError('需要修改時請寫下問題（時間點 / 類別 / 說明）');
      const receipt = { version: 1, bundleHash, runId, decision: 'changes_requested', notes: notes.map(n => ({ category: String(n.category || 'other').slice(0, 40), t: typeof n.t === 'number' ? n.t : null, text: n.text.slice(0, 2000) })), decidedAt: now() };
      this.coordinator.tx(() => {
        this.coordinator.run("UPDATE reviews SET status = 'changes_requested', decided_at = ?, idempotency_key = ?, receipt = ? WHERE review_id = ?", receipt.decidedAt, idempotencyKey, JSON.stringify(receipt), review.review_id);
        this.coordinator.run("UPDATE runs SET state = 'changes_requested', reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?", JSON.stringify([{ code: 'CHANGES_REQUESTED', message: '人工驗收要求修改；請修改決策（新 revision）後重新製作，語音依 hash 重用。' }]), now(), runId);
      });
    } else throw new StudioError('decision must be accept or changes');
    return this.view(draftId);
  }

  // ---------------- decisions edits go through the coordinator ----------------
  beginMutation(draftId, fromRevision, fromDecisionHash) {
    const id = randomUUID();
    this.coordinator.tx(() => {
      this.coordinator.run('INSERT INTO mutations VALUES (?, ?, ?, ?, ?, ?, NULL)', id, draftId, fromRevision, fromDecisionHash, 'pending', now());
      for (const r of this.coordinator.runsForDraft(draftId).filter(r => !TERMINAL.includes(r.state))) {
        revokeRun(this.coordinator, r.run_id, [{ code: 'DECISIONS_EDITED', message: '人工決策修改中' }]);
        this.coordinator.run("UPDATE reviews SET status = 'stale' WHERE run_id = ? AND status IN ('open','accepted')", r.run_id);
        this.coordinator.run("UPDATE runs SET state = 'stale', reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ?", JSON.stringify([{ code: 'DECISIONS_CHANGED', message: '人工決策已修改（新 revision）；舊 run / receipt / approval 失效。' }]), now(), r.run_id);
      }
    });
    return id;
  }
  finishMutation(id, committed) { this.coordinator.run('UPDATE mutations SET status = ?, finished_at = ? WHERE mutation_id = ?', committed ? 'committed' : 'aborted', now(), id); }

  // ---------------- restart recovery ----------------
  recover() {
    const c = this.coordinator;
    const candidateDirOf = executionId => { const e = c.execution(executionId), r = c.run2B(e.run_id); return new Candidate(this.productionDir, r.candidate_id).dir; };
    recoverLedger(c, candidateDirOf);
    for (const e of c.all("SELECT * FROM executions WHERE status IN ('issued','interrupted','failed')")) {
      try { verifyReceipt(c, c.get('SELECT * FROM receipts WHERE receipt_id = ?', e.receipt_id), { statuses: ['issued', 'claimed'] }); }
      catch (err) { markReceiptFailure(c, e, err); }
    }
    for (const s of c.all("SELECT * FROM steps WHERE status = 'running'")) {
      const pids = JSON.parse(s.child_pids || '[]'), alive = pids.filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
      c.run("UPDATE steps SET status = 'interrupted', finished_at = ?, result = ? WHERE attempt_id = ?", now(), JSON.stringify({ status: 'interrupted', errors: [{ code: 'STUDIO_RESTARTED', message: 'Studio 在步驟完成前停止；不推定成功，需重新執行（新的 attempt）。' }], aliveChildPids: alive }), s.attempt_id);
      c.run("UPDATE runs SET state = ?, reason = ?, updated_at = ? WHERE run_id = ? AND state NOT IN ('stale','superseded','changes_requested')", alive.length ? 'blocked' : 'interrupted', JSON.stringify([{ code: alive.length ? 'ORPHAN_WORKER_ALIVE' : 'STUDIO_RESTARTED', message: alive.length ? `舊的 worker process 仍在執行（PID ${alive.join(', ')}）；確認結束後再續跑。` : 'Studio 重啟；可按「續跑本機步驟」從失敗的步驟重新執行。' }]), now(), s.run_id);
    }
    c.run("UPDATE runs SET state = 'interrupted', updated_at = ? WHERE state = 'running'", now());
    for (const m of c.all("SELECT * FROM mutations WHERE status = 'pending'")) {
      let committed = false;
      try { committed = JSON.parse(fs.readFileSync(path.join(this.draftsDir, `${m.draft_id}.json`), 'utf8')).revision > m.from_revision; } catch { /* draft missing */ }
      this.finishMutation(m.mutation_id, committed);
    }
    // Selection can commit just before a crash interrupts the FREE voice-bundle step. Keep the decision, require an
    // explicit resume of that same selection; GET/restart never rebuilds or requests another take.
    for (const t of c.all("SELECT * FROM retakes WHERE status = 'selected'")) {
      const run = c.run2B(t.new_run_id);
      if (run && !TERMINAL.includes(run.state) && !this.staleness(run).length && !this.chain(run).voice)
        c.run("UPDATE runs SET state = 'awaiting_take_selection', updated_at = ? WHERE run_id = ?", now(), run.run_id);
    }
  }

  // ---------------- canonical promotion (separately authorized; disabled unless the owner enables it) ----------------
  approvedBundle(draftId) {
    const ctx = this.context(), run = this.coordinator.runsForDraft(draftId).map(r => this.reconcile(r, ctx)).filter(r => r.state === 'approved').at(-1);
    if (!run) throw new StudioError('沒有已人工接受且仍有效的 bundle', 409);
    const out = this.chain(run);
    if (this.milestone(run, out) !== 'approved') throw new StudioError('Approval 已失效', 409);
    const manifest = this.candidate(run).readJson(out.review.result.outputs.find(x => x.role === 'bundle'));
    const review = this.coordinator.get("SELECT * FROM reviews WHERE run_id = ? AND status = 'accepted' ORDER BY decided_at DESC", run.run_id);
    return { run, manifest, bundleHash: jsonHash(manifest), approval: JSON.parse(review.receipt) };
  }
  promotionPreview(draftId) {
    if (!this.promotion.enabled) throw new StudioError('Promotion 機制已實作，但本輪未開通（需 owner 另行授權，以 --enable-promotion 啟動）。', 403);
    const { run, manifest, bundleHash } = this.approvedBundle(draftId);
    return { preview: promotionPreview({ root: this.promotionRoot, manifest }), bundleHash, challenge: issueChallenge(this.coordinator, run.run_id, `promotion:${bundleHash}`) };
  }
  promote(draftId, { bundleHash, challenge, acknowledgements = {} }) {
    if (!this.promotion.enabled) throw new StudioError('Promotion 未開通', 403);
    const { run, manifest, bundleHash: current, approval } = this.approvedBundle(draftId);
    if (bundleHash !== current) throw new StudioError('Bundle 已改變；請重新預覽', 409);
    if (acknowledgements.notAtomic !== true || acknowledgements.notFreeze !== true) throw new StudioError('請確認「跨資料夾安裝不是原子操作」與「這不是 freeze」', 409);
    const c = typeof challenge === 'string' && this.coordinator.get('SELECT * FROM challenges WHERE challenge_hash = ?', bufferHash(Buffer.from(`studio-challenge:${challenge}`)));
    if (!c || c.envelope_hash !== `promotion:${bundleHash}` || c.consumed_at || Date.parse(c.expires_at) <= Date.now()) throw new StudioError('Promotion 確認碼無效 / 已使用 / 過期', 409);
    this.coordinator.run('UPDATE challenges SET consumed_at = ? WHERE challenge_hash = ?', now(), c.challenge_hash);
    const candidate = this.candidate(run);
    return promote({ coordinator: this.coordinator, root: this.promotionRoot, stagingRoot: path.join(this.productionDir, 'promotion'), lockDir: path.join(this.productionDir, 'locks'), manifest, approval,
      source: t => candidate.verify({ path: t.path, bytesHash: t.bytesHash, size: t.size }),
      fresh: () => { const r = this.reconcile(this.coordinator.run2B(run.run_id)); if (r.state !== 'approved' || this.milestone(r) !== 'approved') throw new StudioError('Approval / revision 已失效；停止 promotion', 409); } });
  }

  /** Any accepted review whose bundle is not the current one is stale; an approved run without a current approval is not approved. */
  syncApproval(run, milestone) {
    const out = milestone === 'approved' ? this.chain(run) : null, current = out?.review?.result.report.bundleHash || null;
    const stale = this.coordinator.all("SELECT review_id FROM reviews WHERE run_id = ? AND status = 'accepted' AND bundle_hash IS NOT ?", run.run_id, current);
    if (!stale.length && !(run.state === 'approved' && milestone !== 'approved')) return;
    this.coordinator.tx(() => {
      for (const r of stale) this.coordinator.run("UPDATE reviews SET status = 'stale' WHERE review_id = ?", r.review_id);
      if (run.state === 'approved' && milestone !== 'approved') this.coordinator.run("UPDATE runs SET state = 'failed', reason = ?, updated_at = ?, epoch = epoch + 1 WHERE run_id = ? AND state = 'approved'", JSON.stringify([{ code: 'APPROVAL_INVALIDATED', message: '已接受的 bundle 不再是目前的 bundle（某個 artifact 或 evidence 已改變）；approval 失效，需要重新驗證與人工驗收。' }]), now(), run.run_id);
    });
  }

  // ---------------- views / media ----------------
  view(draftId) {
    const ctx = this.context();
    const runs = this.coordinator.runsForDraft(draftId).map(r => this.reconcile(r, ctx));
    let run = runs.filter(r => r.state !== 'superseded').at(-1) || runs.at(-1);
    if (!run) return { capabilityProfile: CAPABILITY_PROFILE, run: null, readiness: { productionReady: false, canGenerate: false, canRender: false, canReview: false, canPromote: false } };
    // a terminal run never shows a stored milestone as evidence: it is recomputed from the verified chain (its reviews are stale, so never 'approved')
    const { out: verified, invalidation: chainBreak } = this.chainState(run), out = TERMINAL.includes(run.state) ? {} : verified, milestone = this.milestone(run, verified);
    this.syncApproval(run, milestone);
    run = this.coordinator.run2B(run.run_id); // the sync may have revoked the approval
    if (milestone !== run.milestone) this.coordinator.run('UPDATE runs SET milestone = ? WHERE run_id = ?', milestone, run.run_id);
    const candidate = this.candidate(run), safeRead = ref => { try { return ref ? candidate.readJson(ref) : null; } catch { return null; } };
    const envelope = safeRead(run.inputs.envelopes?.at(-1)), preflight = safeRead(run.inputs.preflight);
    const reviewRow = this.coordinator.get('SELECT * FROM reviews WHERE run_id = ? ORDER BY created_at DESC, rowid DESC', run.run_id);
    const session = out.review ? safeRead(out.review.result.outputs.find(x => x.role === 'session')) : null;
    const approved = milestone === 'approved' && run.state === 'approved';
    const running = this.jobs.has(run.run_id);
    const retryBlocker = this.deterministicRetryBlocker(run, out);
    return {
      capabilityProfile: CAPABILITY_PROFILE,
      retryBlocker,
      recovery: { restartRequired: ctx.workflow.engineHash() !== this.loadedEngineHash, canRebuildAfterUpdate: ctx.workflow.engineHash() === this.loadedEngineHash && (run.inputs.bindings.studioEngineHash !== this.loadedEngineHash || Boolean(run.inputs.bindings.engine && engineDrift(this.repoRoot, run.inputs.bindings.engine))) && Boolean(verified.voice) },
      run: { runId: run.run_id, candidateId: run.candidate_id, revision: run.revision, milestone, state: running ? 'running' : run.state, reason: run.reason, createdAt: run.created_at, updatedAt: run.updated_at, running },
      preflight, envelope: envelope && { counts: envelope.counts, segments: envelope.segments, requests: envelope.requests.map(({ url, ...r }) => r), budget: envelope.budget, retryPolicy: envelope.retryPolicy, estimatedUniqueTextChars: envelope.estimatedUniqueTextChars, maxRequestChars: envelope.maxRequestChars, billingDisclaimer: envelope.billingDisclaimer, pinned: envelope.pinned.map(p => ({ hash: p.hash, origin: p.origin })), quarantined: envelope.quarantined, recovery: envelope.recovery || null, retake: envelope.retake || null, envelopeHash: run.inputs.envelopes.at(-1)?.bytesHash },
      executions: ledgerSummary(this.coordinator, run.run_id),
      steps: this.coordinator.steps(run.run_id).map(s => ({ step: s.step, attemptId: s.attempt_id, status: s.status, startedAt: s.started_at, finishedAt: s.finished_at, current: out[s.step]?.attempt_id === s.attempt_id, report: s.result?.report ?? null, errors: s.result?.errors ?? [], warnings: s.result?.warnings ?? [] })),
      review: session && { reviewId: reviewRow?.review_id, status: reviewRow?.status, bundleHash: session.bundleHash, seams: session.seams, warnings: session.warnings, visualChecklist: session.visualChecklist, machine: session.machine, receipt: reviewRow?.receipt && JSON.parse(reviewRow.receipt) },
      readiness: { productionReady: approved, stale: TERMINAL.includes(run.state), canGenerate: run.state === 'awaiting_confirmation' && !running, canRender: Boolean(out.voice) && !TERMINAL.includes(run.state) && !running, canReview: milestone === 'awaiting_human_review', canPromote: approved && this.promotion.enabled === true },
      invalidation: this.invalidation(run, out, chainBreak, ctx),
      history: runs.filter(r => r !== run).map(r => ({ runId: r.run_id, state: r.state, milestone: r.milestone, createdAt: r.created_at, reason: r.reason })).slice(-10),
    };
  }
  /**
   * Machine-readable invalidation for the UI (read-only: derives, never repairs / rebuilds / pays): why the run is not current, which
   * steps still count, and what the owner has to do next. A terminal run keeps no current step; a new run starts from a new free preview.
   */
  invalidation(run, out, chainBreak, ctx) {
    const terminal = TERMINAL.includes(run.state), reasons = Array.isArray(run.reason) ? run.reason : [];
    if (!terminal && !chainBreak) return null;
    let draftStatus = null;
    try { draftStatus = ctx.store.get(run.draft_id).status; } catch { /* draft missing: recompile is required anyway */ }
    const codes = new Set(reasons.map(r => r.code)), recompile = draftStatus !== 'voice_planned';
    const next = [
      ...(codes.has('STUDIO_ENGINE_CHANGED') ? [{ code: 'RESTART_STUDIO', message: 'Studio / shared helper 程式已改變：先重啟 Studio。' }] : []),
      ...(codes.has('MUTATION_PENDING') ? [{ code: 'FINISH_DECISION_EDIT', message: '草稿修改尚未完成：完成或放棄修改。' }] : []),
      ...(recompile ? [{ code: 'RECOMPILE', message: '重新 compile → validation → 免費 voice plan（新的 revision / artifacts）。' }] : []),
      ...(terminal ? [
        { code: 'NEW_FREE_PREVIEW', message: '建立新的免費預覽（新的 run / candidate / envelope）；舊 run、receipt、approval 不會恢復。' },
        { code: 'CONFIRM_IF_MISSES', message: '新預覽若仍有 cache miss，需要重新確認付費；仍完好且已驗證的語音依 hash 免費命中，被改過的不會被當作 hit。' },
        { code: 'REGENERATE_LOCAL_STEPS', message: 'assemble → camera → audit → render → mix → verify 在新 run 重新執行（免費、本機）。' },
        { code: 'HUMAN_REVIEW', message: '新的 bundle 需要重新人工驗收。' },
      ] : [{ code: 'RESUME_LOCAL_STEPS', message: `步驟 ${chainBreak.step} 的輸入無法驗證；之後的步驟不算數，需要重新執行。` }]),
    ];
    return {
      stale: terminal, state: run.state, productionReady: false, reasons, chainBreak,
      steps: STEP_ORDER.map(step => ({ step, current: Boolean(out[step]) })), invalidatedFrom: terminal ? STEP_ORDER[0] : chainBreak.step,
      requires: { recompile, newFreePreview: terminal, paidConfirmation: terminal ? 'only_if_new_preview_has_misses' : 'no', humanReview: true },
      nextActions: next,
    };
  }
  /** Media for the current run only: final MP4 after verify, seam clips and the review sheet in review. */
  media(draftId, role) {
    const ctx = this.context(), run = this.coordinator.runsForDraft(draftId).map(r => this.reconcile(r, ctx)).filter(r => !TERMINAL.includes(r.state)).at(-1);
    if (!run) throw new StudioError('沒有目前有效的 run', 404);
    if (['take-old', 'take-new'].includes(role) && run.inputs.retake) {
      const { snapshot } = retakeEvidence(this, run);
      if (role === 'take-old') {
        const base = this.coordinator.run2B(snapshot.baseRunId), old = this.candidate(base), ref = snapshot.rejected.audio;
        return { file: old.verify(ref), etag: ref.bytesHash, contentType: 'audio/mpeg' };
      }
      const candidate = this.candidate(run), prepared = prepareNarration(candidate.readJson(run.inputs.inputRefs.narration), this.voiceConfig(run), { requireApiKey: false, env: {} });
      const hash = prepared.segments.find(s => s.id === snapshot.segmentId)?.hash;
      const trusted = hash && verifyGeneratedVoice(this.coordinator, candidate.dir, run.run_id, hash).get(hash);
      if (!trusted) throw new StudioError('新語音尚未完成，無法試聽', 404);
      return { file: path.join(candidate.dir, 'voice', 'sealed', `${hash}.mp3`), etag: trusted.audioHash, contentType: 'audio/mpeg' };
    }
    const out = this.chain(run);
    let ref = null;
    if (role === 'final' && out.verify) ref = out.mix.result.outputs.find(x => x.role === 'final');
    else if (role === 'review-sheet' && out.verify) ref = out.verify.result.outputs.find(x => x.role === 'reviewSheet');
    else if (/^seam-\d+-(whole|handoff|resume)$/.test(role) && out.review) ref = out.review.result.outputs.find(x => x.role === role);
    if (!ref) throw new StudioError('Media unavailable', 404);
    return { file: this.candidate(run).verify(ref), etag: ref.bytesHash, contentType: role === 'final' ? 'video/mp4' : role === 'review-sheet' ? 'image/png' : 'audio/wav' };
  }
}
