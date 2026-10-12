// Visual evidence for an episode with phrase vocabulary, from the real plan (same renderFrame the video uses; no video needed).
//   node scripts/video/review-visual.mjs scripts/video/episodes/toeic-079-auto.json [--shots <dir>]
// 1. camera motion: the largest per-frame move of the feed and every frame that moves more than a threshold
// 2. for each vocabulary note: while the note is open, how long is (a) the whole yellow vocabulary of its story line inside the
//    window, (b) the whole note inside the window
// 3. optional screenshots at the moments that matter
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./voice/config.mjs";
import { launchBrowser, openEpisode, startServer } from "./render-lib.mjs";

const args = process.argv.slice(2);
const episodeFile = path.resolve(args.find((a) => !a.startsWith("--")) || "");
const shotsDir = args.includes("--shots") ? path.resolve(args[args.indexOf("--shots") + 1]) : null;
const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
const episodeUrl = "/" + path.relative(REPO_ROOT, episodeFile).split(path.sep).join("/");
const server = startServer(8135);
let browser;
try {
  browser = await launchBrowser();
  const page = await openEpisode(browser, 8135, episodeUrl);
  const plan = await page.evaluate(() => window.plan);
  const line = (id) => plan.lines.find((l) => l.id === id);
  const dur = await page.evaluate(() => window.template.duration), frames = Math.ceil(dur * 30 - 1e-9);

  // 1. camera motion
  const ty = [];
  for (let i = 0; i < frames; i++) ty.push(await page.evaluate((t) => { window.renderFrame(t); return new DOMMatrix(getComputedStyle(document.getElementById("thread")).transform).m42; }, i / 30));
  const moves = ty.map((v, i) => (i ? Math.abs(v - ty[i - 1]) : 0));
  const big = moves.flatMap((m, i) => (m > 70 ? [{ t: +(i / 30).toFixed(2), px: Math.round(m) }] : []));
  console.log(`camera: ${frames} frames, largest move ${Math.round(Math.max(...moves))} px/frame, ${big.length} frame(s) over 70 px/frame${big.length ? " " + JSON.stringify(big.slice(0, 12)) : ""}`);
  // reversals: the feed moving up and then down again is a "jump back"
  let rev = 0; for (let i = 2; i < ty.length; i++) { const a = ty[i - 1] - ty[i - 2], b = ty[i] - ty[i - 1]; if (Math.abs(a) > 3 && Math.abs(b) > 3 && Math.sign(a) !== Math.sign(b)) rev++; }
  console.log(`camera: direction reversals (>3 px each way): ${rev}`);

  // 2. notes
  for (const v of episode.vocabulary) {
    const open = (() => { const l = line(v.open.line), w = l.words.find((x) => x.text.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase() === v.open.word.toLowerCase()); return l.start + w.at; })();
    const close = line(v.close.line).start;
    const rows = [];
    for (let t = open + 0.4; t < close; t += 0.1) {
      rows.push(await page.evaluate(({ t, id }) => {
        window.renderFrame(t);
        const view = document.getElementById("view").getBoundingClientRect(), top = view.top + 8, bottom = view.bottom - 10;
        const note = document.getElementById(id), nr = note.getBoundingClientRect();
        const sec = note.closest("section"), keys = [...sec.querySelectorAll(".paragraph .cue.key")];
        const vis = (r) => r.top >= top && r.bottom <= bottom;
        return { keys: keys.length, keysVisible: keys.filter((k) => vis(k.getBoundingClientRect())).length, noteVisible: vis(nr), noteTop: Math.round(nr.top - view.top), noteBottom: Math.round(nr.bottom - view.top) };
      }, { t, id: v.id }));
    }
    const pct = (f) => Math.round((100 * rows.filter(f).length) / rows.length);
    console.log(`note "${v.word}": open ${open.toFixed(2)}s–${close.toFixed(2)}s | whole yellow story phrase in view ${pct((r) => r.keys > 0 && r.keysVisible === r.keys)}% of the time | whole note in view ${pct((r) => r.noteVisible)}% | note spans y ${Math.min(...rows.map((r) => r.noteTop))}–${Math.max(...rows.map((r) => r.noteBottom))} of 1024`);
  }

  // 3. screenshots
  if (shotsDir) {
    fs.mkdirSync(shotsDir, { recursive: true });
    const wordAt = (id, w) => { const l = line(id), x = l.words.find((q) => q.text.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase() === w); return l.start + x.at + (x.until - x.at) / 2; };
    const shots = {
      "01_hook": 0.5, "02_hook_reveal": wordAt("hook", "forgot") + 0.45,
      "03_update_plain_a": line("update").start + 1.2,
      "04_game_phrase_cat": wordAt("gameSent", "cat"), "05_game_sentence_end_us": wordAt("gameSent", "us") + 0.15,
      "06_game_meaning": line("gameMeaning").start + 0.8, "07_game_example": wordAt("gameExample", "cat"),
      "08_consumed_phrase": wordAt("consumedLead", "consumed"), "09_consumed_queen_note_opens": wordAt("consumedLead", "queen") + 0.35,
      "10_consumed_meaning": line("consumedMeaning").start + 1.2, "11_consumed_example": wordAt("consumedExample", "consumed"),
      "12_consumed_rest": line("consumedRest").start + 1.0, "13_napping": line("napping").start + 1.0,
      "14_quiz_question": line("question").start + 0.4, "15_quiz_answer": line("answer").start + 0.6, "16_outro": plan.duration + 1.7,
    };
    for (const [n, t] of Object.entries(shots)) { await page.evaluate((t) => window.renderFrame(t), t); await page.screenshot({ path: path.join(shotsDir, n + ".png") }); }
    console.log("screenshots →", shotsDir);
  }
} finally {
  await browser?.close();
  server.close();
}
