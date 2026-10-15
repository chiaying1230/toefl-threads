// Child process: load ONE episode in the candidate root's own renderer (post-reference.html + reference/*.js, the copied
// render-lib.mjs) and report, for every output frame (30 fps, frames = ceil(duration × 30)), what the renderer really drew.
//
//   node video-studio/geometry-worker.mjs <job.json>
//   job: { root, episode: "scripts/video/episodes/<id>-auto.json", refs: [timeRef...], out, mode: "frames" | "cards" }
//
// Nothing is decided here; the parent (camera-solver.mjs) evaluates the evidence. Coordinates are "thread" coordinates
// (independent of the camera): y = rect.top − view.top + T, where T is the thread's current translate.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const lib = await import(pathToFileURL(path.join(job.root, 'scripts/video/render-lib.mjs')).href);
const server = lib.startServer(0);
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
let browser;
const collect = t => {
  if (t !== null) window.renderFrame(t);
  const view = document.getElementById('view').getBoundingClientRect(), thread = document.getElementById('thread');
  const T = -new DOMMatrix(getComputedStyle(thread).transform).m42, r1 = v => Math.round(v * 10) / 10;
  const y = r => [r1(r.top - view.top + T), r1(r.bottom - view.top + T)];
  const lineOf = e => e.closest('[data-line]')?.dataset.line;
  const sec = {}, opacity = {};
  for (const s of thread.children) if (s.id) { sec[s.id] = y(s.getBoundingClientRect())[0]; opacity[s.id] = s.style.opacity === '' ? 1 : Number(s.style.opacity); }
  const active = [...document.querySelectorAll('.cue.active')].map(e => ({ line: lineOf(e), text: e.textContent, rects: [...e.getClientRects()].map(y) }));
  const keys = [...document.querySelectorAll('.cue.key')].map(e => ({ line: lineOf(e), rects: [...e.getClientRects()].map(y) }));
  const lines = {}; for (const e of document.querySelectorAll('[data-line]')) lines[e.dataset.line] = y(e.getBoundingClientRect());
  const notes = {};
  for (const n of document.querySelectorAll('.note')) { const m = n.querySelector('.meaning'); notes[n.id] = { h: r1(parseFloat(n.style.height) || 0), full: n.firstElementChild.offsetHeight, box: y(n.getBoundingClientRect()), meaning: y(m.getBoundingClientRect()), meaningActive: m.classList.contains('active') }; }
  const ep = window.episode, q = document.getElementById(ep.quiz.id);
  const subtitles = Object.fromEntries(ep.story.filter(b => b.subtitleLine).map(b => [b.id, [...document.getElementById(b.id).querySelectorAll('.zh')].map(e => y(e.getBoundingClientRect()))]));
  const quiz = { question: y(q.querySelector('.question').getBoundingClientRect()), options: y(q.querySelector('.options').getBoundingClientRect()), feedback: y(q.querySelector('.feedback').getBoundingClientRect()), feedbackOpacity: Number(q.querySelector('.feedback').style.opacity || 0) };
  const hook = document.getElementById(ep.hook.id), parts = [...hook.querySelectorAll('.hooksetup,.hookbox,.hooknum')].map(e => y(e.getBoundingClientRect()));
  const outro = ep.outro ? document.getElementById(ep.outro.id) : null, mascot = outro?.querySelector('.outro-mascot');
  // content that is visible below the reading position (for the blank-area measurement)
  let contentBottom = -Infinity;
  for (const e of thread.querySelectorAll('.paragraph,.zh,.note,.question,.options,.quote,.outro-lead,.outro-words,.outro-cta,.hooksetup,.hookbox')) {
    const s = e.closest('#thread > *'); if (!s || (opacity[s.id] ?? 1) < 0.99 || (s.style.visibility === 'hidden')) continue;
    const b = e.getBoundingClientRect(); if (b.height > 0) contentBottom = Math.max(contentBottom, b.bottom - view.top + T);
  }
  return { T: r1(T), view: [r1(view.top), r1(view.bottom)], sec, opacity, active, keys, lines, notes, quiz, subtitles, hook: parts, contentBottom: Number.isFinite(contentBottom) ? r1(contentBottom) : null,
    mascot: mascot ? getComputedStyle(mascot).visibility : null, outroVisible: outro ? getComputedStyle(outro).visibility : null, issues: t === null ? [] : window.audit(t) };
};
try {
  browser = await lib.launchBrowser();
  const page = await lib.openEpisode(browser, server.address().port, '/' + job.episode);
  const env = await page.evaluate(() => ({ duration: window.template.duration, start: window.template.start, planDuration: window.plan.duration, fonts: { dmSans: document.fonts.check('16px "DM Sans"'), jhenghei: document.fonts.check('16px "Microsoft JhengHei"') }, ua: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight] }));
  const refs = await page.evaluate(refs => refs.map(ref => { try { return { ref, time: window.template.time(ref) }; } catch (e) { return { ref, error: e.message }; } }), job.refs || []);
  if (job.mode === 'cards') {
    const cards = await page.evaluate(() => [...document.querySelectorAll('.note')].map(n => ({ id: n.id, innerHeight: n.firstElementChild.offsetHeight })));
    const issues = [];
    for (const t of [0, env.planDuration / 2, Math.max(0, env.planDuration - 0.05)]) issues.push(...await page.evaluate(t => window.audit(t), t));
    fs.writeFileSync(job.out, JSON.stringify({ env, refs, cards, overflow: [...new Set(issues.filter(i => i.startsWith('horizontal')))] }));
  } else {
    const frames = Math.ceil(env.duration * 30 - 1e-9), samples = [], digest = createHash('sha256');
    for (let i = 0; i < frames; i++) {
      const s = await page.evaluate(collect, i / 30);
      s.i = i; s.t = +(i / 30).toFixed(6); samples.push(s); digest.update(JSON.stringify([i, s.T, s.active.map(a => a.line), Object.values(s.notes).map(n => n.h)]));
    }
    // renderer parity: renderFrame(t) must give the same pose in any order (random access, restart points)
    const parity = [];
    let seed = 7;
    const pick = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % frames; };
    for (let k = 0; k < Math.min(40, frames); k++) {
      const i = pick(), again = await page.evaluate(collect, i / 30), a = samples[i];
      const same = again.T === a.T && JSON.stringify(again.active.map(x => x.line + x.text)) === JSON.stringify(a.active.map(x => x.line + x.text)) && JSON.stringify(Object.values(again.notes).map(n => n.h)) === JSON.stringify(Object.values(a.notes).map(n => n.h));
      parity.push({ frame: i, same });
    }
    fs.writeFileSync(job.out, JSON.stringify({ env, refs, frames, samples, coverageHash: `sha256:${digest.digest('hex')}`, parity }));
  }
} finally {
  await browser?.close();
  server.close();
}
