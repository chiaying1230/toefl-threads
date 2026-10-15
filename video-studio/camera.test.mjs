// Camera / visibility solver, time-reference parity and full-frame audit on synthetic geometry (deterministic, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, buildAnchors, auditFrames, resolveRef, parityReport, linesFromPlanForRefs } from './camera-solver.mjs';
import { VISUAL_POLICY } from './production-decisions.mjs';

const episode = (extra = {}) => ({
  hook: { id: 'hook', reveal: { line: 'h', word: 'starts' } }, scrollDuration: 0.35,
  story: [{ id: 's1', parts: [{ type: 'reading', line: 'l1' }, { type: 'vocabulary', id: 'n1' }, { type: 'reading', line: 'l2' }] }],
  vocabulary: [{ id: 'n1', word: 'go', open: { line: 'l1', word: 'go' }, close: { line: 'l2' }, meaningLine: 'm', exampleLine: 'e', openDuration: 0.28, closeDuration: 0.32 }],
  quiz: { id: 'quiz', questionLine: 'q', answerLine: 'a' }, camera: [{ at: 0, id: 'hook', offset: 0 }], visibility: [], ...extra,
});
const plan = () => ({ duration: 9.1, lines: [
  { id: 'h', start: 0, end: 1, words: [{ text: 'The', at: 0 }, { text: 'class', at: 0.3 }, { text: 'starts', at: 0.6 }] },
  { id: 'l1', start: 1.1, end: 2, words: [{ text: 'We', at: 0 }, { text: 'go', at: 0.4 }] },
  { id: 'm', start: 2.1, end: 3, words: [] }, { id: 'e', start: 3.1, end: 4, words: [{ text: 'Go', at: 0 }, { text: 'now', at: 0.4 }] },
  { id: 'l2', start: 4.1, end: 5, words: [{ text: 'and', at: 0 }, { text: 'stay', at: 0.4 }] },
  { id: 'q', start: 5.1, end: 5.9, silent: true, words: [] }, { id: 'a', start: 7.9, end: 9, silent: true, words: [] },
] });
/** One sample per output frame. `card` = settled card height; `opts` tweak positions to build infeasible cases. */
function geometry({ card = 300, l2Top = 0, quizAt = 2000, quizOpacity = t => (t >= 5 ? 1 : 0), T = () => 0, parity = true, frames = 273 } = {}) {
  const samples = [];
  for (let i = 0; i < frames; i++) {
    const t = i / 30, open = t >= 2.04 && t < 4.1 ? Math.min(1, (t - 1.5) / 0.28) : t >= 4.1 ? Math.max(0, 1 - (t - 4.1) / 0.32) : 0;
    const h = Math.round(card * open), active = [];
    const line = (id, top) => ({ line: id, text: 'x', rects: [[top, top + 50]] });
    if (t >= 1.1 && t < 2) active.push(line('l1', 540));
    if (t >= 3.1 && t < 4) active.push(line('e', 620));
    if (t >= 4.1 && t < 5) active.push(line('l2', 600 + h + l2Top));
    samples.push({ i, t, T: T(t), view: [146, 1170], sec: { hook: 26, s1: 500, quiz: quizAt + h }, opacity: { quiz: quizOpacity(t) }, active, keys: [], lines: { l1: [540, 590], e: [620, 670], l2: [600 + h + l2Top, 650 + h + l2Top] },
      notes: { n1: { h, full: card, box: [595, 595 + h], meaning: [600, 640], meaningActive: t >= 2.1 && t < 3 } },
      quiz: { question: [quizAt + h + 60, quizAt + h + 130], options: [quizAt + h + 140, quizAt + h + 400], feedback: [quizAt + h + 410, quizAt + h + 480], feedbackOpacity: t >= 7.9 ? 1 : 0 },
      hook: [[40, 120], [130, 136]], contentBottom: 700, mascot: null, issues: [] });
  }
  return { env: { duration: 9.1, start: Infinity }, refs: [], frames, samples, coverageHash: 'sha256:test', parity: [{ frame: 3, same: parity }] };
}

test('feasible geometry: deterministic anchors, offsets inside every interval, forward-only camera, policy visibility', () => {
  const ep = episode(), a = buildAnchors(ep);
  assert.deepEqual(a.map(x => x.kind), ['reading', 'note', 'reading', 'quiz']);
  const one = solve({ episode: ep, plan: plan(), geometry: geometry(), policy: VISUAL_POLICY, anchors: buildAnchors(ep) });
  const two = solve({ episode: ep, plan: plan(), geometry: geometry(), policy: VISUAL_POLICY, anchors: buildAnchors(ep) });
  assert.equal(one.ok, true, JSON.stringify(one.blocked));
  assert.deepEqual(one.camera, two.camera); // same inputs → same answer
  for (const r of one.report) assert.ok(r.offset >= Math.ceil(r.interval[0] - 1e-6) && r.offset <= Math.floor(r.interval[1] + 1e-6), JSON.stringify(r));
  assert.equal(one.camera[0].offset, 0); assert.equal(one.camera.at(-1).id, 'quiz');
  assert.deepEqual(one.visibility.at(-1), { id: 'quiz', at: { line: 'q', delay: -0.1 }, before: 0 }); // never before the last spoken line ends
  assert.equal(one.visibility[0].before, VISUAL_POLICY.firstBlockPreviewOpacity);
});

test('unsatisfiable: a card taller than the view is a structured BLOCK naming the conflicting content, never a forced offset', () => {
  const ep = episode(), r = solve({ episode: ep, plan: plan(), geometry: geometry({ card: 1200 }), policy: VISUAL_POLICY, anchors: buildAnchors(ep) });
  assert.equal(r.ok, false);
  const b = r.blocked.find(x => x.code === 'CAMERA_UNSATISFIABLE');
  assert.ok(b); assert.match(b.message, /vocabulary card n1/); assert.ok(b.detail.binding.lo && b.detail.binding.hi);
});

test('no reversal: content that could only be seen by scrolling back blocks the story camera', () => {
  const ep = episode(), r = solve({ episode: ep, plan: plan(), geometry: geometry({ l2Top: -560 }), policy: VISUAL_POLICY, anchors: buildAnchors(ep) });
  assert.equal(r.ok, false); assert.ok(r.blocked.some(x => x.code === 'CAMERA_REVERSAL_REQUIRED'), JSON.stringify(r.blocked.map(b => b.code)));
});

test('time-reference parity: helpers that normalize punctuation differently BLOCK instead of guessing a word', () => {
  const lines = new Map([['x', { start: 1, end: 3, words: [{ text: 'It', at: 0 }, { text: 'is', at: 0.2 }, { text: 'frivolous', at: 0.4 }, { text: 'a.m', at: 0.9 }] }]]);
  assert.equal(resolveRef(lines, { line: 'x', word: 'frivolous' }).ok, true);
  assert.equal(resolveRef(lines, { line: 'x', word: 'frivolous' }).time, 1.4);
  assert.equal(resolveRef(lines, { line: 'x', word: 'frivolous:' }).ok, false); // renderer would throw "Missing aligned target"
  const am = resolveRef(lines, { line: 'x', word: 'am' });
  assert.equal(am.ok, false); assert.equal(am.code, 'TIME_REF_PARITY_BLOCKED'); // renderer / fit-camera find it, verify-episode does not
  assert.equal(resolveRef(lines, { line: 'x', word: 'missing' }).ok, false);
  const ep = episode({ vocabulary: [{ ...episode().vocabulary[0], open: { line: 'l1', word: 'go!' } }] });
  const report = parityReport(linesFromPlanForRefs(plan()), ep, [{ ref: { line: 'l1', word: 'go!' }, error: 'Missing aligned target: go!' }]);
  assert.equal(report.ok, false); assert.ok(report.problems.every(p => p.code === 'TIME_REF_PARITY_BLOCKED'));
});

test('full-frame audit: coverage, renderer parity, premature Quiz, reversal and mascot are hard; blank area is soft', () => {
  const ep = episode(), p = plan();
  assert.equal(auditFrames({ episode: ep, plan: p, geometry: geometry({ quizAt: 1500, T: t => (t > 1.5 ? 1100 : 0) }), policy: VISUAL_POLICY }).verdict, 'FAIL');
  const ok = auditFrames({ episode: ep, plan: p, geometry: geometry({ T: t => (t < 1.2 ? 0 : t < 5.2 ? 300 : 1900) }), policy: VISUAL_POLICY });
  assert.ok(!ok.hard.some(h => h.code === 'PREMATURE_QUIZ_REVEAL'));
  const early = auditFrames({ episode: ep, plan: p, geometry: geometry({ quizAt: 400, quizOpacity: () => 1 }), policy: VISUAL_POLICY });
  assert.ok(early.hard.some(h => h.code === 'PREMATURE_QUIZ_REVEAL'));
  const back = auditFrames({ episode: ep, plan: p, geometry: geometry({ T: t => (t > 3 && t < 3.2 ? 300 + (t - 3) * 300 : t >= 3.2 ? 330 - (t - 3.2) * 600 : 300) }), policy: VISUAL_POLICY });
  assert.ok(back.hard.some(h => h.code === 'CAMERA_REVERSAL'));
  const short = geometry(); short.samples.pop();
  assert.ok(auditFrames({ episode: ep, plan: p, geometry: short, policy: VISUAL_POLICY }).hard.some(h => h.code === 'FRAME_COVERAGE_INCOMPLETE'));
  assert.ok(auditFrames({ episode: ep, plan: p, geometry: geometry({ parity: false }), policy: VISUAL_POLICY }).hard.some(h => h.code === 'RENDERER_PARITY'));
  const withOutro = episode({ outro: { id: 'outro', scrollDuration: 0.45, mascot: { enabled: true } } }), g = geometry({ T: () => 300 });
  g.env = { duration: 9.1, start: 7 }; g.samples.forEach(s => { s.mascot = s.t < 8 ? 'visible' : 'hidden'; });
  assert.ok(auditFrames({ episode: withOutro, plan: p, geometry: g, policy: VISUAL_POLICY }).hard.some(h => h.code === 'OUTRO_MASCOT_HIDDEN'));
  const blank = geometry({ T: () => 300 }); blank.samples.forEach(s => { s.contentBottom = 400; });
  assert.ok(auditFrames({ episode: ep, plan: p, geometry: blank, policy: VISUAL_POLICY }).soft.some(x => x.code === 'BLANK_AREA_DWELL'));
});
