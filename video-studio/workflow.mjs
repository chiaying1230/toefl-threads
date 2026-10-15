import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, candidates } from './catalog.mjs';
import { quizReview } from './quiz.mjs';
import { sourceDisplayReview } from './source-display.mjs';
import { compileDraft, COMPILER_VERSION, issue } from './compiler.mjs';
import { validateProduction } from './production-validation.mjs';
import { freeVoicePlan } from './free-voice-plan.mjs';
import { loadVoiceConfig } from '../scripts/video/voice/config.mjs';
import { StudioError, configurationComplete } from './store.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const now = () => new Date().toISOString();
const stages = ['compile', 'validation', 'voicePlan'];
const outputs = { compile: ['narration', 'episode', 'compileReport'], validation: ['validation'], voicePlan: ['voicePlan'] };
// Studio code that decides production output: a change requires a restart and invalidates artifacts / 2B runs built with the old code.
const dependencyFiles = ['compiler.mjs', 'sentences.mjs', 'source-display.mjs', 'quiz.mjs', 'state-contract.mjs', 'production-validation.mjs', 'free-voice-plan.mjs', 'workflow.mjs', 'store.mjs', 'catalog.mjs', 'production-decisions.mjs', 'hashing.mjs', 'coordinator.mjs', 'candidate.mjs', 'voice-envelope.mjs', 'paid-voice.mjs', 'production-steps.mjs', 'camera-solver.mjs', 'geometry-worker.mjs', 'production.mjs', 'retake.mjs', 'promotion.mjs'].map(f => path.join(here, f));
export class ProductionWorkflow {
  constructor(store, root, { voicePlanner = freeVoicePlan, loadedEngineHash } = {}) { this.store = store; this.root = root; this.voicePlanner = voicePlanner; this.loadedEngineHash = loadedEngineHash || this.engineHash(); }
  engineHash() {
    return digest([...dependencyFiles, ...['voice/config.mjs', 'voice/segments.mjs', 'voice/episode-refs.mjs', 'voice/generate.mjs', 'voice/cache.mjs'].map(f => path.join(this.root, 'scripts/video', f))].map(f => fs.readFileSync(f, 'utf8')));
  }
  fingerprint(draft, record) {
    const files = [...dependencyFiles, ...['voice/config.mjs', 'voice/segments.mjs', 'voice/episode-refs.mjs', 'voice/generate.mjs', 'voice/cache.mjs', 'voices.json', 'series.json'].map(f => path.join(this.root, 'scripts/video', f))];
    return digest({ decisions: draft.decisions, revision: draft.revision, sourceHash: record?.sourceHash, dependencies: files.map(f => [path.basename(f), fs.readFileSync(f, 'utf8')]) });
  }
  archive(draft) {
    if (draft.workflow?.runId) draft.workflowHistory = [...(draft.workflowHistory || []), JSON.parse(JSON.stringify({ ...draft.workflow, steps: draft.steps, artifacts: draft.artifacts }))].slice(-10);
  }
  fail(draft, step, errors) {
    const entry = { name: step, status: 'failed', startedAt: now(), finishedAt: now(), result: { status: 'failed', errors, warnings: [], unresolved: [] }, artifacts: draft.artifacts };
    draft.steps = [...(draft.steps || []).filter(s => s.name !== step), entry];
    draft.workflow = { ...draft.workflow, failedStep: step, errors, updatedAt: now() };
    draft.updatedAt = now(); return this.store.persist(draft);
  }
  invalidate(draft, from, reason, failedStep = 'freshness') {
    this.archive(draft);
    const start = stages.indexOf(from), at = now();
    for (const name of stages.slice(start)) {
      for (const key of outputs[name]) delete draft.artifacts[key];
      const step = draft.steps.find(s => s.name === name);
      if (step) Object.assign(step, { status: 'invalidated', invalidatedAt: at, artifacts: {}, result: { status: 'invalidated', errors: [reason], warnings: [], unresolved: [], productionReady: false } });
    }
    draft.status = start === 0 ? configurationComplete(draft.decisions) ? 'configured' : 'draft' : start === 1 ? 'compiled' : 'validated';
    draft.workflow = { ...draft.workflow, status: 'stale', invalidatedInputHash: draft.workflow.inputHash || draft.workflow.invalidatedInputHash || null, inputHash: null, invalidatedAt: at, invalidation: { fromStep: from, reason, at }, productionReady: false };
    return this.fail(draft, failedStep, [reason]);
  }
  reconcile(id) {
    const draft = this.store.get(id), record = this.store.catalog.records.get(draft.contentId);
    const before = JSON.stringify([draft.quizReview, draft.sourceDisplayReview]);
    draft.quizReview = quizReview(draft, record && this.store.catalog.vocab ? candidates(record, this.store.catalog.vocab).quizzes : []);
    draft.sourceDisplayReview = sourceDisplayReview(draft, record);
    if (draft.sourceDisplayReview.status === 'needs_confirmation') {
      if (Object.keys(draft.artifacts).length || draft.workflow.failedStep !== 'sourceDisplayConfirmation') return this.invalidate(draft, 'compile', draft.sourceDisplayReview.errors[0], 'sourceDisplayConfirmation');
    }
    if (draft.workflow?.inputHash) {
      const running = draft.steps.find(s => s.status === 'running');
      if (running) return this.invalidate(draft, running.name, issue('WORKFLOW_INTERRUPTED', running.name, 'Studio 在此步驟完成前停止，請重新編譯；不推定成功。'), running.name);
      if (!record || record.sourceHash !== draft.sourceHash || this.fingerprint(draft, record) !== draft.workflow.inputHash) {
        return this.invalidate(draft, 'compile', issue('ARTIFACT_INPUT_STALE', 'sourceHash', '來源、決策或 compiler / voice config 已變更；舊 artifacts / voice plan 已失效，禁止繼續使用。'));
      }
    }
    if (draft.quizReview.status === 'needs_confirmation') {
      if (Object.keys(draft.artifacts).length || draft.workflow.failedStep !== 'quizConfirmation') return this.invalidate(draft, 'compile', draft.quizReview.errors[0], 'quizConfirmation');
    }
    // Read/restore validates the full dependency chain, not just the JSON requested by the browser.
    for (const name of stages) {
      const step = draft.steps.find(s => s.name === name && s.status === 'succeeded');
      if (!step) continue;
      try {
        for (const prerequisite of stages.slice(0, stages.indexOf(name))) {
          if (!draft.steps.some(s => s.name === prerequisite && s.status === 'succeeded')) return this.invalidate(draft, prerequisite, issue('STATE_EVIDENCE_INCOMPLETE', 'steps', `${name} 缺少有效 ${prerequisite} evidence，不可恢復為有效 job。`));
        }
        for (const key of outputs[name]) {
          const ref = draft.artifacts[key], evidence = step.artifacts?.[key];
          if (!ref || !evidence || ref.hash !== evidence.hash || ref.path !== evidence.path || ref.revision !== draft.revision || ref.sourceHash !== draft.sourceHash) throw new StudioError('Artifact reference / revision mismatch');
          this.#readArtifact(draft, key);
        }
        if (name === 'validation') {
          const report = this.#readArtifact(draft, 'validation');
          for (const key of outputs.compile) if (report.validatedArtifactHashes?.[key] !== draft.artifacts[key]?.hash) throw new StudioError('Validated artifact dependency mismatch');
        }
      } catch (e) { return this.invalidate(draft, name, issue('ARTIFACT_DEPENDENCY_STALE', `artifacts.${name}`, e.message, { step: name })); }
    }
    const claimed = { compiled: 'compile', validated: 'validation', voice_planned: 'voicePlan' }[draft.status];
    if (claimed && !draft.steps.some(s => s.name === claimed && s.status === 'succeeded')) return this.invalidate(draft, 'compile', issue('STATE_EVIDENCE_INCOMPLETE', 'status', 'Stored milestone 缺少有效 step evidence，不推定成功。'));
    if (before !== JSON.stringify([draft.quizReview, draft.sourceDisplayReview])) this.store.persist(draft);
    return draft;
  }
  safeFile(relative) {
    if (typeof relative !== 'string') throw new StudioError('Artifact reference missing');
    const base = fs.realpathSync(this.store.directory), file = path.resolve(base, relative);
    const workspace = path.join(base, 'workspaces') + path.sep;
    if (!file.startsWith(workspace)) throw new StudioError('Artifact outside isolated workspace');
    const parent = fs.realpathSync(path.dirname(file));
    if (!parent.startsWith(workspace) || fs.realpathSync(file) !== file) throw new StudioError('Artifact path is not an isolated regular path');
    return file;
  }
  read(draft, name) {
    return this.#readArtifact(this.reconcile(draft.id), name);
  }
  #readArtifact(draft, name) {
    const ref = draft.artifacts[name]; if (!ref) throw new StudioError('Artifact unavailable', 409);
    const value = JSON.parse(fs.readFileSync(this.safeFile(ref.path), 'utf8'));
    if (digest(value) !== ref.hash) throw new StudioError('Artifact hash mismatch; recompile required', 409);
    return value;
  }
  write(draft, name, value, relativeFile) {
    const relative = path.join('workspaces', draft.id, `revision-${draft.revision}`, draft.workflow.runId, relativeFile);
    const base = fs.realpathSync(this.store.directory), file = path.join(base, relative);
    let directory = base;
    for (const part of path.dirname(relative).split(path.sep)) {
      directory = path.join(directory, part);
      if (!fs.existsSync(directory)) fs.mkdirSync(directory);
      if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory() || fs.realpathSync(directory) !== directory) throw new StudioError('Refusing workspace symlink / junction escape');
    }
    // All output is under this store; nothing is promoted to scripts/video, docs or outputs.
    const actualParent = fs.realpathSync(path.dirname(file));
    if (!actualParent.startsWith(path.join(base, 'workspaces') + path.sep)) throw new StudioError('Refusing workspace escape');
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    draft.artifacts[name] = { path: relative.split(path.sep).join('/'), hash: digest(value), revision: draft.revision, sourceHash: draft.sourceHash };
  }
  startStep(draft, name) {
    draft.steps = draft.steps.filter(s => stages.indexOf(s.name) < stages.indexOf(name));
    if (name === 'validation') { delete draft.artifacts.validation; delete draft.artifacts.voicePlan; draft.status = 'compiled'; }
    if (name === 'voicePlan') { delete draft.artifacts.voicePlan; draft.status = 'validated'; }
    const step = { name, status: 'running', startedAt: now(), inputHash: draft.workflow.inputHash };
    draft.steps.push(step); draft.workflow.failedStep = null; this.store.persist(draft); return step;
  }
  finishStep(draft, step, result, status) {
    step.status = result.status; step.finishedAt = now(); step.result = result; step.artifacts = { ...draft.artifacts };
    draft.workflow.failedStep = result.status === 'failed' ? step.name : null;
    draft.workflow.updatedAt = now(); draft.updatedAt = now();
    if (result.status === 'succeeded') draft.status = status;
    this.store.persist(draft);
  }
  run(id, { revision, action = 'run' }) {
    if (!['run', 'compile', 'validation', 'voicePlan'].includes(action)) throw new StudioError('Unsupported workflow action');
    let draft = this.reconcile(id), record = this.store.catalog.records.get(draft.contentId);
    if (draft.revision !== revision) throw new StudioError('草稿已更新，請重新載入後再執行。', 409);
    if (this.engineHash() !== this.loadedEngineHash) return this.fail(draft, 'compile', [issue('ENGINE_RESTART_REQUIRED', 'compiler', 'Compiler / shared helper 程式已變更，請重啟 Studio 再編譯，避免使用舊的已載入模組。')]);
    if (!record || record.sourceHash !== draft.sourceHash) return this.fail(draft, 'compile', [issue('SOURCE_STALE', 'sourceHash', '來源已變更，請建立新 draft；舊決策不會重新編譯。')]);
    if (draft.quizReview.status === 'needs_confirmation') return this.fail(draft, 'compile', draft.quizReview.errors);
    if (draft.sourceDisplayReview.status === 'needs_confirmation') return this.fail(draft, 'compile', draft.sourceDisplayReview.errors);
    const requested = action === 'run' ? stages : [action];
    if (action === 'run' || action === 'compile') {
      this.archive(draft); draft.steps = []; draft.artifacts = {};
      draft.status = configurationComplete(draft.decisions) ? 'configured' : 'draft';
      draft.workflow = { runId: randomUUID(), compilerVersion: COMPILER_VERSION, sourceHash: draft.sourceHash, decisionRevision: draft.revision, inputHash: this.fingerprint(draft, record), startedAt: now(), mode: 'dry-run-plan-only', productionReady: false };
    }
    for (const name of requested) {
      const previous = name === 'validation' ? 'compile' : name === 'voicePlan' ? 'validation' : null;
      if (previous && !draft.steps.some(s => s.name === previous && s.status === 'succeeded')) return this.fail(draft, name, [issue('PREREQUISITE_FAILED', previous, `必須先完成 ${previous}；pipeline 已停止。${draft.workflow.errors?.map(e => e.message).join(' ') || ''}`)]);
      const step = this.startStep(draft, name);
      try {
        const cfg = loadVoiceConfig(path.join(this.root, 'scripts/video/voices.json'));
        if (name === 'compile') {
          const compiled = compileDraft(draft, record, { seriesConfig: JSON.parse(fs.readFileSync(path.join(this.root, 'scripts/video/series.json'), 'utf8')) });
          const { artifacts, ...report } = compiled;
          if (artifacts) {
            this.write(draft, 'narration', artifacts.narration, `narration/${draft.contentId}.json`);
            this.write(draft, 'episode', artifacts.episode, `episodes/${draft.contentId}-auto.json`);
          }
          this.write(draft, 'compileReport', report, 'compile-report.json');
          this.finishStep(draft, step, report, 'compiled');
        } else if (name === 'validation') {
          const report = validateProduction({ narration: this.#readArtifact(draft, 'narration'), episode: this.#readArtifact(draft, 'episode') }, cfg, this.#readArtifact(draft, 'compileReport'));
          report.validatedArtifactHashes = Object.fromEntries(['narration', 'episode', 'compileReport'].map(k => [k, draft.artifacts[k].hash]));
          this.write(draft, 'validation', report, `validation-${randomUUID()}.json`);
          this.finishStep(draft, step, report, 'validated');
        } else {
          const validation = this.#readArtifact(draft, 'validation');
          for (const key of ['narration', 'episode', 'compileReport']) {
            this.#readArtifact(draft, key);
            if (validation.validatedArtifactHashes?.[key] !== draft.artifacts[key].hash) throw new StudioError('Validated artifact inputs changed; validation required', 409);
          }
          if (validation.verdict !== 'PASS') throw new StudioError('Validation FAIL; free plan stopped', 409);
          const report = this.voicePlanner(this.#readArtifact(draft, 'narration'), cfg);
          this.write(draft, 'voicePlan', report, `voice-plan-${randomUUID()}.json`);
          this.finishStep(draft, step, report, 'voice_planned');
        }
      } catch (e) {
        this.finishStep(draft, step, { status: 'failed', errors: [issue('WORKFLOW_STEP_FAILED', name, e.message)], warnings: [], unresolved: [] }, draft.status);
      }
      if (step.status !== 'succeeded') break;
    }
    return draft;
  }
}
