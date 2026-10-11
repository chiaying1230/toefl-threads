// Audio-mix layer: background music + sound effects, driven by the episode JSON. Video is stream-copied, never re-encoded;
// the narration is mixed at gain 1 (amix normalize=0), so nothing that was approved about the voice changes.
//
// Episode settings (both optional – an episode with neither renders as plain narration):
//   "music": { "asset": "/scripts/video/assets/x.wav", "narrationGain": 0.16, "endingGain": 0.3, "riseDuration": 0.6,
//              "fadeIn": 0.35, "fadeOut": 0.8, "riseAt": <time ref, default the end of the narration (plan.audioEnd)> }
//   "soundEffects": [ { "asset": "/scripts/video/assets/y.wav", "at": <time ref>, "gain": 0.75 } ]
// A time ref is a number of seconds, "planEnd", or { line, word?, edge?: "start"|"end", delay? } – the same as the template's.
// Music shorter than the video loops; longer is cut. The mix never changes the video's duration.
//
//   node scripts/video/audio-mix.mjs scripts/video/episodes/p2-auto.json --video outputs/p2-auto-pipeline.mp4 --out outputs/p2-auto-pipeline-music.mp4
//   (--docs <dir> for mix-verification.json; --no-verify skips the checks)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SAMPLE_RATE as SR, decodeAudio, findFfmpeg, rms } from "./voice/audio.mjs";
import { ConfigError, REPO_ROOT } from "./voice/config.mjs";

const FFMPEG = findFfmpeg();
const assetPath = (a) => path.join(REPO_ROOT, String(a).replace(/^\//, ""));

export const needsMix = (episode) => Boolean(episode.music || (episode.soundEffects && episode.soundEffects.length));

/** Seconds for a time ref, against the plan. */
export function timeOf(ref, plan) {
  if (typeof ref === "number") return ref;
  if (ref === "planEnd") return plan.duration;
  const line = plan.lines.find((l) => l.id === ref?.line);
  if (!line) throw new ConfigError(`time reference points to unknown line "${ref?.line}"`);
  if (ref.word) {
    const w = line.words.find((x) => x.text.replace(/[.,]/g, "").toLowerCase() === ref.word.toLowerCase());
    if (!w) throw new ConfigError(`time reference: word "${ref.word}" is not aligned in line "${ref.line}"`);
    return line.start + w.at + (ref.delay ?? 0);
  }
  return (ref.edge === "end" ? line.end : line.start) + (ref.delay ?? 0);
}

function run(args) {
  const r = spawnSync(FFMPEG, ["-y", "-v", "error", ...args], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${r.error?.message || r.stderr.slice(0, 400)}`);
}
/** Video length in seconds, exact: frame count / fps (ffmpeg's own "Duration" only has centisecond precision). */
export function probeDuration(file) {
  const info = spawnSync(FFMPEG, ["-i", file, "-map", "0:v", "-c", "copy", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
  const frames = [...info.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1], fps = /(\d+(?:\.\d+)?) fps/.exec(info)?.[1];
  if (frames && fps) return Number(frames) / Number(fps);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  if (!m) throw new Error(`cannot read duration of ${file}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

/** All problems with the mix settings at once, before ffmpeg runs. */
export function validateMix(episode, plan, duration) {
  const problems = [], m = episode.music, fx = episode.soundEffects ?? [];
  const num = (v, name, min, max) => { if (!(typeof v === "number" && v >= min && v <= max)) problems.push(`${name} must be a number between ${min} and ${max}`); };
  if (m) {
    if (!m.asset || !fs.existsSync(assetPath(m.asset))) problems.push(`music.asset not found: ${m.asset}`);
    num(m.narrationGain, "music.narrationGain", 0, 1); num(m.endingGain ?? m.narrationGain, "music.endingGain", 0, 1);
    num(m.riseDuration ?? 0.6, "music.riseDuration", 0.01, 30); num(m.fadeIn ?? 0, "music.fadeIn", 0, duration); num(m.fadeOut ?? 0, "music.fadeOut", 0, duration);
    if (m.narrationGain > 0.5) problems.push("music.narrationGain above 0.5 would compete with the narration");
  }
  fx.forEach((e, i) => {
    if (!e.asset || !fs.existsSync(assetPath(e.asset))) problems.push(`soundEffects[${i}].asset not found: ${e.asset}`);
    num(e.gain ?? 1, `soundEffects[${i}].gain`, 0, 2);
    try { const t = timeOf(e.at, plan); if (!(t >= 0 && t < duration)) problems.push(`soundEffects[${i}] plays at ${t.toFixed(2)}s, outside the video (0–${duration.toFixed(2)}s)`); } catch (err) { problems.push(`soundEffects[${i}].at: ${err.message}`); }
  });
  if (problems.length) throw new ConfigError(problems);
}

/**
 * ffmpeg inputs + filter graph. `include` picks which buses are built (the full mix has all three; verification renders each alone,
 * from the very same filter strings). Excluded buses are replaced by silence so every bus has the video's length.
 */
export function buildGraph(episode, plan, { duration, narration, video = null, include = { voice: true, cues: true, music: true } }) {
  const args = [], chains = [], labels = [];
  let i = 0;
  if (video) { args.push("-i", video); i++; }
  const voice = i++;
  if (include.voice) args.push("-i", narration); else args.push("-f", "lavfi", "-t", String(duration), "-i", `anullsrc=r=${SR}:cl=mono`);
  chains.push(`[${voice}:a]apad=whole_dur=${duration}[voice]`); labels.push("[voice]");
  if (include.cues) (episode.soundEffects ?? []).forEach((e, k) => {
    args.push("-i", assetPath(e.asset));
    chains.push(`[${i++}:a]volume=${e.gain ?? 1},adelay=${Math.round(timeOf(e.at, plan) * 1000)}:all=1[cue${k}]`); labels.push(`[cue${k}]`);
  });
  const m = episode.music;
  if (include.music && m) {
    const assetSeconds = decodeAudio(assetPath(m.asset)).length / SR;
    if (assetSeconds < duration) args.push("-stream_loop", "-1");
    args.push("-i", assetPath(m.asset));
    const riseAt = m.riseAt === undefined ? plan.audioEnd : timeOf(m.riseAt, plan);
    const ending = m.endingGain ?? m.narrationGain, fadeOut = m.fadeOut ?? 0;
    const gain = `${m.narrationGain}+(${ending}-${m.narrationGain})*min(1,max(0,(t-${riseAt})/${m.riseDuration ?? 0.6}))`;
    chains.push(`[${i++}:a]volume='${gain}':eval=frame,afade=t=in:d=${m.fadeIn ?? 0},afade=t=out:st=${duration - fadeOut}:d=${fadeOut}[music]`); labels.push("[music]");
  }
  chains.push(labels.length > 1 ? `${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[a]` : `${labels[0]}acopy[a]`);
  return { args, filter: chains.join(";") };
}

/** Mix `episode.music` / `episode.soundEffects` over the narration of an already-rendered video. Returns null when there is nothing to mix. */
export function mixAudio({ episode, plan, video, narration, out }) {
  if (!needsMix(episode)) return null;
  const duration = probeDuration(video);
  validateMix(episode, plan, duration);
  const { args, filter } = buildGraph(episode, plan, { duration, narration, video });
  run([...args, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(duration), "-movflags", "+faststart", out]);
  return { out, duration };
}

// ---------- verification ----------
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const peakOf = (x) => { let p = 0; for (const v of x) { const a = Math.abs(v); if (a > p) p = a; } return p; };
function onset(x, from, to, level, blockMs = 5) {
  const w = Math.round((blockMs / 1000) * SR);
  for (let s = Math.max(0, Math.round(from * SR)); s < Math.min(x.length, Math.round(to * SR)); s += w) if (rms(x, s, s + w) > level) return s / SR;
  return null;
}

/** Decode every bus lossless and check the final file against them. Returns { ok, checks }. */
export function verifyMix({ episode, plan, base, out, narration, workDir, referenceOut = null }) {
  fs.mkdirSync(workDir, { recursive: true });
  const duration = probeDuration(base), checks = [], add = (name, ok, detail) => checks.push({ name, ok, detail });
  const bus = (name, include) => {
    const { args, filter } = buildGraph(episode, plan, { duration, narration, include });
    const file = path.join(workDir, `bus-${name}.wav`);
    run([...args, "-filter_complex", filter, "-map", "[a]", "-t", String(duration), "-ac", "1", "-ar", String(SR), "-c:a", "pcm_f32le", file]);
    return decodeAudio(file);
  };
  const n = bus("voice", { voice: true, cues: false, music: false });
  const m = episode.music ? bus("music", { voice: false, cues: false, music: true }) : new Float32Array(n.length);
  const c = (episode.soundEffects ?? []).length ? bus("cues", { voice: false, cues: true, music: false }) : new Float32Array(n.length);
  const f = decodeAudio(out), len = Math.min(f.length, n.length);

  // 1. the video stream is the untouched copy
  const packets = (file) => spawnSync(FFMPEG, ["-v", "error", "-i", file, "-map", "0:v", "-c:v", "copy", "-f", "h264", "-"], { maxBuffer: 1 << 29 }).stdout;
  add("video stream identical to the narration-only render", Buffer.compare(packets(base), packets(out)) === 0, null);
  // 2. duration unchanged
  const outDuration = probeDuration(out);
  add("duration unchanged by the music", Math.abs(outDuration - duration) < 0.05, { base: +duration.toFixed(3), mixed: +outDuration.toFixed(3) });
  // 3. no clipping
  const peak = peakOf(f);
  add("no clipping (peak below −0.5 dBFS)", peak < 0.944, { peakDbfs: +db(peak).toFixed(2) });
  // 4. the narration is still there, unchanged, inside the mix (only AAC noise differs)
  const inside = new Float32Array(len); for (let i = 0; i < len; i++) inside[i] = f[i] - m[i] - c[i];
  const err = new Float32Array(len); for (let i = 0; i < len; i++) err[i] = inside[i] - n[i];
  const snr = db(rms(n, 0, len) / Math.max(rms(err, 0, len), 1e-9));
  add("narration preserved inside the mix (SNR vs the original narration, AAC noise only)", snr >= 15, { snrDb: +snr.toFixed(1), note: "AAC 192k coding noise is the only expected difference" });
  // 5. music stays under the voice while someone speaks
  if (episode.music) {
    const margins = plan.lines.filter((l) => !l.silent).map((l) => ({ id: l.id, musicVsVoiceDb: +db(rms(m, Math.round(l.start * SR), Math.round(l.end * SR)) / Math.max(rms(n, Math.round(l.start * SR), Math.round(l.end * SR)), 1e-9)).toFixed(1) }));
    const loudest = margins.reduce((a, b) => (b.musicVsVoiceDb > a.musicVsVoiceDb ? b : a));
    add("music at least 10 dB below the narration during every spoken line", loudest.musicVsVoiceDb <= -10, { loudest, lines: margins });
  }
  // 6. sound effects land where the episode says
  (episode.soundEffects ?? []).forEach((e, k) => {
    const asset = decodeAudio(assetPath(e.asset)), level = 0.01 * (e.gain ?? 1);
    const assetOnset = onset(asset, 0, asset.length / SR, 0.01) ?? 0, expected = timeOf(e.at, plan) + assetOnset;
    const busOnset = onset(c, expected - 0.2, expected + 0.5, level), residual = new Float32Array(len); for (let i = 0; i < len; i++) residual[i] = f[i] - n[i] - m[i];
    const finalOnset = onset(residual, expected - 0.2, expected + 0.5, level);
    add(`SFX ${k} (${path.basename(e.asset)}) starts at its trigger`, busOnset !== null && finalOnset !== null && Math.abs(busOnset - expected) < 0.01 && Math.abs(finalOnset - expected) < 0.02, { trigger: +timeOf(e.at, plan).toFixed(3), expectedAudible: +expected.toFixed(3), inBus: busOnset && +busOnset.toFixed(3), inFinalFile: finalOnset && +finalOnset.toFixed(3) });
  });
  // 7. optional: the approved reference file (same audio chain on the same inputs) must decode to the same samples
  if (referenceOut) {
    const r = decodeAudio(referenceOut), l = Math.min(r.length, f.length); let maxDiff = 0;
    for (let i = 0; i < l; i++) maxDiff = Math.max(maxDiff, Math.abs(r[i] - f[i]));
    add("identical to the approved reference mix", r.length === f.length && maxDiff < 1e-4, { samples: f.length, referenceSamples: r.length, maxSampleDifference: +maxDiff.toFixed(6) });
  }
  return { ok: checks.every((x) => x.ok), checks, peakDbfs: +db(peak).toFixed(2) };
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : undefined; };
  try {
    const episodeFile = path.resolve(args.find((a, i) => !a.startsWith("--") && !["--video", "--out", "--docs", "--reference"].includes(args[i - 1])) || "");
    if (!fs.existsSync(episodeFile) || !value("video") || !value("out")) throw new ConfigError("usage: node scripts/video/audio-mix.mjs <episode.json> --video <rendered.mp4> --out <mixed.mp4> [--docs dir] [--reference approved.mp4] [--no-verify]");
    const episode = JSON.parse(fs.readFileSync(episodeFile, "utf8"));
    const plan = JSON.parse(fs.readFileSync(assetPath(episode.plan), "utf8")), narration = assetPath(episode.audio);
    const video = path.resolve(value("video")), out = path.resolve(value("out"));
    if (!needsMix(episode)) { console.log("episode has no music or soundEffects: nothing to mix, the narration-only video is the result"); process.exit(0); }
    if (out === video) throw new ConfigError("--out must differ from --video (the narration-only render is kept)");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const r = mixAudio({ episode, plan, video, narration, out });
    console.log(`mixed: ${path.relative(REPO_ROOT, out)} / ${r.duration.toFixed(3)}s`);
    if (!args.includes("--no-verify")) {
      const docs = path.resolve(value("docs") || path.dirname(narration));
      const v = verifyMix({ episode, plan, base: video, out, narration, workDir: path.join(docs, "mix-work"), referenceOut: value("reference") && path.resolve(value("reference")) });
      fs.writeFileSync(path.join(docs, "mix-verification.json"), JSON.stringify(v, null, 2) + "\n");
      for (const c of v.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail && !c.ok ? "  " + JSON.stringify(c.detail).slice(0, 300) : ""}`);
      console.log(`peak ${v.peakDbfs} dBFS`);
      if (!v.ok) process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof ConfigError) { console.error(`\n${e.name}: ${e.message}`); process.exit(1); }
    throw e;
  }
}
