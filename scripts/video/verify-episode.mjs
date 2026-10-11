// Verify a rendered episode against its own plan: reading cues, vocabulary handoffs, return to story, audio sync,
// then build a review sheet (key frames with what the DOM says is active at that moment).
//
//   node scripts/video/verify-episode.mjs scripts/video/episodes/p2-auto.json --video outputs/p2-auto-pipeline.mp4
//   writes <docs>/verification.json, <docs>/review-sheet.png, <docs>/stills/*.png   (docs = the narration's folder)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./voice/config.mjs";
import { SAMPLE_RATE as SR, decodeAudio, rms } from "./voice/audio.mjs";
import { FFMPEG, launchBrowser, openEpisode, startServer } from "./render-lib.mjs";

const args = process.argv.slice(2);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const episodeFile = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--video", "--docs"].includes(args[i - 1])) || "");
const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
const episodeUrl = "/" + path.relative(REPO_ROOT, episodeFile).split(path.sep).join("/");
const audioFile = path.join(REPO_ROOT, episode.audio.replace(/^\//, ""));
const docs = path.resolve(value("docs", path.dirname(audioFile)));
const video = value("video") && path.resolve(value("video"));
const plan = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, episode.plan.replace(/^\//, "")), "utf8"));
const line = (id) => plan.lines.find((l) => l.id === id);
const norm = (s) => s.replace(/[.,!?]/g, "").trim().toLowerCase();
const wordTime = (ref) => { const l = line(ref.line), w = ref.word ? l.words.find((x) => norm(x.text) === ref.word.toLowerCase()) : null; return l.start + (w ? w.at : 0); };

const checks = [], fail = (name, detail) => checks.push({ name, ok: false, detail }), pass = (name, detail) => checks.push({ name, ok: true, detail });
const server = startServer(8132);
let browser;
try {
  browser = await launchBrowser();
  const page = await openEpisode(browser, 8132, episodeUrl);
  const at = async (t) => { await page.evaluate((t) => window.renderFrame(t), t); };
  const active = (id) => page.evaluate((id) => [...document.querySelectorAll(`[data-line="${id}"] .cue.active`)].map((e) => e.textContent.trim()), id);
  const noteHeight = (id) => page.evaluate((id) => parseFloat(document.getElementById(id).style.height) || 0, id);

  // 1. every aligned word of every English line is the active navy cue at its own mid-time
  const readingLines = [...new Set([...episode.story.flatMap((b) => b.parts.filter((p) => p.type === "reading").map((p) => p.line)), ...episode.vocabulary.map((v) => v.exampleLine)])];
  let wordsChecked = 0; const wrong = [];
  for (const id of readingLines) {
    const l = line(id);
    for (const w of l.words) {
      if (w.until - w.at < 0.06) continue;
      await at(l.start + (w.at + w.until) / 2);
      const got = (await active(id)).map(norm);
      wordsChecked++;
      if (!got.includes(norm(w.text))) wrong.push({ line: id, word: w.text, active: got });
    }
  }
  wrong.length ? fail("navy reading cue sits on the spoken word", wrong.slice(0, 5)) : pass("navy reading cue sits on the spoken word", `${wordsChecked} words in ${readingLines.length} lines`);

  // 1b. hook: the 'for' reveal is driven by the word's real time (opacity ramps up exactly there)
  const reveal = wordTime(episode.hook.reveal);
  await at(reveal - 0.05); const dim = await page.evaluate((id) => parseFloat(document.querySelector(`#${id} .hookbox`)?.style.opacity ?? "NaN"), episode.hook.id);
  await at(reveal + episode.hook.revealDuration + 0.05); const lit = await page.evaluate((id) => parseFloat(document.querySelector(`#${id} .hookbox`)?.style.opacity ?? "NaN"), episode.hook.id);
  (dim < 0.3 && lit > 0.97 ? pass : fail)(`hook reveal happens on "${episode.hook.reveal.word}"`, { revealAt: +reveal.toFixed(3), opacityBefore: dim, opacityAfter: lit });

  // 2. vocabulary handoff, meaning, example, and the return to the story
  const stills = [];
  for (const v of episode.vocabulary) {
    const open = wordTime(v.open), close = line(v.close.line).start, meaning = line(v.meaningLine);
    await at(open - 0.05); const before = await noteHeight(v.id);
    await at(open + v.openDuration + 0.05); const opened = await noteHeight(v.id);
    const cue = await active(v.open.line);
    await at((meaning.start + meaning.end) / 2); const meaningOn = await page.evaluate((id) => !!document.querySelector(`#${id} .meaning.active`), v.id);
    const ex = line(v.exampleLine); const exWord = ex.words[Math.floor(ex.words.length / 2)];
    await at(ex.start + (exWord.at + exWord.until) / 2); const exCue = await active(v.exampleLine);
    // the story resumes at the close line; if that line has no aligned words (e.g. the quiz prompt) only the note's collapse is checked
    const resumeWord = line(v.close.line).words[0];
    let resumeCue = null;
    if (resumeWord) { await at(close + (resumeWord.at + resumeWord.until) / 2); resumeCue = await active(v.close.line); }
    await at(close + v.closeDuration + 0.05); const closed = await noteHeight(v.id);
    const ok = before < 1 && opened > 20 && cue.map(norm).includes(v.word) && meaningOn && exCue.map(norm).includes(norm(exWord.text)) && (!resumeWord || resumeCue.map(norm).includes(norm(resumeWord.text))) && closed < 1;
    (ok ? pass : fail)(`vocabulary "${v.word}": yellow handoff → meaning → example → back to story`, { openAt: +open.toFixed(3), noteHeightBefore: before, noteHeightOpen: Math.round(opened), activeCueAtOpen: cue, meaningActive: meaningOn, exampleCue: exCue, resumeLine: v.close.line, resumeCue, noteHeightAfterClose: closed });
  }

  // 3. quiz / outro timing straight from the plan
  const q = line(episode.quiz.questionLine), a = line(episode.quiz.answerLine);
  await at(q.end + 0.5); const thinking = await page.evaluate(() => document.getElementById("phase").textContent);
  await at(a.start + 0.1); const answered = await page.evaluate(() => document.getElementById("status").textContent);
  (thinking === episode.status.thinkingPhase && answered === episode.status.answer ? pass : fail)("quiz question → think → answer", { question: [q.start, q.end], answer: [a.start, a.end], thinking, answered });

  // 4. plan lines vs the actual audio: each spoken line's first/last voiced sample is where the plan says
  const wav = decodeAudio(audioFile), rows = [];
  const voicedIn = (from, to) => { const w = Math.round(SR * 0.01); let first = null, last = null; for (let i = Math.round(from * SR); i < Math.min(wav.length, Math.round(to * SR)); i += w) if (rms(wav, i, i + w) > 0.004) { first ??= i / SR; last = (i + w) / SR; } return { first, last }; };
  for (const l of plan.lines.filter((x) => !x.silent)) { const v = voicedIn(l.start - 0.03, l.end + 0.06); rows.push({ id: l.id, onsetMinusStart: +(v.first - l.start).toFixed(3), endMinusVoicedEnd: +(l.end - v.last).toFixed(3) }); }
  // the plan's span must cover the audible span (10 ms measuring tolerance) without running more than 60 ms past it either side
  const bad = rows.filter((r) => r.onsetMinusStart < -0.01 || r.onsetMinusStart > 0.06 || r.endMinusVoicedEnd < -0.01 || r.endMinusVoicedEnd > 0.06);
  (bad.length ? fail : pass)("each line's start/end encloses the audio's voiced span (tolerance 10 ms, at most 60 ms slack)", { lines: rows.length, outside: bad, rows });

  // 5. mp4 integrity
  if (video) {
    const r = spawnSync(FFMPEG, ["-v", "error", "-i", video, "-f", "null", "-"], { encoding: "utf8" });
    const info = spawnSync(FFMPEG, ["-i", video], { encoding: "utf8" }).stderr;
    const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(info); const seconds = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null;
    const expected = await page.evaluate(() => window.template.duration);
    (r.status === 0 && !r.stderr.trim() && seconds && Math.abs(seconds - expected) < 0.1 ? pass : fail)("mp4 decodes completely and has the expected length", { decodeErrors: r.stderr.trim() || "none", seconds, expected, video: /Video: ([^,]+).*?(\d+x\d+)/.exec(info)?.slice(1, 3), audio: /Audio: ([^,]+)/.exec(info)?.[1] });
  }

  // 6. review sheet
  const mid = (id, k) => { const l = line(id), w = l.words[k]; return l.start + (w.at + w.until) / 2; };
  const lineMid = (id) => (line(id).start + line(id).end) / 2;
  const frames = [["Hook", 0.7], ["Hook reveal", wordTime(episode.hook.reveal) + 0.3]];
  for (const v of episode.vocabulary) {
    const before = line(v.open.line).words.findIndex((w) => norm(w.text) === norm(v.open.word));
    if (before > 0) frames.push([`Reading before "${v.word}"`, mid(v.open.line, before - 1)]);
    const ex = line(v.exampleLine), close = line(v.close.line);
    frames.push([`Handoff → ${v.word}`, wordTime(v.open) + v.openDuration + 0.1], [`${v.word}: meaning`, lineMid(v.meaningLine)], [`${v.word}: example`, mid(v.exampleLine, Math.floor(ex.words.length / 2))],
      [`Back to story after ${v.word}`, close.words.length ? mid(v.close.line, 0) : close.start + v.closeDuration + 0.1]);
  }
  if (episode.reaction) frames.push([`Reaction: ${episode.reaction.word}`, wordTime({ line: episode.reaction.line, word: episode.reaction.word }) + 0.4]);
  frames.push(["Quiz", q.end + 0.5], ["Answer", a.start + 0.5]);
  if (episode.outro) frames.push(["Outro", plan.duration + Math.min(1.4, episode.outro.duration - 0.05)]);
  fs.mkdirSync(path.join(docs, "stills"), { recursive: true });
  const cells = [];
  for (const [n, [label, t]] of frames.entries()) {
    await at(t);
    const file = path.join(docs, "stills", `${String(n + 1).padStart(2, "0")}_${label.replace(/[^\w]+/g, "_")}.png`);
    const png = await page.screenshot({ path: file });
    const lit = await page.evaluate(() => [...document.querySelectorAll(".cue.active,.meaning.active")].map((e) => e.textContent.trim()).join(" | "));
    cells.push({ label, t, lit, src: "data:image/png;base64," + png.toString("base64") });
  }
  const sheet = await browser.newPage({ viewport: { width: 1240, height: 400 } });
  const rowsHtml = plan.lines.map((l) => `<tr><td>${l.id}</td><td>${l.start.toFixed(2)}</td><td>${l.end.toFixed(2)}</td><td>${l.silent ? "silent" : l.words.length ? l.words.length + " words" : "phrase"}</td></tr>`).join("");
  await sheet.setContent(`<style>body{margin:0;padding:20px;background:#fff7e0;font:14px/1.35 sans-serif;color:#222;width:1200px}h1{font-size:20px;margin:0 0 4px}
    .g{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:14px}.c img{width:100%;border:1px solid #ccc;border-radius:6px;display:block}.c b{display:block;margin-top:4px}.c small{color:#555}
    table{border-collapse:collapse;margin-top:8px}td{padding:2px 10px;border-bottom:1px solid #ddd}.ok{color:#1a7f37}.bad{color:#b00020}</style>
    <h1>${episode.id} — automatic pipeline review (${plan.duration.toFixed(2)}s narration + outro)</h1>
    <div>ElevenLabs Arthur / Ling → cache → alignment → words[] → unchanged renderer. Navy underline and yellow handoff driven by real timestamps.</div>
    <div>${checks.map((c) => `<div class="${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "✗"} ${c.name}</div>`).join("")}</div>
    <div class="g">${cells.map((c) => `<div class="c"><img src="${c.src}"><b>${c.label}</b><small>t=${c.t.toFixed(2)}s${c.lit ? " · active: " + c.lit : ""}</small></div>`).join("")}</div>
    <table><tr><td><b>line</b></td><td><b>start</b></td><td><b>end</b></td><td></td></tr>${rowsHtml}</table>`);
  await sheet.screenshot({ path: path.join(docs, "review-sheet.png"), fullPage: true });
  fs.writeFileSync(path.join(docs, "verification.json"), JSON.stringify({ episode: episode.id, checks, frames: cells.map(({ src, ...c }) => c) }, null, 2));
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (checks.some((c) => !c.ok)) { console.log(JSON.stringify(checks.filter((c) => !c.ok), null, 1).slice(0, 3000)); process.exitCode = 1; }
} finally {
  await browser?.close();
  server.close();
}
