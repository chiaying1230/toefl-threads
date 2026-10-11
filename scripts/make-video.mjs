// LEGACY (pre-ElevenLabs pipeline; kept until the ElevenLabs pipeline passes P2 + one new episode). Do not build new episodes on this.
// Make a short vertical (1080 × 1920) vocabulary-in-context video.
//
//   node scripts/make-video.mjs init <postId> [--ep 7] [--main word]   draft scripts/video/episodes/<postId>.json
//   node scripts/make-video.mjs <episode.json | postId> [options]      render it
//
//   --out <dir>      output folder (default ./videos)
//   --voice <dir>    narration from scripts/make-voice.py (line-<id>.mp3); adds audio, real timing and mouth sync
//   --preview        half size, 15 fps: fast draft
//   --stills a,b,c   write PNGs at those seconds instead of a video (to check layout)
//   --phone          render at 360 × 640 (what a phone shows): check that nothing needs zooming to read
//   --audit          check every 0.2 s for text outside the safe area, overflow, too-small text and overlaps
//   --beats          print the beat table: every moment something changes on screen
//   --fps <n> --scale <n>   frame rate (default 30) and pixel density (default 1 → 1080×1920)
//
// Each episode is one JSON file (copy, words, quiz). The look – layout, type, colours, subtitles, mascot,
// motion – lives in scripts/video/ and is shared by every episode. See docs/video-design-system.md.
//
// Needs Playwright (`npm i -D playwright`, or PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs),
// ffmpeg + ffprobe on PATH, and CHROMIUM_PATH if Playwright cannot find its own browser.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "./video/server.mjs";
import { readApp, draftEpisode, loadEpisode, validateEpisode } from "./video/episode.mjs";
import { buildPlan } from "./video/plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const valued = new Set(["out", "voice", "stills", "fps", "scale", "port", "ep", "main"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && valued.has(argv[i - 1].slice(2))));
const INIT = positional[0] === "init";
const target = INIT ? positional[1] : positional[0];
if (!target) { console.error("usage: node scripts/make-video.mjs init <postId>   |   node scripts/make-video.mjs <episode.json | postId> [--voice dir] [--preview] [--stills 1,5,9]"); process.exit(1); }

const PREVIEW = flag("preview");
const FPS = parseInt(opt("fps", PREVIEW ? "15" : "30"), 10);
const SCALE = flag("phone") ? 1 / 3 : parseFloat(opt("scale", PREVIEW ? "0.5" : "1"));
const PORT = parseInt(opt("port", "8123"), 10);
const OUT = path.resolve(opt("out", "videos"));
const VOICE_DIR = opt("voice", null) && path.resolve(opt("voice"));
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const STILLS = opt("stills", null)?.split(",").map(Number);

const server = serve(ROOT, PORT);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
await page.emulateMedia({ colorScheme: "light" });
const done = async (code = 0) => { await browser.close(); server.close(); process.exit(code); };

// ---------- episode ----------
let ep;
if (target.endsWith(".json")) ep = loadEpisode(path.resolve(target));
else {
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => window.POSTS && window.VOCAB && window.CHARACTERS);
  const app = await readApp(page, target);
  if (!app) { console.error(`Post "${target}" not found (looked in the TOEFL list and every word pack).`); await done(1); }
  if (!app.char) { console.error(`Unknown author for ${target}.`); await done(1); }
  ep = draftEpisode(app, { episode: opt("ep", null) != null ? parseInt(opt("ep"), 10) : null, main: opt("main", null) });
}
const { errors, warnings } = validateEpisode(ep);
warnings.forEach((w) => console.warn("warning:", w));
if (errors.length) { errors.forEach((e) => console.error("error:", e)); await done(1); }

if (INIT) {
  const dir = path.join(ROOT, "scripts/video/episodes"), file = path.join(dir, `${ep.id}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ep, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}\nmain word: ${ep.main}   teach: ${ep.teach.join(", ")}\nedit the copy there, then: node scripts/make-video.mjs ${path.relative(process.cwd(), file)}`);
  await done(0);
}

// ---------- plan ----------
const voiceFile = (id) => { if (!VOICE_DIR) return null; const f = path.join(VOICE_DIR, `line-${id}.mp3`); return fs.existsSync(f) ? f : null; };
const probe = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const series = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/video/series.json"), "utf8"));
const plan = buildPlan(ep, { series, voiceFile, probe });

// loudness envelope of each narrated line (60 values/s, 0..1) so the mascot's mouth follows the recording
function envelopes(files) {
  const raw = files.map((f) => {
    const pcm = execFileSync(FFMPEG, ["-v", "error", "-i", f, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
    const win = 8000 / 60, out = [];
    for (let i = 0; i + win <= pcm.length / 2; i += win) { let sum = 0; for (let j = 0; j < win; j++) { const v = pcm.readInt16LE((Math.floor(i) + j) * 2) / 32768; sum += v * v; } out.push(Math.sqrt(sum / win)); }
    return out.map((v, i, a) => (v + (a[i - 1] ?? v) + (a[i + 1] ?? v)) / 3);
  });
  const all = raw.flat().sort((a, b) => a - b), ref = all[Math.floor(all.length * 0.95)] || 1;
  return raw.map((r) => r.map((v) => +Math.min(1, v / ref).toFixed(2)));
}
const voiced = plan.lines.filter((l) => voiceFile(l.id));
envelopes(voiced.map((l) => voiceFile(l.id))).forEach((env, i) => { voiced[i].env = env; });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${ep.id}.plan.json`), JSON.stringify({ ...plan, lines: plan.lines.map(({ tokens, env, ...l }) => l) }, null, 2));
if (process.env.SPEC_DUMP) fs.writeFileSync(process.env.SPEC_DUMP, JSON.stringify(plan));
console.log(`${ep.id}: ${plan.duration}s · main word "${ep.main}" · also ${ep.teach.slice(1).join(", ") || "-"}${VOICE_DIR ? " (voiced)" : " (estimated timing)"}`);
if (flag("beats")) { let prev = 0, gap = 0, at = 0; plan.beats.forEach((b) => { console.log(String(b.t).padStart(6), b.what); if (b.t - prev > gap) { gap = b.t - prev; at = prev; } prev = b.t; }); console.log(`longest quiet stretch: ${gap.toFixed(2)} s (after ${at}s)`); }
if (plan.duration > 40) console.warn(`WARNING: ${plan.duration}s is too long for a short (target 24–32 s). Trim thread.show or teach fewer words, or split the post into two episodes.`);
else if (plan.duration > 36) console.warn(`note: ${plan.duration}s is longer than ideal (target 24–32 s, up to 36 s is fine).`);
else if (plan.duration < 20) console.warn(`note: ${plan.duration}s is shorter than 20 s.`);

// ---------- render ----------
await page.goto(`http://localhost:${PORT}/scripts/video/scene.html`);
await page.evaluate((spec) => window.init(spec), plan);

if (flag("audit")) {
  const seen = new Map();
  for (let s = 0; s <= plan.duration; s += 0.2) {
    const issues = await page.evaluate((t) => window.audit(t), s);
    for (const i of issues) if (!seen.has(i)) seen.set(i, s);
  }
  if (!seen.size) console.log(`audit: no problems found (${Math.round(plan.duration / 0.2)} checks, safe area x 84–948, y 220–1560)`);
  else { [...seen].forEach(([i, s]) => console.log(`audit: ${i}   (first at ${s.toFixed(1)}s)`)); }
  await done(seen.size ? 1 : 0);
}

if (STILLS) {
  for (const s of STILLS) {
    await page.evaluate((t) => window.renderFrame(t), s);
    await page.screenshot({ type: "png", path: path.join(OUT, `${ep.id}.still-${s}.png`) });
  }
  console.log(`wrote ${STILLS.length} stills to ${OUT}`);
  await done();
}

const out = path.join(OUT, `${ep.id}.mp4`);
const ffArgs = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-"];
voiced.forEach((l) => ffArgs.push("-i", voiceFile(l.id)));
if (voiced.length) {
  const f = voiced.map((l, i) => `[${i + 1}:a]adelay=${Math.round(l.start * 1000)}|${Math.round(l.start * 1000)}[a${i}]`).join(";");
  ffArgs.push("-filter_complex", `${f};${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:duration=longest:dropout_transition=0,volume=${voiced.length}[aout]`, "-map", "0:v", "-map", "[aout]", "-c:a", "aac");
}
ffArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-r", String(FPS), "-t", String(plan.duration), "-movflags", "+faststart", out);
const ff = spawn(FFMPEG, ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
const ffDone = new Promise((res) => ff.on("close", res));

const frames = Math.ceil(plan.duration * FPS);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.renderFrame(t), i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 93 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (FPS * 5) === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%`);
}
ff.stdin.end();
const code = await ffDone;
console.log(`\r${out}  (${plan.duration}s, ${frames} frames${voiced.length ? ", with narration" : ", no audio"})`);
await done(code === 0 ? 0 : 1);
