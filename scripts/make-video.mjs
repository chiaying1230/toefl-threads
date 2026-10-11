// Make a 30–45 s vertical explainer clip for one thread.
//
//   node scripts/make-video.mjs <postId> [options]
//
//   --out <dir>      output folder (default ./videos)
//   --words <n>      cap the number of words taught (default: every word in the thread)
//   --voice <dir>    folder with line-<id>.mp3 from scripts/make-voice.py (adds real narration)
//   --preview        half-size, 15 fps: fast draft render
//   --stills a,b,c   only write PNG stills at those seconds (for checking layout), no video
//   --fps <n> --scale <n>   override frame rate / pixel density (default 30 / 2 → 1080×1920)
//
// The picture is the real toEfu app (feed → thread → the app's own word sheet) with our overlays
// on top: a hook, rolling captions, a talking tofu host, small voice bars, tap marks.
// Structure: 3-second hook → the whole thread read aloud → one card per word → call to action.
// Works for every thread: the TOEFL list and the Elementary / High School / IELTS / TOEIC packs.
// Without --voice the mouth, bars and captions run on estimated timings; with voice files they
// follow the real audio (length and loudness).
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
const MAX_WORDS = parseInt(opt("words", "99"), 10);

// ---------- tiny static server (the page needs the app's data files) ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(fs.readFileSync(p));
}).listen(PORT);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
await page.emulateMedia({ colorScheme: "light" });
const done = async (code = 0) => { await browser.close(); server.close(); process.exit(code); };

// ---------- read the thread from the app's own data ----------
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(() => window.POSTS && window.VOCAB && window.CHARACTERS);
const data = await page.evaluate(async (id) => {
  let post = window.POSTS.find((p) => p.id === id), pack = null;
  if (!post) { // threads of the other word lists live in js/data/packs/<id>.js and load on demand
    const ids = (window.PACK_META || []).map((p) => p.id);
    await new Promise((res) => window.Core.loadPacks(ids, res));
    for (const k of ids) { post = ((window.PACK_POSTS || {})[k] || []).find((p) => p.id === id); if (post) { pack = k; break; } }
  }
  if (!post) return null;
  const vocab = {}, kk = {};
  post.text.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (m, k) => { vocab[k] = window.VOCAB[k]; kk[k] = (window.KK || {})[k] || ""; });
  const meta = (window.PACK_META || []).find((p) => p.id === (pack || "toefl"));
  return { post, vocab, kk, pack, packZh: meta ? meta.zh : "托福", char: window.CHARACTERS[post.author] };
}, postId);
if (!data) { console.error(`Post "${postId}" not found (looked in the TOEFL list and every word pack).`); await done(1); }
const { post, vocab, kk, char, pack, packZh } = data;
if (!char) { console.error(`Unknown author "${post.author}" for ${postId}.`); await done(1); }
// The app runs inside the video: skip its first-run screens and select the thread's word pack.
await ctx.addInitScript((pk) => {
  try { localStorage.setItem("toeflThreads.v2", JSON.stringify({ prefs: { levels: [1, 2, 3], packs: pk ? [pk] : [], topics: [], onboarded: true, toured: true } })); } catch (e) {}
}, pack);

// ---------- text → timed tokens ----------
const EMOJI = /\p{Extended_Pictographic}|️|‍/gu;
const MARK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const plain = (s) => s.replace(MARK, (m, k, shown) => shown || k);
const LEVEL_NAME = { 1: "Soy Milk 豆漿", 2: "Tofu 豆腐", 3: "Natto 納豆" };
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0) >>> 0;

function tokenize(raw, lang) {
  // paragraphs are tokenized separately; the first token of a later paragraph carries `brk`
  const paras = raw.split(/\n\s*\n/);
  if (paras.length > 1) {
    return paras.flatMap((p, i) => { const t = tokenize(p, lang); if (i && t.length) t[0].brk = true; return t; });
  }
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
  // punctuation right after a highlighted word ("[[word]].") stays glued to it
  const addAfterMark = (seg) => { const g = seg.match(/^[^\s]+/); if (g && out.length) { out[out.length - 1].text += g[0]; seg = seg.slice(g[0].length); } addPlain(seg); };
  let afterMark = false;
  while ((m = MARK.exec(raw))) { (afterMark ? addAfterMark : addPlain)(raw.slice(last, m.index)); push(m[2] || m[1], m[1]); last = m.index + m[0].length; afterMark = true; }
  (afterMark ? addAfterMark : addPlain)(raw.slice(last));
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
// The whole thread is read out, and every word highlighted in it is taught — in the order
// it appears, so the lesson follows the story. (One word → one card, three words → three.)
const storyRaw = post.text.trim();
const storyZh = post.zh.trim().replace(/\n\s*\n/g, "\n");
const keysIn = (s) => { const ks = []; s.replace(MARK, (m, k) => { if (!ks.includes(k)) ks.push(k); }); return ks; };
const teachAll = keysIn(storyRaw);
const hardest = (keys) => keys.reduce((b, k) => (vocab[k].level > vocab[b].level ? k : b), keys[0]);


// Real-audio loudness: 60 values/s in 0..1 per voiced line, so the voice rings and the mouth
// follow the actual recording. Normalised against the loudest 5% of all voiced samples.
function envelopes(files) {
  const raw = files.map((f) => {
    const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
    const win = 8000 / 60, out = [];
    for (let i = 0; i + win <= pcm.length / 2; i += win) {
      let sum = 0; for (let j = 0; j < win; j++) { const v = pcm.readInt16LE((Math.floor(i) + j) * 2) / 32768; sum += v * v; }
      out.push(Math.sqrt(sum / win));
    }
    return out.map((v, i, a) => (v + (a[i - 1] ?? v) + (a[i + 1] ?? v)) / 3);
  });
  const all = raw.flat().sort((a, b) => a - b), ref = all[Math.floor(all.length * 0.95)] || 1;
  return raw.map((r) => r.map((v) => +Math.min(1, v / ref).toFixed(2)));
}

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

  const hookWord = hardest(teach), hv = vocab[hookWord];
  const question = ["你會嗎？", "看得懂嗎？", "知道嗎？"][hash(post.id) % 3];
  const h = [line("host", "en", hookWord, VOICES.hostEn), line("host", "zh", question, VOICES.hostZh)];
  scenes.push({ type: "hook", ...schedule(h, 0.1, 0.35), lines: h, word: hookWord, label: `${packZh}單字`, level: LEVEL_NAME[hv.level], question });

  const sl = line("char", "en", storyRaw, VOICES.char);
  scenes.push({ type: "story", ...schedule([sl], 0.3, storyZh ? Math.min(4, Math.max(1.6, storyZh.length / 14)) : 0.8), line: sl, zh: storyZh, teach });

  teach.forEach((k, i) => {
    const v = vocab[k];
    const meaning = v.zh.replace(/\s*\(.*?\)/g, "").replace(/…/g, "");
    const ids = [line("host", "en", k, { ...VOICES.hostEn, rate: "-15%" }), line("host", "zh", meaning, VOICES.hostZh), line("host", "en", v.ex, VOICES.hostEn)];
    scenes.push({ type: "word", ...schedule(ids, 0.35, 0.6, 0.2), lines: { word: ids[0], mean: ids[1], ex: ids[2] }, key: k, word: k, pos: v.pos, zh: v.zh, kk: kk[k], level: LEVEL_NAME[v.level], exZh: v.exZh, index: i + 1, total: teach.length });
  });

  const c = [line("host", "zh", "收藏起來，隨時複習", VOICES.hostZh), line("host", "zh", `留言用 ${hookWord} 造句`, VOICES.hostZh), line("host", "zh", "追蹤 toEfu，每天一則", VOICES.hostZh)];
  scenes.push({ type: "cta", ...schedule(c, 0.2, 1.2, 0.25), lines: c, word: hookWord });

  return { postId: post.id, duration: +t.toFixed(2), pack, char: { name: char.name, handle: char.handle, avatar: char.avatar, color: char.color, topic: post.topic }, lines, scenes };
}

const teach = teachAll.slice(0, Math.max(1, MAX_WORDS)), plan = buildPlan(teach);
const voicedLines = plan.lines.filter((l) => voiceFile(l.id) && fs.existsSync(voiceFile(l.id)));
envelopes(voicedLines.map((l) => voiceFile(l.id))).forEach((env, i) => { voicedLines[i].env = env; });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `${postId}.plan.json`), JSON.stringify({ ...plan, lines: plan.lines.map(({ tokens, env, ...l }) => l) }, null, 2));
console.log(`${postId}: ${plan.duration}s, teaching ${teach.length} word(s): ${teach.join(", ")}${VOICE_DIR ? " (voiced)" : " (estimated timing)"}`);
if (plan.duration > 60) console.warn(`note: ${plan.duration}s is long for a short; use --words to teach fewer.`);

// ---------- render ----------
await page.goto(`http://localhost:${PORT}/scripts/video/scene.html`);
await page.evaluate((spec) => window.init(spec), plan);
{ // load every web-font glyph the clip needs, then settle before the first frame
  const text = plan.scenes.flatMap((sc) => [sc.zh, sc.exZh, sc.word, sc.kk, sc.level, sc.question]).concat(plan.lines.map((l) => l.text)).join("") + "今天學會了嗎？收藏起來，隨時複習留言用造句追蹤每天一則用生活日常背單字⭐托福必考字例句";
  await page.evaluate((t) => window.preloadFonts(t), text);
  for (const sc of plan.scenes) await page.evaluate((t) => window.renderFrame(t), sc.start + 0.01);
  await page.evaluate(() => document.fonts.ready);
}

if (STILLS) {
  for (const s of STILLS) {
    await page.evaluate((t) => window.renderFrame(t), s);
    await page.screenshot({ type: "png", path: path.join(OUT, `${postId}.still-${s}.png`) });
  }
  console.log(`wrote ${STILLS.length} stills to ${OUT}`);
  await done();
}

const out = path.join(OUT, `${postId}.mp4`);
const voiced = voicedLines;
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
