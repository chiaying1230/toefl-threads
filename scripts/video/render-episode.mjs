// Render one episode (post-reference.html template + its plan.json + narration.wav) to an MP4.
//
//   node scripts/video/render-episode.mjs scripts/video/episodes/p2-auto.json --out outputs/p2-auto-pipeline.mp4
//   options: --docs <dir>   where layout-audit.json / render.json go (default: the narration's folder)
//            --audit-only   check every frame's layout, write no video
//            --narration-only   skip the music / sound-effect mix even if the episode defines one
// If the episode defines `music` / `soundEffects`, the video is first rendered with the narration only (<out>.narration-only.mp4,
// kept) and audio-mix.mjs then writes <out> with the mix; without them <out> is the narration-only render.
// Same encode settings as render-p2-v42-outro.mjs (30 fps, h264 crf 17, aac 160k, narration padded to the video length).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "./voice/config.mjs";
import { FFMPEG, launchBrowser, openEpisode, startServer } from "./render-lib.mjs";
import { mixAudio, needsMix } from "./audio-mix.mjs";
import { assertEpisode, linesFromPlan } from "./voice/episode-refs.mjs";

const args = process.argv.slice(2);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const episodeFile = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--out", "--docs"].includes(args[i - 1])) || "");
if (!fs.existsSync(episodeFile)) { console.error("usage: node scripts/video/render-episode.mjs <episode.json> --out <file.mp4> [--docs dir] [--audit-only]"); process.exit(1); }
const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
const episodeUrl = "/" + path.relative(REPO_ROOT, episodeFile).split(path.sep).join("/");
const audioFile = path.join(REPO_ROOT, episode.audio.replace(/^\//, ""));
const docs = path.resolve(value("docs", path.dirname(audioFile)));
const out = path.resolve(value("out", path.join(REPO_ROOT, "outputs", `${episode.id}.mp4`)));
const mixing = needsMix(episode) && !args.includes("--narration-only");
const rendered = mixing ? out.replace(/\.mp4$/i, ".narration-only.mp4") : out;
for (const f of [audioFile, path.join(REPO_ROOT, episode.plan.replace(/^\//, ""))]) if (!fs.existsSync(f)) { console.error(`missing ${f} (run assemble.mjs first)`); process.exit(1); }

// every line / word / id the episode refers to must exist in the assembled plan: fail here, not inside the browser
assertEpisode(episode, linesFromPlan(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, episode.plan.replace(/^\//, "")), "utf8"))), path.basename(episodeFile));

const server = startServer(8131);
let browser;
try {
  browser = await launchBrowser();
  const page = await openEpisode(browser, 8131, episodeUrl);
  const spec = await page.evaluate(() => ({ duration: window.template.duration, start: window.template.start }));
  const frames = Math.ceil(spec.duration * 30 - 1e-9);
  spec.duration = frames / 30; spec.frames = frames;

  const issues = new Map();
  for (let i = 0; i < frames; i++) {
    const t = i / 30;
    for (const issue of await page.evaluate((t) => window.audit(t), t)) if (!issues.has(issue)) issues.set(issue, t);
  }
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, "layout-audit.json"), JSON.stringify({ samples: frames, issues: [...issues], checks: ["horizontal text overflow", "active reading cue within white viewport", "settled outro text bounds"] }, null, 2));
  fs.writeFileSync(path.join(docs, "render.json"), JSON.stringify(spec, null, 2));
  if (issues.size) throw Error("layout audit failed: " + JSON.stringify([...issues]));
  console.log(`layout audit: ${frames} frames, no issues`);
  if (args.includes("--audit-only")) process.exit(0);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "30", "-c:v", "mjpeg", "-i", "-", "-i", audioFile, "-map", "0:v", "-map", "1:a", "-af", `apad=whole_dur=${spec.duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-c:a", "aac", "-b:a", "160k", "-t", String(spec.duration), "-movflags", "+faststart", rendered], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => { ff.on("close", resolve); ff.on("error", reject); });
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.renderFrame(t), i / 30);
    const image = await page.screenshot({ type: "jpeg", quality: 93 });
    if (!ff.stdin.write(image)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 150 === 0) console.log(`${i}/${frames} frames`);
  }
  ff.stdin.end();
  if ((await done) !== 0) throw Error("ffmpeg failed");
  console.log(`${path.relative(REPO_ROOT, rendered)} / ${spec.duration.toFixed(3)}s / ${frames} frames`);
  if (mixing) {
    const plan = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, episode.plan.replace(/^\//, "")), "utf8"));
    mixAudio({ episode, plan, video: rendered, narration: audioFile, out });
    console.log(`${path.relative(REPO_ROOT, out)} (narration + music/SFX; verify with audio-mix.mjs)`);
  }
} finally {
  await browser?.close();
  server.close();
}
