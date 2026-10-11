// Build narration.wav + plan.json for one episode from its cached segments. Local, free, never calls the API.
//
//   node scripts/video/assemble.mjs p2                 → docs/p2-auto/{narration.wav, p2-auto.plan.json, assembly.json}
//   options: --out <dir>   --narration <file>   --voices <file>   --episode <file>
// The episode that uses this narration is cross-checked first (every referenced line id / word must exist).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AlignmentError } from "./voice/align.mjs";
import { writeWav } from "./voice/audio.mjs";
import { assembleNarration } from "./voice/assemble.mjs";
import { createCache } from "./voice/cache.mjs";
import { ConfigError, DEFAULT_VOICES_FILE, REPO_ROOT, loadVoiceConfig } from "./voice/config.mjs";
import { loadNarration, prepareNarration } from "./voice/segments.mjs";
import { assertEpisode, findEpisodeFor, linesFromNarration } from "./voice/episode-refs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const target = args.find((a, i) => !a.startsWith("--") && !["--out", "--narration", "--voices", "--episode"].includes(args[i - 1]));

try {
  if (!target && !value("narration")) throw new ConfigError("usage: node scripts/video/assemble.mjs <episode-id | narration.json> [--out dir]");
  const file = value("narration") || (/[\\/]|\.json$/.test(target) ? path.resolve(target) : path.join(HERE, "narration", `${target}.json`));
  const prepared = prepareNarration(loadNarration(file), loadVoiceConfig(value("voices", DEFAULT_VOICES_FILE)), { requireApiKey: false });
  const episodeFile = value("episode") ? path.resolve(value("episode")) : findEpisodeFor(prepared.id);
  if (episodeFile) assertEpisode(JSON.parse(fs.readFileSync(episodeFile, "utf8")), linesFromNarration(prepared), path.basename(episodeFile));
  const { plan, samples, provenance } = assembleNarration(prepared, createCache());
  const out = path.resolve(value("out", path.join(REPO_ROOT, "docs", plan.id)));
  fs.mkdirSync(out, { recursive: true });
  writeWav(path.join(out, "narration.wav"), samples);
  fs.writeFileSync(path.join(out, `${plan.id}.plan.json`), JSON.stringify(plan, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "assembly.json"), JSON.stringify(provenance, null, 2) + "\n");
  console.log(`${plan.id}: ${plan.duration.toFixed(3)}s / ${plan.frames} frames / audioEnd ${plan.audioEnd.toFixed(3)}s → ${path.relative(process.cwd(), out)}`);
  for (const l of plan.lines) console.log(`  ${l.id.padEnd(18)} ${l.start.toFixed(3).padStart(7)} – ${l.end.toFixed(3).padStart(7)}  ${l.silent ? "silent" : `${l.words.length} words`}`);
  if (provenance.warnings.length) { console.log("\nwarnings:"); provenance.warnings.forEach((w) => console.log("  " + w)); }
} catch (e) {
  if (e instanceof ConfigError || e instanceof AlignmentError) { console.error(`\n${e.name}: ${e.message}`); process.exit(1); }
  throw e;
}
