// Record a 30–45 s vertical promo clip for one thread.
//
//   node scripts/make-video.mjs <postId> [--out videos] [--words 4] [--port 8123]
//
// Opens #/t/<postId> in a phone-sized Chromium, scrolls through the thread, taps each
// highlighted word to show its word card, and writes:
//   <out>/<postId>.mp4          the screen recording (needs ffmpeg on PATH)
//   <out>/<postId>.script.json  timeline + narration text for TTS / subtitles
//   <out>/<postId>.srt          subtitles (English narration + Chinese)
//
// Needs Playwright (`npm i -D playwright`, or set PLAYWRIGHT_MODULE to its path).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const postId = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const opt = (name, def) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
};
if (!postId) {
  console.error("usage: node scripts/make-video.mjs <postId> [--out videos] [--words 4] [--port 8123]");
  process.exit(1);
}
const OUT = path.resolve(opt("out", "videos"));
const MAX_WORDS = parseInt(opt("words", "4"), 10);
const PORT = parseInt(opt("port", "8123"), 10);
const CHROME = process.env.CHROMIUM_PATH || undefined;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");

// ---- tiny static server for the repo ----
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(fs.readFileSync(p));
}).listen(PORT);

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(OUT, ".rec-"));
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  recordVideo: { dir: tmp, size: { width: 390, height: 844 } },
});
// Skip first-run onboarding and the feature tour.
await ctx.addInitScript(() => {
  try { localStorage.setItem("toeflThreads.v2", JSON.stringify({ prefs: { levels: [1, 2, 3], packs: [], topics: [], onboarded: true, toured: true } })); } catch (e) {}
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => +((Date.now() - t0) / 1000).toFixed(2);
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`http://localhost:${PORT}/index.html#/t/${postId}`);
await page.addStyleTag({ content: "#toast, .toast { display: none !important; }" });
await page.waitForSelector("#threadBody .post, #threadBody .vocab", { timeout: 10000 });

// Thread + vocab data come straight from the page.
const data = await page.evaluate((id) => {
  const post = (window.POSTS || []).find((p) => p.id === id);
  const keys = [];
  if (post) post.text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (m, k) => { if (!keys.includes(k)) keys.push(k); });
  return { post, vocab: Object.fromEntries(keys.map((k) => [k, window.VOCAB[k]])), keys };
}, postId);
if (!data.post) {
  // Pack threads (non-TOEFL lists) are not built in; fall back to whatever the page rendered.
  console.error(`Post "${postId}" not found in window.POSTS (pack threads are not supported yet).`);
  await ctx.close(); await browser.close(); server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}
const words = data.keys.slice(0, MAX_WORDS);
const cues = [];
const cue = (start, end, en, zh) => cues.push({ start, end: +end.toFixed(2), en, zh });

// 1. Hook: show the thread
const t1 = now();
await wait(3500);
cue(t1, now(), "Can you understand this post?", "你看得懂這則貼文嗎？");

// 2. Stay on the post while the narrator reads it
const t2 = now();
// Hold long enough for the narrator to read the post (~2.6 words/s).
const readSecs = data.post.text.replace(/\[\[|\]\]/g, "").split(/\s+/).length / 2.6;
await wait(Math.max(800, readSecs * 1000 - (now() - t2) * 1000));
cue(t2, now(), data.post.text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, k, s) => s || k).replace(/\n+/g, " "), data.post.zh.replace(/\n+/g, " "));

// 3. One word card per highlighted word
for (const key of words) {
  const v = data.vocab[key];
  const btn = page.locator(`#threadBody button.vocab[data-key="${key}"]`).first();
  if (!(await btn.count())) continue;
  await btn.scrollIntoViewIfNeeded();
  await wait(700);
  await btn.tap();
  const ts = now();
  await wait(5200);
  cue(ts, now(), `${key}. ${v.pos} ${v.ex}`, `${v.zh}。${v.exZh}`);
  await page.keyboard.press("Escape");
  // Fall back to the overlay if Escape doesn't close the sheet.
  await page.evaluate(() => { const o = document.querySelector("#sheetOverlay"); if (o && !o.hidden) o.click(); });
  await wait(600);
}

// 4. Outro
const t4 = now();
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(2500);
cue(t4, now(), "Learn TOEFL words from funny posts. Follow toEfu!", "用好笑的串文學托福單字，追蹤 toEfu！");

const duration = now();
await ctx.close();
await browser.close();
server.close();

// ---- outputs ----
const webm = fs.readdirSync(tmp).find((f) => f.endsWith(".webm"));
const mp4 = path.join(OUT, `${postId}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(tmp, webm), "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
fs.rmSync(tmp, { recursive: true, force: true });

const ts = (s) => {
  const ms = Math.round(s * 1000), pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};
fs.writeFileSync(path.join(OUT, `${postId}.srt`), cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.en}\n${c.zh}\n`).join("\n"));
fs.writeFileSync(path.join(OUT, `${postId}.script.json`), JSON.stringify({ postId, duration, words, cues }, null, 2));
console.log(`${mp4}  (${duration.toFixed(1)} s, ${words.length} words)`);
