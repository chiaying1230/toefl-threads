// Local, free production steps. Each runs the EXISTING tool inside a fresh attempt root of the candidate (never the real repo),
// with a fixed argv (shell: false), an environment without ELEVENLABS_API_KEY, and its outputs sealed + hashed afterwards.
// A tool that exits 0 but leaves a missing / failing report is a failed step. stdout is a log, never state.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCache } from '../scripts/video/voice/cache.mjs';
import { prepareNarration } from '../scripts/video/voice/segments.mjs';
import { planNarration, writeManifest } from '../scripts/video/voice/generate.mjs';
import { validateEpisode, linesFromPlan } from '../scripts/video/voice/episode-refs.mjs';
import { findFfmpeg } from '../scripts/video/voice/audio.mjs';
import { LifetimeLock } from './coordinator.mjs';
import { parityReport, linesFromPlanForRefs, bindPartEndHandoffs, buildAnchors, solve, auditFrames } from './camera-solver.mjs';
import { VISUAL_POLICY } from './production-decisions.mjs';
import { jsonHash, fileEvidence } from './hashing.mjs';
import { StudioError } from './state-contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const VERIFY_REQUIRED_VERSION = 1;
export class StepFailure extends Error {
  constructor(code, message, { blocked = false, detail = null, warnings = [] } = {}) { super(message); this.code = code; this.blocked = blocked; this.detail = detail; this.warnings = warnings; }
}

export function refineCameraAnchors(anchors, report, hard, boost) {
  const targets = new Map();
  for (const issue of hard.filter(h => typeof h.t === 'number')) {
    const moving = report.find(r => issue.t >= r.start - 1e-6 && issue.t < r.settle);
    const target = moving || report.find(r => issue.t >= r.settle && (r.end === null || issue.t < r.end));
    if (target) targets.set(target.anchor, { target, moving: Boolean(moving) || targets.get(target.anchor)?.moving });
  }
  let changed = false;
  for (const { target, moving } of targets.values()) {
    const anchor = anchors.find(a => target.members.includes(a.id) && !a.fixedDelay);
    if (moving && anchor && (anchor.delayOption ?? 0) < 2) { anchor.delayOption = (anchor.delayOption ?? 0) + 1; changed = true; }
    else if (!moving) { boost[target.anchor] = (boost[target.anchor] || 0) + 12; changed = true; }
  }
  return changed;
}
const childEnv = () => { const env = { ...process.env }; delete env.ELEVENLABS_API_KEY; return env; };

/** Spawn a Node script with a fixed argv inside `root`; logs go to the attempt directory. */
export function runNode({ cwd, script, args, logDir, timeoutMs = 30 * 60 * 1000, onSpawn = () => {} }) {
  fs.mkdirSync(logDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: childEnv(), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    onSpawn(child.pid);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); }, timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      const name = path.basename(script, '.mjs');
      fs.writeFileSync(path.join(logDir, `${name}.stdout.log`), stdout); fs.writeFileSync(path.join(logDir, `${name}.stderr.log`), stderr);
      resolve({ code, stdout, stderr });
    });
  });
}
const portFree = port => new Promise(resolve => { const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true))).listen(port, '127.0.0.1'); });
/** The original CLIs use fixed ports; a port owned by an unknown process blocks (Studio never kills other processes). */
export async function withRenderer(productionDir, ports, fn) {
  const lock = LifetimeLock.acquire(path.join(productionDir, 'locks', 'renderer.lock'), 'Studio renderer');
  try {
    for (const port of ports) if (!(await portFree(port))) throw new StepFailure('PORT_IN_USE', `Port ${port} 被其他程式使用；不終止其他 process，請關閉後重試。`, { blocked: true });
    return await fn();
  } finally { lock.release(); }
}
export function probeVideo(file) {
  const ffmpeg = findFfmpeg();
  const decode = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const info = spawnSync(ffmpeg, ['-i', file, '-map', '0:v', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
  const frames = Number([...info.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]), fps = Number(/(\d+(?:\.\d+)?) fps/.exec(info)?.[1]);
  return { decodes: decode.status === 0 && !decode.stderr.trim(), decodeErrors: decode.stderr.trim().slice(0, 400) || null, frames, fps, seconds: frames && fps ? +(frames / fps).toFixed(3) : null, hasAudio: /Audio:/.test(info) };
}
const videoPackets = file => spawnSync(findFfmpeg(), ['-v', 'error', '-i', file, '-map', '0:v', '-c:v', 'copy', '-f', 'h264', '-'], { maxBuffer: 1 << 29 }).stdout;
export const sameVideoStream = (a, b) => Buffer.compare(videoPackets(a), videoPackets(b)) === 0;

/** Pipeline paths of one content id inside an attempt root. */
export const layout = id => ({
  narration: `scripts/video/narration/${id}.json`, manifest: `scripts/video/narration/${id}.manifest.json`, episode: `scripts/video/episodes/${id}-auto.json`,
  plan: `docs/${id}-auto/${id}-auto.plan.json`, wav: `docs/${id}-auto/narration.wav`, assembly: `docs/${id}-auto/assembly.json`, docs: `docs/${id}-auto`,
  alignment: hash => `scripts/video/narration/alignment/${hash}.json`, audio: hash => `voice-cache/${hash}.mp3`,
  narrationOnly: `outputs/${id}-auto.narration-only.mp4`, final: `outputs/${id}-auto.mp4`,
});

// ---------------- assemble ----------------
export async function assembleStep({ candidate, attemptId, contentId, narrationRef, episodeRef, voiceBundle, voiceConfig, onSpawn }) {
  const L = layout(contentId);
  const placements = [{ ref: narrationRef, as: L.narration }, { ref: episodeRef, as: L.episode }, ...voiceBundle.pairs.flatMap(p => [{ ref: p.audio, as: L.audio(p.hash) }, { ref: p.alignment, as: L.alignment(p.hash) }])];
  const root = candidate.attemptRoot('assemble', attemptId, placements), logDir = path.dirname(root);
  const r = await runNode({ cwd: root, script: 'scripts/video/assemble.mjs', args: [contentId], logDir, onSpawn, timeoutMs: 10 * 60 * 1000 });
  if (r.code !== 0) throw new StepFailure('ASSEMBLE_FAILED', `assemble.mjs 失敗：${(r.stderr || r.stdout).trim().slice(-400)}`);
  for (const f of [L.plan, L.wav, L.assembly]) if (!fs.existsSync(path.join(root, f))) throw new StepFailure('ASSEMBLE_OUTPUT_MISSING', `assemble.mjs 沒有產生 ${f}`);
  const plan = JSON.parse(fs.readFileSync(path.join(root, L.plan), 'utf8')), provenance = JSON.parse(fs.readFileSync(path.join(root, L.assembly), 'utf8'));
  const episode = JSON.parse(fs.readFileSync(path.join(root, L.episode), 'utf8'));
  const warnings = [], problems = validateEpisode(episode, linesFromPlan(plan), { warnings });
  if (problems.length) throw new StepFailure('EPISODE_PLAN_REFS_FAILED', problems.join('\n'), { blocked: true });
  if (!plan.lines?.length || plan.fps !== 30 || !(plan.duration > 0) || plan.lines.some(l => !l.silent && !l.words?.length && l.lang !== 'zh')) throw new StepFailure('PLAN_INVALID', 'plan 缺少 lines / fps / 字級 alignment', { blocked: true });
  // the per-episode manifest, written by the existing writer from the assembled cache (all ready)
  const prepared = prepareNarration(JSON.parse(fs.readFileSync(path.join(root, L.narration), 'utf8')), voiceConfig, { requireApiKey: false, env: {} });
  const cache = createCache({ audioDir: path.join(root, 'voice-cache'), alignmentDir: path.join(root, 'scripts/video/narration/alignment') });
  const manifest = writeManifest(planNarration(prepared, cache), cache, path.join(root, L.manifest));
  if (!manifest.complete) throw new StepFailure('MANIFEST_INCOMPLETE', 'narration manifest 不完整');
  const outputs = candidate.seal('assemble', attemptId, [{ role: 'plan', from: path.join(root, L.plan), as: L.plan }, { role: 'wav', from: path.join(root, L.wav), as: L.wav }, { role: 'assembly', from: path.join(root, L.assembly), as: L.assembly }, { role: 'manifest', from: path.join(root, L.manifest), as: L.manifest }]);
  const seams = provenance.segments.filter(s => s.parts).flatMap(s => s.cuts.map((c, i) => ({ id: `${s.id}:${c.before}`, segment: s.id, hash: s.hash, before: c.before, after: s.parts[i], cutAt: c.at, wordEnd: c.wordEnd, nextStart: c.nextStart, ratio: c.ratio, cut: c.cut || null, warning: provenance.warnings.find(w => w.includes(`before "${c.before}"`)) || null })));
  return { outputs, report: { lines: plan.lines.map(l => ({ id: l.id, start: l.start, end: l.end, silent: Boolean(l.silent), words: l.words?.length || 0 })), duration: plan.duration, frames: plan.frames, audioEnd: plan.audioEnd, fps: plan.fps, seams, assemblyWarnings: provenance.warnings, validatorWarnings: warnings, partToWholeTake: provenance.segments.filter(s => s.parts).map(s => ({ segment: s.id, hash: s.hash, parts: s.parts })) }, warnings: provenance.warnings.map(w => ({ code: 'SEAM_NOT_CLEARLY_QUIET', path: 'assembly', message: w })) };
}

// ---------------- geometry (camera solve / extended audit) ----------------
async function geometry({ root, episodeRel, refs, mode = 'frames', logDir, onSpawn }) {
  const job = path.join(logDir, `geometry-${mode}-${Date.now()}.json`), out = `${job}.out.json`;
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(job, JSON.stringify({ root, episode: episodeRel, refs, mode, out }));
  const r = await runNode({ cwd: root, script: path.join(here, 'geometry-worker.mjs'), args: [job], logDir, onSpawn, timeoutMs: 20 * 60 * 1000 });
  if (r.code !== 0 || !fs.existsSync(out)) throw new StepFailure('GEOMETRY_WORKER_FAILED', `renderer geometry 失敗：${(r.stderr || r.stdout).trim().slice(-500)}`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}
const allRefs = episode => {
  const refs = [];
  for (const b of episode.story) {
    if (b.subtitleLine) refs.push({ line: b.subtitleLine });
    for (const p of b.parts) if (p.type === 'reading') refs.push({ line: p.line });
  }
  for (const v of episode.vocabulary) refs.push(v.open, { line: v.close.line }, { line: v.meaningLine }, { line: v.exampleLine });
  refs.push(episode.hook.reveal, { line: episode.quiz.questionLine }, { line: episode.quiz.answerLine });
  for (const x of [...(episode.camera || []), ...(episode.visibility || []), ...(episode.soundEffects || [])]) if (typeof x.at === 'object') refs.push(x.at);
  return [...new Map(refs.map(r => [JSON.stringify(r), r])).values()];
};

/** Pre-payment dry run: card heights / horizontal overflow do not depend on audio, so measure them with a synthetic plan. */
export async function cardBoundsDryRun({ candidate, attemptId, contentId, narration, episode, linesInOrder, policy = VISUAL_POLICY, onSpawn }) {
  const L = layout(contentId), lines = [];
  let t = 0;
  for (const l of linesInOrder) {
    const words = l.silent ? [] : [...String(l.text).matchAll(/\S+/g)].map((m, i) => ({ at: i * 0.25, until: (i + 1) * 0.25, pos: m.index, count: m[0].length, text: m[0].replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '') || m[0] }));
    const duration = l.silent ? l.duration : Math.max(0.5, words.length * 0.25);
    lines.push({ id: l.id, lang: l.lang ?? null, text: l.text, gap: 0.1, start: +t.toFixed(6), end: +(t + duration).toFixed(6), duration, words, ...(l.silent ? { silent: true } : {}) });
    t += duration + 0.1;
  }
  const frames = Math.ceil(t * 30), plan = { id: `${contentId}-auto`, duration: frames / 30, frames, fps: 30, voices: {}, audioEnd: t, synthetic: 'Studio pre-payment dry run; never production evidence', lines };
  const root = candidate.attemptRoot('preflight', attemptId);
  for (const [rel, value] of [[L.narration, narration], [L.episode, episode], [L.plan, plan]]) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(value)); }
  const g = await geometry({ root, episodeRel: L.episode, refs: [], mode: 'cards', logDir: path.dirname(root), onSpawn });
  const limit = policy.viewHeight - policy.insetTop - policy.insetBottom;
  const tooTall = g.cards.filter(c => c.innerHeight > limit);
  return { ok: !tooTall.length && !g.overflow.length, cards: g.cards, limit, tooTall, overflow: g.overflow, env: g.env };
}

export async function cameraStep({ candidate, attemptId, contentId, episodeRef, planRef, wavRef, narrationRef, policy = VISUAL_POLICY, onSpawn }) {
  const L = layout(contentId);
  const root = candidate.attemptRoot('camera', attemptId, [{ ref: episodeRef, as: L.episode }, { ref: planRef, as: L.plan }, { ref: wavRef, as: L.wav }, { ref: narrationRef, as: L.narration }]);
  const logDir = path.dirname(root), episodeFile = path.join(root, L.episode);
  const compiled = JSON.parse(fs.readFileSync(episodeFile, 'utf8')), plan = JSON.parse(fs.readFileSync(path.join(root, L.plan), 'utf8'));
  bindPartEndHandoffs(compiled, plan);
  fs.writeFileSync(episodeFile, JSON.stringify(compiled, null, 2) + '\n');
  // 1. time references: every helper must resolve the compiled refs to the same word (else BLOCK, never guess)
  let geo = await geometry({ root, episodeRel: L.episode, refs: allRefs(compiled), logDir, onSpawn });
  const parity = parityReport(linesFromPlanForRefs(plan), compiled, geo.refs);
  if (!parity.ok) throw new StepFailure('TIME_REF_PARITY_BLOCKED', parity.problems.map(p => `${p.path}: ${p.message}`).join('\n'), { blocked: true, detail: parity });
  // 2. bounded solve → audit loop on the real renderer
  const anchors = buildAnchors(compiled), boost = {}, iterations = [];
  for (let iteration = 0; iteration < policy.maxIterations; iteration++) {
    const solved = solve({ episode: compiled, plan, geometry: geo, policy, anchors, insetBoost: boost });
    if (!solved.ok) throw new StepFailure(solved.blocked[0].code, solved.blocked.map(b => `${b.path}: ${b.message}`).join('\n'), { blocked: true, detail: { blocked: solved.blocked, report: solved.report, iterations } });
    const episode = { ...compiled, camera: solved.camera, visibility: solved.visibility };
    fs.writeFileSync(episodeFile, JSON.stringify(episode, null, 2) + '\n');
    geo = await geometry({ root, episodeRel: L.episode, refs: allRefs(episode), logDir, onSpawn });
    const p2 = parityReport(linesFromPlanForRefs(plan), episode, geo.refs);
    if (!p2.ok) throw new StepFailure('TIME_REF_PARITY_BLOCKED', p2.problems.map(p => `${p.path}: ${p.message}`).join('\n'), { blocked: true, detail: p2 });
    const audit = auditFrames({ episode, plan, geometry: geo, policy });
    iterations.push({ iteration, camera: solved.camera, visibility: solved.visibility, hard: audit.hard.slice(0, 20), soft: audit.soft.length, anchors: solved.report.map(r => ({ anchor: r.anchor, offset: r.offset, interval: r.interval })) });
    if (audit.verdict === 'PASS') {
      const outputs = candidate.seal('camera', attemptId, [{ role: 'episode', from: episodeFile, as: L.episode }]);
      outputs.push(candidate.sealJson('camera', attemptId, 'solverReport', 'reports/camera-solver.json', { version: 'studio-camera-v1', policy, parentEpisode: episodeRef.bytesHash, plan: planRef.bytesHash, anchors: solved.anchors, solve: solved.report, iterations, parity: p2, audit }));
      return { outputs, report: { iterations: iterations.length, camera: solved.camera, visibility: solved.visibility, softWarnings: audit.soft, coverage: { frames: audit.frames, hash: audit.coverageHash } }, warnings: audit.soft.map(s => ({ code: s.code, path: 'camera', message: s.message, t: s.t })) };
    }
    // One episode can have many independent transitions. Repair every affected transition in this
    // bounded iteration; repairing only the earliest frame exhausts six passes on six different scenes.
    if (!refineCameraAnchors(anchors, solved.report, audit.hard, boost)) break;
  }
  throw new StepFailure('CAMERA_AUDIT_UNRESOLVED', `${policy.maxIterations} 次內無法讓全幀 audit 通過；不以 magic number 硬過。`, { blocked: true, detail: { iterations } });
}

export async function auditStep({ candidate, attemptId, contentId, productionDir, episodeRef, planRef, wavRef, narrationRef, policy = VISUAL_POLICY, onSpawn }) {
  const L = layout(contentId);
  const root = candidate.attemptRoot('audit', attemptId, [{ ref: episodeRef, as: L.episode }, { ref: planRef, as: L.plan }, { ref: wavRef, as: L.wav }, { ref: narrationRef, as: L.narration }]);
  const logDir = path.dirname(root), docs = path.join(logDir, 'docs-out');
  const episode = JSON.parse(fs.readFileSync(path.join(root, L.episode), 'utf8')), plan = JSON.parse(fs.readFileSync(path.join(root, L.plan), 'utf8'));
  return withRenderer(productionDir, [8131], async () => {
    const r = await runNode({ cwd: root, script: 'scripts/video/render-episode.mjs', args: [L.episode, '--audit-only', '--docs', docs], logDir, onSpawn });
    const auditFile = path.join(docs, 'layout-audit.json'), renderFile = path.join(docs, 'render.json');
    if (!fs.existsSync(auditFile) || !fs.existsSync(renderFile)) throw new StepFailure('AUDIT_REPORT_MISSING', `layout audit 沒有產生報告（exit ${r.code}）：${r.stderr.trim().slice(-300)}`);
    const shared = JSON.parse(fs.readFileSync(auditFile, 'utf8')), spec = JSON.parse(fs.readFileSync(renderFile, 'utf8'));
    if (r.code !== 0 || shared.issues?.length || shared.samples !== spec.frames) throw new StepFailure('LAYOUT_AUDIT_FAILED', `shared layout audit FAIL：${JSON.stringify(shared.issues).slice(0, 400)}`, { detail: shared });
    const geo = await geometry({ root, episodeRel: L.episode, refs: allRefs(episode), logDir, onSpawn });
    const parity = parityReport(linesFromPlanForRefs(plan), episode, geo.refs);
    const extended = auditFrames({ episode, plan, geometry: geo, policy });
    if (!parity.ok) throw new StepFailure('TIME_REF_PARITY_BLOCKED', parity.problems.map(p => p.message).join('\n'), { blocked: true });
    if (extended.verdict !== 'PASS' || extended.frames !== spec.frames) throw new StepFailure('EXTENDED_AUDIT_FAILED', `全幀 geometry audit FAIL：${extended.hard.slice(0, 5).map(h => `${h.code}@${h.t}s ${h.message}`).join('; ')}`, { detail: extended });
    const outputs = candidate.seal('audit', attemptId, [{ role: 'layoutAudit', from: auditFile, as: `${L.docs}/layout-audit.json` }, { role: 'renderSpec', from: renderFile, as: `${L.docs}/render.json` }]);
    outputs.push(candidate.sealJson('audit', attemptId, 'extendedAudit', 'reports/extended-audit.json', { ...extended, parity, episode: episodeRef.bytesHash, plan: planRef.bytesHash }));
    return { outputs, report: { frames: spec.frames, sharedIssues: 0, extendedHard: 0, soft: extended.soft, coverageHash: extended.coverageHash, env: extended.env }, warnings: extended.soft.map(s => ({ code: s.code, path: 'audit', message: s.message, t: s.t })) };
  });
}

export async function renderStep({ candidate, attemptId, contentId, productionDir, episodeRef, planRef, wavRef, narrationRef, auditSpecRef, onSpawn }) {
  const L = layout(contentId);
  const root = candidate.attemptRoot('render', attemptId, [{ ref: episodeRef, as: L.episode }, { ref: planRef, as: L.plan }, { ref: wavRef, as: L.wav }, { ref: narrationRef, as: L.narration }]);
  const logDir = path.dirname(root), docs = path.join(logDir, 'docs-out');
  return withRenderer(productionDir, [8131], async () => {
    // --narration-only is mandatory: the mix runs exactly once, in its own step
    const r = await runNode({ cwd: root, script: 'scripts/video/render-episode.mjs', args: [L.episode, '--narration-only', '--out', L.narrationOnly, '--docs', docs], logDir, onSpawn, timeoutMs: 60 * 60 * 1000 });
    const mp4 = path.join(root, L.narrationOnly);
    if (r.code !== 0 || !fs.existsSync(mp4)) throw new StepFailure('RENDER_FAILED', `render 失敗（exit ${r.code}）：${r.stderr.trim().slice(-400)}`);
    const spec = JSON.parse(fs.readFileSync(path.join(docs, 'render.json'), 'utf8')), expected = candidate.readJson(auditSpecRef);
    if (spec.frames !== expected.frames || Math.abs(spec.duration - expected.duration) > 1e-6) throw new StepFailure('RENDER_SPEC_CHANGED', 'render 的幀數 / 長度與 audit 不同');
    const probe = probeVideo(mp4);
    if (!probe.decodes || probe.frames !== spec.frames || Math.abs(probe.seconds - spec.duration) > 0.05) throw new StepFailure('RENDER_OUTPUT_INVALID', `narration-only MP4 無法完整解碼或幀數不符：${JSON.stringify(probe)}`);
    const outputs = candidate.seal('render', attemptId, [{ role: 'narrationOnly', from: mp4, as: L.narrationOnly }, { role: 'renderSpec', from: path.join(docs, 'render.json'), as: 'reports/render.json' }]);
    return { outputs, report: { frames: spec.frames, duration: spec.duration, probe } };
  });
}

export async function mixStep({ candidate, attemptId, contentId, episodeRef, planRef, wavRef, narrationOnlyRef, onSpawn }) {
  const L = layout(contentId);
  const root = candidate.attemptRoot('mix', attemptId, [{ ref: episodeRef, as: L.episode }, { ref: planRef, as: L.plan }, { ref: wavRef, as: L.wav }, { ref: narrationOnlyRef, as: L.narrationOnly }]);
  const logDir = path.dirname(root), docs = path.join(logDir, 'docs-out'), episode = JSON.parse(fs.readFileSync(path.join(root, L.episode), 'utf8'));
  const mixing = Boolean(episode.music || episode.soundEffects?.length);
  if (!mixing) {
    // explicit no-mix binding: the final file IS the narration-only render; no fake six-check success
    const probe = probeVideo(path.join(root, L.narrationOnly));
    if (!probe.decodes) throw new StepFailure('FINAL_DECODE_FAILED', 'narration-only MP4 無法解碼');
    const outputs = candidate.seal('mix', attemptId, [{ role: 'final', from: path.join(root, L.narrationOnly), as: L.final }]);
    return { outputs, report: { mixed: false, binding: 'final = narration-only (episode has no music / soundEffects)', probe } };
  }
  fs.mkdirSync(docs, { recursive: true });
  const r = await runNode({ cwd: root, script: 'scripts/video/audio-mix.mjs', args: [L.episode, '--video', L.narrationOnly, '--out', L.final, '--docs', docs], logDir, onSpawn });
  const reportFile = path.join(docs, 'mix-verification.json'), final = path.join(root, L.final);
  if (!fs.existsSync(reportFile) || !fs.existsSync(final)) throw new StepFailure('MIX_REPORT_MISSING', `audio-mix 沒有產生 final / 報告（exit ${r.code}）：${r.stderr.trim().slice(-300)}`);
  const v = JSON.parse(fs.readFileSync(reportFile, 'utf8')), verdict = evaluateMix(v, episode, r.code);
  if (!verdict.ok) throw new StepFailure('MIX_VERIFY_FAILED', `audio mix 驗證 FAIL：${verdict.problems.join('; ')}`, { detail: v });
  const probe = probeVideo(final);
  if (!probe.decodes || !probe.hasAudio) throw new StepFailure('FINAL_DECODE_FAILED', 'final MP4 無法完整解碼');
  const outputs = candidate.seal('mix', attemptId, [{ role: 'final', from: final, as: L.final }, { role: 'mixVerification', from: reportFile, as: `${L.docs}/mix-verification.json` }]);
  return { outputs, report: { mixed: true, checks: v.checks.map(c => ({ name: c.name, ok: c.ok })), peakDbfs: v.peakDbfs, probe } };
}

/** Required verify-episode checks for this episode's features (versioned; an empty / partial report never passes). */
export function requiredVerifyChecks(episode) {
  const names = ['navy reading cue sits on the spoken word', /^hook reveal happens on/, 'vocabulary highlight: every word / phrase (and its forms) is yellow where it occurs', 'vocabulary highlight: nothing else is yellow (a / of / and … outside a phrase stay plain)', /^header: top right/, 'quiz question → think → answer', "each line's start/end encloses the audio's voiced span (tolerance 10 ms, at most 60 ms slack)", 'mp4 decodes completely and has the expected length'];
  if (episode.allowContentEmoji !== true) names.push('content: no decorative emoji in the hook, story, vocabulary, quiz or outro');
  for (const v of episode.vocabulary) names.push(`vocabulary "${v.word}": yellow handoff → meaning → example → back to story`);
  return names;
}
/** A verify report passes only when the exit code is 0, every required check is present and every check is ok (an empty report fails). */
export function evaluateVerification(v, episode, exitCode) {
  const checks = Array.isArray(v?.checks) ? v.checks : [], names = requiredVerifyChecks(episode);
  const missing = names.filter(n => !checks.some(c => (n instanceof RegExp ? n.test(c.name) : c.name === n))).map(String);
  const failing = checks.filter(c => c.ok !== true).map(c => c.name);
  const problems = [...(exitCode !== 0 ? [`exit code ${exitCode}`] : []), ...failing, ...missing.map(m => `missing check: ${m}`)];
  return { ok: !problems.length, problems, failing, missing };
}
/** The six-check mix contract: 4 base checks + music + one per sound effect, all ok, report ok, exit code 0. */
export function evaluateMix(v, episode, exitCode) {
  const required = 4 + (episode.music ? 1 : 0) + (episode.soundEffects?.length || 0), checks = Array.isArray(v?.checks) ? v.checks : [];
  const problems = [...(exitCode !== 0 ? [`exit code ${exitCode}`] : []), ...(v?.ok !== true ? ['report not ok'] : []), ...(checks.length !== required ? [`checks ${checks.length}/${required}`] : []), ...checks.filter(c => c.ok !== true).map(c => c.name)];
  return { ok: !problems.length, problems };
}
export async function verifyStep({ candidate, attemptId, contentId, productionDir, episodeRef, planRef, wavRef, narrationRef, narrationOnlyRef, finalRef, mixReport, onSpawn }) {
  const L = layout(contentId);
  const root = candidate.attemptRoot('verify', attemptId, [{ ref: episodeRef, as: L.episode }, { ref: planRef, as: L.plan }, { ref: wavRef, as: L.wav }, { ref: narrationRef, as: L.narration }, { ref: narrationOnlyRef, as: L.narrationOnly }, { ref: finalRef, as: L.final }]);
  const logDir = path.dirname(root), docs = path.join(logDir, 'docs-out'), episode = JSON.parse(fs.readFileSync(path.join(root, L.episode), 'utf8'));
  return withRenderer(productionDir, [8132], async () => {
    const r = await runNode({ cwd: root, script: 'scripts/video/verify-episode.mjs', args: [L.episode, '--video', L.narrationOnly, '--docs', docs], logDir, onSpawn });
    const file = path.join(docs, 'verification.json');
    if (!fs.existsSync(file)) throw new StepFailure('VERIFY_REPORT_MISSING', `verify-episode 沒有產生 verification.json（exit ${r.code}）`);
    const v = JSON.parse(fs.readFileSync(file, 'utf8')), names = requiredVerifyChecks(episode), verdict = evaluateVerification(v, episode, r.code);
    if (!verdict.ok) throw new StepFailure('VERIFY_FAILED', `verify FAIL：${verdict.problems.join('; ')}`, { detail: { ...verdict, exitCode: r.code } });
    // final MP4 binding: same video stream as the verified narration-only render, decodes, same length
    const fin = probeVideo(path.join(root, L.final)), base = probeVideo(path.join(root, L.narrationOnly));
    const bound = mixReport.mixed ? sameVideoStream(path.join(root, L.narrationOnly), path.join(root, L.final)) : fileEvidence(path.join(root, L.final)).bytesHash === fileEvidence(path.join(root, L.narrationOnly)).bytesHash;
    if (!fin.decodes || fin.frames !== base.frames || !bound) throw new StepFailure('FINAL_BINDING_FAILED', 'final MP4 與已驗證的 narration-only render 不一致', { detail: { fin, base, bound } });
    const outputs = candidate.seal('verify', attemptId, [{ role: 'verification', from: file, as: `${L.docs}/verification.json` }, ...(fs.existsSync(path.join(docs, 'review-sheet.png')) ? [{ role: 'reviewSheet', from: path.join(docs, 'review-sheet.png'), as: 'review/review-sheet.png' }] : [])]);
    return { outputs, report: { checks: v.checks.map(c => ({ name: c.name, ok: c.ok })), requiredVersion: VERIFY_REQUIRED_VERSION, required: names.map(String), final: fin, binding: mixReport.mixed ? 'same h264 stream as narration-only + mix six-check report' : 'byte-identical (no mix)', coverageNote: 'verify-episode 以 browser key frames + decoder 驗證，不是 final MP4 逐像素證明。' } };
  });
}

/** Free review clips around each seam: whole take, the handoff, the resume (WAV cut from sealed audio). */
export function seamClips({ candidate, attemptId, seams, voiceBundle, wavRef, planLines }) {
  const ffmpeg = findFfmpeg(), dir = path.join(candidate.dir, 'attempts', 'review', attemptId, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  const cut = (input, from, to, name) => {
    const out = path.join(dir, name);
    const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(Math.max(0, from).toFixed(3)), '-to', String(to.toFixed(3)), '-i', input, '-ac', '1', '-ar', '44100', out]);
    if (r.status !== 0) throw new StepFailure('SEAM_CLIP_FAILED', `無法產生接縫試聽：${String(r.stderr).slice(0, 200)}`);
    return { from: +Math.max(0, from).toFixed(3), to: +to.toFixed(3), file: out };
  };
  const wav = candidate.verify(wavRef), clips = [];
  seams.forEach((s, i) => {
    const pair = voiceBundle.pairs.find(p => p.hash === s.hash), whole = candidate.verify(pair.audio);
    const lead = planLines.find(l => l.id === s.after), rest = planLines.find(l => l.id === s.before);
    const made = [['whole', cut(whole, 0, 60, `seam-${i + 1}-whole.wav`)], ['handoff', cut(wav, lead.end - 2.5, lead.end + 0.6, `seam-${i + 1}-handoff.wav`)], ['resume', cut(wav, rest.start - 0.6, rest.start + 2.5, `seam-${i + 1}-resume.wav`)]];
    clips.push({ seam: s.id, index: i + 1, finalTimes: { handoffEnd: lead.end, resumeStart: rest.start }, clips: made.map(([kind, c]) => ({ kind, from: c.from, to: c.to, file: c.file })) });
  });
  const sealed = candidate.seal('review', attemptId, clips.flatMap(c => c.clips.map(x => ({ role: `seam-${c.index}-${x.kind}`, from: x.file, as: `review/${path.basename(x.file)}` }))));
  return clips.map(c => ({ ...c, clips: c.clips.map(x => ({ kind: x.kind, from: x.from, to: x.to, ref: sealed.find(o => o.role === `seam-${c.index}-${x.kind}`) })) }));
}
export const stepInputHash = refs => jsonHash(Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v && v.bytesHash ? v.bytesHash : v])));
export { StudioError };
