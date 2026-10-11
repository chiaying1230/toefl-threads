// Minimal live check of the ElevenLabs timestamps contract. MAKES ONE REAL API REQUEST (costs a few credits).
// It refuses to run without --yes, and refuses text longer than 40 characters.
//
//   node scripts/video/voice/smoke-timestamps.mjs --role story --yes
//   node scripts/video/voice/smoke-timestamps.mjs --role meaning --text "分配、撥出。" --yes
//
// Writes the audio and the raw API alignment to voice-cache/smoke/ (git-ignored) so they can be inspected,
// then runs the same alignment → words conversion the pipeline will use and prints the table.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, ConfigError, assertReady, loadDotEnv, loadVoiceConfig } from "./config.mjs";
import { synthesizeWithTimestamps, ElevenLabsError } from "./elevenlabs.mjs";
import { alignmentToWords, AlignmentError } from "./align.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const role = arg("role", "story");
const text = arg("text", role === "meaning" ? "分配、撥出。" : "We allocate money to advertising.");

try {
  if (!process.argv.includes("--yes")) throw new ConfigError("this makes a real, billed API request; re-run with --yes");
  if (text.length > 40) throw new ConfigError(`smoke text is ${text.length} characters; keep it to 40 or fewer`);
  loadDotEnv();
  const cfg = loadVoiceConfig();
  const voice = assertReady(cfg, { roles: [role] })[role];
  const format = cfg.output?.format || "mp3_44100_128";
  const r = await synthesizeWithTimestamps({ voice, text, outputFormat: format, apiBase: cfg.apiBase });
  const { words, speechStart, speechEnd } = alignmentToWords(text, r.alignment, { audioDuration: r.estimatedDuration, tokens: voice.lang === "zh" ? "none" : "whitespace" });

  const dir = path.join(REPO_ROOT, "voice-cache", "smoke");
  fs.mkdirSync(dir, { recursive: true });
  const stem = path.join(dir, `${role}-${Date.now()}`);
  fs.writeFileSync(`${stem}.mp3`, r.audio);
  fs.writeFileSync(`${stem}.alignment.json`, JSON.stringify({ text, voice: voice.name, model: voice.model, alignment: r.alignment, normalized_alignment: r.normalizedAlignment }, null, 2));
  console.log(`voice=${voice.name} model=${voice.model} chars=${r.characters} bytes=${r.audio.length} estDuration=${r.estimatedDuration?.toFixed(2)}s`);
  console.log(`speech ${speechStart.toFixed(3)}s → ${speechEnd.toFixed(3)}s; normalized alignment ${r.normalizedAlignment ? "present" : "absent"}`);
  console.table(words);
  console.log(`saved ${path.relative(REPO_ROOT, stem)}.{mp3,alignment.json}`);
} catch (e) {
  if (e instanceof ConfigError || e instanceof ElevenLabsError || e instanceof AlignmentError) { console.error(`${e.name}: ${e.message}`); process.exit(1); }
  throw e;
}
