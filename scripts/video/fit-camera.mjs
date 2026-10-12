// Suggest the camera entries of an episode from its REAL plan: for every entry the line being read is placed at a chosen
// height in the window; where a vocabulary note opens, the line is lifted just enough that the whole note stays in view.
// Prints the camera JSON (and the visibility entries are left to the episode). Read-only: nothing is written unless --write.
//
//   node scripts/video/fit-camera.mjs scripts/video/episodes/toeic-079-auto.json [--write]
//
// The anchors (when, which line, which section) are the episode's current `camera` entries; only their `offset` is recomputed.
// An entry whose line is the opening line of a vocabulary note (the note's `open`) is treated as "note opens here".
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./voice/config.mjs";
import { launchBrowser, openEpisode, startServer } from "./render-lib.mjs";

const args = process.argv.slice(2);
const episodeFile = path.resolve(args.find((a) => !a.startsWith("--")) || "");
const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
const episodeUrl = "/" + path.relative(REPO_ROOT, episodeFile).split(path.sep).join("/");
const TOP = 110, BOTTOM = 1010;   // the line being read sits at TOP; a note must end above BOTTOM (the window is 1024 high)

const server = startServer(8134);
let browser;
try {
  browser = await launchBrowser();
  const page = await openEpisode(browser, 8134, episodeUrl);
  const plan = await page.evaluate(() => window.plan);
  const line = (id) => plan.lines.find((l) => l.id === id);
  const timeOf = (ref) => { const l = line(ref.line); if (!ref.word) return l.start; const w = l.words.find((x) => x.text.replace(/[^\p{L}\p{N}']/gu, "").toLowerCase() === ref.word.toLowerCase()); return l.start + w.at; };
  const out = [];
  for (const c of episode.camera) {
    if (typeof c.at === "number" || c.id === "hook" || c.id === "quiz" || c.id === "outro") { out.push(c); continue; }
    const t = timeOf(c.at);
    // the vocabulary note this entry opens, if any
    const note = episode.vocabulary.find((v) => v.open.line === c.at.line && v.open.word === c.at.word);
    // measure with the state the viewer will see: settled, a note fully open when the entry opens it
    const settle = note ? Math.max(line(note.exampleLine).start + 0.6, t + 1.2) : t + 0.8;
    const m = await page.evaluate(({ settle, section, lineId, noteId }) => {
      window.renderFrame(settle);
      const sec = document.getElementById(section), el = document.querySelector(`[data-line="${lineId}"]`);
      const rel = el.getBoundingClientRect().top - sec.getBoundingClientRect().top;
      let noteBottom = null;
      if (noteId) noteBottom = document.getElementById(noteId).getBoundingClientRect().bottom - sec.getBoundingClientRect().top;
      return { rel, noteBottom };
    }, { settle, section: c.id, lineId: c.at.line, noteId: note?.id });
    // the line sits at TOP, or higher when the note below it would not fit
    const y = note ? Math.min(TOP, BOTTOM - (m.noteBottom - m.rel)) : TOP;
    out.push({ ...c, offset: Math.round(y - m.rel), _y: Math.round(y), _note: note ? note.id : undefined });
  }
  console.log(JSON.stringify(out.map(({ _y, _note, ...c }) => c)));
  for (const c of out) if (c._y !== undefined) console.error(`  ${JSON.stringify(c.at)} → line at y=${c._y}${c._note ? ` (note ${c._note} open: ${c._y < TOP ? "line lifted to keep the note in view" : "fits"})` : ""}`);
  if (args.includes("--write")) { episode.camera = out.map(({ _y, _note, ...c }) => c); fs.writeFileSync(episodeFile, JSON.stringify(episode, null, 2) + "\n"); console.error("written to " + episodeFile); }
} finally {
  await browser?.close();
  server.close();
}
