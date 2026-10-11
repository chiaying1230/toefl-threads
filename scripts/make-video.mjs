// Make a 30–45 s vertical explainer clip for one thread.
//
//   node scripts/make-video.mjs <postId> [options]
//
//   --out <dir>      output folder (default ./videos)
//   --words <n>      max words to teach (default 3; trimmed automatically to stay under 45 s)
//   --voice <dir>    folder with line-<id>.mp3 from scripts/make-voice.py (adds real narration)
//   --preview        half-size, 15 fps: fast draft render
//   --stills a,b,c   only write PNG stills at those seconds (for checking layout), no video
//   --fps <n> --scale <n>   override frame rate / pixel density (default 30 / 2 → 1080×1920)
//
// Structure (hook → story → one card per word → call to action) follows the short-video
// formula: a 3-second hook, the thread as the "situation", a quick explanation, then a
// save/comment prompt. A talking tofu host explains; the thread's author bounces along
// while "speaking" the post. Without --voice the mouth and karaoke captions run on
// estimated timings; with voice files they follow the real audio length.
//
// Outputs: <out>/<postId>.mp4 and <out>/<postId>.plan.json (every line to be voiced,
// with its voice settings) — feed the plan to scripts/make-voice.py for narration.
//
// Needs Playwright (`npm i -D playwright`, or PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs),
// ffmpeg + ffprobe on PATH, and CHROMIUM_PATH if Playwright can't find its own browser.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
const valued = new Set(["out", "words", "voice", "stills", "fps", "scale", "port"]);
const postId = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && valued.has(argv[i - 1].slice(2))));
if (!postId) { console.error("usage: node scripts/make-video.mjs <postId> [--voice dir] [--preview] [--stills 1,5,9]"); process.exit(1); }

const OUT = path.resolve(opt("out", "videos"));
const PREVIEW = flag("preview");
const FPS = parseInt(opt("fps", PREVIEW ? "15" : "30"), 10);
const SCALE = parseFloat(opt("scale", PREVIEW ? "1" : "2"));
const PORT = parseInt(opt("port", "8123"), 10);
const VOICE_DIR = opt("voice", null) && path.resolve(opt("voice"));
const STILLS = opt("stills", null)?.split(",").map(Number);
const MAX_WORDS = parseInt(opt("words", "3"), 10);
const MAX_SECONDS = 45;

// ---------- tiny static server (the page needs the app's data files) ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(fs.readFileSync(p));
}).listen(PORT);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: SCALE })).newPage();
const done = async (code = 0) => { await browser.close(); server.close(); process.exit(code); };

// ---------- read the thread from the app's own data ----------
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(() => window.POSTS && window.VOCAB && window.CHARACTERS);
const data = await page.evaluate((id) => {
  const post = window.POSTS.find((p) => p.id === id);
  if (!post) return null;
  const vocab = {}, kk = {};
  post.text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (m, k) => { vocab[k] = window.VOCAB[k]; kk[k] = (window.KK || {})[k] || ""; });
  return { post, vocab, kk, char: window.CHARACTERS[post.author] };
}, postId);
if (!data) { console.error(`Post "${postId}" not found in window.POSTS (pack threads are not supported yet).`); await done(1); }
const { post, vocab, kk, char } = data;

// ---------- text → timed tokens ----------
const EMOJI = /\p{Extended_Pictographic}|️|‍/gu;
const MARK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const plain = (s) => s.replace(MARK, (m, k, shown) => shown || k);
const LEVEL_NAME = { 1: "Soy Milk 豆漿", 2: "Tofu 豆腐", 3: "Natto 納豆" };
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;

function tokenize(raw, lang) {
  const out = [];
  const push = (text, key) => {
    text = text.replace(EMOJI, "");
    if (!text.trim()) return;
    const letters = (text.match(/[A-Za-z0-9]/g) || []).length;
    const cjk = (text.match(/[一-鿿]/g) || []).length;
    out.push({ text: text.trim(), key: key || null, w: cjk ? 0.22 * cjk : 0.1 + 0.05 * letters, pause: 0 });
  };
  const addPlain = (seg) => {
    if (lang === "zh") {
      for (const p of seg.match(/[A-Za-z0-9'’.\-]+|[一-鿿]|[^\s]/gu) || []) {
        const isPunct = /^[^A-Za-z0-9一-鿿]$/u.test(p) && !/\p{Extended_Pictographic}/u.test(p);
        if (isPunct && out.length) out[out.length - 1].text += p; else push(p);
      }
    } else seg.split(/\s+/).forEach((p) => push(p));
  };
  let last = 0, m;
  MARK.lastIndex = 0;
  while ((m = MARK.exec(raw))) { addPlain(raw.slice(last, m.index)); push(m[2] || m[1], m[1]); last = m.index + m[0].length; }
  addPlain(raw.slice(last));
  out.forEach((k) => { k.pause = /[.!?。！？]["”’)]*$/.test(k.text) ? 0.35 : /[,;:，；：、]$/.test(k.text) ? 0.15 : 0; });
  return out;
}
const estimate = (tokens) => tokens.reduce((s, k) => s + k.w + k.pause, 0) + 0.1;
const voiceFile = (id) => VOICE_DIR && path.join(VOICE_DIR, `line-${id}.mp3`);
const probe = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

const CHAR_VOICES = ["en-US-GuyNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-AU-NatashaNeural", "en-US-ChristopherNeural", "en-GB-SoniaNeural"];
const VOICES = {
  hostZh: { voice: "zh-TW-HsiaoChenNeural", rate: "+5%", pitch: "+0Hz" },
  hostEn: { voice: "en-US-AnaNeural", rate: "-5%", pitch: "+0Hz" },
  char: { voice: CHAR_VOICES[hash(post.author) % CHAR_VOICES.length], rate: "+0%", pitch: ["-6Hz", "+0Hz", "+8Hz"][hash(post.author) % 3] },
};

// ---------- choose what to teach ----------
const paras = post.text.split(/\n\s*\n/), zhParas = post.zh.split(/\n\s*\n/);
const keysIn = (s) => { const ks = []; s.replace(MARK, (m, k) => { if (!ks.includes(k)) ks.push(k); }); return ks; };
const wordCount = (s) => plain(s).split(/\s+/).length;
const best = paras.map((p, i) => ({ i, n: keysIn(p).length, len: wordCount(p) })).filter((x) => x.len <= 48).sort((a, b) => b.n - a.n || a.i - b.i)[0];
let storyRaw, storyZh = "";
if (best) { storyRaw = paras[best.i]; storyZh = zhParas.length === paras.length ? zhParas[best.i] : ""; }
else { // first paragraph is too long: keep whole sentences up to ~36 words
  const sents = paras[0].match(/[^.!?]+[.!?]*\s*/g) || [paras[0]];
  storyRaw = ""; for (const s of sents) { if (wordCount(storyRaw + s) > 36 && storyRaw) break; storyRaw += s; }
  storyRaw = storyRaw.trim();
}
const byLevel = (a, b) => (vocab[b].level - vocab[a].level) || 0;
const inStory = keysIn(storyRaw).sort(byLevel);
const rest = Object.keys(vocab).filter((k) => !inStory.includes(k)).sort(byLevel);
const teachAll = [...inStory, ...rest];

// ---------- build the plan ----------
function buildPlan(teach) {
  const lines = [], scenes = [];
  const line = (speaker, lang, raw, v) => {
    const tokens = tokenize(raw, lang);
    const l = { id: lines.length, speaker, lang, text: tokens.map((k) => k.text).join(lang === "zh" ? "" : " "), tokens, voice: v, start: 0, end: 0 };
    const f = voiceFile(l.id);
    l.dur = f && fs.existsSync(f) ? probe(f) + 0.05 : estimate(tokens);
    lines.push(l);
    return l.id;
  };
  let t = 0;
  const schedule = (ids, lead, tail, gap = 0.15) => {
    const start = t; let c = t + lead;
    for (const id of ids) {
      const l = lines[id];
      l.start = c; l.end = c + l.dur;
      const total = l.tokens.reduce((s, k) => s + k.w + k.pause, 0), scale = (l.dur - 0.1) / total;
      let x = l.start;
      for (const k of l.tokens) { k.s = +x.toFixed(3); x += k.w * scale; k.e = +x.toFixed(3); x += k.pause * scale; }
      c = l.end + gap;
    }
    t = lines[ids[ids.length - 1]].end + tail;
    return { start, end: t };
  };

  const hookWord = teach[0], hv = vocab[hookWord];
  const question = ["你會嗎？", "看得懂嗎？", "知道嗎？"][hash(post.id) % 3];
  const h = [line("host", "en", hookWord, VOICES.hostEn), line("host", "zh", question, VOICES.hostZh)];
  scenes.push({ type: "hook", ...schedule(h, 0.1, 0.35), lines: h, word: hookWord, level: LEVEL_NAME[hv.level], question });

  const sl = line("char", "en", storyRaw, VOICES.char);
  scenes.push({ type: "story", ...schedule([sl], 0.3, storyZh ? 1.6 : 0.8), line: sl, zh: storyZh, teach });

  teach.forEach((k, i) => {
    const v = vocab[k];
    const meaning = v.zh.replace(/\s*\(.*?\)/g, "").replace(/…/g, "");
    const ids = [line("host", "en", k, { ...VOICES.hostEn, rate: "-15%" }), line("host", "zh", meaning, VOICES.hostZh), line("host", "en", v.ex, VOICES.hostEn)];
    scenes.push({ type: "word", ...schedule(ids, 0.35, 0.6, 0.2), lines: { word: ids[0], mean: ids[1], ex: ids[2] }, key: k, word: k, pos: v.pos, zh: v.zh, kk: kk[k], level: LEVEL_NAME[v.level], exZh: v.exZh, index: i + 1, total: teach.length });
  });

  const c = [line("host", "zh", "收藏起來，考前複習", VOICES.hostZh), line("host", "zh", `留言用 ${hookWord} 造句`, VOICES.hostZh), line("host", "zh", "追蹤 toEfu，每天一篇", VOICES.hostZh)];
  scenes.push({ type: "cta", ...schedule(c, 0.2, 1.2, 0.25), lines: c, word: hookWord });

  return { postId: post.id, duration: +t.toFixed(2), char: { name: char.name, handle: char.handle, avatar: char.avatar, color: char.color, topic: post.topic }, lines, scenes };
}

let teach = teachAll.slice(0, Math.max(1, MAX_WORDS)), plan = buildPlan(teach);
while (plan.duration > MAX_SECONDS && teach.length > 1) { teach = teach.slice(0, -1); plan = buildPlan(teach); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${postId}.plan.json`), JSON.stringify({ ...plan, lines: plan.lines.map(({ tokens, ...l }) => l) }, null, 2));
console.log(`${postId}: ${plan.duration}s, teaching ${teach.join(", ")}${VOICE_DIR ? " (voiced)" : " (estimated timing)"}`);

// ---------- render ----------
await page.goto(`http://localhost:${PORT}/scripts/video/scene.html`);
await page.evaluate((spec) => window.init(spec), plan);

if (STILLS) {
  for (const s of STILLS) {
    await page.evaluate((t) => window.renderFrame(t), s);
    await page.screenshot({ type: "png", path: path.join(OUT, `${postId}.still-${s}.png`) });
  }
  console.log(`wrote ${STILLS.length} stills to ${OUT}`);
  await done();
}

const out = path.join(OUT, `${postId}.mp4`);
const voiced = plan.lines.filter((l) => voiceFile(l.id) && fs.existsSync(voiceFile(l.id)));
const ffArgs = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-"];
voiced.forEach((l) => ffArgs.push("-i", voiceFile(l.id)));
if (voiced.length) {
  const f = voiced.map((l, i) => `[${i + 1}:a]adelay=${Math.round(l.start * 1000)}|${Math.round(l.start * 1000)}[a${i}]`).join(";");
  ffArgs.push("-filter_complex", `${f};${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:duration=longest:dropout_transition=0,volume=${voiced.length}[aout]`, "-map", "0:v", "-map", "[aout]", "-c:a", "aac");
}
ffArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", String(FPS), "-t", String(plan.duration), out);
const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
const ffDone = new Promise((res) => ff.on("close", res));

const frames = Math.ceil(plan.duration * FPS);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.renderFrame(t), i / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (i % (FPS * 5) === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%`);
}
ff.stdin.end();
const code = await ffDone;
console.log(`\r${out}  (${plan.duration}s, ${frames} frames${voiced.length ? ", with narration" : ", no audio"})`);
await done(code === 0 ? 0 : 1);
