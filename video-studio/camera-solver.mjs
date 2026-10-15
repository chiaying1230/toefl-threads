// Camera + visibility: deterministic semantic anchors + a bounded heuristic solver over REAL renderer geometry + a
// deterministic audit of every output frame. Pure functions over the evidence geometry-worker.mjs collects; no pixels are
// guessed, nothing is learned. When the constraints have no solution the result is a structured BLOCK, never a forced PASS.
//
// Renderer facts used here (reference/PostTemplate.js, read-only): a camera entry places its section's top at `offset` px
// below the view top once its move (scrollDuration, extended over overlapping note animations = "settle") is done, i.e.
// translate T = max(0, sectionTop − offset); visibility only changes opacity (hidden content still takes layout space);
// the Outro camera entry is appended by the renderer itself.
import { normalizeToken } from '../scripts/video/voice/episode-refs.mjs';

export const SOLVER_VERSION = 'studio-camera-v1';
const EPS = 1e-6;

// ---------- time references: every helper that reads a {line, word} must land on the same word ----------
const strip = t => String(t).replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
export const HELPER_WORD_KEYS = {
  renderer: w => w.replace(/[.,]/g, '').toLowerCase(),               // PostTemplate.time, audio-mix timeOf
  fitCamera: w => w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase(),   // fit-camera / review-visual
  verify: w => normalizeToken(w),                                    // verify-episode wordTime / cue checks
};
/** lines: Map id → { start, end, words: [{ text, at }] }. Returns { ok, time, detail }. */
export function resolveRef(lines, ref) {
  if (typeof ref === 'number') return { ok: true, time: ref, base: ref };
  if (ref === 'planEnd') return { ok: true, time: null, base: null, planEnd: true };
  const line = lines.get(ref?.line);
  if (!line) return { ok: false, code: 'TIME_REF_PARITY_BLOCKED', detail: `unknown line ${ref?.line}` };
  if (!ref.word) { const base = ref.edge === 'end' ? line.end : line.start; return { ok: true, base, time: base + (ref.delay ?? 0) }; }
  const want = String(ref.word).toLowerCase(), index = {};
  for (const [name, key] of Object.entries(HELPER_WORD_KEYS)) index[name] = line.words.findIndex(w => key(w.text) === want);
  const ok = index.renderer >= 0 && index.fitCamera === index.renderer && index.verify === index.renderer;
  if (!ok) return { ok: false, code: 'TIME_REF_PARITY_BLOCKED', detail: { ref, helperWordIndex: index, message: '不同 helper 對這個字的 normalization 不一致或找不到；不猜第一個字。' } };
  const base = line.start + line.words[index.renderer].at;
  return { ok: true, base, time: base + (ref.delay ?? 0), wordIndex: index.renderer };
}
export function linesFromPlanForRefs(plan) { return new Map(plan.lines.map(l => [l.id, { start: l.start, end: l.end, words: l.words || [], silent: l.silent }])); }
export function bindPartEndHandoffs(episode, plan) {
  const lines = linesFromPlanForRefs(plan);
  for (const v of episode.vocabulary) if (v.openAtPartEnd || v.openAfterTransition) {
    const resolved = resolveRef(lines, { ...v.open, delay: 0 });
    if (!resolved.ok) throw new Error(`Cannot bind handoff ${v.id}: ${JSON.stringify(resolved.detail)}`);
    const transition = v.openAfterTransition && lines.get(v.openAfterTransition.line);
    if (v.openAfterTransition && !transition?.silent) throw new Error(`Missing silent transition for ${v.id}`);
    const target = transition ? transition.start + v.openAfterTransition.delay : lines.get(v.open.line).end;
    v.open = { ...v.open, delay: target - resolved.base };
  }
  return episode;
}
/** Before audio exists: same parity check on the narration's display tokens (word times unknown, only the matched index matters). */
export function linesFromTextForRefs(linesMap) { return new Map([...linesMap.values()].map(l => [l.id, { start: 0, end: 0, silent: l.silent, words: l.silent ? [] : [...String(l.text).matchAll(/\S+/g)].map((m, i) => ({ text: strip(m[0]) || m[0], at: i })) }])); }
export function episodeRefs(episode) {
  const refs = [];
  episode.vocabulary.forEach(v => refs.push(['vocabulary.open', v.open], ['vocabulary.close', v.close]));
  refs.push(['hook.reveal', episode.hook.reveal]);
  (episode.camera || []).forEach((c, i) => refs.push([`camera[${i}].at`, c.at]));
  (episode.visibility || []).forEach((c, i) => refs.push([`visibility[${i}].at`, c.at]));
  (episode.soundEffects || []).forEach((e, i) => refs.push([`soundEffects[${i}].at`, e.at]));
  if (episode.outro) refs.push(['outro.start', episode.outro.start]);
  return refs;
}
export function parityReport(lines, episode, rendererTimes = null) {
  const problems = [], rows = [];
  for (const [where, ref] of episodeRefs(episode)) {
    const r = resolveRef(lines, ref);
    if (!r.ok) { problems.push({ code: r.code, path: where, message: typeof r.detail === 'string' ? r.detail : r.detail.message, detail: r.detail }); continue; }
    const renderer = rendererTimes?.find(x => JSON.stringify(x.ref) === JSON.stringify(ref));
    if (renderer && (renderer.error || (r.time !== null && Math.abs(renderer.time - r.time) > 1e-6))) problems.push({ code: 'TIME_REF_PARITY_BLOCKED', path: where, message: 'renderer 的時間與 helper 解析不同', detail: { ref, renderer, helpers: r } });
    rows.push({ path: where, ref, time: r.time, rendererTime: renderer?.time ?? null });
  }
  return { ok: !problems.length, problems, rows };
}

// ---------- anchors ----------
export function buildAnchors(episode) {
  const anchors = [];
  for (const block of episode.story) {
    if (block.subtitleLine) anchors.push({ kind: 'subtitle', section: block.id, line: block.subtitleLine, ref: { line: block.subtitleLine }, delayOption: 0 });
    for (const part of block.parts) {
    if (part.type === 'reading') anchors.push({ kind: 'reading', section: block.id, line: part.line, ref: { line: part.line }, delayOption: 0 });
    if (part.type === 'vocabulary') { const v = episode.vocabulary.find(x => x.id === part.id); anchors.push({ kind: 'note', section: block.id, note: v.id, ref: { ...v.open }, fixedDelay: true }); }
  }
  }
  anchors.push({ kind: 'quiz', section: episode.quiz.id, ref: { line: episode.quiz.questionLine }, delayOption: 0 });
  anchors.forEach((a, i) => { a.id = `${a.kind}:${a.line || a.note || a.section}:${i}`; });
  return anchors;
}
const delayOf = (a, D) => a.fixedDelay ? 0 : [-D, -D / 2, 0][a.delayOption ?? 0];

/** Note animation windows, and the renderer's settle rule for a move that overlaps them. */
function noteWindows(episode, times) {
  return episode.vocabulary.flatMap(v => { const o = times.open[v.id], c = times.close[v.id]; return [[o, o + v.openDuration], [c, c + v.closeDuration]]; });
}
function settleOf(at, duration, windows) {
  let end = at + duration, grew = true;
  while (grew) { grew = false; for (const [s, e] of windows) if (s < end && e > at && e > end) { end = e; grew = true; } }
  return end;
}

// ---------- required content per frame ("must be inside the view") ----------
export function phaseTimes(episode, plan, refTimes) {
  const lines = linesFromPlanForRefs(plan), at = ref => resolveRef(lines, ref).time;
  const reading = episode.story.flatMap(b => b.parts.filter(p => p.type === 'reading').map(p => lines.get(p.line)));
  const open = {}, close = {}, meaning = {};
  for (const v of episode.vocabulary) { open[v.id] = refTimes?.get(JSON.stringify(v.open)) ?? at(v.open); close[v.id] = lines.get(v.close.line).start; meaning[v.id] = lines.get(v.meaningLine); }
  // the Hook must stay readable until its own narration line is over (not only until the story starts)
  const hookEnd = lines.get(episode.hook.reveal?.line)?.end ?? 0;
  // the last narrated line before the Quiz (a sentence-end note's example can come after the last story line)
  const q = lines.get(episode.quiz.questionLine), lastSpokenEnd = Math.max(...[...lines.values()].filter(l => !l.silent && l.end <= q.start + EPS).map(l => l.end));
  return { hookEnd, lastSpokenEnd, firstReading: Math.min(...reading.map(l => l.start)), lastStoryEnd: Math.max(...reading.map(l => l.end)), question: lines.get(episode.quiz.questionLine), answer: lines.get(episode.quiz.answerLine), open, close, meaning, lines };
}
function required(sample, episode, phase, outroStart) {
  const t = sample.t, R = [];
  for (const b of episode.story) if (b.subtitleLine) {
    const line = phase.lines.get(b.subtitleLine);
    if (line && t >= line.start && t < line.end) for (const r of sample.subtitles?.[b.id] || []) R.push({ what: `Chinese subtitle ${b.id}`, r });
  }
  for (const a of sample.active) for (const r of a.rects) R.push({ what: `active cue "${a.text}" (${a.line})`, r });
  const activeLines = new Set(sample.active.map(a => a.line));
  for (const k of sample.keys) if (activeLines.has(k.line)) for (const r of k.rects) R.push({ what: `yellow vocabulary in ${k.line}`, r });
  for (const v of episode.vocabulary) {
    const n = sample.notes[v.id];
    if (n && n.h >= n.full - 0.5 && n.full > 0 && t < phase.close[v.id]) R.push({ what: `whole vocabulary card ${v.id}`, r: n.box, note: v.id });
    if (n?.meaningActive) R.push({ what: `meaning of ${v.id}`, r: n.meaning });
  }
  const quizOn = (sample.opacity[episode.quiz.id] ?? 1) >= 0.99;
  // contract: question / options readable during the thinking period (the camera needs one scroll to arrive after the question appears)
  if (t >= phase.question.end && t < outroStart && quizOn) R.push({ what: 'quiz question', r: sample.quiz.question }, { what: 'quiz options', r: sample.quiz.options });
  if (t >= phase.answer.start && t < outroStart && sample.quiz.feedbackOpacity >= 0.99) R.push({ what: 'quiz feedback', r: sample.quiz.feedback });
  return R;
}

/**
 * Solve offsets for the anchors (with their current delay options) and derive visibility.
 * @returns { ok, camera, visibility, anchors, report } or { ok: false, blocked: [...] }
 */
export function solve({ episode, plan, geometry, policy, anchors, insetBoost = {} }) {
  const D = episode.scrollDuration, H = geometry.samples[0].view[1] - geometry.samples[0].view[0];
  const refTimes = new Map(geometry.refs.filter(r => !r.error).map(r => [JSON.stringify(r.ref), r.time]));
  const phase = phaseTimes(episode, plan, refTimes), lines = phase.lines;
  const timeOf = ref => refTimes.get(JSON.stringify(ref)) ?? resolveRef(lines, ref).time;
  const outroStart = episode.outro ? geometry.env.start : Infinity;
  const windows = noteWindows(episode, phase);
  // 1. resolve + merge anchors closer than one scroll (a move must finish before the next one starts)
  let list = anchors.map(a => ({ ...a, start: timeOf(a.ref) + delayOf(a, D) })).filter(a => Number.isFinite(a.start));
  list.sort((a, b) => a.start - b.start || anchors.indexOf(a) - anchors.indexOf(b));
  const merged = [];
  for (const a of list) {
    const prev = merged.at(-1);
    if (prev && a.start - prev.start < D - EPS) { prev.members.push(a); prev.section = a.section; prev.kind = prev.kind === 'reading' ? 'reading' : a.kind; prev.line ??= a.line; continue; }
    merged.push({ ...a, members: [a] });
  }
  if (merged[0] && merged[0].start < D) merged[0].start = D; // the hook entry owns t = 0
  const ends = merged.map((a, i) => merged[i + 1]?.start ?? outroStart);
  const blocked = [], camera = [{ at: 0, id: episode.hook.id, offset: 0 }], report = [];
  // the hook phase (camera entry 0, offset 0) is checked by the real-renderer audit, never against geometry measured with another camera
  let prevT = geometry.samples[0].T; // the Hook entry's translate: the same for every candidate camera (nothing has moved yet at t = 0)
  for (const [k, a] of merged.entries()) {
    const settle = settleOf(a.start, D, windows), end = ends[k];
    const frames = geometry.samples.filter(s => s.t >= settle - EPS && s.t < end - EPS);
    const top = policy.insetTop + (insetBoost[a.id] || 0), bottom = H - policy.insetBottom - (insetBoost[a.id] || 0);
    let lo = -Infinity, hi = Infinity, cap = Infinity, loBy = null, hiBy = null;
    for (const s of frames) {
      const S = s.sec[a.section]; if (S === undefined) { blocked.push({ code: 'ANCHOR_SECTION_MISSING', path: a.id, message: `section ${a.section} 不存在` }); break; }
      cap = Math.min(cap, S);
      for (const req of required(s, episode, phase, outroStart)) {
        const l = top - (req.r[0] - S), h = bottom - (req.r[1] - S);
        if (l > lo) { lo = l; loBy = { t: s.t, what: req.what, rect: req.r }; }
        if (h < hi) { hi = h; hiBy = { t: s.t, what: req.what, rect: req.r }; }
      }
    }
    const S0 = (frames[0] ?? geometry.samples.find(s => s.t >= a.start))?.sec[a.section] ?? 0;
    const fwdMax = S0 - prevT + policy.maxReversalPx;
    const lineTop = a.line && frames[0]?.lines[a.line] ? frames[0].lines[a.line][0] - S0 : null;
    const pref = a.kind === 'quiz' ? policy.quizTop : lineTop !== null ? policy.readingTop - lineTop : S0 - prevT;
    const upper = Math.min(hi, cap, fwdMax), loI = Math.ceil(lo - EPS), upI = Math.floor(upper + EPS);
    const entry = { anchor: a.id, kind: a.kind, members: a.members.map(m => m.id), section: a.section, start: +a.start.toFixed(3), settle: +settle.toFixed(3), end: Number.isFinite(end) ? +end.toFixed(3) : null, frames: frames.length, interval: [lo, hi], cap, fwdMax, preferred: pref, binding: { lo: loBy, hi: hiBy } };
    if (lo > Math.min(hi, cap) + EPS || loI > Math.floor(Math.min(hi, cap) + EPS)) {
      blocked.push({ code: 'CAMERA_UNSATISFIABLE', path: a.id, message: `沒有任何 camera 位置能同時看見「${loBy?.what}」與「${hiBy?.what}」（需要的高度超過可見範圍）`, detail: entry });
      report.push(entry); continue;
    }
    if (loI > upI) { blocked.push({ code: 'CAMERA_REVERSAL_REQUIRED', path: a.id, message: `要讓「${loBy?.what}」可見，story camera 必須往回捲（違反 no reversal）`, detail: entry }); report.push(entry); continue; }
    const offset = Math.round(Math.min(upI, Math.max(loI, Math.round(pref))));
    entry.offset = offset; report.push(entry);
    const ref = a.members[0].fixedDelay ? { ...a.members[0].ref } : { ...a.members[0].ref, ...(delayOf(a.members[0], D) ? { delay: +delayOf(a.members[0], D).toFixed(3) } : {}) };
    camera.push({ at: ref, id: a.section, offset });
    const Slast = (frames.at(-1) ?? frames[0])?.sec[a.section] ?? S0;
    prevT = Math.max(0, Slast - offset);
  }
  if (blocked.length) return { ok: false, blocked, report };
  return { ok: true, camera, visibility: deriveVisibility(episode, plan, camera, phase, policy), report, anchors: merged.map(m => ({ id: m.id, members: m.members.map(x => x.id), start: m.start })) };
}

/** Visibility from the Studio policy: next block when the previous block's last reading line starts (minus one scroll). */
export function deriveVisibility(episode, plan, camera, phase, policy) {
  const D = episode.scrollDuration, out = [];
  const readingOf = b => b.subtitleLine ? [b.subtitleLine] : b.parts.filter(p => p.type === 'reading').map(p => p.line);
  episode.story.forEach((b, i) => {
    const first = readingOf(b)[0], own = camera.find(c => c.id === b.id);
    if (i === 0) { out.push({ id: b.id, at: own ? own.at : { line: first, delay: -D }, before: policy.firstBlockPreviewOpacity }); return; }
    const prevLast = readingOf(episode.story[i - 1]).at(-1);
    out.push({ id: b.id, at: { line: prevLast, delay: -D }, before: 0 });
  });
  // the Quiz never appears before the story's last word is over
  const gap = phase.question.start - phase.lastSpokenEnd;
  out.push({ id: episode.quiz.id, at: { line: episode.quiz.questionLine, delay: -Math.max(0, Math.min(D, +gap.toFixed(3))) }, before: 0 });
  return out;
}

// ---------- full-frame audit ----------
export function auditFrames({ episode, plan, geometry, policy }) {
  const hard = [], soft = [], seen = new Set();
  const add = (list, code, s, message, detail) => { const key = `${code}|${message}`; if (seen.has(key)) { const e = list.find(x => x.key === key); e.frames++; e.lastT = s.t; return; } seen.add(key); list.push({ key, code, t: s.t, frame: s.i, lastT: s.t, frames: 1, message, detail }); };
  const expected = Math.ceil(geometry.env.duration * 30 - 1e-9);
  if (geometry.frames !== expected || geometry.samples.length !== expected || geometry.samples.some((s, i) => s.i !== i)) hard.push({ code: 'FRAME_COVERAGE_INCOMPLETE', message: `audit 幀數 ${geometry.samples.length} ≠ ${expected}` });
  for (const p of geometry.parity) if (!p.same) hard.push({ code: 'RENDERER_PARITY', message: `renderFrame 在第 ${p.frame} 幀隨機存取結果不同`, detail: p });
  const refTimes = new Map(geometry.refs.filter(r => !r.error).map(r => [JSON.stringify(r.ref), r.time]));
  const phase = phaseTimes(episode, plan, refTimes), H = geometry.samples[0].view[1] - geometry.samples[0].view[0];
  const outroStart = episode.outro ? geometry.env.start : Infinity, inView = (r, T) => r[0] - T >= policy.insetTop - 0.5 && r[1] - T <= H - policy.insetBottom + 0.5;
  let blankRun = 0, blankFrom = null, maxBlank = { seconds: 0 };
  geometry.samples.forEach((s, i) => {
    for (const issue of s.issues) add(hard, 'SHARED_LAYOUT_AUDIT', s, issue);
    for (const b of episode.story) if (b.subtitleLine) {
      const line = phase.lines.get(b.subtitleLine);
      if (line && s.t >= line.start && s.t < line.end && (!(s.subtitles?.[b.id]?.length) || (s.opacity[b.id] ?? 1) < 0.99)) add(hard, 'SUBTITLE_NOT_VISIBLE', s, `中文字幕 ${b.id} 未在停留期間完整顯示`);
    }
    if (s.t < phase.hookEnd) for (const part of s.hook) if (!inView(part, s.T)) add(hard, 'HOOK_NOT_VISIBLE', s, 'Hook 旁白還在念，Hook 文字已不在可見範圍');
    for (const req of required(s, episode, phase, outroStart)) if (!inView(req.r, s.T)) add(hard, req.note ? 'CARD_NOT_VISIBLE' : 'CONTENT_NOT_VISIBLE', s, `${req.what} 不完整在可見範圍`, { rect: req.r, T: s.T });
    if (s.t < phase.lastSpokenEnd - EPS && (s.opacity[episode.quiz.id] ?? 1) >= 0.99 && inView(s.quiz.options, s.T)) add(hard, 'PREMATURE_QUIZ_REVEAL', s, '旁白還沒念完，Quiz 選項已經可見');
    if (episode.outro?.mascot?.enabled && s.t >= outroStart + episode.outro.scrollDuration && s.t <= geometry.env.duration - 1 / 30 + EPS && s.mascot !== 'visible') add(hard, 'OUTRO_MASCOT_HIDDEN', s, 'Outro 吉祥物在 Outro 結束前消失');
    if (i >= 2) {
      const a = s.T - geometry.samples[i - 1].T, b = geometry.samples[i - 1].T - geometry.samples[i - 2].T;
      if (Math.abs(a) > policy.maxReversalPx && Math.abs(b) > policy.maxReversalPx && Math.sign(a) !== Math.sign(b)) add(hard, 'CAMERA_REVERSAL', s, 'camera 方向反轉（往回捲）', { deltas: [b, a] });
      if (Math.abs(a) > policy.maxSpeedPxPerFrame) add(soft, 'CAMERA_FAST', s, `camera 單幀移動 ${Math.round(Math.abs(a))}px`, { px: Math.round(Math.abs(a)) });
    }
    // blank area below the content while reading (Studio policy proposal; soft – needs a human look)
    if (s.t >= phase.firstReading && s.t < phase.question.start) {
      const bottom = s.contentBottom === null ? -Infinity : s.contentBottom - s.T, frac = Math.max(0, (H - policy.insetBottom - bottom) / H);
      if (frac > policy.blankFraction) { blankRun++; blankFrom ??= s.t; } else blankRun = 0, blankFrom = null;
      if (blankRun / 30 > maxBlank.seconds) maxBlank = { seconds: +(blankRun / 30).toFixed(2), from: blankFrom };
    }
    for (const v of episode.vocabulary) {
      const n = s.notes[v.id];
      if (n && n.h >= n.full - 0.5 && s.t < phase.close[v.id]) { const keys = s.keys.filter(k => k.line === v.open.line).flatMap(k => k.rects); if (keys.length && !keys.every(r => inView(r, s.T))) add(soft, 'STORY_PHRASE_HIDDEN_DURING_NOTE', s, `${v.word} 在正文中的黃色詞彙在教學期間不在畫面內`); }
    }
  });
  if (maxBlank.seconds > policy.maxBlankDwellSeconds) soft.push({ code: 'BLANK_AREA_DWELL', message: `朗讀時下方留白超過 ${Math.round(policy.blankFraction * 100)}% 的時間連續 ${maxBlank.seconds}s`, t: maxBlank.from, detail: maxBlank });
  const clean = list => list.map(({ key, ...x }) => x);
  return { version: SOLVER_VERSION, verdict: hard.length ? 'FAIL' : 'PASS', hard: clean(hard), soft: clean(soft), frames: geometry.samples.length, expectedFrames: expected, coverageHash: geometry.coverageHash, parityChecked: geometry.parity.length, env: geometry.env, policyVersion: policy.version };
}
